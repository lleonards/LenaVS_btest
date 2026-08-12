// src/services/stanzaAligner.js
// Distribui estrofes pelos segmentos vocais detectados.
// Se não houver vocal, distribui por fallback proporcional.

import { downloadAudioToBuffer } from './audioDownloader.js';
import { decodeToPcm16kMono } from './decoder.js';
import { detectVocalSegments } from './vadEnergy.js';

const HARD_MIN_SEG = 1.5; // nunca retorna segmentos menores que isto (para não apertar demais a UX)

function mergeSmallSegments(segments, audioDurationSec) {
  if (segments.length === 0) return segments;
  const merged = [];
  for (const seg of segments) {
    let [a, b] = seg;
    if (b - a < HARD_MIN_SEG) {
      // estica pro mínimo e clampa ao total
      const center = (a + b) / 2;
      a = Math.max(0, center - HARD_MIN_SEG / 2);
      b = Math.min(audioDurationSec, a + HARD_MIN_SEG);
    }
    if (merged.length === 0) {
      merged.push([a, b]);
      continue;
    }
    const last = merged[merged.length - 1];
    if (a - last[1] < 0.05) {
      last[1] = b;
    } else {
      merged.push([a, b]);
    }
  }
  return merged.filter(([a, b]) => b - a > 0.1);
}

function distributeByDuration(stanzas, totalDurationSec) {
  // fallback sem VAD — distribui proporcional ao nº de palavras
  const wordCounts = stanzas.map((s) => (s.text.trim().split(/\s+/).filter(Boolean).length) || 1);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return stanzas.map((s, idx) => {
    const proportion = wordCounts[idx] / totalWords;
    const span = Math.max(HARD_MIN_SEG, totalDurationSec * proportion);
    const start = cursor;
    const end = Math.min(totalDurationSec, start + span);
    cursor = end;
    return [start, end];
  });
}

export { distributeByDuration, mergeSmallSegments };


/**
 * @param {string} audioUrl
 * @param {{id:string,text:string}[]} stanzas
 * @param {{audioMaxMinutes?:number, leadInSec?:number, trailOutSec?:number}} [opts]
 */
export async function syncStanzasToAudio(audioUrl, stanzas, opts = {}) {
  const audioMaxMinutes = opts.audioMaxMinutes ?? 15;
  const maxBytes = 200 * 1024 * 1024;

  const buffer = await downloadAudioToBuffer(audioUrl, { maxBytes, timeoutMs: 90_000 });

  const probe = await decodeToPcm16kMono(buffer.slice(0, Math.min(buffer.length, 4 * 1024 * 1024)));
  // decodifica o arquivo inteiro
  const full = await decodeToPcm16kMono(buffer);

  if (full.durationSec > audioMaxMinutes * 60) {
    const e = new Error(`Áudio excede ${audioMaxMinutes} minutos.`);
    e.status = 413;
    e.code = 'AUDIO_TOO_LONG';
    e.userMessage = `O áudio enviado tem ${(full.durationSec / 60).toFixed(1)} minutos e o limite é ${audioMaxMinutes}.`;
    throw e;
  }

  if (!Number.isFinite(full.durationSec) || full.durationSec <= 1) {
    const e = new Error('Áudio inválido.');
    e.status = 422;
    e.code = 'INVALID_AUDIO';
    e.userMessage = 'Não foi possível ler a duração do áudio enviado.';
    throw e;
  }

  const vad = detectVocalSegments(full.pcm, full.sampleRate);
  let vocalSegments = mergeSmallSegments(vad.segments, full.durationSec);

  // Sem vocal detectado? cai pra distribuição proporcional por nº de palavras,
  // mas marca cada estrofe como sem vocal (frontend esconde no preview).
  if (vocalSegments.length === 0) {
    const fallback = distributeByDuration(stanzas, full.durationSec);
    return {
      method: 'proportional-fallback',
      audioDurationSec: full.durationSec,
      vocalRatio: 0,
      vocalSegments: [],
      coverage: 0,
      assignments: stanzas.map((_, idx) => ({
        start: fallback[idx][0],
        end: fallback[idx][1],
        vocalPresence: false,
        reason: 'sem-vocal-confirmado',
        confidence: 0,
      })),
    };
  }

  // Com vocal detectado: alinha estrofes por BALANCEAMENTO DE TAMANHO
  // — cada estrofe herda o segmento mais "compatível" em tamanho com seu nº de palavras.
  const wordCounts = stanzas.map((s) => (s.text.trim().split(/\s+/).filter(Boolean).length) || 1);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);

  // tenta parear palavras→segmentos arredondando para nº de estrofes
  const totalSeg = vocalSegments.reduce((a, [s, e]) => a + Math.max(0.1, e - s), 0);
  const idealCum = [];
  let acc = 0;
  for (const wc of wordCounts) {
    acc += wc / totalWords;
    idealCum.push(acc * totalSeg);
  }

  const assignments = [];
  let segCursor = 0;
  let segUsed = 0;
  let lastIdeal = 0;

  for (let i = 0; i < stanzas.length; i++) {
    const idealEnd = idealCum[i];

    // avança cursor até o ponto ideal (ou final do último segmento)
    while (segCursor < vocalSegments.length - 1 && segUsed + (vocalSegments[segCursor][1] - vocalSegments[segCursor][0]) < idealEnd - lastIdeal) {
      segUsed += vocalSegments[segCursor][1] - vocalSegments[segCursor][0];
      segCursor++;
    }
    const seg = vocalSegments[Math.min(segCursor, vocalSegments.length - 1)];
    const start = Math.max(seg[0] - (opts.leadInSec ?? 0), 0);
    const end = seg[1] + (opts.trailOutSec ?? 0);

    assignments.push({
      start,
      end: Math.min(full.durationSec, end),
      vocalPresence: true,
      reason: 'vad-segment-aligned',
      confidence: Math.min(1, Math.max(0.4, vad.vocalRatio)),
    });
    lastIdeal = idealEnd;
  }

  // métricas de cobertura
  const assignedDuration = assignments.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
  const coverage = totalSeg > 0 ? Math.min(1, assignedDuration / totalSeg) : 0;

  // Usa probe só pra suprimir warning de variável não usada (Linter)
  void probe;

  return {
    method: 'energy-vad',
    audioDurationSec: full.durationSec,
    vocalRatio: vad.vocalRatio,
    vocalSegments,
    coverage,
    assignments,
  };
}
