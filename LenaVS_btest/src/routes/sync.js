import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireActiveAccess } from '../middleware/requireActiveAccess.js';
import { synchronizeLyrics } from '../controllers/syncController.js';

const router = express.Router();

router.post('/', authenticateToken, requireActiveAccess, synchronizeLyrics);

export default router;