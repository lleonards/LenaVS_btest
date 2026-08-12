// src/services/vadEnergy.js
// Voice Activity Detection 100% JavaScript baseado em energia RMS + ZCR.
// Sem modelo neural, sem download de binário pesado. Funciona em qualquer Node ≥ 18.

const FRAME_MS = 20;          // janela curta
const HOP_MS = 10;            // passo
const MIN_SEG_MS = 250;       // tamanho mínimo de segmento vocal
const PAD_MS = 80;            // padding nas bordas do segmento
const MERGE_GAP_MS = 300;     // une segmentos separados por gaps menores que isto

/**
 * @param {Float32Array} pcm sample @ 16 kHz mono
 * @param {number} sampleRate
 */
export function detectVocalSegments(pcm, sampleRate) {
  const frameSize = Math.round((FRAME_MS / 1000) * sampleRate);
  const hopSize = Math.round((HOP_MS / 1000) * sampleRate);

  const rms = new Float32Array(Math.ceil(pcm.length / hopSize));
  const zcr = new Float32Array(rms.length);

  // 1) calcula RMS e ZCR por frame
  for (let i = 0; i < rms.length; i++) {
    const start = i * hopSize;
    const end = Math.min(start + frameSize, pcm.length);
    if (end <= start) break;
    let sumSq = 0;
    let crosses = 0;
    let prevSign = 0;
    for (let j = start; j < end; j++) {
      const v = pcm[j];
      sumSq += v * v;
      const sign = v > 0 ? 1 : v < 0 ? -1 : 0;
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) crosses++;
      prevSign = sign;
    }
    rms[i] = Math.sqrt(sumSq / Math.max(1, end - start));
    zcr[i] = crosses / Math.max(1, end - start);
  }

  // 2) thresholds adaptativos (percentis) — funciona para música FRACA e FORTE
  const sortedRms = Array.from(rms).sort((a, b) => a - b);
  const p = (q) => sortedRms[Math.min(sortedRms.length - 1, Math.max(0, Math.floor(q * sortedRms.length)))] || 0;
  const noiseFloor = Math.max(p(0.10), 0.001);
  const adaptiveThr = Math.max(noiseFloor * 3.0, p(0.55) * 0.5 + noiseFloor);
  const zcrThr = 0.35; // vozes cantadas têm ZCR menor que percussão aguda

  // 3) classifica cada frame como vocal
  const isVocal = new Uint8Array(rms.length);
  for (let i = 0; i < rms.length; i++) {
    const e = rms[i] >= adaptiveThr;
    const z = zcr[i] <= zcrThr;
    isVocal[i] = e && z ? 1 : 0;
  }

  // 4) colapsa em segmentos contíguos
  const rawSegments = [];
  let curStart = -1;
  for (let i = 0; i < isVocal.length; i++) {
    if (isVocal[i]) {
      if (curStart < 0) curStart = i;
    } else if (curStart >= 0) {
      rawSegments.push([curStart, i - 1]);
      curStart = -1;
    }
  }
  if (curStart >= 0) rawSegments.push([curStart, isVocal.length - 1]);

  // 5) descarta segmentos muito curtos, adiciona padding, funde gaps pequenos
  const minFrames = Math.ceil(MIN_SEG_MS / HOP_MS);
  const padFrames = Math.ceil(PAD_MS / HOP_MS);
  const mergeFrames = Math.ceil(MERGE_GAP_MS / HOP_MS);

  const filtered = rawSegments
    .filter(([s, e]) => (e - s + 1) >= minFrames)
    .map(([s, e]) => [Math.max(0, s - padFrames), e + padFrames]);

  const merged = [];
  for (const seg of filtered) {
    if (merged.length === 0) {
      merged.push(seg);
      continue;
    }
    const last = merged[merged.length - 1];
    if (seg[0] - last[1] <= mergeFrames) {
      last[1] = seg[1];
    } else {
      merged.push(seg);
    }
  }

  // 6) converte frames → segundos
  const segments = merged.map(([s, e]) => [
    Math.max(0, (s * hopSize) / sampleRate),
    Math.min(pcm.length / sampleRate, (e * hopSize) / sampleRate),
  ]);

  const totalDuration = pcm.length / sampleRate;
  const vocalDuration = segments.reduce((acc, [a, b]) => acc + Math.max(0, b - a), 0);
  const vocalRatio = totalDuration > 0 ? vocalDuration / totalDuration : 0;

  return {
    segments,
    totalDurationSec: totalDuration,
    vocalDurationSec: vocalDuration,
    vocalRatio,
    noiseFloor,
    adaptiveThr,
    method: 'energy-vad',
  };
}
