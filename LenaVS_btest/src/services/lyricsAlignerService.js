/**
 * lyricsAlignerService.js
 *
 * Integração com o Lyrics Aligner (ctc-forced-aligner==1.0.2), executado em
 * um ambiente Python 3.12 OBRIGATÓRIO via scripts/align_lyrics.py.
 *
 * O aligner apenas DESCOBRE os tempos de cada palavra cantada no áudio
 * ({ word, start, end }); a estrutura de blocos da letra é sempre preservada
 * pela LenaVS.
 *
 * Variáveis de ambiente:
 *  - ALIGNER_PYTHON_BIN  binário Python 3.12 a usar (padrão: "python3.12").
 *                        Recomendado apontar para o python de um venv criado
 *                        com `python3.12 -m venv .venv-aligner` e com o
 *                        requirements-aligner.txt instalado.
 *  - ALIGNER_LANGUAGE    ISO-639-3 (padrão: "por" — português).
 *  - ALIGNER_BATCH_SIZE  batch da inferência ONNX (padrão: 4).
 *  - ALIGNER_MODEL_PATH  caminho opcional do modelo ONNX.
 *  - ALIGNER_TIMEOUT_MS  timeout do processo (padrão: 20 min).
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ALIGNER_PYTHON_BIN = process.env.ALIGNER_PYTHON_BIN || 'python3.12';
export const ALIGNER_LANGUAGE = String(process.env.ALIGNER_LANGUAGE || 'por').trim() || 'por';
export const ALIGNER_BATCH_SIZE = Number(process.env.ALIGNER_BATCH_SIZE || 4);
export const ALIGNER_MODEL_PATH = String(process.env.ALIGNER_MODEL_PATH || '').trim();
export const ALIGNER_TIMEOUT_MS = Number(process.env.ALIGNER_TIMEOUT_MS || 20 * 60 * 1000);
export const ALIGNER_SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'align_lyrics.py');

let alignerAvailabilityPromise = null;

const buildAlignerEnv = (baseEnv = process.env) => {
  const env = { ...baseEnv };

  // Inferência em CPU: evita que bibliotecas numéricas saturem os núcleos.
  env.OMP_NUM_THREADS = env.OMP_NUM_THREADS || '1';
  env.MKL_NUM_THREADS = env.MKL_NUM_THREADS || '1';
  env.NUMEXPR_NUM_THREADS = env.NUMEXPR_NUM_THREADS || '1';
  env.OPENBLAS_NUM_THREADS = env.OPENBLAS_NUM_THREADS || '1';

  return env;
};

const runPython = (args, { timeoutMs = ALIGNER_TIMEOUT_MS, env = process.env } = {}) => new Promise((resolve, reject) => {
  const child = spawn(ALIGNER_PYTHON_BIN, args, {
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
      const timeoutError = new Error(`O Lyrics Aligner excedeu o tempo limite de ${Math.round(timeoutMs / 1000)} segundos.`);
      timeoutError.code = 'ALIGNER_TIMEOUT';
      timeoutError.stdout = stdout;
      timeoutError.stderr = stderr;
      reject(timeoutError);
      return;
    }

    if (code !== 0) {
      const commandError = new Error(`O Lyrics Aligner finalizou com código ${code}.`);
      commandError.code = 'ALIGNER_PROCESS_FAILED';
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
 * Verifica (uma única vez por processo) se o ambiente Python 3.12 com o
 * ctc-forced-aligner 1.0.2 está disponível no binário configurado.
 */
export const ensureAlignerAvailable = async () => {
  if (!alignerAvailabilityPromise) {
    alignerAvailabilityPromise = (async () => {
      const probe = spawn(
        ALIGNER_PYTHON_BIN,
        ['-c', 'import sys; assert sys.version_info[:2] == (3, 12); import ctc_forced_aligner; print("ok")'],
        {
          env: buildAlignerEnv(process.env),
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
            'O Lyrics Aligner não está disponível no ambiente Python configurado (ALIGNER_PYTHON_BIN). Crie um venv com Python 3.12 e instale o requirements-aligner.txt nele.'
          );
          unavailableError.code = 'ALIGNER_UNAVAILABLE';
          unavailableError.stderr = stderr;
          reject(unavailableError);
        });
      });
    })().catch((error) => {
      alignerAvailabilityPromise = null;

      if (
        error?.code === 'ENOENT'
        || String(error?.message || '').toLowerCase().includes('enoent')
        || String(error?.stderr || '').toLowerCase().includes('no module named ctc_forced_aligner')
        || String(error?.stderr || '').toLowerCase().includes('assertionerror')
        || String(error?.stderr || '').toLowerCase().includes('assert')
      ) {
        const unavailableError = new Error(
          'O Lyrics Aligner (ctc-forced-aligner 1.0.2 em Python 3.12) não está instalado no servidor. Crie um venv com Python 3.12 e instale o requirements-aligner.txt nele.'
        );
        unavailableError.code = 'ALIGNER_UNAVAILABLE';
        throw unavailableError;
      }

      throw error;
    });
  }

  return alignerAvailabilityPromise;
};

/**
 * Roda o script scripts/align_lyrics.py e retorna o JSON com as palavras
 * alinhadas ({ language, words: [{ word, start, end, score }] }).
 */
export const alignLyrics = async ({
  audioPath,
  transcriptPath,
  language = ALIGNER_LANGUAGE,
} = {}) => {
  if (!audioPath) {
    throw new Error('Caminho do áudio ausente para o Lyrics Aligner.');
  }

  if (!transcriptPath) {
    throw new Error('Caminho da letra ausente para o Lyrics Aligner.');
  }

  await ensureAlignerAvailable();
  await fs.promises.access(audioPath);
  await fs.promises.access(transcriptPath);

  const args = [
    ALIGNER_SCRIPT_PATH,
    '--audio', audioPath,
    '--transcript', transcriptPath,
    '--language', String(language || ALIGNER_LANGUAGE).trim() || 'por',
    '--batch-size', String(Number.isFinite(ALIGNER_BATCH_SIZE) && ALIGNER_BATCH_SIZE > 0 ? ALIGNER_BATCH_SIZE : 4),
  ];

  if (ALIGNER_MODEL_PATH) {
    args.push('--model-path', ALIGNER_MODEL_PATH);
  }

  const execution = await runPython(args, {
    timeoutMs: ALIGNER_TIMEOUT_MS,
    env: buildAlignerEnv(process.env),
  });

  const jsonLine = execution.stdout.split('\n').filter(Boolean).pop() || '';

  try {
    const parsed = JSON.parse(jsonLine);

    if (!parsed || !Array.isArray(parsed.words)) {
      throw new Error('Formato de saída do Lyrics Aligner inválido.');
    }

    return { ...parsed, rawLogs: execution };
  } catch (error) {
    const wrapped = new Error(`Não foi possível interpretar a saída do Lyrics Aligner: ${error.message}`);
    wrapped.code = 'ALIGNER_OUTPUT_INVALID';
    wrapped.stdout = execution.stdout;
    wrapped.stderr = execution.stderr;
    throw wrapped;
  }
};

export default alignLyrics;
