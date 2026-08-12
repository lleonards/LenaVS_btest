// src/services/decoder.js
// Decodifica QUALQUER áudio (mp3, m4a, ogg, wav…) em PCM float32 mono @ 16 kHz,
// usando o binário do ffmpeg-static que vem embutido em node_modules.
//
// Não há dependência Python. O retorno é um Float32Array + metadados.

import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import ffmpegStaticPath from 'ffmpeg-static';

const TARGET_SR = 16000;
const TARGET_CH = 1;

/**
 * Inicia o ffmpeg com `args` e `stdinPayload` (Buffer opcional para entrada via pipe).
 * Retorna uma promise que resolve com o stdout concatenado em Buffer.
 */
function runFfmpeg(args, stdinPayload = null) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegStaticPath || 'ffmpeg';
    const ff = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    if (stdinPayload) {
      ff.stdin.write(stdinPayload);
      ff.stdin.end();
    } else {
      ff.stdin.end();
    }

    const chunks = [];
    const stderrChunks = [];
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => stderrChunks.push(c));

    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(0, 400)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * @param {Buffer} inputBuffer  arquivo de áudio arbitrário
 * @param {object} [opts]
 * @param {number} [opts.targetSampleRate=16000]
 * @param {number} [opts.targetChannels=1]
 * @returns {Promise<{ pcm: Float32Array, sampleRate: number, durationSec: number, channels: number }>}
 */
export async function decodeToPcm16kMono(inputBuffer, opts = {}) {
  const sampleRate = opts.targetSampleRate ?? TARGET_SR;
  const channels = opts.targetChannels ?? TARGET_CH;

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', 'pipe:0',
    '-ac', String(channels),
    '-ar', String(sampleRate),
    '-f', 'f32le',
    'pipe:1',
  ];

  const stdout = await runFfmpeg(args, inputBuffer);
  const pcm = new Float32Array(
    stdout.buffer,
    stdout.byteOffset,
    stdout.length / Float32Array.BYTES_PER_ELEMENT
  );
  const durationSec = pcm.length / sampleRate;

  return { pcm, sampleRate, durationSec, channels };
}

export { runFfmpeg };
