import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  downloadSourceValueToTempFile,
  removeLocalFileSilently,
} from './storageService.js';

const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ALIGNER_SCRIPT_PATH = path.resolve(SERVICE_DIR, '../../scripts/align_lyrics.py');
const ALIGNER_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.ALIGNER_TIMEOUT_MS || '1200000', 10)
);

let activeAlignment = Promise.resolve();

const enqueueAlignment = (task) => {
  const next = activeAlignment.then(task, task);
  activeAlignment = next.catch(() => undefined);
  return next;
};

const parseJsonOutput = (stdout) => {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // The Python dependency may print a harmless informational line.
    }
  }

  return null;
};

const runAlignerProcess = ({ audioPath, stanzasPath, outputPath, language }) => (
  new Promise((resolve, reject) => {
    const pythonBin = process.env.ALIGNER_PYTHON_BIN || 'python3.12';
    const child = spawn(pythonBin, [
      ALIGNER_SCRIPT_PATH,
      '--audio',
      audioPath,
      '--stanzas-json',
      stanzasPath,
      '--output',
      outputPath,
      '--language',
      language,
    ], {
      cwd: path.resolve(SERVICE_DIR, '../..'),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(reject, Object.assign(
        new Error('O processamento da sincronização excedeu o tempo limite.'),
        { code: 'ALIGNMENT_TIMEOUT', status: 504 }
      ));
    }, ALIGNER_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      const wrapped = Object.assign(
        new Error(
          error.code === 'ENOENT'
            ? 'Python 3.12 não está disponível no servidor para executar o aligner.'
            : error.message
        ),
        {
          code: error.code === 'ENOENT' ? 'ALIGNER_UNAVAILABLE' : 'ALIGNMENT_PROCESS_ERROR',
          status: error.code === 'ENOENT' ? 503 : 500,
        }
      );
      finish(reject, wrapped);
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      if (settled) return;

      const parsed = parseJsonOutput(stdout);
      if (exitCode === 0 && parsed?.success) {
        finish(resolve, parsed);
        return;
      }

      const error = Object.assign(
        new Error(
          parsed?.error
            || stderr.trim().split(/\r?\n/).filter(Boolean).pop()
            || 'O aligner não conseguiu analisar a música e a letra.'
        ),
        {
          code: parsed?.code || 'ALIGNMENT_FAILED',
          status: 422,
          details: stderr.trim().slice(-4000),
        }
      );
      finish(reject, error);
    });
  })
);

export const alignLyricsWithCtc = ({
  audioSource,
  stanzas,
  language = 'por',
}) => enqueueAlignment(async () => {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lenavs-align-'));
  let audioPath = null;

  try {
    audioPath = await downloadSourceValueToTempFile(audioSource, {
      prefix: 'original',
      fallbackName: 'original-audio.mp3',
      folder: 'aligner',
    });

    const stanzasPath = path.join(workDir, 'stanzas.json');
    const outputPath = path.join(workDir, 'result.json');
    await fs.promises.writeFile(stanzasPath, JSON.stringify(stanzas), 'utf8');

    return await runAlignerProcess({
      audioPath,
      stanzasPath,
      outputPath,
      language,
    });
  } finally {
    await removeLocalFileSilently(audioPath);
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
});