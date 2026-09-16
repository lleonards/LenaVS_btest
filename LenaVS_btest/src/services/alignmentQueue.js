/**
 * alignmentQueue.js — Execução econômica do ctc-forced-aligner
 * ─────────────────────────────────────────────────────────────────────────────
 * O servidor tem 1 CPU e 2 GB de RAM. Para nunca travar ou ser encerrado por
 * falta de memória:
 *
 *   • SOMENTE UMA sincronização roda por vez (fila FIFO, concorrência 1);
 *   • o alinhador roda em processo filho (a RAM volta para o SO ao terminar);
 *   • 1 thread de CPU (OMP/MKL/torch) e batch/window pequenos;
 *   • verificação de memória livre antes de começar;
 *   • timeout com kill garantido do processo filho.
 *
 * Espelha o padrão já usado em services/videoTaskQueue.js.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(currentDir, '..', '..');

const clampInteger = (value, fallback, min, max) => {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

export const ALIGNMENT_TIMEOUT_MS = clampInteger(
  process.env.ALIGNMENT_TIMEOUT_MS,
  25 * 60 * 1000,
  60 * 1000,
  60 * 60 * 1000
);
export const ALIGNMENT_MAX_QUEUE = clampInteger(process.env.ALIGNMENT_MAX_QUEUE, 2, 1, 10);
export const ALIGNMENT_MIN_FREE_MEMORY_MB = clampInteger(
  process.env.ALIGNMENT_MIN_FREE_MEMORY_MB,
  1000,
  300,
  8000
);
export const ALIGNMENT_MAX_AUDIO_SECONDS = clampInteger(
  process.env.ALIGNMENT_MAX_AUDIO_SECONDS,
  15 * 60,
  30,
  60 * 60
);

const ALIGNMENT_SCRIPT_PATH = process.env.ALIGNER_SCRIPT
  ? path.resolve(process.env.ALIGNER_SCRIPT)
  : path.join(BACKEND_ROOT, 'scripts', 'forced_align_words.py');

/**
 * Interpretador do alinhador: usa o venv dedicado do Docker quando existir,
 * para não misturar as dependências do alinhador com o runtime do Node.
 */
export const resolveAlignerPythonBin = () => {
  const configured = String(process.env.ALIGNER_PYTHON_BIN || '').trim();
  if (configured) return configured;

  const venvCandidate = '/opt/aligner/bin/python3';
  if (fs.existsSync(venvCandidate)) return venvCandidate;

  return 'python3';
};

const alignmentState = {
  running: false,
  queue: [],
  lastError: null,
  completedJobs: 0,
};

const freeMemoryMb = () => Math.round(os.freemem() / (1024 * 1024));

export const getAlignmentStatus = () => ({
  running: alignmentState.running,
  queueLength: alignmentState.queue.length,
  freeMemoryMb: freeMemoryMb(),
  minFreeMemoryMb: ALIGNMENT_MIN_FREE_MEMORY_MB,
  completedJobs: alignmentState.completedJobs,
  lastError: alignmentState.lastError,
  pythonBin: resolveAlignerPythonBin(),
  scriptPath: ALIGNMENT_SCRIPT_PATH,
  timeoutMs: ALIGNMENT_TIMEOUT_MS,
});

const createBusyError = () => {
  const error = new Error(
    'Já existe uma sincronização automática em andamento. Aguarde ela terminar e tente novamente.'
  );
  error.status = 429;
  error.code = 'ALIGNMENT_BUSY';
  return error;
};

const createQueueFullError = () => {
  const error = new Error(
    'Há várias sincronizações na fila. Tente novamente em alguns instantes.'
  );
  error.status = 503;
  error.code = 'ALIGNMENT_QUEUE_FULL';
  return error;
};

export const assertEnoughMemory = () => {
  const free = freeMemoryMb();

  if (free < ALIGNMENT_MIN_FREE_MEMORY_MB) {
    const error = new Error(
      'O servidor está com pouca memória livre no momento. Tente a sincronização novamente em alguns minutos.'
    );
    error.status = 503;
    error.code = 'ALIGNMENT_LOW_MEMORY';
    error.freeMemoryMb = free;
    throw error;
  }

  return free;
};

/** Executa `task` com concorrência 1 (uma sincronização por vez). */
export const runExclusiveAlignment = async (task) => {
  if (alignmentState.running) {
    if (alignmentState.queue.length >= ALIGNMENT_MAX_QUEUE) {
      throw createQueueFullError();
    }

    return new Promise((resolve, reject) => {
      alignmentState.queue.push({ task, resolve, reject });
    });
  }

  alignmentState.running = true;

  try {
    return await task();
  } finally {
    alignmentState.completedJobs += 1;
    alignmentState.running = false;

    const next = alignmentState.queue.shift();

    if (next) {
      runExclusiveAlignment(next.task).then(next.resolve).catch(next.reject);
    }
  }
};

/** Marca uma falha para diagnóstico (usado no /health da sincronização). */
export const recordAlignmentError = (error) => {
  alignmentState.lastError = {
    code: error?.code || 'ALIGNMENT_ERROR',
    message: String(error?.message || '').slice(0, 300),
    at: new Date().toISOString(),
  };
};

/**
 * Roda o script Python de alinhamento e devolve as palavras com tempos.
 */
export const runForcedAlignment = ({ audioPath, textPath, outputPath, language = 'por' }) => (
  new Promise((resolve, reject) => {
    if (!fs.existsSync(ALIGNMENT_SCRIPT_PATH)) {
      const error = new Error('O script de sincronização não foi encontrado no servidor.');
      error.code = 'ALIGNER_SCRIPT_MISSING';
      reject(error);
      return;
    }

    const pythonBin = resolveAlignerPythonBin();
    const args = [
      ALIGNMENT_SCRIPT_PATH,
      '--audio', audioPath,
      '--text-file', textPath,
      '--output', outputPath,
      '--language', language,
      '--threads', String(clampInteger(process.env.ALIGNMENT_THREADS, 1, 1, 4)),
      '--batch-size', String(clampInteger(process.env.ALIGNMENT_BATCH_SIZE, 2, 1, 16)),
      '--window-size', String(Number(process.env.ALIGNMENT_WINDOW_SIZE || 30)),
      '--context-size', String(Number(process.env.ALIGNMENT_CONTEXT_SIZE || 2)),
    ];

    if (String(process.env.ALIGNMENT_ROMANIZE || 'true').toLowerCase() === 'false') {
      args.push('--no-romanize');
    }

    const child = spawn(pythonBin, args, {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        OMP_NUM_THREADS: '1',
        MKL_NUM_THREADS: '1',
        OPENBLAS_NUM_THREADS: '1',
        NUMEXPR_NUM_THREADS: '1',
        TOKENIZERS_PARALLELISM: 'false',
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;

      try {
        child.kill('SIGKILL');
      } catch {
        // processo já encerrado
      }

      const error = new Error(
        'A sincronização demorou mais do que o limite do servidor. Tente novamente com um áudio menor.'
      );
      error.code = 'ALIGNMENT_TIMEOUT';
      reject(error);
    }, ALIGNMENT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 400000) stdout = stdout.slice(-200000);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);

      const wrapped = new Error(
        error?.code === 'ENOENT'
          ? 'O interpretador Python do alinhador não está disponível no servidor.'
          : 'Não foi possível iniciar o processo de sincronização.'
      );
      wrapped.code = 'ALIGNMENT_SPAWN_FAILED';
      wrapped.cause = error;
      reject(wrapped);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);

      const readJson = (filePath) => {
        try {
          return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {
          return null;
        }
      };

      const payloadFromFile = readJson(outputPath);
      const payloadFromStdout = (() => {
        const line = stdout.trim().split('\n').filter(Boolean).pop();
        if (!line || !line.startsWith('{')) return null;
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })();

      const payload = payloadFromFile || payloadFromStdout;

      if (payload?.success && Array.isArray(payload.words) && payload.words.length) {
        resolve({ ...payload, stderr: stderr.slice(-4000) });
        return;
      }

      if (payload?.error) {
        const error = new Error(String(payload.error));
        error.code = payload.code || 'ALIGNMENT_FAILED';
        error.stderr = stderr.slice(-4000);
        reject(error);
        return;
      }

      const error = new Error(
        code === 0
          ? 'O alinhador terminou sem devolver tempos de palavras.'
          : 'O alinhador falhou ao processar o áudio e a letra.'
      );
      error.code = code === 0 ? 'ALIGNMENT_EMPTY_RESULT' : 'ALIGNMENT_PROCESS_FAILED';
      error.exitCode = code;
      error.stderr = stderr.slice(-4000);
      reject(error);
    });
  })
);

export const buildAlignmentOutputPath = () => (
  path.join(os.tmpdir(), 'lenavs', 'alignment', `align-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
);

export const ensureAlignmentOutputDir = async (outputPath) => {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  return outputPath;
};