import express from 'express';
import { createInstrumental } from '../controllers/mediaController.js';
import {
  syncLyricsAutomatically,
  getSyncLyricsStatus,
} from '../controllers/alignmentController.js';
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

/* =====================================================
   🎤 Sincronização automática de letra
   ctc-forced-aligner==1.0.2 (processo filho, 1 thread,
   uma sincronização por vez)
===================================================== */

router.post(
  '/sync-lyrics',
  authenticateToken,
  requireActiveAccess,
  syncLyricsAutomatically
);

// Diagnóstico leve (não processa áudio): fila, memória livre, limite de áudio
router.get(
  '/sync-lyrics/status',
  authenticateToken,
  getSyncLyricsStatus
);

export default router;