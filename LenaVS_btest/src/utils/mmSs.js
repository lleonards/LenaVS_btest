// src/utils/mmSs.js
export function formatSecondsToMmSs(seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function parseMmSsToSeconds(value) {
  if (typeof value !== 'string') return null;
  const m = String(value).match(/^(\d{1,3}):(\d{1,2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
