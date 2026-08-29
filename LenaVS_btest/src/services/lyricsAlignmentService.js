/**
 * lyricsAlignmentService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sincronização automática de letras por ALINHAMENTO FORÇADO (forced alignment).
 *
 * Conceito (inspirado no projeto open-source Lyrics Aligner):
 *   - O usuário fornece a letra EXATA já organizada em blocos na LenaVS;
 *   - Nada é reorganizado: cada bloco é alinhado exatamente como está
 *     (frases, linhas ou estrofes — a organização da LenaVS é preservada);
 *   - Internamente o alinhamento trabalha palavra por palavra;
 *   - Bloco.início = momento em que a 1ª palavra do bloco é cantada;
 *   - Bloco.fim    = momento em que a última palavra do bloco é cantada.
 *
 * Pipeline (100% local, gratuito, sem API key):
 *   Música original → (opcional) Demucs isola o vocal → transcodifica p/ WAV 16 kHz
 *   → torchaudio MMS_FA (wav2vec2 multilingue, CTC forced alignment)
 *   → timestamps por palavra → mapeados de volta para os blocos originais.
 *
 * Engine: torchaudio.pipelines.MMS_FA (Apache-2.0 / MIT — torchaudio).
 * Requer Python com torch + torchaudio (mesmo ambiente já exigido pelo Demucs).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';

import {
  createVocalsWithDemucsFromLocalFile,
  ensureDemucsAvailable,
  removeDirectorySilently,
} from './demucsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALIGN_PYTHON_BIN = process.env.ALIGN_PYTHON_BIN
  || process.env.DEMUCS_PYTHON_BIN
  || 'python3';

const ALIGN_SCRIPT = process.env.LYRICS_ALIGN_SCRIPT
  || path.join(__dirname, '..', '..', 'scripts', 'forced_align.py');

const ALIGN_TMP_ROOT = path.join(os.tmpdir(), 'lenavs-align');
const ALIGN_TIMEOUT_MS = Number(process.env.LYRICS_ALIGN_TIMEOUT_MS || 25 * 60 * 1000);

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
  return dirPath;
};

const runCommand = (command, args, { timeoutMs = ALIGN_TIMEOUT_MS, env = process.env } = {}) => (
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const error = new Error(`O alinhamento excedeu o tempo limite de ${Math.round(timeoutMs / 1000)} segundos.`);
        error.code = 'ALIGNMENT_TIMEOUT';
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ code, stdout, stderr });
    });
  })
);

const isMissingPythonDepsError = (stderr = '', stdout = '') => {
  const text = String(stderr + ' ' + stdout).toLowerCase();
  return (
    text.includes('no module named torch')
    || text.includes('no module named torchaudio')
    || text.includes('module \'torchaudio\' has no attribute')
    || text.includes('command not found')
    || text.includes('is not recognized as an internal or external command')
  );
};

const formatUnavailableError = (detail = '') => {
  const message = [
    'O alinhamento automático de letras não está disponível no servidor.',
    'Instale o ambiente Python com torch e torchaudio (mesmo ambiente exigido pelo Demucs — veja requirements-demucs.txt).',
    detail ? `Detalhe técnico: ${detail}` : '',
  ].filter(Boolean).join(' ');
  const error = new Error(message);
  error.code = 'ALIGNMENT_UNAVAILABLE';
  return error;
};

/** Verifica se o Python tem torch + torchaudio + MMS_FA. */
export const ensureAlignmentAvailable = async () => {
  const probe = [
    'import torch, torchaudio',
    'from torchaudio import pipelines',
    'assert hasattr(pipelines, "MMS_FA"), "MMS_FA ausente"',
    'print("ok")',
  ].join('; ');

  try {
    const { code, stderr, stdout } = await runCommand(ALIGN_PYTHON_BIN, ['-c', probe], { timeoutMs: 60000 });
    if (code !== 0 || String(stdout).trim() !== 'ok') {
      throw formatUnavailableError(stderr || `exit ${code}`);
    }
    return true;
  } catch (error) {
    if (error?.code === 'ALIGNMENT_UNAVAILABLE') throw error;
    if (isMissingPythonDepsError(error?.stderr, error?.stdout)) {
      throw formatUnavailableError(error?.stderr || error?.message);
    }
    throw error;
  }
};

const transcodeToMono16kWav = (inputPath, outputPath) => new Promise((resolve, reject) => {
  ffmpeg(inputPath)
    .audioFrequency(16000)
    .audioChannels(1)
    .audioCodec('pcm_s16le')
    .format('wav')
    .on('end', () => resolve(outputPath))
    .on('error', reject)
    .save(outputPath);
});

const getAudioDurationInSeconds = (filePath) => new Promise((resolve, reject) => {
  ffmpeg.ffprobe(filePath, (error, metadata) => {
    if (error) { reject(error); return; }
    const duration = Number(
      metadata?.streams?.find((s) => s.codec_type === 'audio')?.duration
      || metadata?.format?.duration
      || 0
    );
    resolve(Number.isFinite(duration) ? duration : 0);
  });
});

/**
 * Executa o script Python de forced alignment.
 * @returns {Promise<object>} { engine, sample_rate, duration, words, blocks }
 */
const runForcedAlignmentScript = async ({ wavPath, blocksPath, blocks }) => {
  await ensureAlignmentAvailable();

  const { code, stdout, stderr } = await runCommand(
    ALIGN_PYTHON_BIN,
    [ALIGN_SCRIPT, '--audio', wavPath, '--blocks', blocksPath]
  );

  if (code !== 0) {
    const detail = String(stderr || '').trim();
    if (isMissingPythonDepsError(detail, '')) {
      throw formatUnavailableError(detail);
    }
    const error = new Error(detail ? `Falha no alinhamento: ${detail}` : 'Falha no alinhamento da letra.');
    error.code = 'ALIGNMENT_FAILED';
    error.stderr = stderr;
    throw error;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error('A engine de alinhamento devolveu uma resposta inválida.');
  }

  if (!parsed || !Array.isArray(parsed.blocks) || parsed.blocks.length !== blocks.length) {
    throw new Error('A engine de alinhamento não devolveu os blocos esperados.');
  }

  return parsed;
};

/**
 * Sincroniza os blocos da letra com o áudio.
 *
 * @param {object} options
 * @param {string} options.audioPath  Caminho local do áudio original
 * @param {Array<{text: string}>} options.blocks  Blocos EXATOS da LenaVS (ordem preservada)
 * @param {boolean} [options.preferVocals=true]  Isola o vocal com Demucs quando disponível
 * @returns {Promise<{engine, alignedOn, duration, blocks: Array}>}
 */
export const alignLyricsWithAudio = async ({ audioPath, blocks, preferVocals = true }) => {
  if (!audioPath) throw new Error('Caminho do áudio ausente para o alinhamento.');
  if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('Envie a letra em blocos para sincronizar.');

  await ensureDir(ALIGN_TMP_ROOT);
  const jobRoot = await fs.promises.mkdtemp(path.join(ALIGN_TMP_ROOT, 'job-'));

  let sourceForAlign = audioPath;
  let alignedOn = 'original';
  let vocalsPath = null;
  let vocalsJobRoot = null;
  let wavPath = null;
  let blocksPath = null;

  try {
    // 1) Detectar o canto: isola o vocal com Demucs quando disponível
    if (preferVocals) {
      try {
        await ensureDemucsAvailable();
        const vocalsResult = await createVocalsWithDemucsFromLocalFile(audioPath);
        vocalsPath = vocalsResult.vocalsPath;
        vocalsJobRoot = vocalsResult.jobRoot;
        sourceForAlign = vocalsPath;
        alignedOn = 'vocals';
        console.log('[lyricsAlignment] Vocal isolado com Demucs — alinhando sobre a voz.');
      } catch (error) {
        console.warn('[lyricsAlignment] Demucs indisponível, alinhando sobre o áudio original:', error.message);
        alignedOn = 'original';
      }
    }

    // 2) WAV mono 16 kHz (entrada estável para o MMS_FA)
    wavPath = path.join(jobRoot, 'audio16k.wav');
    await transcodeToMono16kWav(sourceForAlign, wavPath);

    // 3) Blocos em JSON (texto original, intocado)
    blocksPath = path.join(jobRoot, 'blocks.json');
    await fs.promises.writeFile(
      blocksPath,
      JSON.stringify({ blocks: blocks.map((b) => ({ text: String(b?.text ?? '') })) }),
      'utf-8'
    );

    // 4) Forced alignment palavra por palavra
    const result = await runForcedAlignmentScript({ wavPath, blocksPath, blocks });

    // 5) Recompõe os blocos na ordem exata da LenaVS
    const duration = await getAudioDurationInSeconds(wavPath);
    const outBlocks = blocks.map((block, index) => {
      const matched = result.blocks.find((b) => b.index === index);
      return {
        index,
        text: String(block.text || ''),
        startTime: matched?.start ?? null,
        endTime: matched?.end ?? null,
        matched: Boolean(matched?.matched),
        words: Array.isArray(matched?.words) ? matched.words : [],
      };
    });

    return {
      engine: result.engine || 'torchaudio-mms-fa',
      alignedOn,
      duration: Number.isFinite(duration) ? Number(duration.toFixed(3)) : null,
      blocks: outBlocks,
    };
  } finally {
    await removeDirectorySilently(jobRoot);
    await removeDirectorySilently(vocalsJobRoot);
    await fs.promises.rm(vocalsPath || '', { force: true }).catch(() => {});
  }
};
