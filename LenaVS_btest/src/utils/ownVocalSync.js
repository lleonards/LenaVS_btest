import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ');
const wordCount = (s) => norm(s).trim() ? norm(s).trim().split(/\s+/).length : 1;
const syllableCount = (s) => Math.max(1, (norm(s).match(/[aeiouy]+/g) || []).length);

const runFfmpegPcm = (input) => new Promise((resolve, reject) => {
  const chunks = [];
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1']);
  ff.stdout.on('data', (c) => chunks.push(c));
  let stderr = '';
  ff.stderr.on('data', (c) => { stderr += c.toString(); });
  ff.on('error', reject);
  ff.on('close', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`FFmpeg não conseguiu decodificar o áudio: ${stderr.slice(-500)}`)));
});

const framesFromPcm = (buffer, sampleRate = 16000, frameMs = 25, hopMs = 10) => {
  const frame = Math.round(sampleRate * frameMs / 1000);
  const hop = Math.round(sampleRate * hopMs / 1000);
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 2));
  const out = [];
  let previousEnergy = 0;
  for (let start = 0; start + frame <= samples.length; start += hop) {
    let sum = 0; let zc = 0; let prev = samples[start];
    for (let i = 0; i < frame; i += 1) {
      const value = samples[start + i] / 32768;
      sum += value * value;
      if ((value >= 0) !== (prev >= 0)) zc += 1;
      prev = value;
    }
    const rms = Math.sqrt(sum / frame);
    const energyDb = 20 * Math.log10(rms + 1e-7);
    const flux = Math.max(0, energyDb - previousEnergy);
    previousEnergy = energyDb;
    const zcr = zc / frame;
    // Cantado tem energia sustentada e zcr baixo/moderado; respingos muito agudos
    // não são suficientes sozinhos para virar uma região vocal.
    const f0 = zcr > 0.015 && zcr < 0.32 ? sampleRate * zcr / 2 : 0;
    out.push({ t: start / sampleRate, rms, db: energyDb, flux, zcr, f0 });
  }
  return out;
};

const mergeRegions = (frames, opts = {}) => {
  if (!frames.length) return [];
  const noise = frames.map(f => f.db).sort((a, b) => a - b)[Math.floor(frames.length * 0.2)] ?? -60;
  const energyThreshold = Math.max(-48, noise + 7);
  const active = frames.map((f, i) => {
    const harmonic = f.f0 >= 70 && f.f0 <= 1100;
    const sustained = f.rms > 0.012 && f.db >= energyThreshold;
    const onset = f.flux > 1.5 && f.db > energyThreshold + 2;
    return sustained && (harmonic || onset || f.zcr < 0.18);
  });
  const smooth = active.map((v, i) => {
    const from = Math.max(0, i - 3); const to = Math.min(active.length, i + 4);
    return active.slice(from, to).filter(Boolean).length >= 3;
  });
  const regions = []; let start = null; const hop = 0.01;
  for (let i = 0; i <= smooth.length; i += 1) {
    const on = i < smooth.length && smooth[i];
    if (on && start === null) start = Math.max(0, frames[i].t - 0.05);
    if (!on && start !== null) {
      const end = Math.min(frames[i - 1].t + 0.025 + 0.08, frames.at(-1).t + 0.2);
      if (end - start >= (opts.minRegionSeconds || 0.18)) regions.push({ start, end });
      start = null;
    }
  }
  // merge gaps shortos (vogais sustentadas e consoantes não quebram o bloco)
  const merged = [];
  for (const r of regions) {
    const last = merged.at(-1);
    if (last && r.start - last.end <= (opts.mergeGapSeconds || 0.32)) last.end = r.end;
    else merged.push({ ...r });
  }
  return merged;
};

const alignBlocks = (blocks, regions, duration) => {
  const n = blocks.length; const m = regions.length;
  if (!n) return [];
  if (!m) return blocks.map((b) => ({ id: b.id, text: b.text, start: null, end: null, confidence: 0, reason: 'nenhuma região vocal detectada' }));
  // DP monotônico. O detector nunca altera, duplica, remove ou reordena blocks.
  const dp = Array.from({ length: n }, () => Array(m).fill(-Infinity));
  const prev = Array.from({ length: n }, () => Array(m).fill(null));
  const targetTotal = blocks.reduce((s, b) => s + syllableCount(b.text), 0);
  const cumulative = [];
  let acc = 0;
  for (const b of blocks) { acc += syllableCount(b.text); cumulative.push(acc / targetTotal); }
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const blockWeight = syllableCount(blocks[i].text);
      const regionDur = Math.max(0.05, regions[j].end - regions[j].start);
      const expected = duration * (i ? cumulative[i - 1] : 0);
      const temporal = Math.exp(-Math.abs(regions[j].start - expected) / Math.max(2, duration * 0.25));
      const durationFit = Math.exp(-Math.abs(regionDur - clamp(blockWeight * 0.28, 0.25, 12)) / 6);
      const score = 0.55 * temporal + 0.25 * durationFit + 0.20;
      if (i === 0) { dp[i][j] = score; continue; }
      for (let k = 0; k < j; k += 1) {
        const gap = regions[j].start - regions[k].end;
        const candidate = dp[i - 1][k] + score + Math.min(0.15, Math.max(0, gap) / Math.max(1, duration) * 0.15);
        if (candidate > dp[i][j]) { dp[i][j] = candidate; prev[i][j] = k; }
      }
    }
  }
  let j = dp[n - 1].reduce((best, v, idx, a) => v > a[best] ? idx : best, 0);
  const chosen = Array(n).fill(null);
  for (let i = n - 1; i >= 0; i -= 1) { chosen[i] = j; j = prev[i][j]; if (j === null && i > 0) j = i - 1; }
  return blocks.map((block, i) => {
    const region = regions[chosen[i]];
    return { id: block.id, text: block.text, start: region?.start ?? null, end: region?.end ?? null, confidence: region ? clamp(dp[i][chosen[i]] / 1.2, 0, 1) : 0, vocalRegionIndex: chosen[i] };
  });
};

export const detectVocalRegionsFromFile = async (audioPath) => {
  const pcm = await runFfmpegPcm(audioPath);
  const frames = framesFromPcm(pcm);
  const regions = mergeRegions(frames);
  const duration = frames.length ? frames.at(-1).t + 0.025 : 0;
  return { duration, frames: frames.map(({ t, db, flux, f0 }) => ({ t, db, flux, f0 })), regions };
};

export const synchronizeExistingBlocks = async (audioPath, blocks) => {
  const safeBlocks = Array.isArray(blocks) ? blocks.map((b) => ({ id: b?.id, text: String(b?.text || '') })) : [];
  const detected = await detectVocalRegionsFromFile(audioPath);
  const assignments = alignBlocks(safeBlocks, detected.regions, detected.duration);
  if (assignments.length !== safeBlocks.length || assignments.some((a, i) => a.id !== safeBlocks[i].id)) {
    throw new Error('Falha de integridade: a sincronização alteraria a quantidade ou a ordem dos blocos.');
  }
  return { ...detected, blocks: assignments };
};

export const toTemporaryAudioFile = async (sourceValue, downloadSourceValueToTempFile) => downloadSourceValueToTempFile(sourceValue, { prefix: 'vocal-sync', fallbackName: 'audio.mp3', mimeType: 'audio/mpeg', folder: 'vocal-sync' });
