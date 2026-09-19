import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import {
  downloadSourceValueToTempFile,
  removeLocalFileSilently,
} from './storageService.js';
import {
  getHeavyTaskQueueInfo,
  runExclusiveHeavyTaskTracked,
} from '../utils/heavyTaskLock.js';

/**
 * lyricsAlignService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sincronização automática de letras da LenaVS (tempo por palavra → tempo por
 * bloco/estrofe), usando o ctc-forced-aligner==1.0.2 executado localmente.
 *
 * Cuidados com o servidor de 1 CPU / 2 GB de RAM:
 *  • FILA SERIAL: apenas UM alinhamento por vez (dois processos em paralelo
 *    estouram a RAM e o Render mata o container).
 *  • Áudio é convertido para WAV 16 kHz MONO antes de alinhar (o WAV de 16 kHz
 *    mono ocupa ~1,9 MB por minuto, contra dezenas de MB de um MP3 decodificado
 *    em 44,1 kHz estéreo).
 *  • O Python fixa threads=1 e batch=1 (ver scripts/lyrics_align.py).
 *  • O processo Python MORRE ao final de cada job: a RAM do modelo volta para
 *    o sistema operacional.
 *  • Timeout por job e limpeza garantida de arquivos temporários.
 */

const ALIGNER_SCRIPT = process.env.LYRICS_ALIGN_SCRIPT
  || path.join(process.cwd(), 'scripts', 'lyrics_align.py');

const PYTHON_BIN = (() => {
  const configured = String(process.env.LYRICS_ALIGN_PYTHON_BIN || '').trim();
  const dedicated = '/opt/lenavs-aligner/bin/python3';

  if (configured && configured !== 'python3') return configured;
  if (fs.existsSync(dedicated)) return dedicated;
  return configured || 'python3';
})();
const LANGUAGE = process.env.LYRICS_ALIGN_LANGUAGE || 'por';
const TIMEOUT_MS = Math.max(60 * 1000, Number(process.env.LYRICS_ALIGN_TIMEOUT_MS) || 25 * 60 * 1000);
const PROBE_TIMEOUT_MS = Math.max(10 * 1000, Number(process.env.LYRICS_ALIGN_PROBE_TIMEOUT_MS) || 90 * 1000);
const MODE = String(process.env.LYRICS_ALIGN_MODE || 'auto').trim().toLowerCase();
const MODEL_DIR = process.env.LYRICS_ALIGN_MODEL_DIR || '';
const MODEL_URL = process.env.LYRICS_ALIGN_MODEL_URL || '';
const BATCH_SIZE = String(process.env.LYRICS_ALIGN_BATCH_SIZE || '1');
const WINDOW_SECONDS = String(process.env.LYRICS_ALIGN_WINDOW_SECONDS || '15');
const CONTEXT_SECONDS = String(process.env.LYRICS_ALIGN_CONTEXT_SECONDS || '1');

const TMP_ROOT = path.join(os.tmpdir(), 'lenavs-align');

const AVAILABILITY_ERROR_MESSAGE = [
  'O sincronizador de letras não está instalado neste servidor.',
  'Instale as dependências Python do alinhador (pip install -r requirements-aligner.txt)',
  'e confirme a variável LYRICS_ALIGN_PYTHON_BIN apontando para o Python correto.',
].join(' ');

let availabilityPromise = null;

/* ────────────────────────────────────────────────────────────────────────────
   Utilidades
──────────────────────────────────────────────────────────────────────────── */

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
  return dirPath;
};

const removeDirectorySilently = async (dirPath) => {
  if (!dirPath) return;

  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.warn('[lyricsAlignService] Não foi possível remover diretório temporário:', error.message);
  }
};

const roundSeconds = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(3)) : null;
};

const countWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

const buildProportionalBlocks = (blocks, durationSeconds) => {
  const duration = Math.max(1, Number(durationSeconds) || 0);
  const counts = blocks.map((block) => Math.max(1, countWords(block)));
  const total = counts.reduce((sum, count) => sum + count, 0) || 1;
  let cursor = 0;

  return blocks.map((block, index) => {
    const start = cursor;
    const end = index === blocks.length - 1
      ? duration
      : Math.min(duration, cursor + (duration * counts[index]) / total);

    cursor = Math.max(start, end);

    return {
      index,
      startSec: Number(start.toFixed(3)),
      endSec: Number(Math.max(start + 0.1, end).toFixed(3)),
      wordCount: countWords(block),
      alignedWords: 0,
      estimated: true,
    };
  });
};

const buildAlignerEnv = (baseEnv = process.env) => ({
  ...baseEnv,
  OMP_NUM_THREADS: '1',
  MKL_NUM_THREADS: '1',
  OPENBLAS_NUM_THREADS: '1',
  NUMEXPR_NUM_THREADS: '1',
  VECLIB_MAXIMUM_THREADS: '1',
  TOKENIZERS_PARALLELISM: 'false',
  PYTHONUNBUFFERED: '1',
});

const runCommand = (command, args, { cwd, timeoutMs = TIMEOUT_MS, env = process.env } = {}) => new Promise((resolve, reject) => {
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
      if (!child.killed) child.kill('SIGKILL');
    }, 5000).unref();
  }, timeoutMs);

  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });

  child.on('close', (code) => {
    clearTimeout(timer);

    if (timedOut) {
      const timeoutError = new Error(`A sincronização excedeu o tempo limite de ${Math.round(timeoutMs / 1000)}s.`);
      timeoutError.code = 'ALIGN_TIMEOUT';
      timeoutError.stdout = stdout;
      timeoutError.stderr = stderr;
      reject(timeoutError);
      return;
    }

    if (code !== 0) {
      const commandError = new Error(`Alinhador finalizou com código ${code}.`);
      commandError.code = 'ALIGN_PROCESS_FAILED';
      commandError.exitCode = code;
      commandError.stdout = stdout;
      commandError.stderr = stderr;
      reject(commandError);
      return;
    }

    resolve({ stdout, stderr });
  });
});

const extractJsonFromStdout = (stdout) => {
  const raw = String(stdout || '').trim();
  if (!raw) return null;

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');

  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
};

/* ────────────────────────────────────────────────────────────────────────────
   Fila serial (1 job por vez)
──────────────────────────────────────────────────────────────────────────── */

// FILA SERIAL GLOBAL: o lock compartilhado com o Demucs garante que CTC e
// separação de stems NUNCA rodem ao mesmo tempo (1 CPU / 2 GB de RAM).
const enqueueSerial = (task) => runExclusiveHeavyTaskTracked(task);

export const getAlignerQueueInfo = () => {
  const queue = getHeavyTaskQueueInfo();
  return {
    pending: queue.pending,
    resource: 'shared-heavy-task-lock',
  };
};

/* ────────────────────────────────────────────────────────────────────────────
   Disponibilidade do alinhador
──────────────────────────────────────────────────────────────────────────── */

const isLikelyMissingAlignerError = (error) => {
  const details = `${error?.stderr || ''} ${error?.stdout || ''} ${error?.message || ''}`.toLowerCase();

  return (
    error?.code === 'ENOENT'
    || details.includes('no module named ctc_forced_aligner')
    || details.includes('no module named ctc-forced-aligner')
    || details.includes('no module named onnxruntime')
    || details.includes('no module named librosa')
    || details.includes('command not found')
    || details.includes('not recognized as an internal or external command')
  );
};

export const ensureAlignerAvailable = async () => {
  if (MODE === 'proportional') {
    // Modo econômico: não usa modelo de IA, apenas o script Python puro.
    return { mode: 'proportional', python: PYTHON_BIN };
  }

  if (!availabilityPromise) {
    availabilityPromise = (async () => {
      try {
        await fs.promises.access(ALIGNER_SCRIPT, fs.constants.R_OK);
      } catch {
        const scriptError = new Error(`Script do alinhador não encontrado em ${ALIGNER_SCRIPT}.`);
        scriptError.code = 'ALIGN_UNAVAILABLE';
        throw scriptError;
      }

      try {
        const { stdout } = await runCommand(
          PYTHON_BIN,
          [ALIGNER_SCRIPT, '--check', '--out', '-'],
          { timeoutMs: PROBE_TIMEOUT_MS, env: buildAlignerEnv(process.env) },
        );

        const report = extractJsonFromStdout(stdout);

        if (!report?.ok) {
          const detail = report?.error || 'verificação retornou estado inválido';
          const probeError = new Error(`Alinhador indisponível: ${detail}`);
          probeError.code = 'ALIGN_UNAVAILABLE';
          probeError.detail = detail;
          throw probeError;
        }

        return { mode: 'align', python: PYTHON_BIN, packages: report.packages || {} };
      } catch (error) {
        if (error?.code === 'ALIGN_UNAVAILABLE') throw error;

        const wrapped = new Error(
          isLikelyMissingAlignerError(error) ? AVAILABILITY_ERROR_MESSAGE : `Falha ao verificar o alinhador: ${error.message}`,
        );
        wrapped.code = 'ALIGN_UNAVAILABLE';
        wrapped.stderr = error?.stderr;
        wrapped.stdout = error?.stdout;
        throw wrapped;
      }
    })().catch((error) => {
      availabilityPromise = null;

      if (MODE === 'auto') {
        console.warn(
          '[lyricsAlignService] Alinhador real indisponível; usando sincronização proporcional econômica:',
          error.message,
        );
        return {
          mode: 'proportional',
          python: PYTHON_BIN,
          fallback: true,
          reason: error.message,
        };
      }

      throw error;
    });
  }

  return availabilityPromise;
};

/* ────────────────────────────────────────────────────────────────────────────
   Áudio → WAV 16 kHz mono
──────────────────────────────────────────────────────────────────────────── */

const transcodeToAlignmentWav = (inputPath, outputPath) => new Promise((resolve, reject) => {
  ffmpeg(inputPath)
    .noVideo()
    .audioChannels(1)
    .audioFrequency(16000)
    .audioCodec('pcm_s16le')
    .format('wav')
    .on('end', () => resolve(outputPath))
    .on('error', (error) => {
      const transcodeError = new Error(`Não foi possível preparar o áudio para a sincronização: ${error.message}`);
      transcodeError.code = 'ALIGN_AUDIO_PREPARE_FAILED';
      reject(transcodeError);
    })
    .save(outputPath);
});

const getAudioDurationInSeconds = (filePath) => new Promise((resolve) => {
  ffmpeg.ffprobe(filePath, (error, metadata) => {
    if (error) {
      resolve(null);
      return;
    }

    const duration = Number(
      metadata?.streams?.find((stream) => stream.codec_type === 'audio')?.duration
      || metadata?.format?.duration
      || 0,
    );

    resolve(roundSeconds(duration));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   API pública
──────────────────────────────────────────────────────────────────────────── */

/**
 * Alinha a letra (blocos já separados) contra a música e devolve o tempo de
 * cada bloco: início = 1ª palavra, fim = última palavra.
 *
 * @param {Object}   params
 * @param {string}   params.audioUrl   URL do áudio (música original)
 * @param {string[]} params.stanzas    Blocos de letra, na ordem, sem alteração
 * @returns {Promise<Object>}
 */
export const syncLyricsWithAudio = async ({ audioUrl, stanzas = [] }) => {
  const availability = await ensureAlignerAvailable();

  const blocks = (Array.isArray(stanzas) ? stanzas : [])
    .map((stanza) => (typeof stanza === 'string' ? stanza : String(stanza?.text ?? '')));

  if (!blocks.length || !blocks.some((block) => block.trim())) {
    const emptyError = new Error('Nenhum bloco de letra para sincronizar.');
    emptyError.code = 'ALIGN_NO_LYRICS';
    emptyError.status = 400;
    throw emptyError;
  }

  return enqueueSerial(async () => {
    await ensureDir(TMP_ROOT);

    const jobRoot = await fs.promises.mkdtemp(path.join(TMP_ROOT, 'job-'));
    const wavPath = path.join(jobRoot, 'audio.wav');
    const blocksPath = path.join(jobRoot, 'blocks.json');
    const outPath = path.join(jobRoot, 'alignment.json');
    const fallbackName = (() => {
      try {
        return path.basename(new URL(audioUrl).pathname) || 'musica-original.mp3';
      } catch {
        return 'musica-original.mp3';
      }
    })();

    let sourcePath = null;

    try {
      console.log('[lyricsAlignService] Baixando a música original para o alinhamento…');

      sourcePath = await downloadSourceValueToTempFile(audioUrl, {
        prefix: 'align-source',
        fallbackName,
        mimeType: 'audio/mpeg',
        folder: 'align-source',
      });

      const duration = await getAudioDurationInSeconds(sourcePath);

      if (!duration) {
        const durationError = new Error('Não foi possível descobrir a duração do áudio.');
        durationError.code = 'ALIGN_AUDIO_PREPARE_FAILED';
        throw durationError;
      }

      // In auto/proportional mode there is no reason to decode the complete
      // track to WAV or start Python. This keeps the low-memory path usable
      // even when the optional ONNX model is not installed.
      if (availability.mode === 'proportional') {
        return {
          engine: 'proportional-fallback',
          mode: 'proportional',
          language: LANGUAGE,
          durationSec: duration,
          wordCount: blocks.reduce((sum, block) => sum + countWords(block), 0),
          elapsedSec: null,
          blocks: buildProportionalBlocks(blocks, duration),
          words: [],
        };
      }

      console.log('[lyricsAlignService] Convertendo para WAV 16 kHz mono (economia de memória)…');
      await transcodeToAlignmentWav(sourcePath, wavPath);

      await fs.promises.writeFile(
        blocksPath,
        JSON.stringify({ stanzas: blocks, language: LANGUAGE, durationSec: duration ?? 0 }),
        'utf8',
      );

      const args = [
        ALIGNER_SCRIPT,
        '--audio', wavPath,
        '--blocks-json', blocksPath,
        '--out', outPath,
        '--language', LANGUAGE,
        '--mode', availability.mode === 'proportional' ? 'proportional' : 'align',
        '--batch-size', BATCH_SIZE,
        '--window', WINDOW_SECONDS,
        '--context', CONTEXT_SECONDS,
      ];

      if (duration) args.push('--duration', String(duration));
      if (MODEL_DIR) args.push('--model-dir', MODEL_DIR);
      if (MODEL_URL) args.push('--model-url', MODEL_URL);

      console.log(`[lyricsAlignService] Executando o alinhador (1 CPU, fila serial, modo=${availability.mode})…`);

      try {
        await runCommand(PYTHON_BIN, args, {
          cwd: jobRoot,
          timeoutMs: TIMEOUT_MS,
          env: buildAlignerEnv(process.env),
        });
      } catch (error) {
        // `auto` is intentionally resilient on a 1 CPU / 2 GB instance:
        // if the real model is killed or times out, still return usable
        // timings instead of failing the whole editor operation.
        if (MODE === 'auto' && ['ALIGN_PROCESS_FAILED', 'ALIGN_TIMEOUT'].includes(error?.code)) {
          console.warn(
            '[lyricsAlignService] Alinhamento real falhou; usando distribuição proporcional:',
            error.message,
          );
          return {
            engine: 'proportional-fallback',
            mode: 'proportional',
            language: LANGUAGE,
            durationSec: duration,
            wordCount: blocks.reduce((sum, block) => sum + countWords(block), 0),
            elapsedSec: null,
            blocks: buildProportionalBlocks(blocks, duration),
            words: [],
          };
        }

        throw error;
      }

      const raw = await fs.promises.readFile(outPath, 'utf8');
      const parsed = JSON.parse(raw);

      if (!parsed?.ok || !Array.isArray(parsed.blocks)) {
        const parseError = new Error('O alinhador não devolveu tempos válidos.');
        parseError.code = 'ALIGN_INVALID_OUTPUT';
        throw parseError;
      }

      return {
        engine: parsed.engine || 'ctc-forced-aligner-1.0.2',
        mode: parsed.mode || availability.mode,
        language: parsed.language || LANGUAGE,
        durationSec: parsed.durationSec ?? duration ?? null,
        wordCount: parsed.wordCount ?? null,
        elapsedSec: parsed.elapsedSec ?? null,
        blocks: parsed.blocks,
      };
    } finally {
      await removeLocalFileSilently(sourcePath);
      await removeDirectorySilently(jobRoot);
    }
  });
};

/** Pré-baixa/valida o modelo (útil após instalar as dependências). */
export const warmupAligner = async () => {
  const availability = await ensureAlignerAvailable();

  if (availability.mode !== 'align') {
    return { ok: true, mode: availability.mode, downloaded: false };
  }

  const args = [ALIGNER_SCRIPT, '--warmup', '--out', '-'];
  if (MODEL_DIR) args.push('--model-dir', MODEL_DIR);
  if (MODEL_URL) args.push('--model-url', MODEL_URL);

  const { stdout } = await runCommand(PYTHON_BIN, args, {
    timeoutMs: Math.max(TIMEOUT_MS, 30 * 60 * 1000),
    env: buildAlignerEnv(process.env),
  });

  return extractJsonFromStdout(stdout) || { ok: true, mode: availability.mode };
};

export const ALIGNER_UNAVAILABLE_MESSAGE = AVAILABILITY_ERROR_MESSAGE;
