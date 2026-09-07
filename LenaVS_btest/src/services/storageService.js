import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { supabase } from '../config/supabase.js';

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'videos';
export const BACKEND_BASE_URL = (
  process.env.BACKEND_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'http://localhost:10000'
).replace(/\/$/, '');

const TEMP_ROOT = path.join(os.tmpdir(), 'lenavs');

const MIME_EXTENSION_MAP = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/oga': '.oga',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/x-ms-wma': '.wma',
  'audio/opus': '.opus',
  'audio/webm': '.weba',
  'audio/x-m4a': '.m4a',
  'audio/x-aiff': '.aiff',
  'audio/aiff': '.aiff',
  'audio/amr': '.amr',
  'audio/3gpp': '.3gp',
  'audio/x-caf': '.caf',
  'audio/x-matroska': '.mka',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/x-matroska': '.mkv',
  'video/webm': '.webm',
  'video/x-m4v': '.m4v',
  'video/mpeg': '.mpeg',
  'video/3gpp': '.3gp',
  'video/mp2t': '.ts',
  'video/x-ms-wmv': '.wmv',
  'video/x-flv': '.flv',
  'video/ogg': '.ogv',
  'video/x-ms-asf': '.asf',
  'video/mxf': '.mxf',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/rtf': '.rtf',
  'text/rtf': '.rtf',
  'application/msword': '.doc',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const EXTENSION_CONTENT_TYPE_MAP = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wma': 'audio/x-ms-wma',
  '.opus': 'audio/opus',
  '.weba': 'audio/webm',
  '.webm': 'video/webm',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.amr': 'audio/amr',
  '.caf': 'audio/x-caf',
  '.mka': 'audio/x-matroska',
  '.alac': 'audio/mp4',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mxf': 'video/mxf',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.asf': 'video/x-ms-asf',
  '.ogv': 'video/ogg',
  '.vob': 'video/mpeg',
  '.rm': 'application/vnd.rn-realmedia',
  '.rmvb': 'application/vnd.rn-realmedia-vbr',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.lrc': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.rtf': 'application/rtf',
  '.doc': 'application/msword',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
  return dirPath;
};

export const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

export const sanitizeStorageSegment = (value = 'arquivo') => (
  String(value || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'arquivo'
);

const randomSuffix = () => Math.random().toString(36).slice(2, 10);

export const inferExtension = ({ originalName = '', mimeType = '', fallback = '.bin' } = {}) => {
  const fromName = path.extname(String(originalName || '').split('?')[0]).toLowerCase();
  if (fromName) return fromName;

  const normalizedMime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  return MIME_EXTENSION_MAP[normalizedMime] || fallback;
};

export const inferContentType = ({ originalName = '', mimeType = '', fallback = 'application/octet-stream' } = {}) => {
  const normalizedMime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (normalizedMime && !['application/octet-stream', 'binary/octet-stream'].includes(normalizedMime)) {
    return mimeType;
  }

  const ext = path.extname(String(originalName || '').split('?')[0]).toLowerCase();
  return EXTENSION_CONTENT_TYPE_MAP[ext] || fallback;
};

const buildSafeBaseName = (originalName = '', prefix = 'arquivo') => {
  const ext = path.extname(String(originalName || ''));
  const nameWithoutExt = path.basename(String(originalName || ''), ext);
  return sanitizeStorageSegment(nameWithoutExt || prefix || 'arquivo');
};

export const buildStorageObjectPath = ({
  category = 'media',
  userId = 'anonymous',
  prefix = 'arquivo',
  originalName = '',
  mimeType = '',
  fallbackExtension = '.bin',
} = {}) => {
  const ext = inferExtension({ originalName, mimeType, fallback: fallbackExtension });
  const safeCategory = String(category || 'media')
    .split('/')
    .filter(Boolean)
    .map((segment) => sanitizeStorageSegment(segment))
    .join('/');
  const safeUserId = sanitizeStorageSegment(String(userId || 'anonymous'));
  const safePrefix = sanitizeStorageSegment(prefix || 'arquivo');
  const safeBaseName = buildSafeBaseName(originalName, prefix);

  return `${safeCategory}/${safeUserId}/${Date.now()}-${randomSuffix()}-${safePrefix}-${safeBaseName}${ext}`;
};

export const getStoragePublicUrl = (storagePath) => {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || null;
};

export const removeLocalFileSilently = async (filePath) => {
  if (!filePath) return;

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Não foi possível remover arquivo temporário:', error.message);
    }
  }
};

export const uploadLocalFileToStorage = async ({
  localPath,
  storagePath,
  contentType,
  cacheControl = '31536000',
  upsert = false,
} = {}) => {
  const stream = fs.createReadStream(localPath);

  try {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, stream, {
      cacheControl,
      upsert,
      contentType,
    });

    if (error) {
      throw error;
    }
  } finally {
    stream.destroy();
  }

  const publicUrl = getStoragePublicUrl(storagePath);
  if (!publicUrl) {
    throw new Error('Não foi possível gerar a URL pública do arquivo enviado.');
  }

  return {
    bucket: STORAGE_BUCKET,
    storagePath,
    publicUrl,
  };
};

export const uploadRequestFileToStorage = async (file, {
  userId,
  category = 'media',
  prefix = 'arquivo',
  fallbackExtension = '.bin',
} = {}) => {
  if (!file?.path) {
    throw new Error('Arquivo temporário não encontrado para envio ao storage.');
  }

  const storagePath = buildStorageObjectPath({
    category,
    userId,
    prefix,
    originalName: file.originalname,
    mimeType: file.mimetype,
    fallbackExtension,
  });

  try {
    return await uploadLocalFileToStorage({
      localPath: file.path,
      storagePath,
      contentType: inferContentType({ originalName: file.originalname, mimeType: file.mimetype }),
    });
  } finally {
    await removeLocalFileSilently(file.path);
  }
};

export const extractLegacyUploadsRelativePath = (sourceValue) => {
  const rawValue = String(sourceValue || '').trim();
  if (!rawValue) return null;

  try {
    if (isHttpUrl(rawValue)) {
      const parsed = new URL(rawValue);
      const markerIndex = parsed.pathname.indexOf('/uploads/');
      if (markerIndex === -1) return null;
      return decodeURIComponent(parsed.pathname.slice(markerIndex + '/uploads/'.length));
    }
  } catch {
    return null;
  }

  if (rawValue.startsWith('/uploads/')) {
    return decodeURIComponent(rawValue.slice('/uploads/'.length));
  }

  const markerIndex = rawValue.indexOf('/uploads/');
  if (markerIndex !== -1) {
    return decodeURIComponent(rawValue.slice(markerIndex + '/uploads/'.length).split('?')[0]);
  }

  return null;
};

const encodeRelativeUploadPath = (relativePath = '') => (
  String(relativePath || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
);

export const isLegacyUploadReference = (sourceValue) => Boolean(extractLegacyUploadsRelativePath(sourceValue));

export const buildSourceUrlCandidates = (sourceValue) => {
  const rawValue = String(sourceValue || '').trim();
  const candidates = [];
  const legacyRelativePath = extractLegacyUploadsRelativePath(rawValue);

  if (legacyRelativePath) {
    candidates.push(`${BACKEND_BASE_URL}/uploads/${encodeRelativeUploadPath(legacyRelativePath)}`);
  }

  if (rawValue.startsWith('/uploads/')) {
    candidates.push(`${BACKEND_BASE_URL}${rawValue}`);
  }

  if (isHttpUrl(rawValue)) {
    candidates.push(rawValue);
  }

  const normalizedStoragePath = rawValue.replace(/^\/+/, '');
  if (
    normalizedStoragePath
    && !isHttpUrl(rawValue)
    && !rawValue.startsWith('/uploads/')
    && !legacyRelativePath
  ) {
    const storagePublicUrl = getStoragePublicUrl(normalizedStoragePath);
    if (storagePublicUrl) {
      candidates.push(storagePublicUrl);
    }
  }

  return [...new Set(candidates.filter(Boolean))];
};

export const createTempFilePath = async ({
  prefix = 'arquivo',
  originalName = '',
  mimeType = '',
  fallbackExtension = '.tmp',
  folder = 'runtime',
} = {}) => {
  const dirPath = await ensureDir(path.join(TEMP_ROOT, sanitizeStorageSegment(folder || 'runtime')));
  const ext = inferExtension({ originalName, mimeType, fallback: fallbackExtension });
  const safePrefix = sanitizeStorageSegment(prefix || 'arquivo');
  return path.join(dirPath, `${safePrefix}-${Date.now()}-${randomSuffix()}${ext}`);
};

export const downloadUrlToLocalFile = async (url, localPath) => {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    maxRedirects: 5,
    timeout: 120000,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  await ensureDir(path.dirname(localPath));

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(localPath);
    response.data.pipe(writer);
    writer.on('finish', () => resolve(localPath));
    writer.on('error', reject);
  });
};

export const downloadSourceValueToTempFile = async (sourceValue, {
  prefix = 'arquivo',
  fallbackName = 'arquivo.bin',
  mimeType = '',
  folder = 'runtime',
} = {}) => {
  const candidateUrls = buildSourceUrlCandidates(sourceValue);
  let lastError = null;

  for (const candidateUrl of candidateUrls) {
    try {
      const derivedName = (() => {
        try {
          const parsed = new URL(candidateUrl);
          return path.basename(parsed.pathname) || fallbackName;
        } catch {
          return fallbackName;
        }
      })();

      const tempPath = await createTempFilePath({
        prefix,
        originalName: derivedName || fallbackName,
        mimeType,
        fallbackExtension: inferExtension({ originalName: fallbackName, mimeType, fallback: '.tmp' }),
        folder,
      });

      await downloadUrlToLocalFile(candidateUrl, tempPath);
      return tempPath;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    lastError?.message
      ? `Não foi possível acessar o arquivo de mídia (${lastError.message})`
      : 'Não foi possível acessar o arquivo de mídia'
  );
};

export const cloneMediaReferenceForUser = async (sourceValue, {
  userId,
  category = 'media',
  prefix = 'arquivo',
  fallbackName = 'arquivo.bin',
  mimeType = '',
} = {}) => {
  const rawValue = String(sourceValue || '').trim();
  if (!rawValue) return null;

  if (!isLegacyUploadReference(rawValue)) {
    return rawValue;
  }

  const tempPath = await downloadSourceValueToTempFile(rawValue, {
    prefix,
    fallbackName,
    mimeType,
    folder: 'clone',
  });

  const storagePath = buildStorageObjectPath({
    category,
    userId,
    prefix,
    originalName: fallbackName,
    mimeType,
    fallbackExtension: inferExtension({ originalName: fallbackName, mimeType, fallback: '.bin' }),
  });

  try {
    const uploaded = await uploadLocalFileToStorage({
      localPath: tempPath,
      storagePath,
      contentType: inferContentType({ originalName: fallbackName, mimeType }),
    });

    return uploaded.publicUrl;
  } finally {
    await removeLocalFileSilently(tempPath);
  }
};
