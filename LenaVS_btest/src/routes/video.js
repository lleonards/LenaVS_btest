import express from 'express';
import {
  uploadMedia,
  generateVideo,
  getVideoProcessingStatus,
  downloadVideo,
} from '../controllers/videoController.js';

import { authenticateToken } from '../middleware/auth.js';
import { requireActiveAccess } from '../middleware/requireActiveAccess.js';
import { uploadFiles, handleUploadError } from '../middleware/upload.js';

const router = express.Router();

/* =====================================================
   📤 Upload de mídia
===================================================== */

router.post(
  '/upload',
  authenticateToken,
  requireActiveAccess,
  uploadFiles,
  handleUploadError,
  uploadMedia
);

/* =====================================================
   🎬 Gerar vídeo
===================================================== */

router.post(
  '/generate',
  authenticateToken,
  requireActiveAccess,
  generateVideo
);

/* =====================================================
   📊 Status do processamento
===================================================== */

router.get(
  '/status/:taskId',
  authenticateToken,
  getVideoProcessingStatus
);

/* =====================================================
   ⬇ Download de vídeo
===================================================== */

router.get(
  '/download/:fileName',
  authenticateToken,
  downloadVideo
);

export default router;
