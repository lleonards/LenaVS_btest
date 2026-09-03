/**
 * lyricsAlignerService.js
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Motor de alinhamento palavra-por-palavra usando o Lyrics Aligner
 * (ctc-forced-aligner==1.0.2 — modelo CTC ONNX; NÃO usar a API 2.x).
 *
 * O Lyrics Aligner serve APENAS para descobrir os tempos das palavras.
 * Ele NÃO cria, exclui, divide, junta ou reorganiza blocos.
 * A estrutura de blocos que já existe na LenaVS é mantida exatamente como está.
 *
 * ─── Como funciona ──────────────────────────────────────────────────────────
 *
 *   ETAPA 1 — Download do áudio (Supabase Storage → arquivo local temporário)
 *   ETAPA 2 — Opcional: guia vocal via FFmpeg (melhora o alinhamento em músicas)
 *   ETAPA 3 — Lyrics Aligner (ctc-forced-aligner): forced alignment palavra-por-palavra
 *             usando a LETRA fornecida pelo usuário (não usa transcrição do ASR)
 *   ETAPA 4 — Mapeamento por consumo sequencial de tokens:
 *             normaliza (minúsculas, sem acento, sem pontuação) para casar
 *             a letra do usuário com as palavras alinhadas; mantém a ordem
 *             exata em que as palavras aparecem na letra do usuário.
 *
 * ─── Env ────────────────────────────────────────────────────────────────────
 *
 *   LYRICS_ALIGNER_ENABLED  (padrão '1' — habilitado)
 *   LYRICS_ALIGNER_PYTHON   (padrão 'python3')
 *   LYRICS_ALIGNER_LANGUAGE (padrão 'por' — ISO 639-3)
 *   LYRICS_ALIGNER_DEVICE   (padrão 'cpu')
 *   LYRICS_ALIGNER_MODEL_PATH (padrão: ~/ctc_forced_aligner/model.onnx)
 *   LYRICS_ALIGNER_BATCH_SIZE (padrão 4)
 *   LYRICS_ALIGNER_TIMEOUT_MS (padrão 15 * 60 * 1000)
 *   LYRICS_ALIGNER_SCRIPT   (padrão scripts/lyrics_aligner.py)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import {
  downloadSourceValueToTempFile,
  removeLocalFileSilently,
} from './storageService.js';

const ALIGNER_ENABLED = String(process.env.LYRICS_ALIGNER_ENABLED ?? '1').trim().toLowerCase() !== '0';

// O Lyrics Aligner exige Python 3.12 (ctc-forced-aligner==1.0.2). O serviço
// prioriza a venv dedicada criada por scripts/setup_aligner_venv.sh
// (.venv-aligner) e só cai para 'python3' se ela não existir — assim o
// processo Node sempre executa o script no Python 3.12 correto.
const DEFAULT_ALIGNER_VENV_PYTHON = process.platform === 'win32'
  ? path.join(process.cwd(), '.venv-aligner', 'Scripts', 'python.exe')
  : path.join(process.cwd(), '.venv-aligner', 'bin', 'python');

const ALIGNER_PYTHON_BIN = process.env.LYRICS_ALIGNER_PYTHON
  || (fs.existsSync(DEFAULT_ALIGNER_VENV_PYTHON) ? DEFAULT_ALIGNER_VENV_PYTHON : 'python3');
const ALIGNER_SCRIPT_PATH = process.env.LYRICS_ALIGNER_SCRIPT
  || path.join(process.cwd(), 'scripts', 'lyrics_aligner.py');
const ALIGNER_LANGUAGE = (process.env.LYRICS_ALIGNER_LANGUAGE || 'por').trim();
const ALIGNER_DEVICE = process.env.LYRICS_ALIGNER_DEVICE || 'cpu';
const ALIGNER_MODEL_PATH = String(process.env.LYRICS_ALIGNER_MODEL_PATH || '').trim();
const ALIGNER_BATCH_SIZE = Number(process.env.LYRICS_ALIGNER_BATCH_SIZE || 4);
const ALIGNER_TIMEOUT_MS = Number(process.env.LYRICS_ALIGNER_TIMEOUT_MS || 15 * 60 * 1000);

const ALIGNER_TMP_ROOT = path.join(os.tmpdir(), 'lenavs-lyrics-aligner');

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 1 — HELPERS DE ÁUDIO E PROCESSO
// ═════════════════════════════════════════════════════════════════════════════

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
  return dirPath;
};

const isAlignerMissingError = (error) => {
  const stderr = String(error?.stderr || '').toLowerCase();
  const stdout = String(error?.stdout || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  return (
    error?.code === 'ENOENT'
    || stderr.includes('no module named ctc_forced_aligner')
    || stderr.includes('command not found')
    || stdout.includes('command not found')
    || message.includes('enoent')
    || message.includes('command not found')
    || message.includes('is not recognized as an internal or external command')
  );
};

const runCommand = (command, args, { cwd, timeoutMs = ALIGNER_TIMEOUT_MS, env = process.env } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');

    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 5000).unref();
  }, timeoutMs);

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });

  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });

  child.on('close', (code) => {
    clearTimeout(timer);

    if (timedOut) {
      const timeoutError = new Error(`Lyrics Aligner excedeu o tempo limite de ${Math.round(timeoutMs / 1000)} segundos.`);
      timeoutError.code = 'LYRICS_ALIGNER_TIMEOUT';
      timeoutError.stdout = stdout;
      timeoutError.stderr = stderr;
      reject(timeoutError);
      return;
    }

    if (code !== 0) {
      const commandError = new Error(`Lyrics Aligner finalizou com código ${code}.`);
      commandError.code = 'LYRICS_ALIGNER_PROCESS_FAILED';
      commandError.exitCode = code;
      commandError.stdout = stdout;
      commandError.stderr = stderr;
      reject(commandError);
      return;
    }

    resolve({ stdout, stderr });
  });
});

/**
 * Lê a duração real (em segundos) de um arquivo de mídia via FFmpeg probe.
 * Usada para limitar os tempos alinhados ao fim real da música.
 */
const getAudioDurationSeconds = (inputPath) => new Promise((resolve) => {
  ffmpeg.ffprobe(inputPath, (error, metadata) => {
    if (error || !metadata?.format?.duration) {
      resolve(null);
      return;
    }
    resolve(Number(metadata.format.duration));
  });
});

/**
 * Limita os tempos das palavras à duração real do áudio de origem.
 * O modelo ONNX processa janelas de 30s — músicas mais curtas recebem
 * silêncio de preenchimento; este clamp impede que esse silêncio gere
 * tempos além do fim real da música.
 */
export const clampWordTimesToDuration = (words, durationSeconds) => {
  const safeDuration = Number(durationSeconds);
  if (!Number.isFinite(safeDuration) || safeDuration <= 0) {
    return words;
  }

  return (Array.isArray(words) ? words : []).map((word) => {
    const rawStart = Number(word?.start);
    const rawEnd = Number(word?.end);
    const start = Math.min(Math.max(Number.isFinite(rawStart) ? rawStart : 0, 0), safeDuration);
    const end = Math.min(Math.max(Number.isFinite(rawEnd) ? rawEnd : start, start), safeDuration);
    return { ...word, start, end };
  });
};

/**
 * Converte áudio para WAV mono 16kHz leve (ideal para o forced alignment).
 * `apad=whole_dur=35` garante janela mínima de 35s para o ONNX; em músicas
 * mais longas o filtro é um no-op (o áudio não é alterado).
 */
const convertToWavForAligner = (inputPath) => new Promise((resolve, reject) => {
  const output = path.join(os.tmpdir(), `lena_aligner_${Date.now()}.wav`);
  ffmpeg(inputPath)
    .audioFilters(['apad=whole_dur=35'])
    .audioChannels(1)
    .audioFrequency(16000)
    .toFormat('wav')
    .on('end', () => resolve(output))
    .on('error', reject)
    .save(output);
});

/**
 * Extrai uma guia vocal aproximada via FFmpeg (melhora o alinhamento
 * quando o áudio original tem muito instrumental).
 */
const extractVocalGuideForAligner = (inputPath) => new Promise((resolve, reject) => {
  const output = path.join(os.tmpdir(), `lena_aligner_vocal_${Date.now()}.wav`);
  ffmpeg(inputPath)
    .audioFilters([
      'pan=mono|c0=0.5*c0+0.5*c1',
      'highpass=f=120',
      'lowpass=f=4200',
      'acompressor=threshold=-20dB:ratio=3:attack=5:release=50',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
    ])
    .audioChannels(1)
    .audioFrequency(16000)
    .toFormat('wav')
    .on('end', () => resolve(output))
    .on('error', reject)
    .save(output);
});

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 2 — HELPERS DE TEXTO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Normaliza uma palavra: minúsculas, sem acento, só alfanumérico.
 * Usada para casar a letra do usuário com as palavras alinhadas.
 */
const normalizeWordForMatching = (word) => String(word || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\w]/g, '');

/**
 * Extrai a lista de palavras normalizadas de um bloco.
 * A ordem das palavras é EXATAMENTE a ordem em que aparecem na letra
 * fornecida pelo usuário. Nenhuma palavra é adicionada, removida ou reordenada.
 */
const extractBlockWords = (text) => String(text || '')
  .split(/\s+/)
  .map(normalizeWordForMatching)
  .filter((word) => word.length > 0);

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 3 — LYRICS ALIGNER (ctc-forced-aligner)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Executa o script Python do Lyrics Aligner (ctc-forced-aligner) localmente.
 *
 * Entrada:  caminho local do áudio (WAV mono 16kHz) + caminho local da letra (.txt)
 * Saída:    [{ word, start, end }] — as palavras alinhadas, na ordem exata
 *           em que aparecem na letra fornecida pelo usuário.
 *
 * CLI usada (scripts/lyrics_aligner.py):
 *   python3 scripts/lyrics_aligner.py --audio <wav> --lyrics <txt> \
 *     --language <iso639-3> --device cpu --batch_size 4 [--model-path <onnx>]
 */
const runLyricsAlignerScript = async (audioPath, lyricsPath) => {
  await ensureDir(ALIGNER_TMP_ROOT);

  const args = [
    ALIGNER_SCRIPT_PATH,
    '--audio', audioPath,
    '--lyrics', lyricsPath,
    '--language', ALIGNER_LANGUAGE,
    '--device', ALIGNER_DEVICE,
    '--batch_size', String(ALIGNER_BATCH_SIZE),
  ];

  if (ALIGNER_MODEL_PATH) {
    args.push('--model-path', ALIGNER_MODEL_PATH);
  }

  const execution = await runCommand(ALIGNER_PYTHON_BIN, args, {
    cwd: ALIGNER_TMP_ROOT,
    timeoutMs: ALIGNER_TIMEOUT_MS,
    env: process.env,
  });

  const output = String(execution.stdout || '').trim();
  const jsonStart = output.indexOf('[');

  if (jsonStart < 0) {
    const error = new Error('Lyrics Aligner não retornou saída JSON legível.');
    error.code = 'LYRICS_ALIGNER_OUTPUT_NOT_FOUND';
    error.stdout = execution.stdout;
    error.stderr = execution.stderr;
    throw error;
  }

  let alignedWords = null;

  try {
    alignedWords = JSON.parse(output.slice(jsonStart));
  } catch (error) {
    const parseError = new Error('Não foi possível interpretar a saída do Lyrics Aligner como JSON.');
    parseError.code = 'LYRICS_ALIGNER_OUTPUT_INVALID';
    parseError.stdout = execution.stdout;
    parseError.stderr = execution.stderr;
    throw parseError;
  }

  if (!Array.isArray(alignedWords)) {
    const error = new Error('Lyrics Aligner retornou um formato inesperado.');
    error.code = 'LYRICS_ALIGNER_OUTPUT_INVALID';
    error.stdout = execution.stdout;
    error.stderr = execution.stderr;
    throw error;
  }

  return alignedWords
    .map((word) => ({
      word: String(word?.word ?? ''),
      start: Number(word?.start),
      end: Number(word?.end),
    }))
    .filter((word) => (
      normalizeWordForMatching(word.word).length > 0
      && Number.isFinite(word.start)
      && Number.isFinite(word.end)
      && word.end >= word.start
    ));
};

/**
 * Descobre os tempos das palavras usando o Lyrics Aligner.
 *
 * NÃO usa transcrição do ASR — usa a LETRA fornecida pelo usuário.
 * Retorna as palavras alinhadas na ordem exata da letra.
 *
 * @param {string} audioUrl URL pública do áudio (Supabase Storage)
 * @param {string} lyricsText Letra fornecida pelo usuário
 * @returns {Promise<{ words: [{word, start, end}], engine: string }>}
 */
export const alignLyricsWordsWithAudio = async (audioUrl, lyricsText, opts = {}) => {
  if (!ALIGNER_ENABLED && !opts.force) {
    const error = new Error('Lyrics Aligner está desativado (LYRICS_ALIGNER_ENABLED=0).');
    error.code = 'LYRICS_ALIGNER_DISABLED';
    throw error;
  }

  const sourceValue = String(audioUrl || '').trim();
  if (!sourceValue) {
    const error = new Error('audioUrl inválido ou ausente.');
    error.code = 'LYRICS_ALIGNER_AUDIO_URL_MISSING';
    throw error;
  }

  const text = String(lyricsText || '').trim();
  if (!text) {
    const error = new Error('Letra não fornecida para o alinhamento.');
    error.code = 'LYRICS_ALIGNER_LYRICS_MISSING';
    throw error;
  }

  const files = [];
  const cleanup = () => {
    for (const f of files) {
      removeLocalFileSilently(f);
    }
  };

  try {
    const fallbackName = (() => {
      try {
        return path.basename(new URL(sourceValue).pathname) || 'audio-original.mp3';
      } catch {
        return 'audio-original.mp3';
      }
    })();

    console.log('[lyricsAligner] Baixando áudio de origem para alinhamento local…');

    const sourceAudioPath = await downloadSourceValueToTempFile(sourceValue, {
      prefix: 'lyrics-aligner-source',
      fallbackName,
      mimeType: 'audio/mpeg',
      folder: 'lyrics-aligner',
    });
    files.push(sourceAudioPath);

    console.log('[lyricsAligner] Convertendo áudio para WAV mono 16kHz…');
    const wavPath = await convertToWavForAligner(sourceAudioPath);
    files.push(wavPath);

    console.log('[lyricsAligner] Preparando guia vocal via FFmpeg…');
    let alignerAudioPath = wavPath;
    try {
      const vocalGuidePath = await extractVocalGuideForAligner(wavPath);
      if (vocalGuidePath) {
        files.push(vocalGuidePath);
        alignerAudioPath = vocalGuidePath;
      }
    } catch (error) {
      console.warn('[lyricsAligner] Não foi possível preparar a guia vocal:', error.message);
    }

    console.log('[lyricsAligner] Escrevendo letra temporária para o forced alignment…');
    await ensureDir(ALIGNER_TMP_ROOT);
    const lyricsDir = await fs.promises.mkdtemp(path.join(ALIGNER_TMP_ROOT, 'lyrics-'));
    const lyricsPath = path.join(lyricsDir, 'letra.txt');
    files.push(lyricsDir);

    // A letra é gravada EXATAMENTE como o usuário escreveu.
    await fs.promises.writeFile(lyricsPath, text, 'utf8');

    console.log('[lyricsAligner] Executando Lyrics Aligner (ctc-forced-aligner)…');
    const alignedWords = await runLyricsAlignerScript(alignerAudioPath, lyricsPath);

    // Limita os tempos à duração real da música (padrão: janela mínima ONNX).
    const sourceDuration = await getAudioDurationSeconds(sourceAudioPath);
    const finalWords = clampWordTimesToDuration(alignedWords, sourceDuration);

    console.log(`[lyricsAligner] ✅ ${finalWords.length} palavras com timestamps.`);

    if (!finalWords.length) {
      const error = new Error('O Lyrics Aligner não conseguiu alinhar nenhuma palavra da letra.');
      error.code = 'LYRICS_ALIGNER_EMPTY';
      throw error;
    }

    return {
      words: finalWords,
      engine: 'lyrics-aligner-ctc',
    };
  } finally {
    cleanup();
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// SEÇÃO 4 — MAPEAMENTO POR CONSUMO SEQUENCIAL DE TOKENS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Mapeia as palavras alinhadas para os blocos que JÁ EXISTEM na LenaVS.
 *
 * Regra principal: o mapeamento é por CONSUMO SEQUENCIAL de tokens —
 *   • o cursor avança somente para frente;
 *   • cada bloco consome, a partir do cursor, a MESMA quantidade de palavras
 *     que ele já tem (a estrutura do usuário é mantida exatamente como está);
 *   • bloco.start = tempo da primeira palavra consumida;
 *   • bloco.end = tempo da última palavra consumida.
 *
 * O Lyrics Aligner NÃO cria, exclui, divide, junta ou reorganiza blocos.
 * Se as palavras alinhadas forem menos do que a letra tem (o ASR pode falhar
 * em trechos com muito instrumental), o bloco fica sem tempo — nunca recebe
 * tempo inventado.
 *
 * @param {Array<{text: string}>} blocks Blocos existentes na LenaVS
 * @param {Array<{word: string, start: number, end: number}>} alignedWords Palavras alinhadas
 * @returns {Array<{ text: string, startTime: number|null, endTime: number|null }>}
 */
export const mapAlignedWordsToBlocks = (blocks, alignedWords) => {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  const safeAlignedWords = Array.isArray(alignedWords) ? alignedWords : [];

  // Tokeniza os blocos na ordem exata em que o usuário escreveu.
  const blockWordCounts = safeBlocks.map((block) => extractBlockWords(block?.text).length);
  const totalBlockWords = blockWordCounts.reduce((sum, count) => sum + count, 0);

  // Tokeniza as palavras alinhadas na ordem exata em que o Lyrics Aligner as alinhou.
  const alignedTokens = safeAlignedWords.map((word) => ({
    ...word,
    normalized: normalizeWordForMatching(word.word),
  }));

  const result = [];
  let cursor = 0;

  for (let blockIndex = 0; blockIndex < safeBlocks.length; blockIndex += 1) {
    const block = safeBlocks[blockIndex];
    const wordCount = blockWordCounts[blockIndex];

    if (wordCount <= 0) {
      result.push({
        text: String(block?.text || ''),
        startTime: null,
        endTime: null,
      });
      continue;
    }

    const startIndex = cursor;
    const endIndex = cursor + wordCount - 1;

    // Consumo sequencial: só avança, nunca reordena.
    cursor = endIndex + 1;

    if (endIndex >= alignedTokens.length) {
      // Não há palavras alinhadas suficientes — o bloco fica sem tempo.
      result.push({
        text: String(block?.text || ''),
        startTime: null,
        endTime: null,
      });
      continue;
    }

    const firstWord = alignedTokens[startIndex];
    const lastWord = alignedTokens[endIndex];

    result.push({
      text: String(block?.text || ''),
      startTime: Number(firstWord.start.toFixed(3)),
      endTime: Number(lastWord.end.toFixed(3)),
    });
  }

  const matchedBlocks = result.filter((block) => block.startTime !== null && block.endTime !== null).length;

  return {
    blocks: result,
    matchedBlocks,
    totalBlocks: safeBlocks.length,
    totalBlockWords,
    totalAlignedWords: alignedTokens.length,
  };
};

/**
 * Sincroniza os blocos existentes com a música usando o Lyrics Aligner.
 *
 * A estrutura de blocos é mantida exatamente como está.
 * Apenas os tempos (início e final de cada bloco) são preenchidos.
 *
 * @param {string} audioUrl URL pública do áudio (Supabase Storage)
 * @param {Array<{text: string}>} blocks Blocos existentes na LenaVS
 * @returns {Promise<{ blocks: [{text, startTime, endTime}], ... }>}
 */
export const syncLyricsStanzasWithAligner = async (audioUrl, blocks, opts = {}) => {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];

  const lyricsText = safeBlocks
    .map((block) => String(block?.text || '').trim())
    .filter(Boolean)
    .join('\n\n');

  const aligned = await alignLyricsWordsWithAudio(audioUrl, lyricsText, opts);

  return mapAlignedWordsToBlocks(safeBlocks, aligned.words);
};
