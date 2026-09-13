import { DEFAULT_TIMECODE, parseFixedTimecode } from './timecode';

export const DEFAULT_STANZA_POSITION = {
  x: 50,
  y: 78,
};

export const DEFAULT_STANZA_TRANSFORM = {
  scaleX: 1,
  scaleY: 1,
};

export const STANZA_FONT_SIZE_MIN = 12;
export const STANZA_FONT_SIZE_MAX = 120;
export const STANZA_SCALE_MIN = 0.35;
export const STANZA_SCALE_MAX = 4;
export const STANZA_WIDTH_SCALE_MIN = 0.6;
export const STANZA_WIDTH_SCALE_MAX = 1.8;
export const STANZA_OUTLINE_WIDTH_MIN = 1;
export const STANZA_OUTLINE_WIDTH_MAX = 10;
export const STANZA_TRANSITION_DURATION_MIN = 0.1;
export const STANZA_TRANSITION_DURATION_MAX = 5;
export const STANZA_TRANSITION_TYPES = ['fade', 'slide', 'zoom-in', 'zoom-out'];
export const STANZA_ALIGNMENT_OPTIONS = ['left', 'center', 'right'];
export const STANZA_LINE_STYLE_FIELDS = [
  'fontFamily',
  'color',
  'outlineColor',
  'outlineWidth',
  'bold',
  'italic',
  'underline',
  'alignment',
];
export const FONT_OPTIONS = [
  {
    label: 'Montserrat',
    value: 'Montserrat',
    previewFamily: "'Montserrat', 'DejaVu Sans', sans-serif",
  },
  {
    label: 'Arial',
    value: 'Arial',
    previewFamily: "'Liberation Sans', Arial, sans-serif",
  },
  {
    label: 'Impact',
    value: 'Impact',
    previewFamily: "'DejaVu Sans Condensed', 'Arial Narrow', Impact, sans-serif",
  },
  {
    label: 'Verdana',
    value: 'Verdana',
    previewFamily: "'DejaVu Sans', Verdana, sans-serif",
  },
  {
    label: 'Georgia',
    value: 'Georgia',
    previewFamily: "'Liberation Serif', Georgia, serif",
  },
  {
    label: 'Courier New',
    value: 'Courier New',
    previewFamily: "'Liberation Mono', 'Courier New', monospace",
  },
];

const PREVIEW_SAFE_AREA = {
  frameHorizontalPadding: 32,
  frameVerticalPadding: 32,
  stanzaHorizontalPadding: 38,
  stanzaVerticalPadding: 30,
  minWidth: 80,
  minHeight: 56,
};

const STANZA_TIMELINE_EPSILON = 0.001;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let canvasContext = null;

const getCanvasContext = () => {
  if (canvasContext) {
    return canvasContext;
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvasContext = canvas.getContext('2d');
    return canvasContext;
  }

  return null;
};

const normalizeHexColor = (value, fallback) => {
  const rawValue = String(value || '').trim();
  const match = rawValue.match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : fallback;
};

const normalizeFontSize = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 32;
  }

  return clamp(Math.round(numericValue), STANZA_FONT_SIZE_MIN, STANZA_FONT_SIZE_MAX);
};

export const normalizeStanzaTransition = (value) => {
  const normalizedValue = String(value || 'fade').trim().toLowerCase();
  return STANZA_TRANSITION_TYPES.includes(normalizedValue) ? normalizedValue : 'fade';
};

export const clampTransitionDuration = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 1;
  }

  return Number(
    clamp(numericValue, STANZA_TRANSITION_DURATION_MIN, STANZA_TRANSITION_DURATION_MAX).toFixed(2)
  );
};

export const normalizeStanzaScale = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 1;
  }

  return Number(clamp(numericValue, STANZA_SCALE_MIN, STANZA_SCALE_MAX).toFixed(3));
};

export const normalizeStanzaWidthScale = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_STANZA_TRANSFORM.scaleX;
  }

  return Number(clamp(numericValue, STANZA_WIDTH_SCALE_MIN, STANZA_WIDTH_SCALE_MAX).toFixed(2));
};

export const normalizeOutlineWidth = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 2;
  }

  return Math.round(clamp(numericValue, STANZA_OUTLINE_WIDTH_MIN, STANZA_OUTLINE_WIDTH_MAX));
};

export const getStanzaTransform = (stanza = {}) => ({
  scaleX: normalizeStanzaWidthScale(stanza?.scaleX ?? DEFAULT_STANZA_TRANSFORM.scaleX),
  scaleY: normalizeStanzaScale(stanza?.scaleY ?? DEFAULT_STANZA_TRANSFORM.scaleY),
});

export const normalizeFontFamily = (value) => {
  const normalized = String(value || '').trim();
  return FONT_OPTIONS.some((font) => font.value === normalized) ? normalized : 'Montserrat';
};

export const normalizeAlignment = (value) => {
  const normalized = String(value || 'center').trim().toLowerCase();
  return STANZA_ALIGNMENT_OPTIONS.includes(normalized) ? normalized : 'center';
};

export const getPreviewFontFamily = (value) => {
  const normalized = normalizeFontFamily(value);
  return FONT_OPTIONS.find((font) => font.value === normalized)?.previewFamily
    || FONT_OPTIONS[0].previewFamily;
};

const buildCanvasFont = (stanza, fontSize) => {
  const style = stanza?.italic ? 'italic ' : '';
  const weight = stanza?.bold ? '700 ' : '400 ';
  const family = getPreviewFontFamily(stanza?.fontFamily);
  return `${style}${weight}${fontSize}px ${family}`;
};

const measureApproximateWidth = (text = '', fontSize = 32) => {
  return String(text).length * fontSize * 0.58;
};

const wrapParagraph = (paragraph, maxWidth, measureText) => {
  const normalizedParagraph = String(paragraph ?? '');
  const words = normalizedParagraph.trim().split(/\s+/).filter(Boolean);

  if (!words.length) {
    return [''];
  }

  const lines = [];
  let currentLine = '';

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (!currentLine || measureText(candidate) <= maxWidth) {
      currentLine = candidate;
      return;
    }

    lines.push(currentLine);
    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
};

const measureWrappedText = (stanza, fontSize, previewWidth = 1280) => {
  const maxWidth = Math.max(
    PREVIEW_SAFE_AREA.minWidth,
    previewWidth
      - PREVIEW_SAFE_AREA.frameHorizontalPadding
      - PREVIEW_SAFE_AREA.stanzaHorizontalPadding
  );
  const paragraphs = String(stanza?.text || '').replace(/\r/g, '').split('\n');
  const ctx = getCanvasContext();

  if (ctx) {
    ctx.font = buildCanvasFont(stanza, fontSize);
  }

  const measureText = (text) => {
    if (ctx) {
      return ctx.measureText(text).width;
    }

    return measureApproximateWidth(text, fontSize);
  };

  const wrappedLines = paragraphs.flatMap((paragraph) => wrapParagraph(paragraph, maxWidth, measureText));
  const nonEmptyLines = wrappedLines.length ? wrappedLines : [''];
  const widestLine = nonEmptyLines.reduce((max, line) => Math.max(max, measureText(line || ' ')), 0);

  return {
    lineCount: nonEmptyLines.length,
    maxLineWidth: widestLine,
    allowedWidth: maxWidth,
  };
};

export const getMaxSafeFontSizeForStanza = (stanza, options = {}) => {
  const previewWidth = Number(options.previewWidth ?? options.width) || 1280;
  const previewHeight = Number(options.previewHeight ?? options.height) || 720;
  const maxTextHeight = Math.max(
    PREVIEW_SAFE_AREA.minHeight,
    previewHeight
      - PREVIEW_SAFE_AREA.frameVerticalPadding
      - PREVIEW_SAFE_AREA.stanzaVerticalPadding
  );

  let low = STANZA_FONT_SIZE_MIN;
  let high = STANZA_FONT_SIZE_MAX;
  let best = STANZA_FONT_SIZE_MIN;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const metrics = measureWrappedText(stanza, middle, previewWidth);
    const estimatedHeight = metrics.lineCount * middle * 1.5;
    const fitsWidth = metrics.maxLineWidth <= metrics.allowedWidth;
    const fitsHeight = estimatedHeight <= maxTextHeight;

    if (fitsWidth && fitsHeight) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return clamp(best, STANZA_FONT_SIZE_MIN, STANZA_FONT_SIZE_MAX);
};

export const generateStanzaId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `stanza-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const splitStanzaTextIntoLines = (text = '') => {
  return String(text ?? '').replace(/\r/g, '').split('\n');
};

export const sanitizeLineStyleOverride = (style = {}) => {
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return {};
  }

  const nextStyle = {};

  if (style.fontFamily !== undefined) {
    nextStyle.fontFamily = normalizeFontFamily(style.fontFamily);
  }

  if (style.color !== undefined) {
    nextStyle.color = normalizeHexColor(style.color, '#FFFFFF');
  }

  if (style.outlineColor !== undefined) {
    nextStyle.outlineColor = normalizeHexColor(style.outlineColor, '#000000');
  }

  if (style.outlineWidth !== undefined) {
    nextStyle.outlineWidth = normalizeOutlineWidth(style.outlineWidth);
  }

  if (style.bold !== undefined) {
    nextStyle.bold = Boolean(style.bold);
  }

  if (style.italic !== undefined) {
    nextStyle.italic = Boolean(style.italic);
  }

  if (style.underline !== undefined) {
    nextStyle.underline = Boolean(style.underline);
  }

  if (style.alignment !== undefined) {
    nextStyle.alignment = normalizeAlignment(style.alignment);
  }

  return nextStyle;
};

export const normalizeLineStyles = (lineStyles = {}, text = '') => {
  if (!lineStyles || typeof lineStyles !== 'object' || Array.isArray(lineStyles)) {
    return {};
  }

  const lines = splitStanzaTextIntoLines(text);
  const maxIndex = Math.max(0, lines.length - 1);

  return Object.entries(lineStyles).reduce((accumulator, [rawIndex, rawStyle]) => {
    const index = Number(rawIndex);

    if (!Number.isInteger(index) || index < 0 || index > maxIndex) {
      return accumulator;
    }

    const safeStyle = sanitizeLineStyleOverride(rawStyle);
    if (!Object.keys(safeStyle).length) {
      return accumulator;
    }

    accumulator[index] = safeStyle;
    return accumulator;
  }, {});
};

export const getStanzaLineStyleMap = (stanza = {}) => {
  return normalizeLineStyles(stanza?.lineStyles || {}, stanza?.text || '');
};

export const resolveStanzaLineEntries = (stanza = {}) => {
  const lines = splitStanzaTextIntoLines(stanza?.text || '');
  const lineStyles = getStanzaLineStyleMap(stanza);
  const baseStyle = {
    fontSize: normalizeFontSize(stanza?.fontSize ?? 32),
    fontFamily: normalizeFontFamily(stanza?.fontFamily ?? 'Montserrat'),
    color: normalizeHexColor(stanza?.color, '#FFFFFF'),
    outlineColor: normalizeHexColor(stanza?.outlineColor, '#000000'),
    outlineWidth: normalizeOutlineWidth(stanza?.outlineWidth ?? 2),
    bold: Boolean(stanza?.bold),
    italic: Boolean(stanza?.italic),
    underline: Boolean(stanza?.underline),
    alignment: normalizeAlignment(stanza?.alignment ?? 'center'),
  };

  return lines.map((lineText, index) => {
    const styleOverride = lineStyles[index] || {};

    return {
      index,
      text: lineText,
      styleOverride,
      style: {
        ...baseStyle,
        ...styleOverride,
      },
    };
  });
};

export const applyStyleToSelectedLines = (stanza = {}, selectedLineIndexes = [], stylePatch = {}) => {
  const safeIndexes = [...new Set((selectedLineIndexes || []).filter((index) => Number.isInteger(index) && index >= 0))];
  if (!safeIndexes.length) {
    return stanza;
  }

  const safePatch = sanitizeLineStyleOverride(stylePatch);
  if (!Object.keys(safePatch).length) {
    return stanza;
  }

  const nextLineStyles = {
    ...getStanzaLineStyleMap(stanza),
  };

  safeIndexes.forEach((index) => {
    nextLineStyles[index] = {
      ...(nextLineStyles[index] || {}),
      ...safePatch,
    };
  });

  return {
    ...stanza,
    lineStyles: normalizeLineStyles(nextLineStyles, stanza?.text || ''),
  };
};

export const hasDefinedStartTime = (stanza, options = {}) => {
  const rawStart = String(stanza?.startTime ?? '').trim();
  const parsedStart = parseFixedTimecode(rawStart);

  if (parsedStart === null) {
    return false;
  }

  if (Boolean(stanza?.hasManualStart) || rawStart !== DEFAULT_TIMECODE) {
    return true;
  }

  return Boolean(options?.allowFirstBlockAtZero) && parsedStart === 0;
};

export const hasDefinedEndTime = (stanza) => {
  const rawEnd = String(stanza?.endTime ?? '').trim();
  const parsedEnd = parseFixedTimecode(rawEnd);

  if (parsedEnd === null) {
    return false;
  }

  return Boolean(stanza?.hasManualEnd) || rawEnd !== DEFAULT_TIMECODE;
};

export const createStanzaFromText = (text = 'Nova estrofe', overrides = {}, options = {}) => {
  const finalText = overrides.text ?? text;
  const position = {
    ...DEFAULT_STANZA_POSITION,
    ...(overrides.position || {}),
  };
  const transform = getStanzaTransform(overrides);
  const stanzaId = overrides.id ?? generateStanzaId();
  const safeFontMax = getMaxSafeFontSizeForStanza({
    text: finalText,
    fontFamily: overrides.fontFamily,
    bold: overrides.bold,
    italic: overrides.italic,
  }, options);

  return {
    id: stanzaId,
    text: finalText,
    startTime: DEFAULT_TIMECODE,
    endTime: DEFAULT_TIMECODE,
    fontSize: Math.min(normalizeFontSize(overrides.fontSize ?? 32), safeFontMax),
    fontFamily: normalizeFontFamily(overrides.fontFamily ?? 'Montserrat'),
    color: normalizeHexColor(overrides.color, '#FFFFFF'),
    outlineColor: normalizeHexColor(overrides.outlineColor, '#000000'),
    outlineWidth: normalizeOutlineWidth(overrides.outlineWidth ?? 2),
    bold: Boolean(overrides.bold),
    italic: Boolean(overrides.italic),
    underline: Boolean(overrides.underline),
    transition: normalizeStanzaTransition(overrides.transition ?? 'fade'),
    transitionDuration: clampTransitionDuration(overrides.transitionDuration ?? 1),
    alignment: normalizeAlignment(overrides.alignment ?? 'center'),
    leadIn: Number(overrides.leadIn ?? 0.5),
    lines: Array.isArray(overrides.lines) ? overrides.lines : [],
    lineStyles: normalizeLineStyles(overrides.lineStyles || {}, finalText),
    hasManualStart: Boolean(overrides.hasManualStart),
    hasManualEnd: Boolean(overrides.hasManualEnd),
    isDuplicateCopy: Boolean(overrides.isDuplicateCopy),
    position,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    ...overrides,
    id: stanzaId,
    text: finalText,
    fontSize: Math.min(normalizeFontSize(overrides.fontSize ?? 32), safeFontMax),
    fontFamily: normalizeFontFamily(overrides.fontFamily ?? 'Montserrat'),
    color: normalizeHexColor(overrides.color, '#FFFFFF'),
    outlineColor: normalizeHexColor(overrides.outlineColor, '#000000'),
    outlineWidth: normalizeOutlineWidth(overrides.outlineWidth ?? 2),
    transition: normalizeStanzaTransition(overrides.transition ?? 'fade'),
    transitionDuration: clampTransitionDuration(overrides.transitionDuration ?? 1),
    alignment: normalizeAlignment(overrides.alignment ?? 'center'),
    position,
    lines: Array.isArray(overrides.lines) ? overrides.lines : [],
    lineStyles: normalizeLineStyles(overrides.lineStyles || {}, finalText),
    isDuplicateCopy: Boolean(overrides.isDuplicateCopy),
    scaleX: normalizeStanzaWidthScale(overrides.scaleX ?? DEFAULT_STANZA_TRANSFORM.scaleX),
    scaleY: normalizeStanzaScale(overrides.scaleY ?? DEFAULT_STANZA_TRANSFORM.scaleY),
  };
};

export const normalizeStanzas = (stanzas = [], options = {}) => {
  return stanzas.map((stanza) =>
    createStanzaFromText(stanza?.text || '', {
      ...stanza,
      id: stanza?.id ?? generateStanzaId(),
    }, options)
  );
};

export const duplicateStanza = (stanza) => {
  return createStanzaFromText(stanza?.text || 'Nova estrofe', {
    ...stanza,
    id: undefined,
    isDuplicateCopy: true,
    lineStyles: getStanzaLineStyleMap(stanza),
    position: stanza?.position
      ? { ...DEFAULT_STANZA_POSITION, ...stanza.position }
      : { ...DEFAULT_STANZA_POSITION },
    scaleX: stanza?.scaleX ?? DEFAULT_STANZA_TRANSFORM.scaleX,
    scaleY: stanza?.scaleY ?? DEFAULT_STANZA_TRANSFORM.scaleY,
  });
};

export const hasConfiguredTiming = (stanza) => {
  const start = parseFixedTimecode(stanza?.startTime);
  const end = parseFixedTimecode(stanza?.endTime);

  if (start === null || end === null || end < start) {
    return false;
  }

  if (stanza?.hasManualStart && stanza?.hasManualEnd) {
    return true;
  }

  const rawStart = String(stanza?.startTime ?? '').trim();
  const rawEnd = String(stanza?.endTime ?? '').trim();

  return !(rawStart === DEFAULT_TIMECODE && rawEnd === DEFAULT_TIMECODE);
};

export const getStanzaDisplayStart = (stanza) => {
  const start = parseFixedTimecode(stanza?.startTime);
  if (start === null) return null;

  const leadIn = typeof stanza?.leadIn === 'number' ? stanza.leadIn : 0.5;
  const vocalOnly = stanza?.showOnlyDuringVocal === true;

  return vocalOnly ? start : Math.max(0, start - leadIn);
};

const resolveStanzaEndTime = (stanzas = [], index, start) => {
  const stanza = stanzas[index];
  const explicitEnd = parseFixedTimecode(stanza?.endTime);

  if (hasDefinedEndTime(stanza) && explicitEnd !== null && explicitEnd > start) {
    return explicitEnd;
  }

  for (let nextIndex = index + 1; nextIndex < stanzas.length; nextIndex += 1) {
    const nextStanza = stanzas[nextIndex];
    const nextStart = parseFixedTimecode(nextStanza?.startTime);

    if (!hasDefinedStartTime(nextStanza, { allowFirstBlockAtZero: nextIndex === 0 })) {
      continue;
    }

    if (nextStart !== null && nextStart > start) {
      return nextStart;
    }
  }

  return Number.POSITIVE_INFINITY;
};

export const getResolvedStanzaTimeline = (stanzas = []) => {
  let previousDisplayEnd = 0;
  const safeStanzas = Array.isArray(stanzas) ? stanzas : [];

  return safeStanzas.map((stanza, index) => {
    const allowFirstBlockAtZero = index === 0;

    if (!hasDefinedStartTime(stanza, { allowFirstBlockAtZero })) {
      return null;
    }

    const start = parseFixedTimecode(stanza?.startTime);
    if (start === null) {
      return null;
    }

    const end = resolveStanzaEndTime(safeStanzas, index, start);
    if (end <= start) {
      return null;
    }

    const baseDisplayStart = getStanzaDisplayStart(stanza);
    if (baseDisplayStart === null) {
      return null;
    }

    const displayStart = Math.max(baseDisplayStart, previousDisplayEnd);
    const displayEnd = end;

    previousDisplayEnd = Math.max(previousDisplayEnd, Number.isFinite(displayEnd) ? displayEnd : previousDisplayEnd);

    if (displayEnd <= displayStart + STANZA_TIMELINE_EPSILON) {
      return {
        stanza,
        start,
        end,
        displayStart,
        displayEnd,
        isVisible: false,
      };
    }

    return {
      stanza,
      start,
      end,
      displayStart,
      displayEnd,
      isVisible: true,
    };
  });
};

export const getActiveStanzaAtTime = (stanzas = [], currentTime = 0) => {
  const resolvedTimeline = getResolvedStanzaTimeline(stanzas);

  for (let index = resolvedTimeline.length - 1; index >= 0; index -= 1) {
    const entry = resolvedTimeline[index];

    if (!entry?.isVisible) {
      continue;
    }

    if (
      currentTime + STANZA_TIMELINE_EPSILON >= entry.displayStart
      && currentTime < entry.displayEnd - STANZA_TIMELINE_EPSILON
    ) {
      return entry.stanza;
    }
  }

  return null;
};

export const isStanzaActiveAtTime = (stanza, currentTime, stanzas = []) => {
  if (!stanza) {
    return false;
  }

  if (Array.isArray(stanzas) && stanzas.length > 0) {
    return getActiveStanzaAtTime(stanzas, currentTime)?.id === stanza.id;
  }

  const timeline = getResolvedStanzaTimeline([stanza])[0];
  if (!timeline?.isVisible) {
    return false;
  }

  return (
    currentTime + STANZA_TIMELINE_EPSILON >= timeline.displayStart
    && currentTime < timeline.displayEnd - STANZA_TIMELINE_EPSILON
  );
};
