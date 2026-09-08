import express from 'express';
import {
  createInstrumental,
  syncLyricsWithAligner,
} from '../controllers/mediaController.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireActiveAccess } from '../middleware/requireActiveAccess.js';

const router = express.Router();

// Gera música instrumental a partir da música original usando Demucs local
router.post(
  '/instrumental',
  authenticateToken,
  requireActiveAccess,
  createInstrumental
);

// Sincroniza os tempos dos blocos da letra usando o Lyrics Aligner
// (ctc-forced-aligner 1.0.2, Python 3.12)
router.post(
  '/sync-lyrics',
  authenticateToken,
  requireActiveAccess,
  syncLyricsWithAligner
);

export default router;
