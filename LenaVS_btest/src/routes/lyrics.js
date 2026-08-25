import express from 'express';
import {
  processManualLyrics,
  processLyricsFileUpload,
} from '../controllers/lyricsController.js';
import { autoSyncLyrics } from '../controllers/syncController.js';

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

// Sincronização automática: detecta palavras no áudio e define início/fim
// de cada bloco da letra (MM:SS), sem reorganizar os blocos.
router.post(
  '/auto-sync',
  authenticateToken,
  requireActiveAccess,
  autoSyncLyrics
);

export default router;
