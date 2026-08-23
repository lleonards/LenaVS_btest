import path from 'path';
import { spawn } from 'child_process';
import {
  downloadSourceValueToTempFile,
  removeLocalFileSilently,
} from '../services/storageService.js';

const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts', 'whisperx_transcribe.py');
const MAX_SYNC_SECONDS = 20 * 60;

const normalizeToken = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '');

const levenshtein = (a, b) => {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
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

const isSimilar = (expected, actual) => {
  if (!expected || !actual) return false;
  if (expected === actual) return true;
  const maxDistance = expected.length >= 6 ? 2 : 1;
  return levenshtein(expected, actual) <= maxDistance;
};

const alignBlocks = (blocks, words) => {
  const safeWords = words
    .filter((word) => Number.isFinite(Number(word?.start)) && Number.isFinite(Number(word?.end)))
    .map((word) => ({ ...word, token: normalizeToken(word.word) }))
    .filter((word) => word.token);
  const results = [];
  let cursor = 0;

  for (const block of blocks) {
    const expected = String(block?.text || '').match(/[^\s]+/g)?.map(normalizeToken).filter(Boolean) || [];
    let searchFrom = cursor;
    const matched = [];

    for (const token of expected) {
      let found = -1;
      // Allow short transcription insertions/omissions, while keeping the
      // official block order and never reusing an earlier word.
      for (let index = searchFrom; index < safeWords.length; index += 1) {
        if (isSimilar(token, safeWords[index].token)) {
          found = index;
          break;
        }
        if (index - searchFrom >= 10) break;
      }
      if (found >= 0) {
        matched.push(safeWords[found]);
        searchFrom = found + 1;
      }
    }

    if (matched.length) {
      cursor = Math.max(cursor, safeWords.indexOf(matched[matched.length - 1]) + 1);
      results.push({
        id: block.id,
        startTimeSeconds: Number(matched[0].start),
        endTimeSeconds: Number(matched[matched.length - 1].end),
        matchedWords: matched.length,
        totalWords: expected.length,
      });
    } else {
      results.push({
        id: block.id,
        matchedWords: 0,
        totalWords: expected.length,
        reason: 'Nenhuma palavra do bloco foi encontrada na transcrição.',
      });
    }
  }
  return results;
};

const runWhisperX = (audioPath) => new Promise((resolve, reject) => {
  const python = process.env.PYTHON_BIN || 'python3';
  const args = [
    SCRIPT_PATH,
    '--audio', audioPath,
    '--model', process.env.WHISPERX_MODEL || 'small',
    '--device', process.env.WHISPERX_DEVICE || 'cpu',
    '--compute_type', process.env.WHISPERX_COMPUTE_TYPE || 'int8',
  ];
  const child = spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    const error = new Error('A sincronização demorou mais do que o esperado.');
    error.code = 'SYNC_TIMEOUT';
    reject(error);
  }, Number(process.env.SYNC_TIMEOUT_MS) || 15 * 60 * 1000);

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', (error) => { clearTimeout(timeout); reject(error); });
  child.on('close', (code) => {
    clearTimeout(timeout);
    if (code !== 0) {
      const error = new Error('O mecanismo de reconhecimento de voz não conseguiu analisar a música.');
      error.code = 'SYNC_ENGINE_FAILED';
      error.stderr = stderr;
      reject(error);
      return;
    }
    try {
      resolve(JSON.parse(stdout));
    } catch {
      const error = new Error('O mecanismo de sincronização retornou um resultado inválido.');
      error.code = 'SYNC_INVALID_RESULT';
      reject(error);
    }
  });
});

export const synchronizeLyrics = async (req, res) => {
  const audioUrl = String(req.body?.audioUrl || '').trim();
  const blocks = Array.isArray(req.body?.stanzas) ? req.body.stanzas : [];

  if (!audioUrl || !blocks.length) {
    return res.status(400).json({
      code: 'SYNC_INPUT_INVALID',
      error: 'Envie uma música original e uma letra com pelo menos um bloco.',
    });
  }
  if (blocks.length > 1000) {
    return res.status(400).json({ code: 'SYNC_TOO_MANY_BLOCKS', error: 'A letra possui blocos demais para sincronizar.' });
  }

  let audioPath = null;
  try {
    audioPath = await downloadSourceValueToTempFile(audioUrl, {
      prefix: 'lyrics-sync',
      fallbackName: 'musica-original.mp3',
      mimeType: 'audio/mpeg',
      folder: 'lyrics-sync',
    });
    const transcription = await runWhisperX(audioPath);
    const results = alignBlocks(blocks, transcription.words || []);
    const matched = results.filter((item) => item.matchedWords > 0).length;
    if (!matched) {
      return res.status(422).json({
        code: 'SYNC_NO_MATCH',
        error: 'Não foi possível encontrar palavras da letra na música. Verifique se a música original contém voz.',
      });
    }
    return res.json({
      success: true,
      engine: 'whisperx-local',
      language: transcription.language || null,
      results,
      matchedBlocks: matched,
      totalBlocks: blocks.length,
    });
  } catch (error) {
    console.error('[synchronizeLyrics]', error);
    const status = error.code === 'SYNC_TIMEOUT' ? 504 : 500;
    return res.status(status).json({
      code: error.code || 'SYNC_FAILED',
      error: error.message || 'Não foi possível sincronizar a letra.',
    });
  } finally {
    await removeLocalFileSilently(audioPath);
  }
};