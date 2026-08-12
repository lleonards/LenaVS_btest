import express from 'express';
import {
  processManualLyrics,
  processLyricsFileUpload,
  synchronizeLyrics,
} from '../controllers/lyricsController.js';

import { authenticateToken } from '../middleware/auth.js';
import { requireActiveAccess } from '../middleware/requireActiveAccess.js';
import { handleUploadError, upload } from '../middleware/upload.js';

const router = express.Router();

router.post(
  '/manual',
  authenticateToken,
  requireActiveAccess,
  processManualLyrics
);

router.post(
  '/upload',
  authenticateToken,
  requireActiveAccess,
  upload.single('letra'),
  handleUploadError,
  processLyricsFileUpload
);

router.post(
  '/sync',
  authenticateToken,
  requireActiveAccess,
  synchronizeLyrics
);

export default router;
