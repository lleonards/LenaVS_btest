import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  processManualLyrics,
  processLyricsFileUpload,
  synchronizeLyrics,
} from '../controllers/lyricsController.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 52428800),
  },
});

/* --------- validação --------- */
const manualSchema = z.object({
  text: z.string().min(1, 'Texto da letra vazio.').max(200_000),
});

const syncSchema = z.object({
  audioUrl: z
    .string()
    .url()
    .regex(/^https?:\/\//i, 'audioUrl precisa começar com http(s)://'),
  stanzas: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).optional(),
        text: z.string().min(1),
      })
    )
    .min(1, 'Envie ao menos uma estrofe.')
    .max(Number(process.env.MAX_STANZAS_PER_SYNC || 200)),
});

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      error: 'Payload inválido',
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  req.validated = result.data;
  return next();
};

/* --------- endpoints --------- */
router.post('/manual', validate(manualSchema), processManualLyrics);

router.post(
  '/upload',
  upload.single('letra'),
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) {
      return res
        .status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({ code: err.code, error: 'Upload inválido.' });
    }
    return next();
  },
  processLyricsFileUpload
);

router.post('/sync', validate(syncSchema), synchronizeLyrics);

export default router;
