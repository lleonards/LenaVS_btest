import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTempFilePath,
  downloadSourceValueToTempFile,
  removeLocalFileSilently,
} from './storageService.js';

const ALIGNMENT_TIMEOUT_MS = Number(process.env.CTC_ALIGNER_TIMEOUT_MS) || (30 * 60 * 1000);
const PYTHON_BIN = process.env.PYTHON312_BIN || process.env.PYTHON_BIN || 'python3.12';
const ALIGNER_MODEL = process.env.CTC_ALIGNER_MODEL || 'MMS_FA';
const ALIGNER_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/ctc_align_lyrics.py'
);

const runAligner = ({ audioPath, textPath, outputPath }) => new Promise((resolve, reject) => {
  const child = spawn(
    PYTHON_BIN,
    [
      ALIGNER_SCRIPT,
      '--audio-path',
      audioPath,
      '--text-path',
      textPath,
      '--output-path',
      outputPath,
      '--model-type',
      ALIGNER_MODEL,
    ],
    {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stdout = '';
  let stderr = '';
  let settled = false;
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    const error = new Error('A sincronização automática demorou mais do que o esperado.');
    error.code = 'ALIGNMENT_TIMEOUT';
    settled = true;
    reject(error);
  }, ALIGNMENT_TIMEOUT_MS);

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('error', (error) => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;
    if (error.code === 'ENOENT') {
      error.code = 'ALIGNER_UNAVAILABLE';
      error.message = `Python 3.12 não foi encontrado (${PYTHON_BIN}).`;
    }
    reject(error);
  });

  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;

    if (code !== 0) {
      let workerFailure = null;
      try {
        workerFailure = JSON.parse(stderr.trim().split('\n').pop());
      } catch {
        // O worker pode ter sido encerrado antes de conseguir emitir JSON.
      }

      const error = new Error(
        workerFailure?.error
          || stderr.trim()
          || stdout.trim()
          || `O processo do Lyrics Aligner terminou com código ${code}.`
      );
      error.code = workerFailure?.code || 'ALIGNMENT_FAILED';
      error.stderr = stderr;
      error.exitCode = code;
      error.signal = signal;
      reject(error);
      return;
    }

    resolve({ stdout, stderr });
  });
});

export const alignLyricsBlocks = async ({ audioUrl, stanzas }) => {
  const normalizedAudioUrl = String(audioUrl || '').trim();
  const normalizedStanzas = Array.isArray(stanzas)
    ? stanzas.map((stanza) => ({
      id: stanza?.id ?? null,
      text: String(stanza?.text || ''),
    }))
    : [];

  if (!normalizedAudioUrl) {
    const error = new Error('A música original é obrigatória para sincronizar a letra.');
    error.code = 'AUDIO_REQUIRED';
    throw error;
  }

  if (!normalizedStanzas.length || normalizedStanzas.every((stanza) => !stanza.text.trim())) {
    const error = new Error('Envie uma letra antes de iniciar a sincronização automática.');
    error.code = 'LYRICS_REQUIRED';
    throw error;
  }

  let audioPath = null;
  let textPath = null;
  let outputPath = null;

  try {
    audioPath = await downloadSourceValueToTempFile(normalizedAudioUrl, {
      prefix: 'ctc-audio',
      fallbackName: 'musica-original.mp3',
      mimeType: 'audio/mpeg',
      folder: 'ctc-aligner',
    });

    textPath = await createTempFilePath({
      prefix: 'ctc-lyrics',
      originalName: 'lyrics.txt',
      mimeType: 'text/plain',
      fallbackExtension: '.txt',
      folder: 'ctc-aligner',
    });
    outputPath = await createTempFilePath({
      prefix: 'ctc-result',
      originalName: 'alignment.json',
      mimeType: 'application/json',
      fallbackExtension: '.json',
      folder: 'ctc-aligner',
    });

    // One line per existing LenaVS block. The Python worker never resegments it.
    await fs.writeFile(
      textPath,
      `${normalizedStanzas.map((stanza) => stanza.text).join('\n')}\n`,
      'utf8'
    );

    await runAligner({ audioPath, textPath, outputPath });

    const result = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    if (!Array.isArray(result?.blocks) || result.blocks.length !== normalizedStanzas.length) {
      const error = new Error('O Lyrics Aligner retornou uma estrutura de blocos inválida.');
      error.code = 'ALIGNMENT_INVALID_RESULT';
      throw error;
    }

    const timings = result.blocks.map((block, index) => ({
      index,
      id: normalizedStanzas[index].id,
      start: Number.isFinite(Number(block.start)) ? Number(block.start) : null,
      end: Number.isFinite(Number(block.end)) ? Number(block.end) : null,
      wordCount: Number(block.wordCount) || 0,
    }));

    const hasMissingTiming = normalizedStanzas.some(
      (stanza, index) => stanza.text.trim() && (timings[index].start == null || timings[index].end == null)
    );
    if (hasMissingTiming) {
      const error = new Error('O Lyrics Aligner não conseguiu determinar o tempo de todos os blocos.');
      error.code = 'ALIGNMENT_INCOMPLETE';
      throw error;
    }

    return {
      engine: result.engine || 'ctc-forced-aligner',
      version: result.version || '1.0.2',
      modelType: result.modelType || ALIGNER_MODEL,
      timings,
    };
  } finally {
    await removeLocalFileSilently(audioPath);
    await removeLocalFileSilently(textPath);
    await removeLocalFileSilently(outputPath);
  }
};