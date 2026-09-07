import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const WHISPERX_PYTHON_BIN = process.env.WHISPERX_PYTHON_BIN || 'python3';
export const WHISPERX_MODEL = process.env.WHISPERX_MODEL || 'small';
export const WHISPERX_DEVICE = process.env.WHISPERX_DEVICE || 'cpu';
export const WHISPERX_COMPUTE_TYPE = process.env.WHISPERX_COMPUTE_TYPE || 'int8';
export const WHISPERX_LANGUAGE = String(process.env.WHISPERX_LANGUAGE || '').trim();
export const WHISPERX_TIMEOUT_MS = Number(process.env.WHISPERX_TIMEOUT_MS || 20 * 60 * 1000);
export const WHISPERX_SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'whisperx_align.py');

let whisperxAvailabilityPromise = null;

const isLikelyMissingWhisperXError = (error) => {
  const stderr = String(error?.stderr || '').toLowerCase();
  const stdout = String(error?.stdout || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  return (
    error?.code === 'ENOENT'
    || stderr.includes('no module named whisperx')
    || stderr.includes("can't open file")
    || stderr.includes('command not found')
    || stdout.includes('command not found')
    || message.includes('enoent')
    || message.includes('command not found')
  );
};

const buildWhisperXEnv = (baseEnv = process.env) => {
  const env = { ...baseEnv };

  if (String(WHISPERX_DEVICE).toLowerCase() === 'cpu') {
    env.OMP_NUM_THREADS = env.OMP_NUM_THREADS || '1';
    env.MKL_NUM_THREADS = env.MKL_NUM_THREADS || '1';
    env.NUMEXPR_NUM_THREADS = env.NUMEXPR_NUM_THREADS || '1';
    env.OPENBLAS_NUM_THREADS = env.OPENBLAS_NUM_THREADS || '1';
  }

  return env;
};

const runPython = (args, { timeoutMs = WHISPERX_TIMEOUT_MS, env = process.env } = {}) => new Promise((resolve, reject) => {
  const child = spawn(WHISPERX_PYTHON_BIN, args, {
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
      const timeoutError = new Error(`WhisperX excedeu o tempo limite de ${Math.round(timeoutMs / 1000)} segundos.`);
      timeoutError.code = 'WHISPERX_TIMEOUT';
      timeoutError.stdout = stdout;
      timeoutError.stderr = stderr;
      reject(timeoutError);
      return;
    }

    if (code !== 0) {
      const commandError = new Error(`WhisperX finalizou com código ${code}.`);
      commandError.code = 'WHISPERX_PROCESS_FAILED';
      commandError.exitCode = code;
      commandError.stdout = stdout;
      commandError.stderr = stderr;
      reject(commandError);
      return;
    }

    resolve({ stdout, stderr });
  });
});

export const ensureWhisperXAvailable = async () => {
  if (!whisperxAvailabilityPromise) {
    whisperxAvailabilityPromise = (async () => {
      const probe = spawn(
        WHISPERX_PYTHON_BIN,
        ['-c', 'import whisperx, torch; print("ok")'],
        {
          env: buildWhisperXEnv(process.env),
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      return await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        probe.stdout.on('data', (chunk) => {
          stdout += String(chunk);
        });

        probe.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });

        probe.on('error', reject);

        probe.on('close', (code) => {
          if (code === 0 && /ok/.test(stdout)) {
            resolve(true);
            return;
          }

          const unavailableError = new Error(
            'O pacote whisperx não foi encontrado no Python configurado (WHISPERX_PYTHON_BIN). Instale o requirements-whisperx.txt no servidor.'
          );
          unavailableError.code = 'WHISPERX_UNAVAILABLE';
          unavailableError.stderr = stderr;
          reject(unavailableError);
        });
      });
    })().catch((error) => {
      whisperxAvailabilityPromise = null;

      if (isLikelyMissingWhisperXError(error)) {
        const unavailableError = new Error(
          'O pacote whisperx não está disponível no servidor. Verifique se o requirements-whisperx.txt foi instalado.'
        );
        unavailableError.code = 'WHISPERX_UNAVAILABLE';
        throw unavailableError;
      }

      throw error;
    });
  }

  return whisperxAvailabilityPromise;
};

/**
 * Roda o script scripts/whisperx_align.py e retorna o JSON com as palavras
 * alinhadas ({ language, words: [{word, start, end}], segments }).
 */
export const alignLyricsWithWhisperX = async ({
  audioPath,
  transcriptPath,
  language = WHISPERX_LANGUAGE,
} = {}) => {
  if (!audioPath) {
    throw new Error('Caminho do áudio ausente para o WhisperX.');
  }

  if (!transcriptPath) {
    throw new Error('Caminho da letra ausente para o WhisperX.');
  }

  await ensureWhisperXAvailable();
  await fs.promises.access(audioPath);

  const args = [
    WHISPERX_SCRIPT_PATH,
    '--audio', audioPath,
    '--transcript', transcriptPath,
    '--model', WHISPERX_MODEL,
    '--device', WHISPERX_DEVICE,
    '--compute_type', WHISPERX_COMPUTE_TYPE,
  ];

  if (String(language || '').trim()) {
    args.push('--language', String(language).trim());
  }

  const execution = await runPython(args, {
    timeoutMs: WHISPERX_TIMEOUT_MS,
    env: buildWhisperXEnv(process.env),
  });

  const jsonLine = execution.stdout.split('\n').filter(Boolean).pop() || '';

  try {
    const parsed = JSON.parse(jsonLine);

    if (!parsed || !Array.isArray(parsed.words)) {
      throw new Error('Formato de saída do WhisperX inválido.');
    }

    return { ...parsed, rawLogs: execution };
  } catch (error) {
    const wrapped = new Error(`Não foi possível interpretar a saída do WhisperX: ${error.message}`);
    wrapped.code = 'WHISPERX_OUTPUT_INVALID';
    wrapped.stdout = execution.stdout;
    wrapped.stderr = execution.stderr;
    throw wrapped;
  }
};

export default alignLyricsWithWhisperX;
