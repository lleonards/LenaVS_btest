import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { spawn } from 'child_process';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ');
const textWeight = (s) => Math.max(1, norm(s).trim().split(/\s+/).filter(Boolean).length + String(s || '').length / 18);

const probe = (file) => new Promise((resolve, reject) => ffmpeg.ffprobe(file, (e, m) => e ? reject(e) : resolve(Number(m?.format?.duration || 0))));
const decodeMono = (file, sampleRate = 16000) => new Promise((resolve, reject) => {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', 'pipe:1']);
  const chunks = []; child.stdout.on('data', c => chunks.push(c));
  child.on('error', reject); child.on('close', code => code ? reject(new Error(`ffmpeg saiu com código ${code}`)) : resolve(Buffer.concat(chunks)));
});

// Local audio analysis: frame energy, zero crossing, spectral-flux proxy and adaptive threshold.
export const detectVocalActivity = async (file, options = {}) => {
  const sampleRate = 16000, frameMs = 25, hopMs = 10;
  const pcm = await decodeMono(file, sampleRate);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const frame = Math.round(sampleRate * frameMs / 1000), hop = Math.round(sampleRate * hopMs / 1000);
  const values = [];
  for (let start = 0; start + frame <= samples.length; start += hop) {
    let sum = 0, crossings = 0, prev = samples[start];
    for (let i = 0; i < frame; i++) { const x = samples[start + i] / 32768; sum += x * x; if ((x >= 0) !== (prev >= 0)) crossings++; prev = x; }
    const rms = Math.sqrt(sum / frame);
    values.push({ t: start / sampleRate, rms, zcr: crossings / frame });
  }
  const sorted = values.map(x => x.rms).sort((a,b) => a-b);
  const noise = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const threshold = Math.max(noise * 1.8, peak * 0.08, 0.008);
  const active = values.map((x, i) => x.rms > threshold && x.rms > (values[i - 1]?.rms || 0) * 0.45);
  const regions = []; let begin = null;
  const close = (i) => { if (begin === null) return; const end = values[Math.min(i, values.length - 1)]?.t + frameMs / 1000 || 0; if (end - begin >= 0.18) regions.push({ start: Number(begin.toFixed(3)), end: Number(end.toFixed(3)), duration: Number((end - begin).toFixed(3)) }); begin = null; };
  active.forEach((on, i) => { if (on && begin === null) begin = values[i].t; if (!on && begin !== null) { const silence = values[i + 1]?.t - values[i]?.t || 0; if (silence > 0.12) close(i); } }); close(values.length - 1);
  // Join short gaps inside continuous singing, preserve instrumental pauses.
  const joined = []; for (const r of regions) { const last = joined[joined.length - 1]; if (last && r.start - last.end < 0.28) { last.end = r.end; last.duration = Number((last.end - last.start).toFixed(3)); } else joined.push({ ...r }); }
  // A sung phrase can be continuously above the VAD threshold. Refine long regions at
  // evidence-based energy valleys (not at equal time intervals) so pauses/syllable
  // boundaries remain available to the ordered block matcher.
  const activeRms = values.filter(x => x.rms > threshold).map(x => x.rms).sort((a,b) => a-b);
  const valley = activeRms[Math.floor(activeRms.length * 0.28)] || threshold;
  const refined = [];
  for (const region of joined) {
    const inside = values.filter(x => x.t >= region.start && x.t <= region.end);
    let segmentStart = region.start;
    for (let i = 2; i < inside.length - 2; i++) {
      const x = inside[i];
      const isValley = x.rms <= valley && x.rms <= inside[i-1].rms && x.rms <= inside[i+1].rms;
      const longEnough = x.t - segmentStart >= 0.45;
      const leavesRoom = region.end - x.t >= 0.45;
      if (isValley && longEnough && leavesRoom) {
        refined.push({ start: Number(segmentStart.toFixed(3)), end: Number(x.t.toFixed(3)), duration: Number((x.t - segmentStart).toFixed(3)) });
        segmentStart = x.t;
      }
    }
    if (region.end - segmentStart >= 0.18) refined.push({ start: Number(segmentStart.toFixed(3)), end: Number(region.end.toFixed(3)), duration: Number((region.end - segmentStart).toFixed(3)) });
  }
  return { duration: Number((samples.length / sampleRate).toFixed(3)), threshold, regions: refined, frameMs, hopMs };
};

const cost = (span, weight, duration, cursor, total) => {
  const target = Math.max(0.35, duration * (weight / total));
  const ratio = Math.abs(Math.log((span.duration + 0.05) / (target + 0.05)));
  const gap = Math.max(0, span.start - cursor);
  return ratio * 0.7 + Math.min(1.2, gap / Math.max(1, duration)) * 0.12;
};

// Ordered block-driven assignment. It emits exactly one result per input block.
export const alignBlocksToRegions = (blocks, analysis) => {
  const input = Array.isArray(blocks) ? blocks : [];
  const regions = analysis.regions || [];
  if (!input.length) return [];
  const weights = input.map(b => textWeight(b?.text)); const totalWeight = weights.reduce((a,b) => a+b, 0);
  const n = input.length, m = regions.length;
  if (!m) return input.map(() => ({ start: null, end: null, confidence: 0, method: 'local-vad' }));
  // DP assigns nondecreasing region indices, permitting a block to span multiple regions (pause included).
  const dp = Array.from({ length: n }, () => Array(m).fill(Infinity)); const prev = Array.from({ length: n }, () => Array(m).fill(-1));
  for (let j=0;j<m;j++) dp[0][j] = cost(regions[j], weights[0], totalWeight, 0, analysis.duration);
  for (let i=1;i<n;i++) for (let j=0;j<m;j++) { for (let k=0;k<=j;k++) { const c = dp[i-1][k] + cost({ start: regions[k].end, end: regions[j].end, duration: Math.max(0.01, regions[j].end - regions[k].end) }, weights[i], totalWeight, regions[k].end, analysis.duration) + (j===k ? 0.08 : 0); if (c < dp[i][j]) { dp[i][j]=c; prev[i][j]=k; } } }
  let j = dp[n-1].reduce((best, v, idx) => v < dp[n-1][best] ? idx : best, 0); const indexes = Array(n); for (let i=n-1;i>=0;i--) { indexes[i]=j; j=prev[i][j]; if (j<0 && i>0) j=0; }
  return input.map((block, i) => { const a = regions[indexes[i]]; const b = regions[indexes[i+1] ?? indexes[i]]; const start = a.start; const end = Math.max(start + 0.18, b?.end || a.end); const confidence = Number(clamp(1 - dp[i][indexes[i]] / Math.max(1, analysis.duration), 0, 1).toFixed(3)); return { id: block.id, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)), confidence, method: 'local-vad-dp' }; });
};

export const syncBlocksFromAudioUrl = async (audioUrl, blocks) => {
  if (!audioUrl) throw new Error('Música Original não encontrada.');
  if (!Array.isArray(blocks) || !blocks.length) throw new Error('A letra processada não possui blocos.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lenavs-sync-')); const ext = path.extname(new URL(audioUrl).pathname) || '.audio'; const file = path.join(dir, `source${ext}`);
  try { const response = await axios.get(audioUrl, { responseType: 'stream', timeout: 120000, maxContentLength: 600 * 1024 * 1024 }); await pipeline(response.data, fs.createWriteStream(file)); const analysis = await detectVocalActivity(file); const assignments = alignBlocksToRegions(blocks, analysis); return { assignments, analysis: { duration: analysis.duration, vocalRegions: analysis.regions, regionCount: analysis.regions.length, detector: 'local-vad-dp' } }; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
