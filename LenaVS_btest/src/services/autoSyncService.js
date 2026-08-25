/**
 * autoSyncService.js — Sincronização automática de letras (sistema novo)
 *
 * Fluxo:
 *  1) Baixa o áudio original para um arquivo temporário.
 *  2) Detecta o momento (início/fim) de CADA PALAVRA cantada, usando:
 *       a) Groq Whisper API (gratuita, precisa de GROQ_API_KEY) — primário
 *       b) WhisperX local (scripts/whisperx_transcribe.py) — fallback opcional
 *  3) Alinha as palavras detectadas com as palavras de CADA BLOCO da letra,
 *     na ordem em que o usuário escreveu (src/utils/lyricsAligner.js) —
 *     sem dividir, juntar ou reorganizar blocos.
 *  4) O início do bloco = início da primeira palavra do bloco;
 *     o fim do bloco = fim da última palavra do bloco.
 *  5) Retorna tempos em MM:SS (a LenaVS trabalha apenas com minutos e segundos).
 *
 * Variáveis de ambiente:
 *  - GROQ_API_KEY            → chave gratuita criada em https://console.groq.com/keys
 *  - GROQ_WHISPER_MODEL      → opcional (padrão: whisper-large-v3-turbo)
 *  - GROQ_WHISPER_LANGUAGE   → opcional (ex.: "pt"; vazio = detecção automática)
 *  - WHISPERX_ENABLED        → "1"/"true" habilita o fallback local WhisperX
 *  - WHISPERX_MODEL          → opcional (padrão: small)
 */

import { spawn } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  downloadSourceValueToTempFile,
  removeLocalFileSilently,
} from './storageService.js';
import {
  alignBlocksToWords,
  formatMinutesSeconds,
} from '../utils/lyricsAligner.js';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_DEFAULT_MODEL = 'whisper-large-v3-turbo';
const GROQ_MAX_BYTES = 24 * 1024 * 1024; // margem de segurança abaixo do limite de 25 MB
const MAX_BLOCKS = 500;

const SYNC_ERRORS = {
  NO_ENGINE: 'SYNC_NO_ENGINE',
  TRANSCRIPTION_FAILED: 'SYNC_TRANSCRIPTION_FAILED',
  NO_WORDS: 'SYNC_NO_WORDS',
  AUDIO_TOO_LARGE: 'SYNC_AUDIO_TOO_LARGE',
  RATE_LIMITED: 'SYNC_RATE_LIMITED',
  INVALID_KEY: 'SYNC_INVALID_KEY',
};

const buildSyncError = (code, message, extra = {}) => {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
};

/* =========================================================
   Execução de processos locais (ffmpeg / whisperx)
========================================================= */

const runProcess = (command, args, { timeoutMs = 600000, maxStdout = 64 * 1024 * 1024 } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGKILL');
      reject(buildSyncError(SYNC_ERRORS.TRANSCRIPTION_FAILED, `${command} excedeu o tempo limite.`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxStdout) {
        finished = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(buildSyncError(SYNC_ERRORS.TRANSCRIPTION_FAILED, `${command} produziu saída grande demais.`));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 256 * 1024) stderr = stderr.slice(-256 * 1024);
    });
    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = buildSyncError(
          SYNC_ERRORS.TRANSCRIPTION_FAILED,
          `${command} terminou com código ${code}.`
        );
        error.stderr = stderr;
        reject(error);
      }
    });
  });

/* =========================================================
   Preparação do áudio (ffmpeg → mp3 16kHz mono, menor p/ API)
========================================================= */

const prepareAudioForTranscription = async (sourcePath) => {
  const stats = await fsp.stat(sourcePath).catch(() => null);
  const isTranscribable = /\.(mp3|mp4|mpeg|mpga|m4a|wav|webm|ogg|oga|flac|opus)$/i.test(sourcePath);

  if (stats && stats.size <= 12 * 1024 * 1024 && isTranscribable) {
    return { path: sourcePath, isTemp: false };
  }

  const targetPath = path.join(
    os.tmpdir(),
    `lenavs-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`
  );

  try {
    await runProcess('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '48k',
      targetPath,
    ], { timeoutMs: 300000 });
    return { path: targetPath, isTemp: true };
  } catch (error) {
    await removeLocalFileSilently(targetPath);
    if (stats && stats.size <= GROQ_MAX_BYTES && isTranscribable) {
      console.warn('[autoSync] ffmpeg indisponível; enviando arquivo original.', error.message);
      return { path: sourcePath, isTemp: false };
    }
    throw buildSyncError(
      SYNC_ERRORS.AUDIO_TOO_LARGE,
      'O áudio é grande demais para a transcrição e não foi possível comprimi-lo (ffmpeg ausente?).'
    );
  }
};

/* =========================================================
   Motor 1 — Groq Whisper API (gratuita, timestamps por palavra)
========================================================= */

const transcribeWordsWithGroq = async (audioPath) => {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) {
    throw buildSyncError(SYNC_ERRORS.NO_ENGINE, 'GROQ_API_KEY não configurada.');
  }

  const buffer = await fsp.readFile(audioPath);
  if (buffer.length > GROQ_MAX_BYTES) {
    throw buildSyncError(
      SYNC_ERRORS.AUDIO_TOO_LARGE,
      'O áudio excede o limite de 25 MB da API de transcrição mesmo após a compressão.'
    );
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/mpeg' }), path.basename(audioPath));
  form.append('model', String(process.env.GROQ_WHISPER_MODEL || GROQ_DEFAULT_MODEL).trim());
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  const language = String(process.env.GROQ_WHISPER_LANGUAGE || '').trim();
  if (language) form.append('language', language);

  let response;
  try {
    response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (networkError) {
    throw buildSyncError(
      SYNC_ERRORS.TRANSCRIPTION_FAILED,
      'Não foi possível alcançar a API de transcrição. Verifique a conexão do servidor.',
      { cause: networkError }
    );
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiMessage = String(payload?.error?.message || '').trim();

    if (response.status === 401 || response.status === 403) {
      throw buildSyncError(
        SYNC_ERRORS.INVALID_KEY,
        'A chave GROQ_API_KEY é inválida. Gere uma chave gratuita em https://console.groq.com/keys e atualize o backend.'
      );
    }

    if (response.status === 413) {
      throw buildSyncError(
        SYNC_ERRORS.AUDIO_TOO_LARGE,
        'O áudio é grande demais para a API de transcrição. Use um arquivo menor.'
      );
    }

    if (response.status === 429) {
      throw buildSyncError(
        SYNC_ERRORS.RATE_LIMITED,
        'Limite gratuito de transcrições atingido. Aguarde alguns instantes e tente novamente.'
      );
    }

    throw buildSyncError(
      SYNC_ERRORS.TRANSCRIPTION_FAILED,
      apiMessage || `A API de transcrição respondeu com status ${response.status}.`
    );
  }

  const words = (Array.isArray(payload?.words) ? payload.words : [])
    .map((entry) => ({
      word: String(entry?.word ?? '').trim(),
      start: Number(entry?.start),
      end: Number(entry?.end),
    }))
    .filter((entry) => entry.word && Number.isFinite(entry.start) && Number.isFinite(entry.end));

  return {
    words,
    language: payload?.language || language || null,
    engine: 'groq',
  };
};

/* =========================================================
   Motor 2 — WhisperX local (fallback opcional, sem chave de API)
========================================================= */

const transcribeWordsWithWhisperX = async (audioPath) => {
  const scriptPath = path.join(process.cwd(), 'scripts', 'whisperx_transcribe.py');
  if (!fs.existsSync(scriptPath)) {
    throw buildSyncError(SYNC_ERRORS.NO_ENGINE, 'Script WhisperX não encontrado no servidor.');
  }

  const { stdout } = await runProcess('python3', [
    scriptPath,
    '--audio', audioPath,
    '--model', String(process.env.WHISPERX_MODEL || 'small'),
  ], { timeoutMs: 1200000 });

  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw buildSyncError(SYNC_ERRORS.TRANSCRIPTION_FAILED, 'WhisperX retornou uma resposta inválida.');
  }

  const words = (Array.isArray(parsed?.words) ? parsed.words : [])
    .map((entry) => ({
      word: String(entry?.word ?? '').trim(),
      start: Number(entry?.start),
      end: Number(entry?.end),
    }))
    .filter((entry) => entry.word && Number.isFinite(entry.start) && Number.isFinite(entry.end));

  return {
    words,
    language: parsed?.language || null,
    engine: 'whisperx',
  };
};

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const transcribeWords = async (audioPath) => {
  const hasGroqKey = Boolean(String(process.env.GROQ_API_KEY || '').trim());
  const whisperXEnabled = isTruthy(process.env.WHISPERX_ENABLED);
  const errors = [];

  if (hasGroqKey) {
    try {
      return await transcribeWordsWithGroq(audioPath);
    } catch (error) {
      errors.push(error);
      // Erros de configuração/limite não adiantam repetir no outro motor se WhisperX estiver off
      if (!whisperXEnabled) throw error;
      console.warn('[autoSync] Groq falhou, tentando WhisperX local:', error.message);
    }
  }

  if (whisperXEnabled || !hasGroqKey) {
    try {
      return await transcribeWordsWithWhisperX(audioPath);
    } catch (error) {
      errors.push(error);
    }
  }

  if (!errors.length) {
    throw buildSyncError(
      SYNC_ERRORS.NO_ENGINE,
      'Nenhum motor de transcrição configurado. Defina GROQ_API_KEY (gratuita) ou habilite WHISPERX_ENABLED=1 com whisperx instalado.'
    );
  }

  throw errors[0];
};

/* =========================================================
   Orquestrador
========================================================= */

/**
 * Sincroniza os blocos da letra com o áudio.
 *
 * @param {string} audioUrl URL pública do áudio original
 * @param {Array<{id: string, text: string}>} blocks blocos exatamente como organizados na LenaVS
 * @returns {Promise<{engine: string, language: string|null, stanzas: Array, stats: object}>}
 */
export const syncLyricsBlocksAutomatically = async (audioUrl, blocks) => {
  if (!Array.isArray(blocks) || !blocks.length) {
    throw buildSyncError(SYNC_ERRORS.TRANSCRIPTION_FAILED, 'Nenhum bloco de letra foi enviado.');
  }

  if (blocks.length > MAX_BLOCKS) {
    throw buildSyncError(SYNC_ERRORS.TRANSCRIPTION_FAILED, `Máximo de ${MAX_BLOCKS} blocos por sincronização.`);
  }

  let sourceAudioPath = null;
  let preparedPath = null;
  let preparedIsTemp = false;

  try {
    const fallbackName = (() => {
      try {
        return path.basename(new URL(audioUrl).pathname) || 'musica-original.mp3';
      } catch {
        return 'musica-original.mp3';
      }
    })();

    sourceAudioPath = await downloadSourceValueToTempFile(audioUrl, {
      prefix: 'autosync-source',
      fallbackName,
      mimeType: 'audio/mpeg',
      folder: 'autosync-source',
    });

    const prepared = await prepareAudioForTranscription(sourceAudioPath);
    preparedPath = prepared.path;
    preparedIsTemp = prepared.isTemp;

    const { words, language, engine } = await transcribeWords(preparedPath);

    if (!words.length) {
      throw buildSyncError(
        SYNC_ERRORS.NO_WORDS,
        'Não foi possível detectar palavras cantadas neste áudio. Verifique se a música tem vocais audíveis.'
      );
    }

    const aligned = alignBlocksToWords(words, blocks);

    const stanzas = aligned.map((entry) => ({
      id: entry.id,
      startTime: formatMinutesSeconds(entry.startSeconds),
      endTime: formatMinutesSeconds(Math.max(entry.endSeconds, entry.startSeconds)),
      matched: Boolean(entry.matched),
      estimated: Boolean(entry.estimated),
    }));

    return {
      engine,
      language,
      stanzas,
      stats: {
        blocks: blocks.length,
        syncedBlocks: aligned.filter((entry) => entry.matched).length,
        estimatedBlocks: aligned.filter((entry) => !entry.matched).length,
        wordsDetected: words.length,
      },
    };
  } finally {
    if (preparedIsTemp) await removeLocalFileSilently(preparedPath);
    await removeLocalFileSilently(sourceAudioPath);
  }
};

export { SYNC_ERRORS };
