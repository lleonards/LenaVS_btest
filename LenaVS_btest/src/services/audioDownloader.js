// src/services/audioDownloader.js
import path from 'node:path';
import fs from 'node:fs/promises';
import { fetchToBuffer } from '../utils/safeFetch.js';

const TMP_DIR = path.resolve(process.env.SYNC_TMP_DIR || './tmp');

export async function ensureTmpDir() {
  await fs.mkdir(TMP_DIR, { recursive: true });
}

export async function downloadAudioToBuffer(urlString, opts = {}) {
  await ensureTmpDir();
  return fetchToBuffer(urlString, opts);
}

export function getTmpDir() { return TMP_DIR; }

export async function cleanupTmpFile(filePath) {
  try { await fs.unlink(filePath); } catch { /* ignora */ }
}
