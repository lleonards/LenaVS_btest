import express from 'express';
import multer from 'multer';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 52428800) },
});

// Stub compatível com o frontend atual — devolve URLs de object URL locais (o frontend
// espera por pelo menos `files` e `metadata`).
router.post(
  '/upload',
  upload.single('file'),
  (_req, res) => {
    if (!_req.file) {
      return res.status(400).json({ code: 'NO_FILE', error: 'Arquivo ausente.' });
    }
    // Esta versão não persiste no storage. Frontend já utiliza o ObjectURL local no estado.
    return res.json({
      success: true,
      files: {},
      metadata: {},
      note: 'Upload aceito; nesta versão o arquivo é mantido pelo navegador via ObjectURL.',
    });
  }
);

export default router;
