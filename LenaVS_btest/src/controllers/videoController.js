import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import { supabase } from '../config/supabase.js';
import {
  ALLOWED_VIDEO_EXTENSIONS,
  buildDownloadFileName,
} from '../services/videoGenerationService.js';
import { getVideoTaskQueue } from '../services/videoTaskQueue.js';
import { hasUnlimitedAccess } from '../utils/access.js';
import {
  getStoragePublicUrl,
  inferContentType,
  removeLocalFileSilently,
  uploadRequestFileToStorage,
} from '../services/storageService.js';

const queue = getVideoTaskQueue();
const MAX_AUDIO_DURATION_MINUTES = Number(process.env.MAX_AUDIO_DURATION_MINUTES || 15);
const MAX_AUDIO_DURATION_SECONDS = Math.max(60, MAX_AUDIO_DURATION_MINUTES * 60);
const AUDIO_UPLOAD_FIELDS = new Set(['musicaOriginal', 'musicaInstrumental']);

const roundDuration = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(3)) : null;
};

const getMediaDurationInSeconds = (filePath, streamType = null) => new Promise((resolve, reject) => {
  ffmpeg.ffprobe(filePath, (error, metadata) => {
    if (error) {
      reject(error);
      return;
    }

    const matchingStream = streamType
      ? metadata?.streams?.find((stream) => stream.codec_type === streamType)
      : metadata?.streams?.find((stream) => stream.codec_type === 'video') || metadata?.streams?.find((stream) => stream.codec_type === 'audio');

    const duration = Number(matchingStream?.duration || metadata?.format?.duration || 0);
    resolve(duration);
  });
});

const getAudioDurationInSeconds = (filePath) => getMediaDurationInSeconds(filePath, 'audio');

const getUploadedMediaKind = (fieldName, file) => {
  if (fieldName === 'imagem') return 'image';
  if (fieldName === 'video') return 'video';
  if (AUDIO_UPLOAD_FIELDS.has(fieldName)) return 'audio';

  const normalizedMime = String(file?.mimetype || '').toLowerCase();
  if (normalizedMime.startsWith('video/')) return 'video';
  return 'audio';
};

const extractUploadedMediaMetadata = async (fieldName, file) => {
  const kind = getUploadedMediaKind(fieldName, file);

  if (kind === 'image') {
    return { kind, duration: null };
  }

  try {
    const duration = await getMediaDurationInSeconds(file.path, kind === 'video' ? 'video' : 'audio');
    return {
      kind,
      duration: roundDuration(duration),
    };
  } catch (error) {
    console.warn(`Não foi possível extrair metadados de ${fieldName}:`, error.message);
    return { kind, duration: null };
  }
};

const validateAudioUploadDurations = async (filesMap = {}) => {
  for (const [fieldName, files] of Object.entries(filesMap || {})) {
    if (!AUDIO_UPLOAD_FIELDS.has(fieldName)) continue;

    for (const file of files || []) {
      let durationInSeconds;

      try {
        durationInSeconds = await getAudioDurationInSeconds(file.path);
      } catch (error) {
        await removeLocalFileSilently(file.path);
        const readError = new Error(
          `Não foi possível ler o áudio "${file.originalname}". O arquivo pode estar corrompido ou em um formato que o FFmpeg não reconhece.`
        );
        readError.code = 'MEDIA_READ_ERROR';
        readError.fileName = file.originalname;
        readError.status = 422;
        throw readError;
      }

      if (!Number.isFinite(durationInSeconds) || durationInSeconds <= 0) {
        await removeLocalFileSilently(file.path);
        const error = new Error(
          `Não foi possível ler a duração do áudio "${file.originalname}".`
        );
        error.code = 'MEDIA_READ_ERROR';
        error.fileName = file.originalname;
        error.status = 400;
        throw error;
      }

      if (durationInSeconds > MAX_AUDIO_DURATION_SECONDS) {
        await removeLocalFileSilently(file.path);
        const error = new Error(`O áudio excede ${MAX_AUDIO_DURATION_MINUTES} minutos. Envie um arquivo com até ${MAX_AUDIO_DURATION_MINUTES} minutos.`);
        error.code = 'AUDIO_TOO_LONG';
        error.fileName = file.originalname;
        error.status = 400;
        throw error;
      }
    }
  }
};

const encodeDownloadFileName = (fileName) => encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const streamPublicFileToResponse = async ({ publicUrl, res, downloadName, fallbackContentType }) => {
  const response = await axios({
    url: publicUrl,
    method: 'GET',
    responseType: 'stream',
    maxRedirects: 5,
    timeout: 120000,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');
  res.setHeader('Content-Type', response.headers['content-type'] || fallbackContentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeDownloadFileName(downloadName)}`);
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (response.headers['content-length']) {
    res.setHeader('Content-Length', response.headers['content-length']);
  }

  response.data.pipe(res);
};

export const uploadMedia = async (req, res) => {
  let activeFileName = null;

  try {
    const userId = req.user?.id;
    const uploadedFiles = {};
    const uploadedMetadata = {};

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    if (req.files) {
      await validateAudioUploadDurations(req.files);

      for (const [fieldName, files] of Object.entries(req.files)) {
        const file = files?.[0];
        if (!file) continue;
        activeFileName = file.originalname;

        const extractedMetadata = await extractUploadedMediaMetadata(fieldName, file);
        const uploaded = await uploadRequestFileToStorage(file, {
          userId,
          category: `media/${fieldName}`,
          prefix: fieldName,
        });

        uploadedFiles[fieldName] = uploaded.publicUrl;
        uploadedMetadata[fieldName] = {
          ...extractedMetadata,
          publicUrl: uploaded.publicUrl,
          storagePath: uploaded.storagePath,
          bucket: uploaded.bucket,
        };
      }
    }

    if (!Object.keys(uploadedFiles).length) {
      return res.status(400).json({
        code: 'NO_FILE_UPLOADED',
        error: 'Nenhum arquivo foi enviado. Escolha um arquivo e tente novamente.',
      });
    }

    return res.status(200).json({
      success: true,
      files: uploadedFiles,
      metadata: uploadedMetadata,
    });
  } catch (error) {
    console.error('Erro no upload:', error);
    return res.status(error.status || 500).json({
      code: error.code || 'UPLOAD_ERROR',
      fileName: error.fileName || activeFileName,
      error: error.message || 'Erro ao enviar o arquivo. Tente novamente.',
    });
  }
};

export const generateVideo = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const {
      projectName,
      audioPath,
      backgroundType,
      backgroundPath,
      backgroundColor,
      mediaAnimation = undefined,
      resolution = '720p',
      videoFormat = 'mp4',
      stanzas = [],
    } = req.body || {};

    if (!projectName || !audioPath) {
      return res.status(400).json({ error: 'Dados insuficientes para gerar o vídeo' });
    }

    const task = await queue.enqueueTask({
      userId,
      payload: {
        projectName,
        audioPath,
        backgroundType,
        backgroundPath,
        backgroundColor,
        mediaAnimation,
        resolution,
        videoFormat,
        stanzas,
      },
    });

    const publicTask = await queue.getPublicTaskStatus(task.id, userId);
    return res.status(202).json({
      success: true,
      taskId: task.id,
      ...(publicTask || {
        status: 'processing',
        progress: 0,
        message: 'Seu vídeo está sendo processado',
      }),
    });
  } catch (error) {
    console.error('Erro ao gerar vídeo:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Erro ao gerar vídeo' });
  }
};

export const getVideoProcessingStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { taskId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const task = await queue.getPublicTaskStatus(taskId, userId);
    if (!task) {
      return res.status(404).json({ error: 'Processamento não encontrado' });
    }

    return res.status(200).json({
      success: true,
      ...task,
    });
  } catch (error) {
    console.error('Erro ao consultar processamento:', error);
    return res.status(500).json({ error: 'Erro ao consultar processamento do vídeo' });
  }
};

export const downloadVideo = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const { fileName } = req.params;
    const extension = path.extname(fileName || '').toLowerCase();

    if (!ALLOWED_VIDEO_EXTENSIONS.has(extension)) {
      return res.status(400).json({ error: 'Arquivo inválido para download' });
    }

    const storagePath = String(req.query?.storagePath || '').trim();
    if (!storagePath) {
      return res.status(400).json({ error: 'Referência do arquivo não encontrada para download' });
    }

    const publicUrl = getStoragePublicUrl(storagePath);
    if (!publicUrl) {
      return res.status(404).json({ error: 'Vídeo não encontrado' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('plan, credits, subscription_status, unlimited_access_until')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(403).json({ error: 'Usuário não encontrado' });
    }

    const isPro = hasUnlimitedAccess(user);

    if (!isPro) {
      if (!user.credits || user.credits <= 0) {
        return res.status(403).json({
          error: 'Créditos esgotados',
          code: 'NO_CREDITS',
        });
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({ credits: user.credits - 1 })
        .eq('id', userId)
        .gt('credits', 0);

      if (updateError) {
        return res.status(500).json({ error: 'Erro ao atualizar créditos' });
      }
    }

    const requestedDownloadName = req.query?.downloadName;
    const downloadName = buildDownloadFileName(
      typeof requestedDownloadName === 'string' && requestedDownloadName.trim()
        ? requestedDownloadName.replace(/\.[a-z0-9]+$/i, '')
        : path.parse(fileName).name,
      extension.replace('.', '')
    );

    await streamPublicFileToResponse({
      publicUrl,
      res,
      downloadName,
      fallbackContentType: inferContentType({ originalName: fileName }),
    });
  } catch (error) {
    console.error('Erro no download:', error);
    const status = error?.response?.status === 404 ? 404 : 500;
    return res.status(status).json({ error: status === 404 ? 'Vídeo não encontrado' : 'Erro ao fazer download' });
  }
};
