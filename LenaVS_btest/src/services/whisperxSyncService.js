import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';
import { spawn } from 'child_process';

const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;

const normalizeWord = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\p{L}\p{N}]/gu, '');

const tokenize = (text) => String(text || '')
  .match(/[\p{L}\p{N}]+/gu)
  ?.map((value) => ({ text: value, normalized: normalizeWord(value) }))
  .filter((token) => token.normalized.length > 0) || [];

const levenshtein = (left, right) => {
  const a = String(left || '');
  const b = String(right || '');
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = a[i - 1] === b[j - 1]
        ? diagonal
        : Math.min(diagonal + 1, previous[j] + 1, previous[j - 1] + 1);
      diagonal = above;
    }
  }

  return previous[b.length];
};

const similarity = (left, right) => {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return 1 - (distance / Math.max(left.length, right.length, 1));
};

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const formatEditorTime = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};

const normalizedWhisperWords = (words = []) => words
  .map((word, index) => {
    const start = toFiniteNumber(word?.start);
    const end = toFiniteNumber(word?.end);
    const text = String(word?.word || '').trim();

    if (!text || start === null || end === null || end < start) {
      return null;
    }

    return {
      index,
      word: text,
      normalized: normalizeWord(text),
      start,
      end,
    };
  })
  .filter((word) => word?.normalized)
  .map((word, index) => ({ ...word, index }));

/*
 * Local, monotonic matching: each user block is searched after the previous
 * block. The text is never rewritten and no block is created or removed.
 */
const matchStanzaToWords = (tokens, words, cursor) => {
  if (!tokens.length || cursor >= words.length) return null;

  const maxWindow = Math.min(words.length, cursor + Math.max(12, (tokens.length * 2) + 8));
  const minimumMatches = Math.max(1, Math.ceil(tokens.length * 0.45));
  let best = null;

  for (let start = cursor; start < words.length; start += 1) {
    if (start >= maxWindow) break;

    const matched = [];
    let searchFrom = start;

    for (const token of tokens) {
      let bestWord = null;
      let bestScore = 0;

      for (let index = searchFrom; index < maxWindow; index += 1) {
        const candidate = words[index];
        const score = similarity(token.normalized, candidate.normalized);
        const isExact = token.normalized === candidate.normalized;

        if (isExact || score > bestScore) {
          bestWord = { ...candidate, tokenText: token.text, score, exact: isExact };
          bestScore = score;
        }

        if (isExact) break;
      }

      if (bestWord && (bestWord.exact || bestWord.score >= 0.62)) {
        matched.push(bestWord);
        searchFrom = bestWord.index + 1;
      }
    }

    if (matched.length < minimumMatches) continue;

    const exactCount = matched.filter((word) => word.exact).length;
    const span = matched[matched.length - 1].index - matched[0].index + 1;
    const coverage = matched.length / tokens.length;
    const compactness = matched.length / Math.max(span, 1);
    const score = (coverage * 100) + (exactCount * 5) + (compactness * 10) - ((start - cursor) * 0.02);

    if (!best || score > best.score) {
      best = { matched, score };
    }
  }

  if (!best) return null;

  return {
    startIndex: best.matched[0].index,
    endIndex: best.matched[best.matched.length - 1].index,
    matchedWords: best.matched,
  };
};

const downloadAudio = async (audioUrl) => {
  let parsedUrl;

  try {
    parsedUrl = new URL(audioUrl);
  } catch {
    throw new Error('A URL da música original é inválida.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('A música original precisa estar disponível em uma URL HTTP ou HTTPS.');
  }

  const extension = path.extname(parsedUrl.pathname).replace(/[^a-z0-9.]/gi, '') || '.audio';
  const targetPath = path.join(os.tmpdir(), `lenavs-whisperx-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
  const transport = parsedUrl.protocol === 'https:' ? https : http;

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(targetPath);
    const request = transport.get(parsedUrl, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        output.close();
        fs.rmSync(targetPath, { force: true });
        reject(new Error('A URL da música redirecionou para um endereço não permitido.'));
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        output.close();
        fs.rmSync(targetPath, { force: true });
        reject(new Error(`Não foi possível baixar a música original (HTTP ${response.statusCode}).`));
        return;
      }

      response.pipe(output);
      output.on('finish', () => output.close(resolve));
    });

    request.setTimeout(120000, () => request.destroy(new Error('Tempo excedido ao baixar a música original.')));
    request.on('error', (error) => {
      output.close();
      fs.rmSync(targetPath, { force: true });
      reject(error);
    });
  });

  return targetPath;
};

const runWhisperX = async (audioPath) => {
  const pythonBin = process.env.WHISPERX_PYTHON || 'python3';
  const scriptPath = process.env.WHISPERX_SCRIPT
    || path.join(process.cwd(), 'scripts', 'whisperx_transcribe.py');
  const timeoutMs = Number(process.env.WHISPERX_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [scriptPath, '--audio', audioPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(reject, new Error('A sincronização demorou mais do que o permitido. Tente uma música menor ou use outro modelo.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(reject, new Error(`WhisperX não conseguiu analisar a música. ${stderr.trim()}`.trim()));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        finish(resolve, {
          language: result.language || null,
          words: normalizedWhisperWords(result.words),
        });
      } catch {
        finish(reject, new Error('WhisperX retornou uma resposta inválida.'));
      }
    });
  });
};

export const syncLyricsWithWhisperX = async ({ audioUrl, stanzas }) => {
  if (!Array.isArray(stanzas) || stanzas.length === 0) {
    throw new Error('Envie a letra antes de iniciar a sincronização automática.');
  }

  const audioPath = await downloadAudio(audioUrl);

  try {
    const transcription = await runWhisperX(audioPath);
    if (!transcription.words.length) {
      throw new Error('WhisperX não encontrou palavras cantadas na música.');
    }

    let cursor = 0;
    let matchedCount = 0;
    const syncedStanzas = stanzas.map((stanza) => {
      const tokens = tokenize(stanza?.text);
      const match = matchStanzaToWords(tokens, transcription.words, cursor);

      if (!match) {
        return {
          ...stanza,
          startTime: null,
          endTime: null,
          wordTimings: [],
          syncMatched: false,
        };
      }

      cursor = match.endIndex + 1;
      matchedCount += 1;
      const start = match.matchedWords[0].start;
      const end = match.matchedWords[match.matchedWords.length - 1].end;

      return {
        ...stanza,
        startTime: formatEditorTime(start),
        endTime: formatEditorTime(end),
        wordTimings: match.matchedWords.map((word) => ({
          text: word.tokenText,
          word: word.word,
          start: word.start,
          end: word.end,
        })),
        syncMatched: true,
      };
    });

    return {
      stanzas: syncedStanzas,
      words: transcription.words.map(({ word, start, end }) => ({ word, start, end })),
      language: transcription.language,
      matchedBlocks: matchedCount,
      totalBlocks: stanzas.length,
      engine: 'whisperx',
    };
  } finally {
    await fs.promises.rm(audioPath, { force: true }).catch(() => {});
  }
};