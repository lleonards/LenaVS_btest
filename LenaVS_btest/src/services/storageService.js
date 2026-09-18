import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { supabase } from '../config/supabase.js';

// =========================================================
// BUCKETS
// ---------------------------------------------------------
// VIDEOS        -> privado  (projetos privados / históricos)
// VIDEOS_PUBLICOS -> público (projetos publicados na Biblioteca)
// ATENÇÃO: nomes de bucket no Supabase são SENSÍVEIS A MAIÚSCULAS.
// =========================================================
export const PRIVATE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'VIDEOS';
export const PUBLIC_STORAGE_BUCKET = process.env.SUPABASE_PUBLIC_STORAGE_BUCKET || 'VIDEOS_PUBLICOS';

// Compatibilidade com código legado que importa STORAGE_BUCKET
export const STORAGE_BUCKET = PRIVATE_STORAGE_BUCKET;

export const DEFAULT_SIGNED_URL_TTL_SECONDS = Math.max(
  60,
  Number(process.env.SUPABASE_SIGNED_URL_TTL) || 60 * 60 * 24 * 7
);

const normalizeBucketName = (bucket) => String(bucket || PRIVATE_STORAGE_BUCKET || '').trim();

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

/* =========================================================
   URLS: PÚBLICA x ASSINADA (SIGNED)
========================================================= */

export const getStoragePublicUrl = (storagePath, bucket = PUBLIC_STORAGE_BUCKET) => {
  if (!storagePath) return null;
  const { data } = supabase.storage.from(normalizeBucketName(bucket)).getPublicUrl(storagePath);
  return data?.publicUrl || null;
};

/**
 * Gera URL assinada (temporária) para um objeto PRIVADO.
 * Nunca use getPublicUrl em bucket privado — o Supabase responde HTTP 400
 * ("Failed to load resource") e o áudio/vídeo não carrega.
 */
export const getStorageSignedUrl = async (storagePath, {
  bucket = PRIVATE_STORAGE_BUCKET,
  expiresIn = DEFAULT_SIGNED_URL_TTL_SECONDS,
} = {}) => {
  if (!storagePath) return null;

  const safeExpiresIn = Math.max(60, Number(expiresIn) || DEFAULT_SIGNED_URL_TTL_SECONDS);
  const { data, error } = await supabase.storage
    .from(normalizeBucketName(bucket))
    .createSignedUrl(storagePath, safeExpiresIn);

  if (error) throw error;
  return data?.signedUrl || null;
};

/**
 * Extrai bucket + caminho de uma URL do Supabase Storage.
 * Suporta /object/public/, /object/sign/ e /object/authenticated/.
 */
export const parseSupabaseStorageUrl = (value) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) return null;

  try {
    const parsedUrl = new URL(rawValue);
    const match = parsedUrl.pathname.match(/\/storage\/v1\/object\/(public|sign|authenticated)\/([^/]+)\/(.+)$/i);
    if (!match) return null;

    return {
      access: match[1].toLowerCase(),
      bucket: decodeURIComponent(match[2]),
      storagePath: decodeURIComponent(match[3]),
    };
  } catch {
    return null;
  }
};

/**
 * Resolve QUALQUER referência de mídia em uma URL que o navegador consegue
 * abrir:
 *   - bucket público   -> URL pública
 *   - bucket privado   -> URL assinada (temporária)
 *   - /uploads legado  -> URL do backend (proxy)
 *   - URL externa      -> devolvida como está
 */
export const resolveMediaReference = async (sourceValue, {
  metadata = null,
  expiresIn = DEFAULT_SIGNED_URL_TTL_SECONDS,
} = {}) => {
  const rawValue = String(sourceValue || '').trim();
  if (!rawValue) return null;

  if (isLegacyUploadReference(rawValue)) return rawValue;

  // 1) O METADADO (bucket + storagePath) é a fonte de verdade: ele permite
  //    re-assinar sempre a partir do bucket correto, mesmo que a URL salva no
  //    config já tenha expirado.
  const metadataBucket = String(metadata?.bucket || '').trim();
  const metadataStoragePath = String(metadata?.storagePath || '').trim();

  if (metadataStoragePath) {
    if (metadataBucket && metadataBucket === PUBLIC_STORAGE_BUCKET) {
      return getStoragePublicUrl(metadataStoragePath, PUBLIC_STORAGE_BUCKET) || rawValue;
    }

    try {
      const signedUrl = await getStorageSignedUrl(metadataStoragePath, {
        bucket: metadataBucket || PRIVATE_STORAGE_BUCKET,
        expiresIn,
      });
      if (signedUrl) return signedUrl;
    } catch (error) {
      console.warn('Não foi possível assinar a mídia privada, usando referência original:', error.message);
    }
  }

  // 2) Sem metadado, tenta interpretar a própria referência (URL do Supabase).
  const parsedRawReference = parseSupabaseStorageUrl(rawValue);

  if (parsedRawReference) {
    if (parsedRawReference.bucket === PUBLIC_STORAGE_BUCKET) {
      return getStoragePublicUrl(parsedRawReference.storagePath, PUBLIC_STORAGE_BUCKET) || rawValue;
    }

    // URL pública de bucket PRIVADO -> errada (causa HTTP 400). Re-assina.
    try {
      const signedUrl = await getStorageSignedUrl(parsedRawReference.storagePath, {
        bucket: parsedRawReference.bucket,
        expiresIn,
      });
      if (signedUrl) return signedUrl;
    } catch (error) {
      console.warn('Não foi possível assinar a mídia referenciada por URL:', error.message);
    }
  }

  const parsedReference = parseSupabaseStorageUrl(rawValue);

  if (parsedReference) {
    if (parsedReference.bucket === PUBLIC_STORAGE_BUCKET) {
      return getStoragePublicUrl(parsedReference.storagePath, PUBLIC_STORAGE_BUCKET) || rawValue;
    }

    try {
      const signedUrl = await getStorageSignedUrl(parsedReference.storagePath, {
        bucket: parsedReference.bucket,
        expiresIn,
      });
      if (signedUrl) return signedUrl;
    } catch (error) {
      console.warn('Não foi possível assinar a mídia referenciada por URL:', error.message);
    }
  }

  if (isHttpUrl(rawValue)) return rawValue;

  try {
    const signedUrl = await getStorageSignedUrl(rawValue.replace(/^\/+/, ''), {
      bucket: PRIVATE_STORAGE_BUCKET,
      expiresIn,
    });
    if (signedUrl) return signedUrl;
  } catch (error) {
    console.warn('Não foi possível assinar o caminho de storage informado:', error.message);
  }

  return rawValue;
};

/* =========================================================
   CÓPIA / REMOÇÃO ENTRE BUCKETS (publish x unpublish)
========================================================= */

export const copyStorageObject = async ({ sourceBucket, sourcePath, targetBucket, targetPath }) => {
  if (!sourcePath || !targetPath) {
    throw new Error('Caminho de origem/destino ausente ao copiar mídia.');
  }

  const normalizedSourceBucket = normalizeBucketName(sourceBucket);
  const normalizedTargetBucket = normalizeBucketName(targetBucket);

  const { data, error } = await supabase.storage
    .from(normalizedSourceBucket)
    .download(sourcePath);

  if (error) throw error;
  if (!data) throw new Error('Objeto de origem não encontrado no storage.');

  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = inferContentType({
    originalName: targetPath || sourcePath,
    mimeType: data.type || '',
  });

  const { error: uploadError } = await supabase.storage
    .from(normalizedTargetBucket)
    .upload(targetPath, buffer, {
      contentType,
      upsert: true,
      cacheControl: '31536000',
    });

  if (uploadError) throw uploadError;

  return { bucket: normalizedTargetBucket, storagePath: targetPath };
};

export const removeStorageObject = async ({ storagePath, bucket = PRIVATE_STORAGE_BUCKET }) => {
  if (!storagePath) return;
  const { error } = await supabase.storage.from(normalizeBucketName(bucket)).remove([storagePath]);
  if (error) throw error;
};

const buildUploadResult = async ({ bucket, storagePath, contentType }) => {
  const normalizedBucket = normalizeBucketName(bucket);
  const isPublicBucket = normalizedBucket === PUBLIC_STORAGE_BUCKET;

  const publicUrl = isPublicBucket ? getStoragePublicUrl(storagePath, normalizedBucket) : null;
  let signedUrl = null;

  if (!isPublicBucket) {
    try {
      signedUrl = await getStorageSignedUrl(storagePath, { bucket: normalizedBucket });
    } catch (error) {
      console.warn('Não foi possível gerar URL assinada para o arquivo enviado:', error.message);
    }
  }

  return {
    bucket: normalizedBucket,
    storagePath,
    publicUrl,
    signedUrl,
    // `url` é sempre a URL utilizável imediatamente pelo navegador
    url: publicUrl || signedUrl || null,
    contentType,
  };
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
  bucket = PRIVATE_STORAGE_BUCKET,
} = {}) => {
  const normalizedBucket = normalizeBucketName(bucket);
  const stream = fs.createReadStream(localPath);

  try {
    const { error } = await supabase.storage.from(normalizedBucket).upload(storagePath, stream, {
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

  const result = await buildUploadResult({ bucket: normalizedBucket, storagePath, contentType });

  if (!result.url) {
    throw new Error('Não foi possível gerar a URL do arquivo enviado.');
  }

  return result;
};

export const uploadRequestFileToStorage = async (file, {
  userId,
  category = 'media',
  prefix = 'arquivo',
  fallbackExtension = '.bin',
  bucket = PRIVATE_STORAGE_BUCKET,
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
      bucket,
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

export const buildSourceUrlCandidates = async (sourceValue) => {
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
    // Uma URL pública de bucket PRIVADO (ex.: /object/public/VIDEOS/...) precisa
    // ser convertida em URL assinada, senão o Supabase responde 400.
    candidates.push(await resolveMediaReference(rawValue));
  }

  const normalizedStoragePath = rawValue.replace(/^\/+/, '');
  if (
    normalizedStoragePath
    && !isHttpUrl(rawValue)
    && !rawValue.startsWith('/uploads/')
    && !legacyRelativePath
  ) {
    try {
      const signedUrl = await getStorageSignedUrl(normalizedStoragePath, {
        bucket: PRIVATE_STORAGE_BUCKET,
      });
      if (signedUrl) candidates.push(signedUrl);
    } catch {
      // segue para a tentativa pública abaixo
    }

    const storagePublicUrl = getStoragePublicUrl(normalizedStoragePath, PUBLIC_STORAGE_BUCKET);
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
  const candidateUrls = await buildSourceUrlCandidates(sourceValue);
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

const signPrivatePath = async (storagePath) => {
  if (!storagePath) return null;

  try {
    return await getStorageSignedUrl(storagePath, { bucket: PRIVATE_STORAGE_BUCKET });
  } catch (error) {
    console.warn('Não foi possível assinar mídia clonada:', error.message);
    return null;
  }
};

/**
 * Clona a referência de mídia de um projeto da Biblioteca para o usuário que
 * está fazendo a cópia (fork):
 *   - /uploads legado        -> baixa e reenvia para o bucket privado
 *   - bucket PÚBLICO         -> copia para o bucket PRIVADO do usuário
 *   - caminho/URL privado    -> devolve URL assinada (mesmo arquivo)
 *   - URL externa            -> devolvida como está
 *
 * Retorna sempre { url, storagePath, bucket }.
 */
export const cloneMediaReferenceForUser = async (sourceValue, {
  userId,
  category = 'media',
  prefix = 'arquivo',
  fallbackName = 'arquivo.bin',
  mimeType = '',
} = {}) => {
  const rawValue = String(sourceValue || '').trim();
  if (!rawValue) return null;

  // 1) Referência legada (/uploads) — baixa e reenvia para o bucket privado
  if (isLegacyUploadReference(rawValue)) {
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
        bucket: PRIVATE_STORAGE_BUCKET,
      });

      return {
        url: uploaded.url,
        storagePath: uploaded.storagePath,
        bucket: uploaded.bucket,
      };
    } finally {
      await removeLocalFileSilently(tempPath);
    }
  }

  const parsedReference = parseSupabaseStorageUrl(rawValue);

  // 2) Mídia no bucket PÚBLICO — copia para o bucket privado do usuário.
  //    Assim a cópia continua funcionando mesmo se o projeto original voltar
  //    a ser privado.
  if (parsedReference && parsedReference.bucket === PUBLIC_STORAGE_BUCKET) {
    const storagePath = buildStorageObjectPath({
      category,
      userId,
      prefix,
      originalName: fallbackName,
      mimeType,
      fallbackExtension: inferExtension({ originalName: fallbackName, mimeType, fallback: '.bin' }),
    });

    try {
      await copyStorageObject({
        sourceBucket: PUBLIC_STORAGE_BUCKET,
        sourcePath: parsedReference.storagePath,
        targetBucket: PRIVATE_STORAGE_BUCKET,
        targetPath: storagePath,
      });

      const signedUrl = await signPrivatePath(storagePath);

      return {
        url: signedUrl || rawValue,
        storagePath,
        bucket: PRIVATE_STORAGE_BUCKET,
      };
    } catch (error) {
      console.warn('Falha ao copiar mídia pública para o bucket privado:', error.message);

      return {
        url: rawValue,
        storagePath: parsedReference.storagePath,
        bucket: PUBLIC_STORAGE_BUCKET,
      };
    }
  }

  // 3) Caminho de storage privado (sem URL) — devolve URL assinada
  if (!isHttpUrl(rawValue)) {
    const storagePath = rawValue.replace(/^\/+/, '');
    const signedUrl = await signPrivatePath(storagePath);

    return {
      url: signedUrl || rawValue,
      storagePath,
      bucket: PRIVATE_STORAGE_BUCKET,
    };
  }

  // 4) URL externa ou já assinada — devolve como está
  return {
    url: rawValue,
    storagePath: parsedReference?.storagePath || null,
    bucket: parsedReference?.bucket || null,
  };
};
