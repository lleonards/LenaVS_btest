/**
 * lyricsSyncService.js
 *
 * Sincronização automática de letras usando o ctc-forced-aligner 1.0.2
 * (Python 3.12), executado via scripts/lyrics_aligner.py.
 *
 * Fluxo:
 *   1. Baixa o áudio original para um arquivo temporário.
 *   2. Envia os blocos de letra (na ordem exata criada pelo usuário) para o
 *      script Python, que:
 *        - achata os blocos em uma lista ordenada de palavras;
 *        - roda o forced alignment (MMS_FA, multilíngue) para descobrir o
 *          tempo (start/end) de cada palavra;
 *        - devolve o tempo de cada bloco = primeira palavra (start) e última
 *          palavra (end) daquele bloco — por índice sequencial.
 *   3. Converte os segundos para o formato mm:ss (sem milissegundos) e
 *      retorna { timings: [{ start, end }, ...] } na MESMA ordem dos blocos.
 *
 * A estrutura dos blocos NUNCA é alterada aqui: o alinhador apenas descobre
 * tempos; montar/repartir blocos continua a cargo da LenaVS.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

import {
  downloadSourceValueToTempFile,
  removeLocalFileSilently,
} from './storageService.js';

import { secondsToTime } from '../utils/lyricsProcessor.js';

const ALIGNER_PYTHON_BIN = process.env.LYRICS_ALIGNER_PYTHON_BIN || 'python3';
const ALIGNER_TIMEOUT_MS = Number(process.env.LYRICS_ALIGNER_TIMEOUT_MS || 10 * 60 * 1000);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(currentDir, '..', '..');

const ALIGNER_SCRIPT = process.env.LYRICS_ALIGNER_SCRIPT
  || path.join(backendRoot, 'scripts', 'lyrics_aligner.py');

const removeSilently = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // arquivo já não existe — ok
  }
};

const runPython = (script, args, { timeoutMs, env = process.env } = {}) => new Promise((resolve, reject) => {
  const child = spawn(script, args, {
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
    const processError = new Error(
      error?.code === 'ENOENT'
        ? 'O Python ou as dependências do alinhador não estão disponíveis no servidor.'
        : error?.message || 'Não foi possível iniciar o alinhador.'
    );
    processError.code = error?.code === 'ENOENT'
      ? 'ALIGNER_DEPS_MISSING'
      : 'ALIGNER_PROCESS_FAILED';
    processError.cause = error;
    reject(processError);
  });

  child.on('close', (code) => {
    clearTimeout(timer);

    if (timedOut) {
      const timeoutError = new Error('O alinhamento de letras excedeu o tempo limite.');
      timeoutError.code = 'ALIGNER_TIMEOUT';
      timeoutError.stderr = stderr;
      reject(timeoutError);
      return;
    }

    if (code !== 0) {
      const commandError = new Error(`O alinhador de letras finalizou com código ${code}.`);
      commandError.code = 'ALIGNER_PROCESS_FAILED';
      commandError.stdout = stdout;
      commandError.stderr = stderr;
      reject(commandError);
      return;
    }

    resolve({ stdout, stderr });
  });
});

const parseAlignerOutput = (rawJson) => {
  const result = typeof rawJson === 'object' && rawJson !== null
    ? rawJson
    : JSON.parse(rawJson);

  if (!result.success) {
    const detail = String(result.error || 'erro desconhecido');
    const error = new Error(detail);
    error.code = /no module named|não está instalado|not installed/i.test(detail)
      ? 'ALIGNER_DEPS_MISSING'
      : 'ALIGNER_FAILED';
    throw error;
  }

  return {
    words: Number(result.words) || 0,
    timings: (Array.isArray(result.blockTimings) ? result.blockTimings : []).map((timing) => ({
      start: secondsToTime(Number(timing?.start) || 0),
      end: secondsToTime(Number(timing?.end) || 0),
    })),
  };
};

/**
 * Sincroniza os blocos de letra com o áudio.
 *
 * @param {object}   params
 * @param {string}   params.audioUrl URL pública do áudio original.
 * @param {Array}    params.blocks   [{ text }] na ordem exata do usuário.
 * @returns {Promise<{ words: number, timings: Array<{start,end}> }>}
 * @throws {Error} Em qualquer falha — nada é devolvido; o chamador deve
 *                 tratar como "blocos intactos".
 */
export const alignBlocksWithAudio = async ({ audioUrl, blocks, onProgress }) => {
  let sourceAudioPath = null;
  let workRoot = null;

  try {
    onProgress?.({
      progress: 10,
      stage: 'downloading',
      message: 'Baixando a música para análise…',
    });
    sourceAudioPath = await downloadSourceValueToTempFile(audioUrl, {
      prefix: 'lenavs-aligner-source',
      fallbackName: 'musica-original.mp3',
      mimeType: 'audio/mpeg',
      folder: 'aligner-source',
    });

    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lenavs-aligner-'));

    const blocksPath = path.join(workRoot, 'blocks.json');
    const outPath = path.join(workRoot, 'result.json');

    await fs.writeFile(blocksPath, JSON.stringify({ blocks }), 'utf8');

    onProgress?.({
      progress: 25,
      stage: 'aligning',
      message: 'Analisando a música e alinhando as palavras…',
    });
    const { stderr } = await runPython(ALIGNER_PYTHON_BIN, [
      ALIGNER_SCRIPT,
      sourceAudioPath,
      blocksPath,
      outPath,
    ], { timeoutMs: ALIGNER_TIMEOUT_MS });

    const outText = await fs.readFile(outPath, 'utf8');
    const parsed = parseAlignerOutput(outText);

    if (!parsed.timings.length) {
      const error = new Error('O alinhador não retornou tempos para os blocos.');
      error.code = 'ALIGNER_FAILED';
      throw error;
    }

    if (stderr) {
      console.log('[lyricsSync] Detalhes do alinhador:', String(stderr).slice(0, 2000));
    }

    return parsed;
  } catch (error) {
    if (error?.code === 'ALIGNER_DEPS_MISSING') {
      error.message = 'As dependências Python do alinhador (ctc-forced-aligner 1.0.2 + torch) não estão instaladas. Instale com: `pip install -r requirements-aligner.txt`.';
    }
    throw error;
  } finally {
    await removeLocalFileSilently(sourceAudioPath);

    if (workRoot) {
      await removeSilently(path.join(workRoot, 'blocks.json'));
      await removeSilently(path.join(workRoot, 'result.json'));
      await removeSilently(path.join(workRoot, 'result_transcript.txt'));
      try {
        await fs.rmdir(workRoot);
      } catch {
        // diretório já removido ou não vazio — ok
      }
    }
  }
};
