import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';

const uploadDir = path.join(os.tmpdir(), 'lenavs', 'incoming-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    cb(null, `${baseName}-${uniqueSuffix}${ext}`);
  },
});

const FILE_RULES = {
  audio: {
    extensions: [
      '.mp3', '.wav', '.ogg', '.oga', '.m4a', '.mp4', '.aac', '.flac', '.wma',
      '.opus', '.weba', '.webm', '.aiff', '.aif', '.amr', '.caf', '.mka',
      '.alac', '.mid', '.midi',
    ],
    mimeTypes: [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg',
      'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/x-flac',
      'audio/x-ms-wma', 'audio/opus', 'audio/webm', 'audio/x-aiff', 'audio/aiff',
      'audio/amr', 'audio/3gpp', 'audio/x-caf', 'audio/x-matroska', 'video/mp4',
    ],
    label: 'áudio',
  },
  video: {
    extensions: [
      '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.mpeg', '.mpg', '.3gp',
      '.ts', '.mts', '.m2ts', '.mxf', '.flv', '.wmv', '.asf', '.ogv', '.vob',
      '.rm', '.rmvb',
    ],
    mimeTypes: [
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm',
      'video/x-m4v', 'video/mpeg', 'video/3gpp', 'video/mp2t', 'video/x-ms-wmv',
      'video/x-flv', 'video/ogg', 'video/x-ms-asf', 'video/mxf',
    ],
    label: 'vídeo',
  },
  image: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
    mimeTypes: [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/webp',
    ],
    label: 'imagem',
  },
  lyrics: {
    extensions: ['.txt', '.lrc', '.srt', '.md', '.rtf', '.docx', '.pdf', '.doc'],
    mimeTypes: [
      'text/plain', 'text/markdown', 'application/rtf', 'text/rtf', 'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream',
    ],
    label: 'letra',
  },
};

const FIELD_RULES_MAP = {
  musicaOriginal: FILE_RULES.audio,
  musicaInstrumental: FILE_RULES.audio,
  video: FILE_RULES.video,
  imagem: FILE_RULES.image,
  letra: FILE_RULES.lyrics,
  avatar: FILE_RULES.image,
};

const isGenericMime = (mime) => (
  !mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream'
);

const isCompatibleMime = (rule, normalizedMime, extension) => {
  if (isGenericMime(normalizedMime) || rule.mimeTypes.includes(normalizedMime)) {
    return true;
  }

  // Mobile browsers and desktop file managers occasionally report a valid
  // media file with a vendor MIME type. The extension is still checked below.
  if (rule === FILE_RULES.audio && (normalizedMime.startsWith('audio/') || normalizedMime === 'video/mp4')) {
    return true;
  }

  if (rule === FILE_RULES.video && normalizedMime.startsWith('video/')) {
    return true;
  }

  if (rule === FILE_RULES.image && normalizedMime.startsWith('image/')) {
    return true;
  }

  return Boolean(extension && rule.extensions.includes(extension) && normalizedMime.includes('octet-stream'));
};

const fileFilter = (req, file, cb) => {
  const rule = FIELD_RULES_MAP[file.fieldname];

  if (!rule) {
    const error = new Error(`Campo de upload não suportado: ${file.fieldname || 'desconhecido'}.`);
    error.code = 'UNSUPPORTED_UPLOAD_FIELD';
    error.fieldName = file.fieldname;
    cb(error);
    return;
  }

  const ext = path.extname(file.originalname).toLowerCase();
  const normalizedMime = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
  const extensionAllowed = rule.extensions.includes(ext);
  const mimeAllowed = isCompatibleMime(rule, normalizedMime, ext);

console.log('[UPLOAD DEBUG]', {
  field: file.fieldname,
  originalname: file.originalname,
  mimetype: file.mimetype,
  normalizedMime,
  ext,
  extensionAllowed,
  mimeAllowed,
});

  if (extensionAllowed && mimeAllowed) {
    cb(null, true);
    return;
  }

  const error = new Error(
    `O arquivo "${file.originalname}" não é um ${rule.label} compatível.`
  );
  error.code = 'UNSUPPORTED_FILE_TYPE';
  error.fieldName = file.fieldname;
  error.fileName = file.originalname;
  error.fileType = ext || normalizedMime || 'sem extensão';
  error.allowedExtensions = rule.extensions;
  cb(error);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 500 * 1024 * 1024,
  },
});

export const uploadFiles = upload.fields([
  { name: 'musicaOriginal', maxCount: 1 },
  { name: 'musicaInstrumental', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'imagem', maxCount: 1 },
  { name: 'letra', maxCount: 1 },
]);

export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        code: 'FILE_TOO_LARGE',
        error: 'O arquivo é muito grande. Escolha um arquivo menor e tente novamente.',
      });
    }
    return res.status(400).json({
      code: err.code || 'UPLOAD_ERROR',
      error: `Não foi possível enviar o arquivo: ${err.message}`,
    });
  }

  if (err) {
    if (err.code === 'UNSUPPORTED_FILE_TYPE') {
      const isLyrics = err.fieldName === 'letra';
      return res.status(415).json({
        code: err.code,
        field: err.fieldName,
        fileName: err.fileName,
        fileType: err.fileType,
        error: `O arquivo "${err.fileName}" não é um formato de ${isLyrics ? 'letra' : 'mídia'} aceito. Verifique a extensão e tente novamente.`,
      });
    }

    return res.status(400).json({
      code: err.code || 'UPLOAD_ERROR',
      field: err.fieldName,
      fileName: err.fileName,
      error: err.message || 'Não foi possível enviar o arquivo.',
    });
  }

  next();
};
