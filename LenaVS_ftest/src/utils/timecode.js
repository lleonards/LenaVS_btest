export const DEFAULT_TIMECODE = '00:00';
export const MAX_FIXED_TIMECODE_MINUTES = 99;
export const MAX_FIXED_TIMECODE_SECONDS = (MAX_FIXED_TIMECODE_MINUTES * 60) + 59;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const sanitizeFixedTimecodeInput = (value) => {
  const digits = String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);

  if (digits.length <= 2) {
    return digits;
  }

  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

export const isCompleteFixedTimecode = (value) => /^\d{2}:\d{2}$/.test(String(value ?? '').trim());

export const formatFixedTimecode = (value) => {
  const safe = clamp(Math.floor(Number(value) || 0), 0, MAX_FIXED_TIMECODE_SECONDS);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const parseFixedTimecode = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(Math.floor(value), 0, MAX_FIXED_TIMECODE_SECONDS);
  }

  const raw = String(value ?? '').trim();
  if (!isCompleteFixedTimecode(raw)) return null;

  const [minutesRaw, secondsRaw] = raw.split(':');
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);

  if (!Number.isInteger(minutes) || !Number.isInteger(seconds)) {
    return null;
  }

  if (minutes < 0 || minutes > MAX_FIXED_TIMECODE_MINUTES || seconds < 0 || seconds > 59) {
    return null;
  }

  return (minutes * 60) + seconds;
};

export const normalizeFixedTimecode = (value, fallback = DEFAULT_TIMECODE) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatFixedTimecode(value);
  }

  const sanitized = sanitizeFixedTimecodeInput(value);
  if (!isCompleteFixedTimecode(sanitized)) {
    return fallback;
  }

  const [minutesRaw, secondsRaw] = sanitized.split(':');
  const minutes = clamp(Number(minutesRaw) || 0, 0, MAX_FIXED_TIMECODE_MINUTES);
  const seconds = clamp(Number(secondsRaw) || 0, 0, 59);

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const parseTimecode = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  const fixedTime = parseFixedTimecode(value);
  if (fixedTime !== null) {
    return fixedTime;
  }

  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Math.max(0, Number(raw));
  }

  if (!/^\d{1,2}:\d{1,2}:\d{1,2}(\.\d+)?$/.test(raw)) {
    return null;
  }

  const [hoursRaw, minutesRaw, secondsRaw] = raw.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  return Math.max(0, (hours * 3600) + (minutes * 60) + seconds);
};

export const formatTimecode = (value, { decimals = 0 } = {}) => {
  const safe = Math.max(0, Number(value) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secondsFloat = safe % 60;
  const seconds = Math.floor(secondsFloat);
  const fractionBase = 10 ** decimals;
  const fraction = Math.round((secondsFloat - seconds) * fractionBase);

  let carrySeconds = seconds;
  let carryMinutes = minutes;
  let carryHours = hours;
  let normalizedFraction = fraction;

  if (normalizedFraction >= fractionBase && decimals > 0) {
    normalizedFraction = 0;
    carrySeconds += 1;
  }
  if (carrySeconds >= 60) {
    carrySeconds = 0;
    carryMinutes += 1;
  }
  if (carryMinutes >= 60) {
    carryMinutes = 0;
    carryHours += 1;
  }

  const fractionSuffix = decimals > 0
    ? `.${String(normalizedFraction).padStart(decimals, '0')}`
    : '';

  if (carryHours > 0) {
    return `${String(carryHours).padStart(2, '0')}:${String(carryMinutes).padStart(2, '0')}:${String(carrySeconds).padStart(2, '0')}${fractionSuffix}`;
  }

  return `${String(carryMinutes).padStart(2, '0')}:${String(carrySeconds).padStart(2, '0')}${fractionSuffix}`;
};
