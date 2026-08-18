import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';

import lyricsRoutes from './routes/lyrics.js';
import mediaRoutes from './routes/media.js';
import vocalSyncRoutes from './routes/vocalSync.js';
import videoRoutes from './routes/video.js';
import projectRoutes from './routes/projects.js';
import supportRoutes from './routes/support.js';
import paymentRoutes from './routes/payment.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import legalRoutes from './routes/legal.js';
import multer from 'multer';

import {
  handlePagarmeWebhook,
  handleStripeWebhook,
} from './controllers/paymentController.js';

import { initializeVideoTaskQueue } from './services/videoTaskQueue.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================================================
   CORS
========================================================= */

const allowedOrigins = new Set([
  'https://www.lenavs.com',
  'https://lenavs.com',
  'https://lenavs-frontend.onrender.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',

  ...String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  if (allowedOrigins.has(origin)) {
    return true;
  }

  return (
    /^https:\/\/(.+\.)?lenavs\.com$/i.test(origin) ||
    /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  );
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origem não permitida pelo CORS'));
    }
  },

  credentials: true,

  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
  ],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* =========================================================
   SECURITY HEADERS
========================================================= */

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,

    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },

    contentSecurityPolicy: {
      useDefaults: true,

      directives: {
        defaultSrc: ["'self'"],

        baseUri: ["'self'"],

        fontSrc: [
          "'self'",
          'https:',
          'data:',
        ],

        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https:',
        ],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https:',
        ],

        scriptSrc: [
          "'self'",
          'https://js.stripe.com',
        ],

        connectSrc: [
          "'self'",
          'https://*.supabase.co',
          'https://api.stripe.com',
          'https://js.stripe.com',
          'https://api.pagar.me',
          'https://api.openai.com',
          'wss://*.supabase.co',
        ],

        frameSrc: [
          "'self'",
          'https://js.stripe.com',
          'https://hooks.stripe.com',
        ],

        mediaSrc: [
          "'self'",
          'blob:',
          'data:',
          'https:',
        ],

        objectSrc: ["'none'"],

        frameAncestors: ["'none'"],

        upgradeInsecureRequests: [],
      },
    },

    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },

    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },

    xssFilter: true,

    noSniff: true,

    frameguard: {
      action: 'deny',
    },
  })
);

/* =========================================================
   MIDDLEWARES
========================================================= */

app.use(morgan('combined'));

app.use(compression());

/* =========================================================
   WEBHOOKS
========================================================= */

app.post(
  '/api/payment/webhook/stripe',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);

app.post(
  '/api/payment/webhook',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);

app.post(
  '/api/payment/webhook/pagarme',
  express.raw({ type: 'application/json' }),
  handlePagarmeWebhook
);

/* =========================================================
   BODY PARSER
========================================================= */

app.use(express.json({ limit: '50mb' }));

app.use(
  express.urlencoded({
    extended: true,
    limit: '50mb',
  })
);

/* =========================================================
   HEALTH CHECKS
========================================================= */

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'LenaVS Backend API',
    status: 'online',
  });
});

const buildHealthPayload = () => ({
  success: true,
  status: 'healthy',
  timestamp: new Date().toISOString(),
});

app.get('/health', (req, res) => {
  res.json(buildHealthPayload());
});

app.get('/api/health', (req, res) => {
  res.json(buildHealthPayload());
});

/* =========================================================
   ROUTES
========================================================= */

app.use('/api/auth', authRoutes);

app.use('/api/user', userRoutes);

app.use('/api/legal', legalRoutes);

app.use('/api/lyrics', lyricsRoutes);

app.use('/api/media', mediaRoutes);
app.use('/api/vocal-sync', vocalSyncRoutes);

app.use('/api/video', videoRoutes);

app.use('/api/projects', projectRoutes);

app.use('/api/support', supportRoutes);

app.use('/api/payment', paymentRoutes);

/* =========================================================
   404
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    error: 'Rota não encontrada',
    path: req.originalUrl,
  });
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);

  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      code: err.code || 'UPLOAD_ERROR',
      error: err.code === 'LIMIT_FILE_SIZE'
        ? 'O arquivo é muito grande. Escolha um arquivo menor e tente novamente.'
        : `Não foi possível enviar o arquivo: ${err.message}`,
    });
  }

  res.status(err.status || 500).json({
    error: err.status && err.status < 500
      ? 'Não foi possível concluir a solicitação.'
      : 'Erro no sistema. Tente novamente mais tarde.',
  });
});

/* =========================================================
   START SERVER
========================================================= */

const startServer = async () => {
  try {
    await initializeVideoTaskQueue();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 LenaVS Backend rodando na porta ${PORT}`);

      console.log(
        '🎬 Processamento interno de vídeos inicializado'
      );

      console.log(
        `🗂️ Uploads persistentes via Supabase Storage no bucket ${
          process.env.SUPABASE_STORAGE_BUCKET || 'videos'
        }`
      );
    });
  } catch (error) {
    console.error('Falha ao iniciar servidor:', error);

    process.exit(1);
  }
};

startServer();