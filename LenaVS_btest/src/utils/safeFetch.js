// src/utils/safeFetch.js
// Wrapper que escolhe fetch global ou http.request conforme o ambiente.

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export async function fetchToBuffer(urlString, { maxBytes = 200 * 1024 * 1024, timeoutMs = 60000 } = {}) {
  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(urlString, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ao baixar ${urlString}`);
      }
      const ab = await res.arrayBuffer();
      if (ab.byteLength > maxBytes) {
        throw new Error(`Arquivo de ${ab.byteLength} bytes excede o limite (${maxBytes}).`);
      }
      return Buffer.from(ab);
    } finally {
      clearTimeout(t);
    }
  }
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlString); } catch (e) { reject(e); return; }
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(urlString, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        reject(new Error(`HTTP ${res.statusCode} ao baixar ${urlString}`));
        res.resume();
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > maxBytes) {
          req.destroy(new Error('Limite de bytes excedido.'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timeout no download.')));
  });
}
