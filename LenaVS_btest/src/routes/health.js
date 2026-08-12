import express from 'express';

const router = express.Router();

const buildPayload = () => ({
  success: true,
  status: 'healthy',
  version: '2.0.0',
  timestamp: new Date().toISOString(),
});

router.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'LenaVS Backend API',
    status: 'online',
    version: '2.0.0',
  });
});

router.get('/health', (_req, res) => res.json(buildPayload()));
router.get('/api/health', (_req, res) => res.json(buildPayload()));

export default router;
