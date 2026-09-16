/**
 * alignmentController.js — Sincronização automática de letras
 * ─────────────────────────────────────────────────────────────────────────────
 * O usuário envia apenas a música original + a letra. Este endpoint:
 *
 *   1. baixa o áudio enviado (Supabase Storage);
 *   2. converte para WAV 16 kHz mono (ffmpeg) — mais leve e mais rápido;
 *   3. roda o ctc-forced-aligner==1.0.2 (processo filho, 1 thread, 1 por vez);
 *   4. mapeia palavra → bloco ORIGINAL da letra (sem alterar texto/divisão);
 *   5. devolve início/fim de cada bloco em MM:SS.
 *
 * Não altera cadastro, login, projetos nem o editor.
 */

import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

import {
  downloadSourceValueToTempFile,
  removeLocalFileSilently,
} from '../services/storageService.js';
import {
  runExclusiveAlignment,
  runForcedAlignment,
  assertEnoughMemory,
  recordAlignmentError,
  buildAlignmentOutputPath,
  ensureAlignmentOutputDir,
  ALIGNMENT_MAX_AUDIO_SECONDS,
  getAlignmentStatus,
} from '../services/alignmentQueue.js';
import {
  buildAlignmentText,
  buildAlignmentBlocks,
  countAlignmentWords,
  mapAlignmentToBlocks,
} from '../utils/lyricsAlignment.js';

const MAX_BLOCKS = 400;
const MAX_BLOCK_CHARS = 5000;
const MAX_TOTAL_WORDS = 4000;

const normalizeStanzasPayload = (rawStanzas) => {
  if (!Array.isArray(rawStanzas)) return null;

  const texts = rawStanzas
    .map((entry) => (typeof entry === 'string' ? entry : String(entry?.text ?? '')))
    .map((text) => text.replace(/\r/g, ''));

  if (!texts.length || texts.length > MAX_BLOCKS) return null;
  if (texts.some((text) => text.length > MAX_BLOCK_CHARS)) return null;

  return texts;
};

const normalizeLyricsError = (error) => {
  if (!error) return 'Erro ao sincronizar automaticamente a letra.';

  switch (error.code) {
    case 'ALIGNER_UNAVAILABLE':
    case 'ALIGNER_SCRIPT_MISSING':
      return 'O recurso de sincronização automática não está instalado neste servidor. Fale com o suporte.';
    case 'ALIGNMENT_OUT_OF_MEMORY':
      return 'O servidor ficou sem memória durante a sincronização. Tente novamente com um áudio menor.';
    case 'ALIGNMENT_TIMEOUT':
      return 'A sincronização demorou mais do que o limite do servidor. Tente novamente com um áudio menor.';
    case 'ALIGNMENT_LOW_MEMORY':
      return 'O servidor está ocupado no momento. Tente a sincronização novamente em alguns minutos.';
    case 'ALIGNMENT_TEXT_EMPTY':
      return 'Não há palavras na letra para sincronizar.';
    case 'ALIGNMENT_EMPTY_RESULT':
      return 'Não foi possível reconhecer palavras cantadas no áudio enviado. Confira se a música tem voz.';
    default:
      return error.message || 'Erro ao sincronizar automaticamente a letra.';
  }
};

const convertToWav16kMono = (inputPath, outputPath) => new Promise((resolve, reject) => {
  ffmpeg(inputPath)
    .noVideo()
    .audioChannels(1)
    .audioFrequency(16000)
    .audioCodec('pcm_s16le')
    .format('wav')
    .on('error', (error) => {
      const wrapped = new Error(
        'Não foi possível preparar o áudio para a sincronização. Verifique se o arquivo está íntegro.'
      );
      wrapped.code = 'ALIGNMENT_AUDIO_CONVERT_FAILED';
      wrapped.cause = error;
      reject(wrapped);
    })
    .on('end', () => resolve(outputPath))
    .save(outputPath);
});

/**
 * GET /api/media/sync-lyrics/status
 * Diagnóstico leve (não processa nada) — útil para conferir o servidor.
 */
export const getSyncLyricsStatus = async (req, res) => {
  const status = getAlignmentStatus();

  return res.status(200).json({
    success: true,
    running: status.running,
    queueLength: status.queueLength,
    freeMemoryMb: status.freeMemoryMb,
    minFreeMemoryMb: status.minFreeMemoryMb,
    completedJobs: status.completedJobs,
    maxAudioSeconds: ALIGNMENT_MAX_AUDIO_SECONDS,
  });
};

/**
 * POST /api/media/sync-lyrics
 * Body: { audioUrl: string, stanzas: [{ text: string }] }
 * Resp: { success, blocks: [{ index, startTime, endTime, startSeconds, endSeconds }], meta }
 */
export const syncLyricsAutomatically = async (req, res) => {
  const rawAudioUrl = req.body?.audioUrl;
  const audioUrl = typeof rawAudioUrl === 'string' ? rawAudioUrl.trim() : '';
  const stanzas = normalizeStanzasPayload(req.body?.stanzas);

  if (!audioUrl) {
    return res.status(400).json({
      code: 'ALIGNMENT_AUDIO_REQUIRED',
      error: 'Envie a música original antes de sincronizar automaticamente.',
    });
  }

  if (!stanzas) {
    return res.status(400).json({
      code: 'ALIGNMENT_LYRICS_REQUIRED',
      error: 'Envie a letra antes de sincronizar automaticamente.',
    });
  }

  const alignmentBlocks = buildAlignmentBlocks(stanzas);
  const lyricWordCount = countAlignmentWords(alignmentBlocks);
  const alignmentText = buildAlignmentText(alignmentBlocks);

  if (!lyricWordCount || !alignmentText.trim()) {
    return res.status(400).json({
      code: 'ALIGNMENT_TEXT_EMPTY',
      error: 'A letra enviada não possui palavras para sincronizar.',
    });
  }

  if (lyricWordCount > MAX_TOTAL_WORDS) {
    return res.status(413).json({
      code: 'ALIGNMENT_LYRICS_TOO_LONG',
      error: `A letra tem palavras demais para a sincronização automática (limite: ${MAX_TOTAL_WORDS}).`,
    });
  }

  const language = String(process.env.ALIGNMENT_LANGUAGE || 'por').trim().toLowerCase() || 'por';

  let sourceAudioPath = null;
  let wavPath = null;
  let textPath = null;
  let outputPath = null;

  try {
    return await runExclusiveAlignment(async () => {
      assertEnoughMemory();

      console.log('[syncLyrics] Baixando áudio de origem para sincronização…');

      sourceAudioPath = await downloadSourceValueToTempFile(audioUrl, {
        prefix: 'alignment-source',
        fallbackName: 'musica-original.mp3',
        mimeType: 'audio/mpeg',
        folder: 'alignment-source',
      });

      const stamp = Date.now();
      const outputDir = await ensureAlignmentOutputDir(buildAlignmentOutputPath());

      wavPath = path.join(outputDir, `align-${stamp}.wav`);
      textPath = path.join(outputDir, `align-${stamp}.txt`);
      outputPath = path.join(outputDir, `align-${stamp}.json`);

      await convertToWav16kMono(sourceAudioPath, wavPath);
      await removeLocalFileSilently(sourceAudioPath);
      sourceAudioPath = null;

      await fs.promises.writeFile(textPath, alignmentText, 'utf8');

      console.log('[syncLyrics] Executando o alinhamento forçado (1 thread, CPU)…');

      const alignmentResult = await runForcedAlignment({
        audioPath: wavPath,
        textPath,
        outputPath,
        language,
      });

      const audioDuration = Number(alignmentResult.audioDuration) || null;

      if (audioDuration && audioDuration > ALIGNMENT_MAX_AUDIO_SECONDS) {
        const error = new Error(
          `O áudio tem mais de ${Math.round(ALIGNMENT_MAX_AUDIO_SECONDS / 60)} minutos. Envie uma música menor.`
        );
        error.code = 'ALIGNMENT_AUDIO_TOO_LONG';
        throw error;
      }

      const { blocks, meta } = mapAlignmentToBlocks({
        stanzas: alignmentBlocks,
        alignedWords: alignmentResult.words,
        audioDuration,
      });

      console.log(
        `[syncLyrics] Concluído em ${alignmentResult.elapsedSeconds}s — modo ${meta.mode} (${meta.alignedWordCount}/${meta.lyricWordCount} palavras).`
      );

      return res.status(200).json({
        success: true,
        engine: alignmentResult.engine || 'ctc-forced-aligner',
        language,
        audioDuration,
        words: alignmentResult.words.map((word) => ({
          text: word.text,
          start: word.start,
          end: word.end,
        })),
        blocks,
        meta: {
          ...meta,
          elapsedSeconds: alignmentResult.elapsedSeconds ?? null,
        },
      });
    });
  } catch (error) {
    recordAlignmentError(error);
    console.error('[syncLyrics] Erro:', error.code || '', error.message);

    if (error?.stderr) {
      console.error('[syncLyrics] stderr:', String(error.stderr).slice(-1500));
    }

    const status = Number.isFinite(error?.status) ? error.status : 500;

    return res.status(status).json({
      code: error?.code || 'ALIGNMENT_ERROR',
      error: normalizeLyricsError(error),
    });
  } finally {
    await removeLocalFileSilently(sourceAudioPath);
    await removeLocalFileSilently(wavPath);
    await removeLocalFileSilently(textPath);
    await removeLocalFileSilently(outputPath);
  }
};