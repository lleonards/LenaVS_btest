import express from 'express';
import {
  createInstrumental,
  syncLyricsWithWhisper,
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

// Sincroniza os tempos dos blocos da letra usando WhisperX
router.post(
  '/sync-lyrics',
  authenticateToken,
  requireActiveAccess,
  syncLyricsWithWhisper
);

export default router;
