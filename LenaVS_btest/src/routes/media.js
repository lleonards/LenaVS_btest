import express from 'express';
import { createInstrumental, syncLyricsWithAudio } from '../controllers/mediaController.js';
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

// Sincroniza automaticamente a letra (blocos da LenaVS) com a música original
// usando forced alignment palavra por palavra (100% local e gratuito)
router.post(
  '/sync-lyrics',
  authenticateToken,
  requireActiveAccess,
  syncLyricsWithAudio
);

export default router;
