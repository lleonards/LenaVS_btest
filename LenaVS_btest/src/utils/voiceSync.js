/**
 * voiceSync.js  —  v6 (Beam Search + Fuzzy Matching Robusto)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sincroniza automaticamente as estrofes da letra com a música usando:
 *
 *   ETAPA 1 — Whisper API (word-level timestamps)
 *     • Transcreve o áudio com OpenAI Whisper (verbose_json + word timestamps)
 *     • Cada palavra transcrita tem { word, start, end }
 *
 *   ETAPA 2 — Beam Search Fuzzy Matching (v6)
 *     • Para cada estrofe gera TOP-K candidatos sobre o áudio COMPLETO
 *       usando Inverted Index para eficiência (O(n) por estrofe)
 *     • Similaridade melhorada: F1 token + bigram order + anchor bonus
 *       + edit distance suave para erros de transcrição
 *     • Beam Search global (largura=5): seleciona a sequência de matches
 *       com melhor combinação de similaridade + consistência temporal
 *     • Cursor flexível: sem bloqueio rígido — penalidade suave por distância
 *     • Penaliza sobreposição e gaps muito grandes entre estrofes
 *     • Detecta "palavras âncora" (raras, alta confiança) para guiar o alinhamento
 *     • Fallback inteligente: janela maior → threshold reduzido → null
 *
 *   FALLBACKS (sem API key ou Whisper falhar):
 *     CAMADA 3 — FFmpeg silence-detect (detecta segmentos de fala)
 *     CAMADA 4 — Distribuição proporcional por nº de palavras
 *
 * ─── Exports públicos ───────────────────────────────────────────────────────
 *
 *  syncStanzasWithWhisper(audioUrl, stanzas, opts?)
 *    → Promise<[{ start, end, lines:[{start,end,text}] }]>
 *
 *  syncStanzasWithWhisperAnchors(audioUrl, stanzas, opts?)
 *    → Promise<[{ text, startTime, endTime }]>
 *
 *  chooseBestAudioCandidateByLyrics(audioUrls, stanzas, opts?)
 *    → Promise<{ bestUrl, bestIndex, ranking }>
 *
 * Requer: openai, fluent-ffmpeg
 * Env:    OPENAI_API_KEY (opcional — fallback sem API)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import OpenAI  from 'openai';
import fs      from 'fs';
import path    from 'path';
import os      from 'os';
import https   from 'https';
import http    from 'http';
import ffmpeg  from 'fluent-ffmpeg';
import { spawn } from 'child_process';

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 1 — HELPERS DE TEXTO
// ═════════════════════════════════════════════════════════════════════════════

/** Normaliza uma palavra: lowercase, sem acento, só alfanumérico */
function normalizeWord(w) {
  return String(w || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w]/g, '');
}

/** Extrai lista de palavras normalizadas (mín. 2 chars) */
function extractWords(text) {
  return String(text || '')
    .split(/\s+/)
    .map(normalizeWord)
    .filter(w => w.length >= 2);
}

/** Extrai lista de palavras normalizadas (permite 1 char) */
function extractWordsAllowShort(text) {
  return String(text || '')
    .split(/\s+/)
    .map(normalizeWord)
    .filter(w => w.length > 0);
}

/**
 * Remove repetições consecutivas (p/ reduzir "vocal sustentado" / stutter).
 */
function removeConsecutiveDuplicates(words) {
  const out = [];
  for (const w of words || []) {
    if (!w) continue;
    if (out.length === 0 || out[out.length - 1] !== w) out.push(w);
  }
  return out;
}

/** Divide texto de estrofe em linhas (sem vazias) */
function splitLines(text) {
  return String(text || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 2 — FUZZY MATCHING DE BLOCOS (v6 — Beam Search)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * fuzzyMatchStanzas  —  v6
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Algoritmo refatorado com:
 *  1. Geração de TOP-K candidatos por estrofe (busca no áudio inteiro via
 *     inverted index — eficiente)
 *  2. Scoring melhorado: F1 token + bigram order + anchor bonus + edit-distance suave
 *  3. Beam Search global (largura BEAM_WIDTH) para consistência temporal
 *  4. Penalidade suave por distância temporal (sem cursor rígido)
 *  5. Penalidade por sobreposição e grandes gaps
 *  6. Detecção de palavras âncora (raras + presentes no Whisper)
 *  7. Fallback por janela maior se score insuficiente
 *
 * @param {Array} stanzas      [{text}]
 * @param {Array} whisperWords [{word, start, end}]
 * @returns {Array} [{text, startIdx, endIdx, startTime, endTime, score}|null]
 */
function fuzzyMatchStanzas(stanzas, whisperWords, opts = {}) {

  // ── Configuração ──────────────────────────────────────────────────────────
  const BEAM_WIDTH      = 5;    // largura do beam search
  const TOP_K           = 6;    // candidatos por estrofe
  const MIN_SCORE       = 0.22; // score mínimo para aceitar um match
  const WINDOW_RATIO    = 1.15; // janela ~15% maior que a estrofe
  const WINDOW_FLEX     = 0.45; // ±45% de flexibilidade no tamanho
  const MIN_WINDOW      = 3;    // janela mínima em palavras
  const TEMPORAL_W      = 0.18; // peso da consistência temporal no beam score
  const ANCHOR_BONUS    = 0.14; // bônus por palavra âncora encontrada
  const OVERLAP_PENALTY = 0.28; // penalidade por sobreposição
  const GAP_PENALTY_MAX = 0.08; // penalidade máxima por gap muito longo
  const NULL_PENALTY    = 0.06; // penalidade por estrofe sem match

  const wNorm = whisperWords.map(w => normalizeWord(w.word));
  const total = wNorm.length;

  if (total === 0 || stanzas.length === 0) {
    return stanzas.map(() => null);
  }

  const totalDur = whisperWords[total - 1]?.end
    ?? whisperWords[total - 1]?.start
    ?? 0;

  // ── 1. Pré-computação dos dados por estrofe ───────────────────────────────

  const stanzaData = stanzas.map(stanza => {
    const text     = String(stanza.text || '');
    const wordsRaw = extractWordsAllowShort(text);
    const words    = removeConsecutiveDuplicates(wordsRaw);
    const wordSet  = new Set(words);
    const bigrams  = _makeBigramSet(words);
    return { text, words, wordSet, wordsRaw, bigrams };
  });

  // ── 2. Detecção de palavras âncora ───────────────────────────────────────
  // Âncoras = palavras raras na letra (≤ 2 ocorrências) que também estão
  // no Whisper — são pontos de alta confiança no alinhamento.

  const globalLyricFreq = new Map();
  for (const { words } of stanzaData) {
    for (const w of words) {
      globalLyricFreq.set(w, (globalLyricFreq.get(w) || 0) + 1);
    }
  }
  const whisperSet = new Set(wNorm);
  const anchorPool = new Set();
  for (const [word, freq] of globalLyricFreq) {
    if (freq <= 2 && word.length >= 4 && whisperSet.has(word)) {
      anchorPool.add(word);
    }
  }

  // Âncoras por estrofe
  const stanzaAnchors = stanzaData.map(({ words }) => {
    const a = new Set();
    for (const w of words) { if (anchorPool.has(w)) a.add(w); }
    return a;
  });

  // ── 3. Inverted index: palavra → [posições no Whisper] ───────────────────

  const invertedIndex = new Map();
  for (let i = 0; i < wNorm.length; i++) {
    const w = wNorm[i];
    if (!invertedIndex.has(w)) invertedIndex.set(w, []);
    invertedIndex.get(w).push(i);
  }

  // ── 4. Funções de scoring ─────────────────────────────────────────────────

  /** Edit distance com early-exit (custo O(la*lb), cap = máx. erros aceitos) */
  function _editDistanceCapped(a, b, cap) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > cap) return cap + 1;
    const row = Array.from({ length: lb + 1 }, (_, i) => i);
    for (let i = 1; i <= la; i++) {
      let prev = row[0];
      row[0] = i;
      let minRow = row[0];
      for (let j = 1; j <= lb; j++) {
        const tmp = row[j];
        row[j] = a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, row[j], row[j - 1]);
        prev = tmp;
        minRow = Math.min(minRow, row[j]);
      }
      if (minRow > cap) return cap + 1;
    }
    return row[lb];
  }

  /**
   * Similaridade suave entre duas palavras normalizadas.
   * Usa edit distance com pré-filtros para máxima eficiência.
   */
  function _wordSim(a, b) {
    if (a === b) return 1.0;
    if (a.length < 3 || b.length < 3) return 0;
    const lenDiff = Math.abs(a.length - b.length);
    if (lenDiff > 3) return 0;
    // Pré-filtro: pelo menos 1 dos 2 primeiros chars deve coincidir
    if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0]) return 0;
    const cap  = Math.min(2, Math.floor(Math.max(a.length, b.length) * 0.35));
    const dist = _editDistanceCapped(a, b, cap);
    if (dist > cap) return 0;
    return 1 - dist / Math.max(a.length, b.length);
  }

  /** Cria Set de bigramas "w1|w2" a partir de array de palavras */
  function _makeBigramSet(words) {
    const bg = new Set();
    for (let i = 0; i < words.length - 1; i++) {
      bg.add(words[i] + '|' + words[i + 1]);
    }
    return bg;
  }

  /**
   * Score de uma janela em relação a uma estrofe.
   *
   * Componentes:
   *  - recall:    fração das palavras da estrofe presentes na janela (exato + fuzzy)
   *  - precision: fração das palavras da janela cobertas pela estrofe
   *  - f1:        média harmônica de recall e precision
   *  - bigram:    fração dos bigramas da estrofe presentes na janela
   *  - anchor:    fração das palavras âncora da estrofe encontradas na janela
   *
   * Combinação final:
   *   score = 0.50*f1 + 0.25*bigram + 0.15*recall + anchor_bonus
   */
  function _scoreWindow(sd, anchors, windowWords) {
    const { words: sWords, wordSet: sSet, bigrams: sBigrams } = sd;
    if (sWords.length === 0 || windowWords.length === 0) return 0;

    const windowSet  = new Set(windowWords);
    const wBigrams   = _makeBigramSet(windowWords);

    // ── Token matching (exact + fuzzy) ───────────────────────
    let matchedS = 0;            // stanza words matched
    const usedW  = new Set();    // window words already matched

    for (const sw of sWords) {
      if (sSet.has(sw) && windowSet.has(sw)) {
        // Exact match (fast path)
        matchedS++;
        usedW.add(sw);
      } else {
        // Fuzzy match
        let best = 0, bestW = null;
        for (const ww of windowWords) {
          if (usedW.has(ww)) continue;
          const sim = _wordSim(sw, ww);
          if (sim > best) { best = sim; bestW = ww; }
        }
        if (best >= 0.70) { matchedS++; if (bestW) usedW.add(bestW); }
      }
    }

    const recall    = matchedS / sWords.length;
    const precision = windowWords.length > 0 ? usedW.size / windowWords.length : 0;
    const f1 = (recall + precision > 0)
      ? 2 * recall * precision / (recall + precision)
      : 0;

    // ── Bigram order bonus ───────────────────────────────────
    let bgHits = 0;
    for (const bg of sBigrams) { if (wBigrams.has(bg)) bgHits++; }
    const bigramScore = sBigrams.size > 0 ? bgHits / sBigrams.size : 0;

    // ── Anchor bonus ─────────────────────────────────────────
    let anchorScore = 0;
    if (anchors && anchors.size > 0) {
      let hits = 0;
      for (const aw of anchors) { if (windowSet.has(aw)) hits++; }
      anchorScore = hits / anchors.size;
    }

    // ── Combinação final ─────────────────────────────────────
    let score = 0.50 * f1 + 0.25 * bigramScore + 0.15 * recall + 0.10 * precision;

    // Âncora: bônus aditivo
    if (anchorScore > 0) {
      score = Math.min(1.0, score + ANCHOR_BONUS * anchorScore);
    }

    // Penalidade suave por diferença de comprimento extrema
    const lenRatio = Math.min(sWords.length, windowWords.length)
                   / Math.max(sWords.length, windowWords.length);
    if (lenRatio < 0.45) score *= 0.65 + 0.35 * (lenRatio / 0.45);

    return Math.max(0, Math.min(1, score));
  }

  // ── 5. Geração de candidatos por estrofe ─────────────────────────────────

  /**
   * Gera os TOP-K candidatos de janela para uma estrofe.
   *
   * Usa inverted index para pré-filtrar posições onde pelo menos uma palavra
   * da estrofe aparece no Whisper — evita varrer o áudio inteiro.
   *
   * Fallback automático: se candidatos insuficientes, expande janela e
   * reduz threshold.
   */
  function _generateCandidates(stanzaIdx, sd, anchors, K) {
    if (sd.words.length === 0) return [];

    const winBase = Math.max(MIN_WINDOW,
      Math.round(sd.wordsRaw.length * WINDOW_RATIO));
    const winMin  = Math.max(MIN_WINDOW, Math.floor(winBase * (1 - WINDOW_FLEX)));
    const winMax  = Math.ceil(winBase * (1 + WINDOW_FLEX));

    // Posições candidatas via inverted index
    const candStarts = new Set();
    for (const w of sd.words) {
      for (const pos of (invertedIndex.get(w) || [])) {
        // A palavra pode estar em qualquer posição dentro da janela
        for (let s = Math.max(0, pos - winMax + 1); s <= pos; s++) {
          candStarts.add(s);
        }
      }
    }

    // Adiciona posições âncora com prioridade
    for (const aw of (anchors || [])) {
      for (const pos of (invertedIndex.get(aw) || [])) {
        for (let s = Math.max(0, pos - winMax + 1); s <= pos; s++) {
          candStarts.add(s);
        }
      }
    }

    // Fallback: se poucas posições, usa expected position + vizinhança
    if (candStarts.size < 5) {
      const exp = Math.floor((stanzaIdx / Math.max(1, stanzas.length - 1)) * total);
      const r   = Math.floor(total * 0.35);
      for (let p = Math.max(0, exp - r); p <= Math.min(total - winMin, exp + r); p++) {
        candStarts.add(p);
      }
    }

    const threshold = MIN_SCORE * 0.65; // threshold relaxado para candidatos
    const raw = [];

    for (const startPos of candStarts) {
      // Testa 3 tamanhos de janela: mínimo, base, máximo
      for (const w of [winMin, winBase, winMax]) {
        if (startPos + w > total) continue;
        const windowWordsRaw = wNorm.slice(startPos, startPos + w);
        const windowWords    = removeConsecutiveDuplicates(windowWordsRaw);
        const score = _scoreWindow(sd, anchors, windowWords);
        if (score >= threshold) {
          const startTime = whisperWords[startPos]?.start ?? 0;
          const endTime   = whisperWords[startPos + w - 1]?.end
            ?? whisperWords[startPos + w - 1]?.start
            ?? startTime;
          raw.push({ startIdx: startPos, endIdx: startPos + w - 1, startTime, endTime, score });
        }
      }
    }

    // ── Fallback inteligente: janela maior / threshold menor ─────────────────
    if (raw.filter(c => c.score >= MIN_SCORE).length < 2) {
      const bigWin  = Math.ceil(winMax * 1.5);
      const softThr = MIN_SCORE * 0.5;
      for (const startPos of candStarts) {
        if (startPos + bigWin > total) continue;
        const windowWords = removeConsecutiveDuplicates(wNorm.slice(startPos, startPos + bigWin));
        const score = _scoreWindow(sd, anchors, windowWords);
        if (score >= softThr) {
          const startTime = whisperWords[startPos]?.start ?? 0;
          const endTime   = whisperWords[startPos + bigWin - 1]?.end
            ?? whisperWords[startPos + bigWin - 1]?.start
            ?? startTime;
          raw.push({ startIdx: startPos, endIdx: startPos + bigWin - 1, startTime, endTime, score });
        }
      }
    }

    // Ordenar por score desc
    raw.sort((a, b) => b.score - a.score);

    // Desduplicar: remove candidatos que cobrem ≥60% da mesma região
    const deduped = [];
    for (const c of raw) {
      let dup = false;
      for (const d of deduped) {
        const overS = Math.max(c.startIdx, d.startIdx);
        const overE = Math.min(c.endIdx,   d.endIdx);
        if (overE >= overS) {
          const overlapRatio = (overE - overS + 1) / (c.endIdx - c.startIdx + 1);
          if (overlapRatio >= 0.60) { dup = true; break; }
        }
      }
      if (!dup) deduped.push(c);
      if (deduped.length >= K * 2) break;
    }

    return deduped.slice(0, K);
  }

  // ── 6. Geração de candidatos para todas as estrofes ───────────────────────

  console.log('[voiceSync] v6: gerando candidatos via inverted index...');
  const allCandidates = stanzaData.map((sd, idx) =>
    _generateCandidates(idx, sd, stanzaAnchors[idx], TOP_K)
  );

  // ── 7. Beam Search global ─────────────────────────────────────────────────
  //
  // Estado de cada beam:
  //   assignments: Array<candidato|null>   (um elemento por estrofe)
  //   lastEndIdx:  índice da última palavra usada
  //   lastEndTime: tempo final da última estrofe matched
  //   score:       score acumulado do beam
  //
  // Expansão: para cada estrofe, cada beam tenta cada candidato (com
  // penalidades temporais) + opção null.
  // Poda: mantém apenas BEAM_WIDTH beams de maior score.

  /** Calcula score de um candidato numa transição de beam */
  function _transitionScore(beam, cand, stanzaIdx) {
    // Hard constraint: não pode voltar muito no tempo (tolerância de 1 s)
    if (cand.startTime < beam.lastEndTime - 1.0) return null; // inválido

    // Consistência temporal: esperamos progressão suave
    const expectedFraction = stanzaIdx / Math.max(1, stanzas.length - 1);
    const actualFraction   = totalDur > 0 ? cand.startTime / totalDur : 0;
    const timeDelta        = Math.abs(actualFraction - expectedFraction);
    const temporalBonus    = Math.max(0, 1 - timeDelta * 2.0);

    // Penalidade por sobreposição com a estrofe anterior
    const overlap = beam.lastEndIdx >= 0 && cand.startIdx <= beam.lastEndIdx
      ? OVERLAP_PENALTY
      : 0;

    // Penalidade por gap muito longo (> 30s sem letra)
    const gap = cand.startTime - beam.lastEndTime;
    const gapPenalty = gap > 30
      ? GAP_PENALTY_MAX * Math.min(1, (gap - 30) / 60)
      : 0;

    return cand.score * (1 + TEMPORAL_W * temporalBonus) - overlap - gapPenalty;
  }

  // Inicializa beam
  let beams = [{
    assignments: [],
    lastEndIdx:  -1,
    lastEndTime: 0,
    score:       0
  }];

  for (let si = 0; si < stanzas.length; si++) {
    const candidates = allCandidates[si];
    const newBeams   = [];

    for (const beam of beams) {
      // Opção A: atribuir um candidato a esta estrofe
      for (const cand of candidates) {
        const ts = _transitionScore(beam, cand, si);
        if (ts === null) continue; // hard constraint violada

        newBeams.push({
          assignments: [...beam.assignments, { ...cand }],
          lastEndIdx:  cand.endIdx,
          lastEndTime: cand.endTime,
          score:       beam.score + ts
        });
      }

      // Opção B: estrofe sem match (null)
      newBeams.push({
        assignments: [...beam.assignments, null],
        lastEndIdx:  beam.lastEndIdx,
        lastEndTime: beam.lastEndTime,
        score:       beam.score - NULL_PENALTY
      });
    }

    // Poda: mantém TOP BEAM_WIDTH
    newBeams.sort((a, b) => b.score - a.score);
    beams = newBeams.slice(0, BEAM_WIDTH);
  }

  // ── 8. Resultado do melhor beam ──────────────────────────────────────────

  const bestBeam = beams[0];

  const matches = bestBeam.assignments.map((match, i) => {
    if (!match || match.score < MIN_SCORE) {
      console.log(
        `[voiceSync] v6: estrofe sem match (score=${match ? match.score.toFixed(3) : 'null'}): ` +
        `"${String(stanzas[i]?.text || '').slice(0, 40)}..."`
      );
      return null;
    }

    const stanzaText = String(stanzas[i]?.text || '');
    return {
      text:      stanzaText,
      startIdx:  match.startIdx,
      endIdx:    match.endIdx,
      startTime: Math.max(0, match.startTime - 0.05),
      endTime:   match.endTime + 0.10,
      score:     match.score,
      rawScore:  match.score
    };
  });

  if (opts.returnMeta) {
    return {
      matches,
      candidates: allCandidates,
      totalDur
    };
  }

  return matches;
}

/**
 * Preenche estrofes sem match (null) interpolando entre vizinhos com match.
 *
 * @param {Array}  matches   saída de fuzzyMatchStanzas
 * @param {Array}  stanzas   [{text}]
 * @param {number} totalDur  duração total do áudio em segundos
 * @returns {Array} matches sem nulls
 */
function fillNullMatches(matches, stanzas, totalDur) {
  const n = matches.length;
  const r = matches.map(m => (m ? { ...m } : null));

  for (let i = 0; i < n; i++) {
    if (r[i] !== null) continue;

    let prev = null, next = null;
    for (let j = i - 1; j >= 0; j--) { if (r[j]) { prev = { v: r[j], i: j }; break; } }
    for (let j = i + 1; j < n;  j++) { if (r[j]) { next = { v: r[j], i: j }; break; } }

    let startTime, endTime;

    if (prev && next) {
      const slots = next.i - prev.i;
      const step  = (next.v.startTime - prev.v.endTime) / slots;
      const k     = i - prev.i;
      startTime = prev.v.endTime + step * (k - 1) + 0.1;
      endTime   = prev.v.endTime + step * k;
    } else if (prev) {
      const step = 3.5;
      const k    = i - prev.i;
      startTime = prev.v.endTime + step * (k - 1) + 0.1;
      endTime   = startTime + step - 0.1;
    } else if (next) {
      const step = next.v.startTime / (next.i + 1);
      startTime  = Math.max(0, step * i);
      endTime    = step * (i + 1) - 0.1;
    } else {
      startTime = (totalDur / n) * i;
      endTime   = (totalDur / n) * (i + 1);
    }

    r[i] = {
      text:      stanzas[i]?.text || '',
      startTime: Math.max(0, startTime),
      endTime:   Math.min(totalDur, endTime),
      score:     0
    };
  }

  return r;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createStanzaSignature(text) {
  return removeConsecutiveDuplicates(extractWordsAllowShort(text)).join(' ');
}

function getWordsInTimeRange(whisperWords, startTime, endTime, padding = 0.12) {
  return (whisperWords || []).filter((w) => {
    const st = Number.isFinite(w?.start) ? w.start : null;
    const en = Number.isFinite(w?.end) ? w.end : st;
    if (st === null && en === null) return false;
    const safeStart = st ?? en;
    const safeEnd = en ?? st ?? safeStart;
    return safeEnd >= (startTime - padding) && safeStart <= (endTime + padding);
  });
}

function makeBigramSet(words) {
  const set = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    set.add(`${words[i]}|${words[i + 1]}`);
  }
  return set;
}

function evaluateMatchQuality(stanza, match, whisperWords, totalDur) {
  const stanzaText = String(stanza?.text || '');
  const lyricWords = removeConsecutiveDuplicates(extractWordsAllowShort(stanzaText));

  if (!match) {
    return {
      signature: createStanzaSignature(stanzaText),
      recognizedWords: 0,
      lyricWordCount: lyricWords.length,
      lexicalCoverage: 0,
      orderCoverage: 0,
      vocalPresence: false,
      confidence: 0,
      verified: false,
      lowConfidence: true,
      reason: 'sem-match'
    };
  }

  const windowWordsRaw = getWordsInTimeRange(whisperWords, match.startTime, match.endTime)
    .map((w) => normalizeWord(w.word))
    .filter(Boolean);
  const windowWords = removeConsecutiveDuplicates(windowWordsRaw);
  const windowSet = new Set(windowWords);

  let matched = 0;
  for (const word of lyricWords) {
    if (windowSet.has(word)) matched += 1;
  }

  const lyricBigrams = makeBigramSet(lyricWords);
  const windowBigrams = makeBigramSet(windowWords);
  let bigramHits = 0;
  for (const bg of lyricBigrams) {
    if (windowBigrams.has(bg)) bigramHits += 1;
  }

  const lexicalCoverage = lyricWords.length > 0 ? matched / lyricWords.length : 0;
  const orderCoverage = lyricBigrams.size > 0 ? bigramHits / lyricBigrams.size : lexicalCoverage;
  const recognizedWords = windowWords.length;
  const vocalPresence = recognizedWords > 0;
  const expectedFraction = totalDur > 0 ? (match.startTime / totalDur) : 0;
  const timingPenalty = Math.min(0.12, Math.abs(expectedFraction - clamp(expectedFraction, 0, 1)) * 0.12);
  const confidence = clamp(
    (match.score || 0) * 0.52
      + lexicalCoverage * 0.28
      + orderCoverage * 0.15
      + (vocalPresence ? 0.05 : -0.12)
      - timingPenalty,
    0,
    1
  );
  const verified = vocalPresence && confidence >= 0.38;

  return {
    signature: createStanzaSignature(stanzaText),
    recognizedWords,
    lyricWordCount: lyricWords.length,
    lexicalCoverage,
    orderCoverage,
    vocalPresence,
    confidence,
    verified,
    lowConfidence: !verified,
    reason: !vocalPresence ? 'sem-vocal-detectado' : (verified ? 'ok' : 'baixa-confianca')
  };
}

function overlapRatioBetweenCandidates(a, b) {
  if (!a || !b) return 0;
  const start = Math.max(a.startIdx ?? 0, b.startIdx ?? 0);
  const end = Math.min(a.endIdx ?? -1, b.endIdx ?? -1);
  if (end < start) return 0;
  const overlap = end - start + 1;
  const lenA = Math.max(1, (a.endIdx ?? 0) - (a.startIdx ?? 0) + 1);
  const lenB = Math.max(1, (b.endIdx ?? 0) - (b.startIdx ?? 0) + 1);
  return overlap / Math.max(1, Math.min(lenA, lenB));
}

function stabilizeRepeatedStanzaMatches(stanzas, matches, candidateLists, totalDur) {
  const stabilized = matches.map((m) => (m ? { ...m } : null));
  const groups = new Map();

  stanzas.forEach((stanza, idx) => {
    const signature = createStanzaSignature(stanza?.text || '');
    if (!signature || extractWords(signature).length < 4) return;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(idx);
  });

  let adjustedCount = 0;
  let repeatedGroups = 0;

  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    repeatedGroups += 1;

    const usedCandidates = [];
    const firstIdx = indexes[0];
    const lastIdx = indexes[indexes.length - 1];

    const prevFixed = stabilized
      .slice(0, firstIdx)
      .reverse()
      .find(Boolean) || null;

    const nextFixed = stabilized
      .slice(lastIdx + 1)
      .find(Boolean) || null;

    let cursor = prevFixed?.endTime || 0;

    indexes.forEach((idx, localIndex) => {
      const expectedStart = totalDur > 0
        ? totalDur * (idx / Math.max(1, stanzas.length - 1))
        : cursor;
      const pool = (candidateLists?.[idx] || []).filter(Boolean);
      if (!pool.length) return;

      const remaining = indexes.length - localIndex - 1;
      const minReserveGap = 0.35;
      const upperBound = nextFixed
        ? Math.max(cursor + 0.3, nextFixed.startTime - (remaining * minReserveGap))
        : totalDur;

      let best = null;
      let bestScore = -Infinity;

      for (const cand of pool) {
        if (cand.startTime < cursor - 0.25) continue;
        if (nextFixed && cand.endTime > upperBound + 0.8) continue;

        const temporalPenalty = totalDur > 0
          ? Math.abs((cand.startTime - expectedStart) / Math.max(totalDur, 1)) * 0.9
          : 0;
        const transitionPenalty = cand.startTime < cursor ? 0.28 : 0;
        const overlapPenalty = usedCandidates.some((used) => overlapRatioBetweenCandidates(cand, used) >= 0.45)
          ? 0.42
          : 0;
        const futurePenalty = nextFixed && cand.startTime > nextFixed.startTime
          ? 0.55
          : 0;
        const candidateScore = (cand.score || 0)
          - temporalPenalty
          - transitionPenalty
          - overlapPenalty
          - futurePenalty;

        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          best = cand;
        }
      }

      if (!best) {
        best = pool.find((cand) => cand.startTime >= cursor - 0.25) || pool[0] || null;
      }

      if (best && (!stabilized[idx]
        || Math.abs((stabilized[idx].startTime || 0) - best.startTime) > 0.30
        || (stabilized[idx].score || 0) + 0.03 < (best.score || 0)
        || stabilized[idx].repetitionAdjusted !== true)) {
        stabilized[idx] = {
          text: String(stanzas[idx]?.text || ''),
          startIdx: best.startIdx,
          endIdx: best.endIdx,
          startTime: Math.max(0, best.startTime - 0.05),
          endTime: best.endTime + 0.10,
          score: best.score,
          rawScore: best.score,
          repetitionAdjusted: true
        };
        adjustedCount += 1;
      }

      if (best) {
        usedCandidates.push(best);
      }

      if (stabilized[idx]) {
        cursor = Math.max(cursor, (stabilized[idx].endTime || cursor) + 0.02);
      }
    });
  }

  return { matches: stabilized, adjustedCount, repeatedGroups };
}

function repairLowConfidenceMatches(stanzas, matches, candidateLists, whisperWords, totalDur) {
  const repaired = matches.map((m) => (m ? { ...m } : null));
  let repairedCount = 0;

  for (let i = 0; i < repaired.length; i++) {
    const analysis = evaluateMatchQuality(stanzas[i], repaired[i], whisperWords, totalDur);
    if (!analysis.lowConfidence) continue;

    const prev = repaired.slice(0, i).reverse().find(Boolean) || null;
    const next = repaired.slice(i + 1).find(Boolean) || null;
    const pool = (candidateLists?.[i] || []).filter(Boolean);

    let bestMatch = repaired[i];
    let bestComposite = analysis.confidence + ((repaired[i]?.score || 0) * 0.35);

    for (const cand of pool) {
      const candidate = {
        text: String(stanzas[i]?.text || ''),
        startIdx: cand.startIdx,
        endIdx: cand.endIdx,
        startTime: Math.max(0, cand.startTime - 0.05),
        endTime: cand.endTime + 0.10,
        score: cand.score,
        rawScore: cand.score
      };

      if (prev && candidate.startTime < prev.endTime - 0.25) continue;
      if (next && candidate.endTime > next.startTime + 0.25) continue;

      const candidateAnalysis = evaluateMatchQuality(stanzas[i], candidate, whisperWords, totalDur);
      const composite = candidateAnalysis.confidence + ((cand.score || 0) * 0.35);

      if (composite > bestComposite + 0.03) {
        bestComposite = composite;
        bestMatch = { ...candidate, repairedByAnalysis: true };
      }
    }

    const changed = JSON.stringify(bestMatch) !== JSON.stringify(repaired[i]);
    repaired[i] = bestMatch;
    if (changed) repairedCount += 1;
  }

  return { matches: repaired, repairedCount };
}

function buildSyncAnalysis(stanzas, matches, whisperWords, totalDur, meta = {}) {
  const stanzaAnalysis = stanzas.map((stanza, idx) => {
    const match = matches[idx];
    const quality = evaluateMatchQuality(stanza, match, whisperWords, totalDur);
    return {
      index: idx,
      textPreview: String(stanza?.text || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      startTime: match?.startTime ?? null,
      endTime: match?.endTime ?? null,
      confidence: Number((quality.confidence || 0).toFixed(3)),
      verified: quality.verified,
      lowConfidence: quality.lowConfidence,
      vocalPresence: quality.vocalPresence,
      lexicalCoverage: Number((quality.lexicalCoverage || 0).toFixed(3)),
      orderCoverage: Number((quality.orderCoverage || 0).toFixed(3)),
      recognizedWords: quality.recognizedWords,
      lyricWordCount: quality.lyricWordCount,
      reason: quality.reason,
      speechActivityDetected: Boolean(match?.speechActivityDetected)
    };
  });

  const verifiedCount = stanzaAnalysis.filter((item) => item.verified).length;
  const lowConfidenceCount = stanzaAnalysis.filter((item) => item.lowConfidence).length;
  const withVocalCount = stanzaAnalysis.filter((item) => item.vocalPresence).length;

  return {
    source: meta.source || 'original',
    transcriptionEngine: meta.engine || 'unknown',
    mode: meta.mode || 'original+vocal-guide',
    stanzaCount: stanzas.length,
    verifiedCount,
    lowConfidenceCount,
    withVocalCount,
    repeatedGroups: meta.repeatedGroups || 0,
    repeatedAdjustments: meta.repeatedAdjustments || 0,
    repairedByAnalysis: meta.repairedByAnalysis || 0,
    speechSegmentsDetected: meta.speechSegmentsDetected || 0,
    speechRefinements: meta.speechRefinements || 0,
    speechDetectionSource: meta.speechDetectionSource || 'none',
    timelineStabilizations: meta.timelineStabilizations || 0,
    stanzas: stanzaAnalysis
  };
}

function appendAnalysisToMatches(matches, analysis) {
  return matches.map((match, idx) => {
    if (!match) return null;
    const stanzaAnalysis = analysis?.stanzas?.[idx] || {};
    return {
      ...match,
      confidence: stanzaAnalysis.confidence ?? null,
      verified: stanzaAnalysis.verified ?? false,
      lowConfidence: stanzaAnalysis.lowConfidence ?? true,
      showOnlyDuringVocal: true,
      vocalPresence: stanzaAnalysis.vocalPresence ?? false,
      speechActivityDetected: stanzaAnalysis.speechActivityDetected ?? false
    };
  });
}

function findSpeechWindowForRange(speechSegments, startTime, endTime, maxDistance = 0.55) {
  if (!Array.isArray(speechSegments) || speechSegments.length === 0) return null;

  const overlapping = speechSegments.filter(
    (seg) => seg.end >= startTime - 0.12 && seg.start <= endTime + 0.12
  );

  if (overlapping.length > 0) {
    return {
      start: overlapping[0].start,
      end: overlapping[overlapping.length - 1].end,
      distance: 0,
      overlap: true
    };
  }

  let nearest = null;
  let bestDistance = Infinity;

  for (const seg of speechSegments) {
    const distance = seg.end < startTime
      ? startTime - seg.end
      : seg.start > endTime
        ? seg.start - endTime
        : 0;

    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = seg;
    }
  }

  if (!nearest || bestDistance > maxDistance) return null;

  return {
    start: nearest.start,
    end: nearest.end,
    distance: bestDistance,
    overlap: false
  };
}

function normalizeMatchWindow(startTime, endTime, totalDur) {
  const safeStart = clamp(Number.isFinite(startTime) ? startTime : 0, 0, totalDur);
  const safeEnd = clamp(Number.isFinite(endTime) ? endTime : safeStart + 0.12, safeStart + 0.12, totalDur);
  return {
    startTime: safeStart,
    endTime: safeEnd
  };
}

function refineMatchesWithSpeechActivity(matches, stanzas, speechSegments, whisperWords, totalDur) {
  if (!Array.isArray(speechSegments) || speechSegments.length === 0) {
    return { matches, refinedCount: 0 };
  }

  const refined = matches.map((match) => (match ? { ...match } : null));
  let refinedCount = 0;

  for (let i = 0; i < refined.length; i++) {
    const match = refined[i];
    if (!match) continue;

    const speechWindow = findSpeechWindowForRange(speechSegments, match.startTime, match.endTime);
    if (!speechWindow) continue;

    const quality = evaluateMatchQuality(stanzas[i], match, whisperWords, totalDur);
    const prev = i > 0 ? refined[i - 1] : null;
    const next = i < refined.length - 1 ? refined[i + 1] : null;

    let targetStart = quality.vocalPresence
      ? Math.max(speechWindow.start, match.startTime - 0.04)
      : speechWindow.start;

    let targetEnd = quality.vocalPresence
      ? Math.min(speechWindow.end, match.endTime + 0.06)
      : speechWindow.end;

    if (prev) {
      targetStart = Math.max(targetStart, prev.endTime + 0.02);
    }
    if (next) {
      targetEnd = Math.min(targetEnd, next.startTime - 0.02);
    }

    const normalized = normalizeMatchWindow(targetStart, targetEnd, totalDur);
    const changed = Math.abs(normalized.startTime - match.startTime) > 0.04
      || Math.abs(normalized.endTime - match.endTime) > 0.04;

    refined[i] = {
      ...match,
      startTime: normalized.startTime,
      endTime: normalized.endTime,
      speechActivityDetected: true,
      speechActivityRefined: changed || match.speechActivityRefined === true
    };

    if (changed) refinedCount += 1;
  }

  return { matches: refined, refinedCount };
}


function stabilizeMatchTimeline(matches, totalDur) {
  const stabilized = matches.map((match) => (match ? { ...match } : null));
  let adjustedCount = 0;
  let lastEnd = 0;

  for (let i = 0; i < stabilized.length; i++) {
    const match = stabilized[i];
    if (!match) continue;

    const safeTotal = Math.max(totalDur || 0, 0.12);
    const minStart = i === 0 ? 0 : lastEnd + 0.02;
    let nextStart = safeTotal;

    for (let j = i + 1; j < stabilized.length; j++) {
      if (stabilized[j]) {
        nextStart = stabilized[j].startTime;
        break;
      }
    }

    let startTime = clamp(match.startTime, minStart, safeTotal);
    let endTime = Math.max(match.endTime, startTime + 0.12);

    if (nextStart < safeTotal) {
      endTime = Math.min(endTime, Math.max(startTime + 0.12, nextStart - 0.02));
    }

    endTime = clamp(endTime, startTime + 0.12, safeTotal);

    if (Math.abs(startTime - match.startTime) > 0.01 || Math.abs(endTime - match.endTime) > 0.01) {
      adjustedCount += 1;
    }

    stabilized[i] = {
      ...match,
      startTime,
      endTime,
      timelineStabilized: true
    };
    lastEnd = endTime;
  }

  return { matches: stabilized, adjustedCount };
}

async function detectSpeechActivityBest(rawAudioPath, vocalGuidePath, totalDur) {
  const candidates = [
    { label: 'vocal-guide', path: vocalGuidePath },
    { label: 'original', path: rawAudioPath }
  ].filter((candidate) => candidate.path);

  for (const candidate of candidates) {
    const segments = await detectSpeechActivity(candidate.path, totalDur).catch(() => []);
    if (segments.length > 0) {
      return { segments, source: candidate.label };
    }
  }

  return { segments: [], source: 'none' };
}

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 3 — ÁUDIO: DOWNLOAD, CONVERSÃO, TRANSCRIÇÃO
// ═════════════════════════════════════════════════════════════════════════════

function isWhisperXEnabled() {
  const v = String(process.env.WHISPERX_ENABLED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Seleciona a fonte de timestamps por palavra.
 * Prioridade:
 *  1) WhisperX (local) se WHISPERX_ENABLED=1
 *  2) OpenAI Whisper API se OPENAI_API_KEY existe
 */
async function getWordTimestamps(localAudioPath) {
  if (isWhisperXEnabled()) {
    const words = await transcribeWithWhisperX(localAudioPath);
    return { words, engine: 'whisperx' };
  }

  if (process.env.OPENAI_API_KEY) {
    const words = await transcribeWithWhisper(localAudioPath);
    return { words, engine: 'openai-whisper' };
  }

  return { words: [], engine: 'none' };
}


function downloadToTemp(url) {
  return new Promise((resolve, reject) => {
    const ext  = path.extname(new URL(url).pathname) || '.mp3';
    const dest = path.join(os.tmpdir(), `lena_sync_${Date.now()}${ext}`);
    const file = fs.createWriteStream(dest);
    const prot = url.startsWith('https') ? https : http;

    prot.get(url, (resp) => {
      if (resp.statusCode >= 400)
        return reject(new Error(`HTTP ${resp.statusCode} ao baixar áudio`));
      resp.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', reject);
  });
}

function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration || 0);
    });
  });
}

/**
 * Converte áudio para MP3 mono 16kHz leve (ideal para Whisper).
 */
function convertToMp3Light(inputPath) {
  return new Promise((resolve, reject) => {
    const output = path.join(os.tmpdir(), `lena_light_${Date.now()}.mp3`);
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate('64k')
      .toFormat('mp3')
      .on('end',   () => resolve(output))
      .on('error', reject)
      .save(output);
  });
}

async function extractVocalGuideTrack(inputPath) {
  return new Promise((resolve, reject) => {
    const output = path.join(os.tmpdir(), `lena_vocal_guide_${Date.now()}.wav`);
    ffmpeg(inputPath)
      .audioFilters([
        'pan=mono|c0=0.5*c0+0.5*c1',
        'highpass=f=120',
        'lowpass=f=4200',
        'acompressor=threshold=-20dB:ratio=3:attack=5:release=50',
        'loudnorm=I=-16:TP=-1.5:LRA=11'
      ])
      .audioChannels(1)
      .audioFrequency(16000)
      .toFormat('wav')
      .on('end', () => resolve(output))
      .on('error', reject)
      .save(output);
  });
}

async function getBestWordTimestampsForSync(rawAudioPath, stanzas, files = [], opts = {}) {
  const candidates = [];
  const vocalGuidePath = opts?.vocalGuidePath || null;

  if (vocalGuidePath) {
    candidates.push({ label: 'vocal-guide', path: vocalGuidePath, bias: 0.08 });
  } else {
    try {
      const extractedVocalGuidePath = await extractVocalGuideTrack(rawAudioPath);
      files.push(extractedVocalGuidePath);
      candidates.push({ label: 'vocal-guide', path: extractedVocalGuidePath, bias: 0.08 });
    } catch (err) {
      console.warn('[voiceSync] Não foi possível gerar guia vocal:', err.message);
    }
  }

  candidates.push({ label: 'original', path: rawAudioPath, bias: 0 });

  let best = { words: [], engine: 'none', source: 'original', score: -Infinity };

  for (const candidate of candidates) {
    try {
      const { words, engine } = await getWordTimestamps(candidate.path);
      if (!words.length) continue;

      const raw = fuzzyMatchStanzas(stanzas, words, { returnMeta: true });
      const matched = raw.matches.filter((m) => m && (m.score || 0) >= 0.22).length;
      const avgScore = raw.matches.length
        ? raw.matches.reduce((sum, item) => sum + (item?.score || 0), 0) / raw.matches.length
        : 0;
      const score = matched * 1000 + avgScore * 100 + Math.min(words.length, 500) * 0.1 + candidate.bias * 100;

      if (score > best.score) {
        best = {
          words,
          engine,
          source: candidate.label,
          score
        };
      }
    } catch (err) {
      console.warn(`[voiceSync] Falha ao transcrever ${candidate.label}:`, err.message);
    }
  }

  return best;
}

/**
 * Transcreve áudio com Whisper API e retorna array de palavras com timestamps.
 * @returns {Promise<Array<{word:string, start:number, end:number}>>}
 */
async function transcribeWithWhisper(localAudioPath) {
  const lightPath = await convertToMp3Light(localAudioPath);

  try {
    const openai = new OpenAI();
    const result = await openai.audio.transcriptions.create({
      file:                    fs.createReadStream(lightPath),
      model:                   'whisper-1',
      response_format:         'verbose_json',
      timestamp_granularities: ['word']
    });
    return result.words || [];
  } finally {
    try { fs.unlinkSync(lightPath); } catch (_) {}
  }
}

/**
 * Converte áudio para WAV mono 16kHz (mais estável para WhisperX).
 */
function convertToWav16kMono(inputPath) {
  return new Promise((resolve, reject) => {
    const output = path.join(os.tmpdir(), `lena_wx_${Date.now()}.wav`);
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .toFormat('wav')
      .on('end',   () => resolve(output))
      .on('error', reject)
      .save(output);
  });
}

/**
 * Executa WhisperX via Python e retorna words com timestamps.
 *
 * Requer:
 *  - python3
 *  - pip install whisperx (e deps)
 *
 * Env:
 *  - WHISPERX_ENABLED=1
 *  - WHISPERX_MODEL=small|medium|large-v2...
 *  - WHISPERX_DEVICE=cpu|cuda
 *  - WHISPERX_LANGUAGE=pt (opcional)
 */
async function transcribeWithWhisperX(localAudioPath) {
  const pythonBin  = process.env.WHISPERX_PYTHON || 'python3';
  const scriptPath = process.env.WHISPERX_SCRIPT
    || path.join(process.cwd(), 'scripts', 'whisperx_transcribe.py');

  const wavPath = await convertToWav16kMono(localAudioPath);

  try {
    const args = [scriptPath, '--audio', wavPath];

    const out = await new Promise((resolve, reject) => {
      const child = spawn(pythonBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));

      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`WhisperX falhou (code=${code}). ${stderr || ''}`.trim()));
        }
        resolve({ stdout, stderr });
      });
    });

    const json = JSON.parse(out.stdout);
    return json.words || [];

  } finally {
    try { fs.unlinkSync(wavPath); } catch (_) {}
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 4 — FALLBACKS SEM WHISPER
// ═════════════════════════════════════════════════════════════════════════════

// ── Fallback 3: FFmpeg silence-detect ────────────────────────────────────────

const SILENCE_THRESHOLDS = [
  { noise: -20, dur: 0.3 },
  { noise: -25, dur: 0.3 },
  { noise: -30, dur: 0.4 },
  { noise: -35, dur: 0.4 },
  { noise: -40, dur: 0.5 },
];

function runSilenceDetect(audioPath, noise, dur) {
  return new Promise((resolve, reject) => {
    const lines = [];
    ffmpeg(audioPath)
      .audioFilters(`silencedetect=noise=${noise}dB:d=${dur}`)
      .format('null').output('-')
      .on('stderr', l => lines.push(l))
      .on('end',    () => resolve(lines.join('\n')))
      .on('error',  reject)
      .run();
  });
}

function parseSilences(out, totalDur) {
  const starts = [...out.matchAll(/silence_start:\s*([\d.]+)/g)].map(m => +m[1]);
  const ends   = [...out.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => +m[1]);
  const count  = Math.min(starts.length, ends.length);
  const sils   = Array.from({ length: count }, (_, i) => ({ start: starts[i], end: ends[i] }));
  if (starts.length > ends.length)
    sils.push({ start: starts[starts.length - 1], end: totalDur });
  return sils;
}

function silencesToSpeech(sils, totalDur) {
  const segs = [];
  let cursor = 0;
  for (const s of sils) {
    if (s.start > cursor + 0.05) segs.push({ start: cursor, end: s.start });
    cursor = s.end;
  }
  if (cursor < totalDur - 0.1) segs.push({ start: cursor, end: totalDur });
  return segs;
}

function adjustSegmentCount(segs, target) {
  let s = [...segs];

  while (s.length > target) {
    let minGap = Infinity, minIdx = 0;
    for (let i = 0; i < s.length - 1; i++) {
      const g = s[i + 1].start - s[i].end;
      if (g < minGap) { minGap = g; minIdx = i; }
    }
    s.splice(minIdx, 2, { start: s[minIdx].start, end: s[minIdx + 1].end });
  }

  while (s.length < target) {
    let maxDur = 0, maxIdx = 0;
    for (let i = 0; i < s.length; i++) {
      const d = s[i].end - s[i].start;
      if (d > maxDur) { maxDur = d; maxIdx = i; }
    }
    const seg = s[maxIdx];
    const mid = (seg.start + seg.end) / 2;
    s.splice(maxIdx, 1,
      { start: seg.start,  end: mid - 0.1 },
      { start: mid + 0.1, end: seg.end    }
    );
  }

  return s;
}

/**
 * Fallback 3: distribui estrofes nos segmentos de fala detectados pelo FFmpeg.
 */
async function detectSpeechActivity(audioPath, totalDur) {
  for (const { noise, dur } of SILENCE_THRESHOLDS) {
    try {
      const out = await runSilenceDetect(audioPath, noise, dur);
      const sils = parseSilences(out, totalDur);
      const segs = silencesToSpeech(sils, totalDur)
        .map((seg) => ({
          start: Math.max(0, seg.start),
          end: Math.min(totalDur, seg.end)
        }))
        .filter((seg) => seg.end - seg.start > 0.18);

      if (segs.length >= 1) {
        return segs;
      }
    } catch (_) { /* tenta próximo threshold */ }
  }

  return [];
}

async function fallbackSilenceDetect(audioPath, totalDur, stanzas) {
  try {
    const segs = await detectSpeechActivity(audioPath, totalDur);

    if (segs.length >= 1) {
      const adjusted = adjustSegmentCount(segs, stanzas.length);
      return stanzas.map((s, i) => ({
        text:      s.text,
        startTime: Math.max(0, adjusted[i].start - 0.1),
        endTime:   Math.min(totalDur, adjusted[i].end)
      }));
    }
  } catch (_) { /* cai para o próximo fallback */ }

  return null;
}

// ── Fallback 4: Distribuição proporcional por palavras ───────────────────────

/**
 * Fallback 4: distribui estrofes linearmente pela duração total,
 * pesando pelo número de palavras de cada estrofe.
 */
function fallbackProportional(stanzas, totalDur) {
  const counts = stanzas.map(s => Math.max(extractWords(s.text).length, 1));
  const total  = counts.reduce((a, c) => a + c, 0);
  const GAP    = Math.min(0.3, totalDur / (stanzas.length * 6));
  const avail  = Math.max(1, totalDur - GAP * (stanzas.length - 1));

  let cursor = 0;
  return stanzas.map((s, i) => {
    const dur   = avail * (counts[i] / total);
    const start = cursor;
    const end   = Math.min(totalDur, start + dur);
    cursor = end + GAP;
    return { text: s.text, startTime: start, endTime: end };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 5 — CONVERSÃO DE FORMATOS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Converte o formato simples [{text, startTime, endTime}]
 * para o formato esperado pelo /voice-sync:
 *   [{ start, end, lines:[{start, end, text}] }]
 */
function toLineLevelFormat(synced, stanzas, totalDur) {
  return synced.map((seg, i) => {
    const stanzaText = stanzas[i]?.text || seg.text || '';
    const lines      = splitLines(stanzaText);
    const start      = Math.max(0, seg.startTime);
    const end        = Math.min(totalDur, seg.endTime);
    const duration   = Math.max(0.1, end - start);

    if (lines.length === 0) {
      return { start, end, lines: [] };
    }

    const weights   = lines.map(l => Math.max(extractWords(l).length, 1));
    const totalW    = weights.reduce((a, w) => a + w, 0);
    const LINE_GAP  = Math.min(0.1, duration / (lines.length * 8));
    const available = Math.max(0.1, duration - LINE_GAP * (lines.length - 1));

    let cursor    = start;
    const lineSegs = lines.map((lineText, li) => {
      const dur       = available * (weights[li] / totalW);
      const lineStart = cursor;
      const lineEnd   = Math.min(end, lineStart + dur);
      cursor = lineEnd + LINE_GAP;
      return { start: lineStart, end: lineEnd, text: lineText };
    });

    return {
      start,
      end,
      lines: lineSegs,
      confidence: seg.confidence ?? null,
      verified: seg.verified ?? false,
      lowConfidence: seg.lowConfidence ?? true,
      showOnlyDuringVocal: seg.showOnlyDuringVocal ?? false,
      vocalPresence: seg.vocalPresence ?? false
    };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 6 — EXPORTAÇÕES PÚBLICAS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * syncStanzasWithWhisper
 * ──────────────────────
 * Sincroniza estrofes com o áudio usando Whisper + Beam Search Fuzzy Matching (v6).
 *
 * @param {string} audioUrl  URL pública do áudio
 * @param {Array}  stanzas   [{ id, text }]
 * @param {Object} opts      { forceOriginalOnly?, instrumentalUrl? }
 * @returns {Promise<Array>} [{ start, end, lines:[{start,end,text}] }]
 */
export async function syncStanzasWithWhisper(audioUrl, stanzas, opts = {}) {
  const files   = [];
  const cleanup = () => {
    for (const f of files)
      if (f && fs.existsSync(f)) try { fs.unlinkSync(f); } catch (_) {}
  };

  try {
    const rawPath  = await downloadToTemp(audioUrl);
    files.push(rawPath);
    const totalDur = await getAudioDuration(rawPath);

    let speechSegments = [];
    let speechDetectionSource = 'none';
    let vocalGuidePath = null;

    try {
      vocalGuidePath = await extractVocalGuideTrack(rawPath);
      if (vocalGuidePath) files.push(vocalGuidePath);
    } catch (err) {
      console.warn('[voiceSync] Não foi possível preparar a guia vocal principal:', err.message);
    }

    // ── Word timestamps + guia vocal + detecção de trechos com/sem vocal ─────
    try {
      const [ts, speechDetection] = await Promise.all([
        getBestWordTimestampsForSync(rawPath, stanzas, files, { vocalGuidePath }),
        detectSpeechActivityBest(rawPath, vocalGuidePath, totalDur)
      ]);

      speechSegments = speechDetection?.segments || [];
      speechDetectionSource = speechDetection?.source || 'none';

      const words = ts.words || [];
      const engine = ts.engine || 'none';
      const source = ts.source || 'original';

      if (words.length > 0) {
        console.log(`[voiceSync] ✅ ${engine}/${source}: ${words.length} palavras com timestamps`);

        const raw = fuzzyMatchStanzas(stanzas, words, { returnMeta: true });
        const repeated = stabilizeRepeatedStanzaMatches(stanzas, raw.matches, raw.candidates, totalDur);
        const repaired = repairLowConfidenceMatches(
          stanzas,
          repeated.matches,
          raw.candidates,
          words,
          totalDur
        );
        const filled = fillNullMatches(repaired.matches, stanzas, totalDur);
        const speechRefined = refineMatchesWithSpeechActivity(filled, stanzas, speechSegments, words, totalDur);
        const timelineStabilized = stabilizeMatchTimeline(speechRefined.matches, totalDur);
        const analysis = buildSyncAnalysis(stanzas, timelineStabilized.matches, words, totalDur, {
          source,
          engine,
          mode: 'original+vocal-guide+speech-activity',
          repeatedGroups: repeated.repeatedGroups,
          repeatedAdjustments: repeated.adjustedCount,
          repairedByAnalysis: repaired.repairedCount,
          speechSegmentsDetected: speechSegments.length,
          speechRefinements: speechRefined.refinedCount,
          speechDetectionSource,
          timelineStabilizations: timelineStabilized.adjustedCount
        });
        const enriched = appendAnalysisToMatches(timelineStabilized.matches, analysis);
        const result = toLineLevelFormat(enriched, stanzas, totalDur);

        console.log('[voiceSync] ✅ Sincronização automática validada por análise de confiança e silêncio');
        return {
          segments: result,
          analysis
        };
      }
      console.log(`[voiceSync] ⚠️ ${engine}/${source}: sem palavras — usando fallbacks`);
    } catch (tsErr) {
      console.warn('[voiceSync] Timestamps falharam:', tsErr.message);
    }

    if (!process.env.OPENAI_API_KEY && !isWhisperXEnabled()) {
      console.log('[voiceSync] OPENAI_API_KEY ausente e WHISPERX_ENABLED desativado — usando fallback silence-detect');
    }

    // ── Fallback 3: silence-detect ────────────────────────────────────────────
    const silResult = await fallbackSilenceDetect(rawPath, totalDur, stanzas);
    if (silResult) {
      console.log('[voiceSync] ✅ Fallback: silence-detect');
      const analysis = {
        source: 'original',
        transcriptionEngine: 'fallback-silence-detect',
        mode: 'fallback',
        stanzaCount: stanzas.length,
        verifiedCount: 0,
        lowConfidenceCount: stanzas.length,
        withVocalCount: 0,
        repeatedGroups: 0,
        repeatedAdjustments: 0,
        repairedByAnalysis: 0,
        speechSegmentsDetected: speechSegments.length,
        speechRefinements: speechSegments.length ? stanzas.length : 0,
        speechDetectionSource,
        timelineStabilizations: 0,
        stanzas: stanzas.map((stanza, idx) => ({
          index: idx,
          textPreview: String(stanza?.text || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          startTime: silResult[idx]?.startTime ?? null,
          endTime: silResult[idx]?.endTime ?? null,
          confidence: 0,
          verified: false,
          lowConfidence: true,
          vocalPresence: false,
          lexicalCoverage: 0,
          orderCoverage: 0,
          recognizedWords: 0,
          lyricWordCount: extractWordsAllowShort(stanza?.text || '').length,
          reason: 'fallback-silence-detect',
          speechActivityDetected: true
        }))
      };
      const result = toLineLevelFormat(
        silResult.map((seg) => ({ ...seg, confidence: 0, verified: false, lowConfidence: true, showOnlyDuringVocal: true, vocalPresence: false })),
        stanzas,
        totalDur
      );
      return { segments: result, analysis };
    }

    // ── Fallback 4: proporcional ──────────────────────────────────────────────
    console.log('[voiceSync] ✅ Fallback: distribuição proporcional');
    const propResult = fallbackProportional(stanzas, totalDur || 180);
    const analysis = {
      source: 'original',
      transcriptionEngine: 'fallback-proportional',
      mode: 'fallback',
      stanzaCount: stanzas.length,
      verifiedCount: 0,
      lowConfidenceCount: stanzas.length,
      withVocalCount: 0,
      repeatedGroups: 0,
      repeatedAdjustments: 0,
      repairedByAnalysis: 0,
      speechSegmentsDetected: 0,
      speechRefinements: 0,
      speechDetectionSource: 'none',
      timelineStabilizations: 0,
      stanzas: stanzas.map((stanza, idx) => ({
        index: idx,
        textPreview: String(stanza?.text || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        startTime: propResult[idx]?.startTime ?? null,
        endTime: propResult[idx]?.endTime ?? null,
        confidence: 0,
        verified: false,
        lowConfidence: true,
        vocalPresence: false,
        lexicalCoverage: 0,
        orderCoverage: 0,
        recognizedWords: 0,
        lyricWordCount: extractWordsAllowShort(stanza?.text || '').length,
        reason: 'fallback-proportional',
        speechActivityDetected: false
      }))
    };
    const result = toLineLevelFormat(
      propResult.map((seg) => ({ ...seg, confidence: 0, verified: false, lowConfidence: true, showOnlyDuringVocal: true, vocalPresence: false })),
      stanzas,
      totalDur || 180
    );
    return { segments: result, analysis };

  } finally {
    cleanup();
  }
}

/**
 * resegmentAndSyncStanzas
 * ───────────────────────
 * Faz a separação automática das estrofes *com base no áudio* (pausas/gaps)
 * e em seguida sincroniza as novas estrofes.
 *
 * Objetivo: quando o usuário clicar em “Sincronizar automaticamente”, o backend
 * pode re-segmentar a letra e devolver os blocos já prontos para o editor.
 *
 * @param {string} audioUrl
 * @param {string} lyricsText  letra completa (pode ter \n)
 * @param {Object} opts
 * @returns {Promise<{stanzas:Array<{id:number,text:string}>, segments:Array, method:string}>}
 */
export async function resegmentAndSyncStanzas(audioUrl, lyricsText, opts = {}) {
  const files   = [];
  const cleanup = () => {
    for (const f of files)
      if (f && fs.existsSync(f)) try { fs.unlinkSync(f); } catch (_) {}
  };

  // Normaliza a letra inteira
  const fullText = String(lyricsText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!fullText) {
    throw new Error('lyricsText vazio');
  }

  // Linhas não-vazias como unidade mínima (melhor p/ editor)
  const lyricLines = fullText
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (lyricLines.length === 0) {
    throw new Error('Letra não possui linhas válidas');
  }

  // Helper: cria stanzas agrupando linhas por distribuição de "peso" (palavras)
  const buildStanzasFromSegments = (segments) => {
    const lineData = lyricLines.map((line) => ({
      line,
      words: Math.max(extractWords(line).length, 1)
    }));

    const totalWords = lineData.reduce((a, b) => a + b.words, 0);

    // Se não vier segmentos (ou vier ruim), cai em uma estrofe única
    const segs = Array.isArray(segments) && segments.length
      ? segments
      : [{ start: 0, end: 1 }];

    const totalSegDur = segs.reduce((a, s) => a + Math.max(0.1, (s.end - s.start)), 0.1);

    const targetCount = Math.max(1, Math.min(segs.length, lineData.length, 120));

    // Alvos de palavras por segmento (proporcional ao tempo do segmento)
    const targets = Array.from({ length: targetCount }, (_, i) => {
      const seg = segs[i] || segs[segs.length - 1];
      const dur = Math.max(0.1, (seg.end - seg.start));
      const tw  = Math.max(1, Math.round(totalWords * (dur / totalSegDur)));
      return tw;
    });

    // Ajuste fino para somar exatamente totalWords (evita sobras gigantes)
    let sumTargets = targets.reduce((a, b) => a + b, 0);
    while (sumTargets > totalWords) {
      const i = targets.findIndex(t => t > 1);
      if (i === -1) break;
      targets[i] -= 1;
      sumTargets -= 1;
    }
    while (sumTargets < totalWords) {
      targets[targets.length - 1] += 1;
      sumTargets += 1;
    }

    const out = [];
    let li = 0;
    for (let si = 0; si < targetCount; si++) {
      const mustLeave = targetCount - si - 1;
      const maxEnd = lineData.length - mustLeave; // garante 1 linha p/ cada estrofe restante

      const collected = [];
      let acc = 0;
      const target = targets[si];

      while (li < maxEnd) {
        collected.push(lineData[li].line);
        acc += lineData[li].words;
        li++;
        if (acc >= target && collected.length >= 1) break;
      }

      // Se por alguma razão ficou vazio, força 1 linha
      if (collected.length === 0 && li < lineData.length) {
        collected.push(lineData[li].line);
        li++;
      }

      out.push({
        id: si,
        text: collected.join('\n').trim()
      });
    }

    // Se sobrou linha, anexa na última estrofe
    if (li < lineData.length && out.length) {
      const rest = lineData.slice(li).map(x => x.line).join('\n');
      out[out.length - 1].text = (out[out.length - 1].text + '\n' + rest).trim();
    }

    // Remove estrofes vazias (defensivo)
    return out.filter(s => String(s.text || '').trim().length > 0);
  };

  // Helper: extrai segmentos de fala usando gaps entre palavras
  const speechSegmentsFromWords = (words, totalDur) => {
    const GAP_SEC = 0.75;      // gap mínimo para “quebra”
    const MIN_DUR = 1.2;       // segmentos menores que isso tendem a ser respiração

    const w = (words || []).filter(Boolean);
    if (w.length === 0) return [];

    const segs = [];
    let segStart = Math.max(0, w[0].start ?? 0);
    let prevEnd  = Math.max(segStart, w[0].end ?? segStart);

    for (let i = 1; i < w.length; i++) {
      const st = w[i].start ?? prevEnd;
      const en = w[i].end ?? st;
      const gap = st - prevEnd;
      if (gap >= GAP_SEC) {
        segs.push({ start: segStart, end: prevEnd });
        segStart = st;
      }
      prevEnd = Math.max(prevEnd, en);
    }
    segs.push({ start: segStart, end: prevEnd });

    // 1) remove/mescla segmentos muito curtos
    const merged = [];
    for (const s of segs) {
      const dur = Math.max(0, s.end - s.start);
      if (merged.length === 0) {
        merged.push({ ...s });
        continue;
      }
      if (dur < MIN_DUR) {
        // cola no anterior
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, s.end);
      } else {
        merged.push({ ...s });
      }
    }

    // 2) clamp dentro da duração total
    return merged
      .map(s => ({
        start: Math.max(0, Math.min(totalDur, s.start)),
        end:   Math.max(0, Math.min(totalDur, s.end))
      }))
      .filter(s => s.end - s.start > 0.2)
      .slice(0, 120);
  };

  try {
    const rawPath  = await downloadToTemp(audioUrl);
    files.push(rawPath);
    const totalDur = await getAudioDuration(rawPath);

    // Tenta timestamps por palavra (WhisperX ou Whisper API)
    let words = [];
    let engine = 'none';
    try {
      const ts = await getWordTimestamps(rawPath);
      words = ts.words || [];
      engine = ts.engine || 'none';
    } catch (e) {
      // ignora e cai nos fallbacks
    }

    // ── Caso 1: temos palavras com timestamps → resegmenta por gaps e sincroniza com fuzzyMatch
    if (words.length > 0) {
      const speechSegs = speechSegmentsFromWords(words, totalDur || (words[words.length - 1]?.end || 0));
      const newStanzas = buildStanzasFromSegments(speechSegs);

      const rawMatches = fuzzyMatchStanzas(newStanzas, words);
      const filled     = fillNullMatches(rawMatches, newStanzas, totalDur);
      const segments   = toLineLevelFormat(filled, newStanzas, totalDur);

      return {
        stanzas: newStanzas.map((s, i) => ({ id: s.id ?? i, text: s.text })),
        segments,
        method: `resegment+${engine}`
      };
    }

    // ── Caso 2: sem Whisper → usa silence-detect para obter segmentos de fala e resegmentar
    const silences = await (async () => {
      try {
        // Reusa a mesma rotina de fallback já existente
        const dummy = Array.from({ length: Math.min(lyricLines.length, 60) }, (_, i) => ({ id: i, text: 'x' }));
        const sil = await fallbackSilenceDetect(rawPath, totalDur || 180, dummy);
        return (sil || []).map(s => ({ start: s.startTime, end: s.endTime }));
      } catch (_) {
        return [];
      }
    })();

    const newStanzas = buildStanzasFromSegments(silences);

    // Para tempos: se silence-detect deu algo, usa; senão, proporcional
    let timing;
    if (silences.length >= 1) {
      // Ajusta contagem para bater com nº de estrofes
      const adjusted = adjustSegmentCount(
        silences.map(s => ({ start: s.start, end: s.end })),
        newStanzas.length
      );
      timing = newStanzas.map((s, i) => ({
        text: s.text,
        startTime: Math.max(0, adjusted[i].start),
        endTime:   Math.max(0.1, adjusted[i].end)
      }));
    } else {
      timing = fallbackProportional(newStanzas, totalDur || 180);
    }

    const segments = toLineLevelFormat(timing, newStanzas, totalDur || 180);
    return {
      stanzas: newStanzas.map((s, i) => ({ id: s.id ?? i, text: s.text })),
      segments,
      method: 'resegment+fallback'
    };

  } finally {
    cleanup();
  }
}

/**
 * syncStanzasWithWhisperAnchors
 * ──────────────────────────────
 * Versão que retorna o formato simples por estrofe (sem subdivisão em linhas).
 *
 * @param {string} audioUrl  URL pública do áudio
 * @param {Array}  stanzas   [{ id?, text }]
 * @param {Object} opts      { respectOrder? }
 * @returns {Promise<Array>} [{ text, startTime, endTime }]
 */
export async function syncStanzasWithWhisperAnchors(audioUrl, stanzas, opts = {}) {
  if (!process.env.OPENAI_API_KEY && !isWhisperXEnabled()) {
    throw new Error('OPENAI_API_KEY não definida e WHISPERX_ENABLED desativado — necessário para gerar timestamps');
  }

  const files   = [];
  const cleanup = () => {
    for (const f of files)
      if (f && fs.existsSync(f)) try { fs.unlinkSync(f); } catch (_) {}
  };

  try {
    const rawPath  = await downloadToTemp(audioUrl);
    files.push(rawPath);
    const totalDur = await getAudioDuration(rawPath);

    const { words, engine } = await getWordTimestamps(rawPath);
    console.log(`[voiceSync/anchors] ${engine}: ${words.length} palavras`);

    if (!words.length) return [];

    const rawMatches = fuzzyMatchStanzas(stanzas, words);
    const filled     = fillNullMatches(rawMatches, stanzas, totalDur);

    return filled.map(m => ({
      text:      m.text,
      startTime: m.startTime,
      endTime:   m.endTime
    }));

  } finally {
    cleanup();
  }
}

/**
 * chooseBestAudioCandidateByLyrics
 * ─────────────────────────────────
 * Dentre vários áudios candidatos, escolhe aquele que melhor cobre a letra.
 *
 * @param {string[]} audioUrls  URLs candidatas
 * @param {Array}    stanzas    [{ id?, text }]
 * @param {Object}   opts       { snippetStartSec?, snippetDurationSec? }
 * @returns {Promise<{bestUrl, bestIndex, ranking}>}
 */
export async function chooseBestAudioCandidateByLyrics(audioUrls, stanzas, opts = {}) {
  const {
    snippetStartSec    = 20,
    snippetDurationSec = 60
  } = opts;

  if (!process.env.OPENAI_API_KEY && !isWhisperXEnabled()) {
    throw new Error('OPENAI_API_KEY não definida e WHISPERX_ENABLED desativado — necessário para auto-seleção');
  }

  const candidates = (audioUrls || []).filter(Boolean);
  if (candidates.length === 0) throw new Error('audioUrls vazio');

  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    const url   = candidates[i];
    const files = [];
    const cleanup = () => {
      for (const f of files)
        if (f && fs.existsSync(f)) try { fs.unlinkSync(f); } catch (_) {}
    };

    try {
      const local = await downloadToTemp(url);
      files.push(local);

      const snip = await makeAudioSnippet(local, snippetStartSec, snippetDurationSec);
      files.push(snip);

      const { words } = await getWordTimestamps(snip);

      const matches = fuzzyMatchStanzas(stanzas, words);
      const matched = matches.filter(m => m !== null).length;
      const score   = (matched / Math.max(stanzas.length, 1)) * 1000
                    + Math.min(words.length, 300) * 0.5;

      results.push({
        index: i, url, score,
        coverage:     matched / Math.max(stanzas.length, 1),
        matched,
        stanzaCount:  stanzas.length,
        whisperCount: words.length
      });
    } catch (err) {
      results.push({
        index: i, url, score: -1, coverage: 0, matched: 0,
        stanzaCount: stanzas.length, whisperCount: 0,
        error: err.message
      });
    } finally {
      cleanup();
    }
  }

  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  return { bestUrl: best?.url, bestIndex: best?.index, ranking: results };
}

// ── Compat retrocompatível ────────────────────────────────────────────────────
export async function detectVoiceSegments(audioUrl, stanzaCount) {
  const dummy = Array.from({ length: stanzaCount }, (_, i) => ({ id: i, text: '' }));
  return syncStanzasWithWhisper(audioUrl, dummy);
}

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 7 — UTILITÁRIOS INTERNOS AUXILIARES
// ═════════════════════════════════════════════════════════════════════════════

/** Gera um snippet de áudio para score rápido sem transcrever o arquivo inteiro */
function makeAudioSnippet(inputPath, startSec = 0, durationSec = 60) {
  return new Promise((resolve, reject) => {
    const output = path.join(os.tmpdir(), `lena_snip_${Date.now()}.mp3`);
    ffmpeg(inputPath)
      .setStartTime(startSec)
      .duration(durationSec)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate('64k')
      .toFormat('mp3')
      .on('end',   () => resolve(output))
      .on('error', reject)
      .save(output);
  });
}
