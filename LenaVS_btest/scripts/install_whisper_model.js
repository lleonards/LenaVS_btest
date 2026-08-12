// scripts/install_whisper_model.js
// (Opcional) baixa um modelo Whisper.cpp para uma precisão maior.
// O backend v2 já funciona SEM Whisper — este script é só upgrade opcional.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODELS = {
  tiny: { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin', size: '~75 MB' },
  base: { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin', size: '~140 MB' },
  small: { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', size: '~460 MB' },
};

const target = (process.argv[2] || 'base').toLowerCase();
const info = MODELS[target];
if (!info) {
  console.error(`Modelo inválido: ${target}. Use tiny, base ou small.`);
  process.exit(1);
}

const outDir = path.resolve(__dirname, '..', 'models');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `ggml-${target}.bin`);
if (fs.existsSync(outPath)) {
  console.log(`Modelo já existe em ${outPath}. Nada a fazer.`);
  process.exit(0);
}

console.log(`Baixando ${target} (${info.size}) para ${outPath}...`);

const file = fs.createWriteStream(outPath);
https.get(info.url, { headers: { 'User-Agent': 'lena-vs-backend/2.0' } }, (res) => {
  if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    https.get(res.headers.location, (res2) => pipeStream(res2, file));
    return;
  }
  pipeStream(res, file);
});

function pipeStream(src, dst) {
  let total = 0;
  src.on('data', (c) => {
    total += c.length;
    process.stdout.write(`\r${(total / 1024 / 1024).toFixed(1)} MB baixados…`);
  });
  src.pipe(dst);
  dst.on('finish', () => {
    process.stdout.write('\n');
    console.log('OK');
    process.exit(0);
  });
  src.on('error', (e) => {
    console.error('Falha:', e.message);
    fs.unlinkSync(outPath);
    process.exit(1);
  });
}
