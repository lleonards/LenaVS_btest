import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';

import lyricsRoutes from './routes/lyrics.js';
import mediaRoutes from './routes/media.js';
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

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');

const configuredOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_ORIGINS,
  process.env.ALLOWED_ORIGINS,
]
  .filter(Boolean)
  .flatMap((value) => String(value).split(','))
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedOrigins = new Set([
  'https://www.lenavs.com',
  'https://lenavs.com',
  'https://lenavs-frontend.onrender.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...configuredOrigins,
]);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);

  if (allowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  return (
    /^https:\/\/(.+\.)?lenavs\.com$/i.test(normalizedOrigin) ||
    /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(normalizedOrigin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalizedOrigin)
  );
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      // Não transforme uma origem não cadastrada em erro 500. O navegador
      // bloqueará a resposta sem o cabeçalho CORS; o backend continua
      // devolvendo o status real da rota e não mascara a causa do problema.
      callback(null, false);
    }
  },

  credentials: true,

  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
  ],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

// Este middleware fica antes das rotas e também antes do tratamento de erros.
// Assim, respostas 4xx/5xx geradas por autenticação, validação ou por uma
// exceção inesperada continuam legíveis pelo frontend. O pacote `cors` segue
// responsável pelo tratamento completo do preflight abaixo.
app.use((req, res, next) => {
  const requestOrigin = normalizeOrigin(req.headers.origin);

  if (requestOrigin && isAllowedOrigin(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      corsOptions.methods.join(',')
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      corsOptions.allowedHeaders.join(',')
    );
    res.setHeader('Access-Control-Max-Age', String(corsOptions.maxAge));
    res.setHeader('Vary', 'Origin');
  }

  next();
});

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

  const requestOrigin = normalizeOrigin(req.headers.origin);
  if (requestOrigin && isAllowedOrigin(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

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