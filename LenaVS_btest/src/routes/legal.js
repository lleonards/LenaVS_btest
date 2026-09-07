import express from 'express';
import { privacyPolicy } from '../data/privacyPolicy.js';

const router = express.Router();

router.get('/privacy-policy', (req, res) => {
  res.json({
    success: true,
    data: privacyPolicy,
  });
});

export default router;
