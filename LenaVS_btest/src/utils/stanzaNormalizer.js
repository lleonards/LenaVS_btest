const DEFAULT_TIMECODE = '00:00';
const DEFAULT_FONT_SIZE = 32;
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 120;
const OUTLINE_WIDTH_MIN = 1;
const OUTLINE_WIDTH_MAX = 10;
const SCALE_X_MIN = 0.6;
const SCALE_X_MAX = 1.8;
const SCALE_Y_MIN = 0.35;
const SCALE_Y_MAX = 4;
const TRANSITION_DURATION_MIN = 0.1;
const TRANSITION_DURATION_MAX = 5;
const VALID_TRANSITIONS = new Set(['fade', 'slide', 'zoom-in', 'zoom-out']);
const VALID_AUDIO_TYPES = new Set(['original', 'instrumental']);
const VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);

export const DEFAULT_MEDIA_ANIMATION = {
  introTransition: 'fade',
  introDuration: 0.8,
  outroTransition: 'fade',
  outroDuration: 0.8,
  loopTransition: 'fade',
  loopTransitionDuration: 0.4,
};

const DEFAULT_POSITION = {
  x: 50,
  y: 78,
};

const DEFAULT_TRANSFORM = {
  scaleX: 1,
  scaleY: 1,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeHexColor = (value, fallback) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : fallback;
};

const splitLines = (text = '') => String(text ?? '').replace(/\r/g, '').split('\n');

const normalizeScaleX = (value) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_TRANSFORM.scaleX;
  }

  return Number(clamp(numeric, SCALE_X_MIN, SCALE_X_MAX).toFixed(2));
};

const normalizeScaleY = (value) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_TRANSFORM.scaleY;
  }

  return Number(clamp(numeric, SCALE_Y_MIN, SCALE_Y_MAX).toFixed(3));
};

const normalizeOutlineWidth = (value) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 2;
  }

  return Math.round(clamp(numeric, OUTLINE_WIDTH_MIN, OUTLINE_WIDTH_MAX));
};

const normalizeFontSize = (value) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_FONT_SIZE;
  }

  return Math.round(clamp(numeric, FONT_SIZE_MIN, FONT_SIZE_MAX));
};

const normalizeAlignment = (value) => {
  const normalized = String(value || 'center').trim().toLowerCase();
  return VALID_ALIGNMENTS.has(normalized) ? normalized : 'center';
};

const normalizeTransition = (value) => {
  const normalized = String(value || 'fade').trim().toLowerCase();
  return VALID_TRANSITIONS.has(normalized) ? normalized : 'fade';
};

const normalizeTransitionDuration = (value) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 1;
  }

  return Number(clamp(numeric, TRANSITION_DURATION_MIN, TRANSITION_DURATION_MAX).toFixed(2));
};

const normalizeLineStyle = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const style = {};

  if (value.fontFamily !== undefined) {
    style.fontFamily = String(value.fontFamily || 'Montserrat');
  }

  if (value.color !== undefined) {
    style.color = normalizeHexColor(value.color, '#FFFFFF');
  }

  if (value.outlineColor !== undefined) {
    style.outlineColor = normalizeHexColor(value.outlineColor, '#000000');
  }

  if (value.outlineWidth !== undefined) {
    style.outlineWidth = normalizeOutlineWidth(value.outlineWidth);
  }

  if (value.bold !== undefined) {
    style.bold = Boolean(value.bold);
  }

  if (value.italic !== undefined) {
    style.italic = Boolean(value.italic);
  }

  if (value.underline !== undefined) {
    style.underline = Boolean(value.underline);
  }

  if (value.alignment !== undefined) {
    style.alignment = normalizeAlignment(value.alignment);
  }

  return style;
};

const normalizeLineStyles = (lineStyles = {}, text = '') => {
  if (!lineStyles || typeof lineStyles !== 'object' || Array.isArray(lineStyles)) {
    return {};
  }

  const lineCount = splitLines(text).length;
  const maxIndex = Math.max(0, lineCount - 1);

  return Object.entries(lineStyles).reduce((accumulator, [rawIndex, rawStyle]) => {
    const index = Number(rawIndex);

    if (!Number.isInteger(index) || index < 0 || index > maxIndex) {
      return accumulator;
    }

    const normalizedStyle = normalizeLineStyle(rawStyle);
    if (!Object.keys(normalizedStyle).length) {
      return accumulator;
    }

    accumulator[index] = normalizedStyle;
    return accumulator;
  }, {});
};

export const normalizeMediaAnimation = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};

  return {
    introTransition: normalizeTransition(source.introTransition ?? DEFAULT_MEDIA_ANIMATION.introTransition),
    introDuration: normalizeTransitionDuration(source.introDuration ?? DEFAULT_MEDIA_ANIMATION.introDuration),
    outroTransition: normalizeTransition(source.outroTransition ?? DEFAULT_MEDIA_ANIMATION.outroTransition),
    outroDuration: normalizeTransitionDuration(source.outroDuration ?? DEFAULT_MEDIA_ANIMATION.outroDuration),
    loopTransition: normalizeTransition(source.loopTransition ?? DEFAULT_MEDIA_ANIMATION.loopTransition),
    loopTransitionDuration: normalizeTransitionDuration(
      source.loopTransitionDuration ?? DEFAULT_MEDIA_ANIMATION.loopTransitionDuration
    ),
  };
};

export const normalizeProjectStanzas = (stanzas = []) => {
  if (!Array.isArray(stanzas)) return [];

  return stanzas.map((stanza, index) => {
    const text = String(stanza?.text || '');

    return {
      id: stanza?.id ?? `stanza-${index + 1}`,
      text,
      startTime: String(stanza?.startTime || DEFAULT_TIMECODE),
      endTime: String(stanza?.endTime || DEFAULT_TIMECODE),
      syncStartTime: Number.isFinite(Number(stanza?.syncStartTime))
        ? Number(stanza.syncStartTime)
        : null,
      syncEndTime: Number.isFinite(Number(stanza?.syncEndTime))
        ? Number(stanza.syncEndTime)
        : null,
      showOnlyDuringVocal: Boolean(stanza?.showOnlyDuringVocal),
      syncConfidence: Number.isFinite(Number(stanza?.syncConfidence))
        ? Number(stanza.syncConfidence)
        : null,
      syncVerified: Boolean(stanza?.syncVerified),
      fontSize: normalizeFontSize(stanza?.fontSize),
      fontFamily: String(stanza?.fontFamily || 'Montserrat'),
      color: normalizeHexColor(stanza?.color, '#FFFFFF'),
      outlineColor: normalizeHexColor(stanza?.outlineColor, '#000000'),
      outlineWidth: normalizeOutlineWidth(stanza?.outlineWidth),
      bold: Boolean(stanza?.bold),
      italic: Boolean(stanza?.italic),
      underline: Boolean(stanza?.underline),
      transition: normalizeTransition(stanza?.transition),
      transitionDuration: normalizeTransitionDuration(stanza?.transitionDuration),
      alignment: normalizeAlignment(stanza?.alignment || 'center'),
      leadIn: Number(stanza?.leadIn ?? 0.5),
      lines: Array.isArray(stanza?.lines) ? stanza.lines : [],
      lineStyles: normalizeLineStyles(stanza?.lineStyles || {}, text),
      hasManualStart: Boolean(stanza?.hasManualStart),
      hasManualEnd: Boolean(stanza?.hasManualEnd),
      isDuplicateCopy: Boolean(stanza?.isDuplicateCopy),
      position: {
        ...DEFAULT_POSITION,
        ...(stanza?.position || {}),
      },
      scaleX: normalizeScaleX(stanza?.scaleX ?? DEFAULT_TRANSFORM.scaleX),
      scaleY: normalizeScaleY(stanza?.scaleY ?? DEFAULT_TRANSFORM.scaleY),
    };
  });
};

export const normalizeProjectPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  const normalizedAudioType = String(payload.audioType || '').trim().toLowerCase();
  const normalizedLockedAudioType = String(payload.lockedAudioType || '').trim().toLowerCase();
  const hasBackgroundMedia = Boolean(payload?.mediaFiles?.video || payload?.mediaFiles?.imagem);

  return {
    ...payload,
    audioType: VALID_AUDIO_TYPES.has(normalizedAudioType) ? normalizedAudioType : 'original',
    lockedAudioType: VALID_AUDIO_TYPES.has(normalizedLockedAudioType) ? normalizedLockedAudioType : null,
    mediaAnimation: hasBackgroundMedia
      ? normalizeMediaAnimation(payload.mediaAnimation || DEFAULT_MEDIA_ANIMATION)
      : { ...DEFAULT_MEDIA_ANIMATION },
    stanzas: normalizeProjectStanzas(payload.stanzas || []),
  };
};
