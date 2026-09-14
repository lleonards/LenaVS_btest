import express from 'express';
import {
  createPaymentSession,
  getSubscriptionStatus,
} from '../controllers/paymentController.js';
import { createBillingPortalSession } from '../controllers/billingPortalController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// ─── Rotas autenticadas ────────────────────────────────────────────────────────
// Os webhooks /webhook/stripe, /webhook e /webhook/pagarme são registrados
// diretamente no server.js com express.raw(), ANTES do body parser JSON.
// Não os duplique aqui.

router.post('/create-session', authenticateToken, createPaymentSession);
router.post('/billing-portal', authenticateToken, createBillingPortalSession);
router.get('/subscription', authenticateToken, getSubscriptionStatus);

export default router;
