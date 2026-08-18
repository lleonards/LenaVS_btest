import express from 'express';
import { synchronizeLyricsBlocks } from '../controllers/syncController.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireActiveAccess } from '../middleware/requireActiveAccess.js';
const router = express.Router();
router.post('/', authenticateToken, requireActiveAccess, synchronizeLyricsBlocks);
export default router;
