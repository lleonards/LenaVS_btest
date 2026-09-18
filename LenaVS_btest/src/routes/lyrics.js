import express from 'express';
import {
  processManualLyrics,
  processLyricsFileUpload,
} from '../controllers/lyricsController.js';
import {
  syncLyrics,
  getSyncStatus,
  warmupSyncEngine,
} from '../controllers/lyricsSyncController.js';

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

/* =====================================================
   🎯 Sincronização automática de letras
   (tempo por palavra → início/fim de cada bloco)
===================================================== */

router.get(
  '/sync/status',
  authenticateToken,
  getSyncStatus
);

router.post(
  '/sync/warmup',
  authenticateToken,
  requireActiveAccess,
  warmupSyncEngine
);

router.post(
  '/sync',
  authenticateToken,
  requireActiveAccess,
  syncLyrics
);

export default router;
