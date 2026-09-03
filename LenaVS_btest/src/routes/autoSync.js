import express from 'express';
import { autoSyncLyrics } from '../controllers/autoSyncController.js';

import { authenticateToken } from '../middleware/auth.js';
import { requireActiveAccess } from '../middleware/requireActiveAccess.js';

const router = express.Router();

// Sincronização automática usando o Lyrics Aligner (forced alignment palavra-por-palavra)
router.post(
  '/auto-sync',
  authenticateToken,
  requireActiveAccess,
  autoSyncLyrics
);

export default router;
