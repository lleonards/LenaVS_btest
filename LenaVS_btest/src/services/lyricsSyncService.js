import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  downloadSourceValueToTempFile,
  removeLocalFileSilently,
} from './storageService.js';

const WHISPERX_PYTHON_BIN = process.env.WHISPERX_PYTHON_BIN || 'python3';
const WHISPERX_SCRIPT = process.env.WHISPERX_SCRIPT
  || path.join(process.cwd(), 'scripts', 'lyrics_align.py');
const WHISPERX_TIMEOUT_MS = Number(
  process.env.WHISPERX_TIMEOUT_MS || 25 * 60 * 1000
);
const WHISPERX_THREADS = String(process.env.WHISPERX_THREADS || '1');

const runWhisperXProcess = ({ audioPath, stanzasPath, language }) => new Promise((resolve, reject) => {
  const args = [WHISPERX_SCRIPT, '--audio', audioPath, '--stanzas', stanzasPath];
  if (language) args.push('--language', language);

  const env = {
    ...process.env,
    OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || WHISPERX_THREADS,
    MKL_NUM_THREADS: process.env.MKL_NUM_THREADS || WHISPERX_THREADS,
    NUMEXPR_NUM_THREADS: process.env.NUMEXPR_NUM_THREADS || WHISPERX_THREADS,
    OPENBLAS_NUM_THREADS: process.env.OPENBLAS_NUM_THREADS || WHISPERX_THREADS,
  };

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
      if (!child.killed) child.kill('SIGKILL');
    }, 5000).unref();
  }, WHISPERX_TIMEOUT_MS);

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
      const timeoutError = new Error('A sincronização excedeu o tempo limite.');
      timeoutError.code = 'WHISPERX_TIMEOUT';
      timeoutError.stdout = stdout;
      timeoutError.stderr = stderr;
      reject(timeoutError);
      return;
    }

    if (code !== 0) {
      const processError = new Error('O alinhamento WhisperX finalizou com erro.');
      processError.code = 'WHISPERX_PROCESS_FAILED';
      processError.exitCode = code;
      processError.stdout = stdout;
      processError.stderr = stderr;
      reject(processError);
      return;
    }

    try {
      resolve(JSON.parse(stdout));
    } catch (parseError) {
      const invalidError = new Error('O alinhamento retornou uma resposta inválida.');
      invalidError.code = 'WHISPERX_INVALID_OUTPUT';
      invalidError.stdout = stdout;
      invalidError.stderr = stderr;
      reject(invalidError);
    }
  });
});

const isLikelyMissingWhisperXError = (error) => {
  const stderr = String(error?.stderr || '').toLowerCase();
  const stdout = String(error?.stdout || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  return (
    error?.code === 'ENOENT'
    || stderr.includes('no module named whisperx')
    || stderr.includes('command not found')
    || stdout.includes('command not found')
    || message.includes('enoent')
    || message.includes('command not found')
  );
};

/**
 * Roda o alinhamento WhisperX em segundo plano.
 *
 * O script NÃO cria, exclui, divide, junta ou reorganiza blocos: ele apenas
 * descobre o start/end de cada bloco existente a partir das palavras do usuário.
 * Retorna { blocks, words, language } — blocks na MESMA ordem da entrada.
 */
export const runLyricsAlignment = async ({ audioUrl, stanzas }) => {
  let audioPath = null;
  let stanzasPath = null;
  let jobRoot = null;

  try {
    jobRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lenavs-sync-'));

    const fallbackName = (() => {
      try {
        return path.basename(new URL(audioUrl).pathname) || 'musica-original.mp3';
      } catch {
        return 'musica-original.mp3';
      }
    })();

    audioPath = await downloadSourceValueToTempFile(audioUrl, {
      prefix: 'sync-source',
      fallbackName,
      mimeType: 'audio/mpeg',
      folder: 'sync-source',
    });

    stanzasPath = path.join(jobRoot, 'stanzas.json');
    await fs.promises.writeFile(stanzasPath, JSON.stringify(stanzas), 'utf8');

    const language = String(process.env.WHISPERX_LANGUAGE || '').trim() || undefined;

    const output = await runWhisperXProcess({ audioPath, stanzasPath, language });

    const rawBlocks = Array.isArray(output?.blocks) ? output.blocks : [];

    const blocks = rawBlocks.map((block) => ({
      id: block.id,
      text: String(block.text ?? ''),
      start: block.start == null ? null : Number(block.start),
      end: block.end == null ? null : Number(block.end),
    }));

    return {
      blocks,
      words: Array.isArray(output?.words) ? output.words : [],
      language: output?.language || language || null,
    };
  } catch (error) {
    if (isLikelyMissingWhisperXError(error)) {
      const missingError = new Error(
        'O WhisperX não está instalado no servidor. Verifique as dependências Python do backend (requirements-whisperx.txt).'
      );
      missingError.code = 'WHISPERX_UNAVAILABLE';
      throw missingError;
    }
    throw error;
  } finally {
    await removeLocalFileSilently(audioPath);
    await removeLocalFileSilently(stanzasPath);
    if (jobRoot) {
      try {
        await fs.promises.rm(jobRoot, { recursive: true, force: true });
      } catch (error) {
        console.warn('[lyricsSyncService] Não foi possível remover diretório temporário:', error.message);
      }
    }
  }
};
