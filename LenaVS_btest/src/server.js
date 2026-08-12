// src/server.js — LenaVS Backend v2
// Bootstrap Express, sem nenhuma dependência Python.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';

import lyricsRoutes from './routes/lyrics.js';
import mediaRoutes from './routes/media.js';
import healthRoutes from './routes/health.js';
import videoRoutes from './routes/video.js';

import { ensureTmpDir } from './services/audioDownloader.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || '0.0.0.0';

/* ---------- CORS ---------- */
const allowed = new Set(
  String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .concat([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ])
);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowed.has(origin)) return true;
  return (
    /^https:\/\/(.+\.)?lenavs\.com$/i.test(origin) ||
    /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  );
};

app.use(
  cors({
    origin(origin, cb) {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error('Origem não permitida pelo CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);
app.options('*', cors());

/* ---------- Security ---------- */
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // desativado para dev; frontend está em outro host
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  })
);

app.use(morgan('combined'));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/* ---------- Rotas ---------- */
app.use('/', healthRoutes);
app.use('/api', healthRoutes);
app.use('/api/lyrics', lyricsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/video', videoRoutes);

/* ---------- 404 ---------- */
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada', path: req.originalUrl });
});

/* ---------- Erros ---------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({
    code: err.code || 'INTERNAL_ERROR',
    error:
      status < 500
        ? err.message || 'Requisição inválida.'
        : 'Erro no sistema. Tente novamente mais tarde.',
  });
});

/* ---------- Start ---------- */
(async () => {
  try {
    await ensureTmpDir();
    app.listen(PORT, HOST, () => {
      // eslint-disable-next-line no-console
      console.log(`LenaVS Backend v2 ouvindo em http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('Falha ao iniciar:', err);
    process.exit(1);
  }
})();
