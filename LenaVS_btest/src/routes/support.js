import express from 'express';
import { reportError } from '../controllers/supportController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Relatar erro (autenticação opcional - usuários não logados podem relatar)
router.post('/report-error', optionalAuth, reportError);

export default router;
