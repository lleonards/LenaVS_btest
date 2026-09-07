import express from 'express';
import { createInstrumental } from '../controllers/mediaController.js';
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

export default router;
