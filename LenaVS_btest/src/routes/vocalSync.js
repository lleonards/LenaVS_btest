import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireActiveAccess } from '../middleware/requireActiveAccess.js';
import { synchronizeVocalBlocks } from '../controllers/vocalSyncController.js';
const router = express.Router();
router.post('/', authenticateToken, requireActiveAccess, synchronizeVocalBlocks);
export default router;
