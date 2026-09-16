/**
 * lyricsAlignment.js — Mapeia palavras alinhadas → blocos de letra da LenaVS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Regras de negócio (definidas pelo produto):
 *   • A letra e a divisão em blocos NUNCA são alteradas: este módulo só copia
 *     o texto recebido para montar a frase enviada ao alinhador e depois
 *     devolve os tempos, na mesma ordem dos blocos originais.
 *   • início do bloco = início da primeira palavra cantada do bloco;
 *   • fim do bloco    = fim da última palavra cantada do bloco.
 *
 * Tolerância a resultados imperfeitos: o alinhador pode devolver mais ou menos
 * unidades do que o número de palavras da letra (fragmentação de sílabas,
 * romanização, palavras omitidas na música). Por isso o mapeamento:
 *   1. tenta ancorar palavra a palavra por similaridade de texto;
 *   2. se não houver âncoras suficientes, distribui as palavras no intervalo
 *      de tempo alinhado de forma proporcional;
 *   3. em ambos os casos garante uma linha do tempo crescente e sem sobreposição.
 */

const MAX_FIXED_TIMECODE_SECONDS = (99 * 60) + 59;

const BRACKETED_TAG_PATTERN = /^[[({<][^\])}>]*[\])}>][:.,;!?…-]?$/;
const MIN_BLOCK_DURATION_SECONDS = 1;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const normalizeAlignmentToken = (value) => (
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
);

export const formatSecondsToFixedTimecode = (value) => {
  const numeric = Number(value);
  const safeSeconds = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  const clamped = clamp(safeSeconds, 0, MAX_FIXED_TIMECODE_SECONDS);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

/** Aceita array de strings ou array de objetos { text } e devolve os textos crus. */
export const extractStanzaTexts = (stanzas = []) => {
  if (!Array.isArray(stanzas)) return [];

  return stanzas.map((stanza) => {
    if (typeof stanza === 'string') return stanza;
    return String(stanza?.text ?? '');
  });
};

/**
 * Constrói a lista de palavras de cada bloco, na ordem original.
 * Nada é removido do texto exibido: palavras que não são cantadas
 * (ex.: "[Refrão]") apenas ficam marcadas como `alignable: false`.
 */
export const buildAlignmentBlocks = (stanzas = []) => {
  const texts = extractStanzaTexts(stanzas);

  return texts.map((text, blockIndex) => {
    const rawWords = String(text ?? '')
      .replace(/\r/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 0);

    const words = rawWords.map((raw, wordIndex) => {
      const normalized = normalizeAlignmentToken(raw);
      const isBracketedTag = BRACKETED_TAG_PATTERN.test(raw.trim());
      const alignable = !isBracketedTag && normalized.length > 0;

      return {
        blockIndex,
        wordIndex,
        raw,
        normalized,
        alignable,
      };
    });

    return { blockIndex, text, words };
  });
};

/** Texto enviado ao alinhador: mesma ordem e mesmas palavras cantadas da letra. */
export const buildAlignmentText = (stanzas = []) => {
  const blocks = Array.isArray(stanzas) && stanzas[0]?.words
    ? stanzas
    : buildAlignmentBlocks(stanzas);

  return blocks
    .flatMap((block) => block.words)
    .filter((word) => word.alignable)
    .map((word) => word.raw)
    .join(' ');
};

export const countAlignmentWords = (stanzas = []) => {
  const blocks = Array.isArray(stanzas) && stanzas[0]?.words
    ? stanzas
    : buildAlignmentBlocks(stanzas);

  return blocks.reduce(
    (total, block) => total + block.words.filter((word) => word.alignable).length,
    0
  );
};

const tokensMatch = (lyricToken, alignedToken) => {
  if (!lyricToken || !alignedToken) return false;
  if (lyricToken === alignedToken) return true;

  if (lyricToken.length >= 3 && alignedToken.startsWith(lyricToken)) return true;
  if (alignedToken.length >= 3 && lyricToken.startsWith(alignedToken)) return true;

  if (
    lyricToken.length >= 4
    && alignedToken.length >= 4
    && (lyricToken.includes(alignedToken) || alignedToken.includes(lyricToken))
  ) {
    return true;
  }

  return false;
};

const buildAnchors = (alignableWords, alignedWords) => {
  const anchors = [];
  let cursor = 0;

  for (let index = 0; index < alignableWords.length; index += 1) {
    const lookAheadLimit = Math.min(alignedWords.length, cursor + 8);
    let foundIndex = -1;

    for (let candidate = cursor; candidate < lookAheadLimit; candidate += 1) {
      if (tokensMatch(alignableWords[index].normalized, alignedWords[candidate].normalized)) {
        foundIndex = candidate;
        break;
      }
    }

    if (foundIndex >= 0) {
      anchors.push({ index, alignedIndex: foundIndex });
      cursor = foundIndex + 1;
    }
  }

  return anchors;
};

const averageWordDuration = (alignedWords) => {
  if (!alignedWords.length) return 0.35;

  const total = alignedWords.reduce(
    (sum, word) => sum + Math.max(0.08, word.end - word.start),
    0
  );

  return total / alignedWords.length;
};

/**
 * Gera { start, end } para cada palavra alinhável, na ordem da letra.
 */
const resolveWordTimes = (alignableWords, alignedWords) => {
  const count = alignableWords.length;
  if (!count) return [];

  const firstStart = alignedWords[0].start;
  const lastEnd = alignedWords[alignedWords.length - 1].end;
  const averageDuration = averageWordDuration(alignedWords);

  const anchors = buildAnchors(alignableWords, alignedWords);
  const useAnchors = anchors.length >= Math.max(2, Math.ceil(count * 0.4));

  const times = new Array(count);
  let mode = 'proportional';

  if (useAnchors) {
    mode = 'anchors';

    anchors.forEach((anchor) => {
      const aligned = alignedWords[anchor.alignedIndex];
      times[anchor.index] = { start: aligned.start, end: aligned.end };
    });

    for (let index = 0; index < count; index += 1) {
      if (times[index]) continue;

      const nextAnchor = anchors.find((anchor) => anchor.index > index) || null;
      const previousAnchor = [...anchors].reverse().find((anchor) => anchor.index < index) || null;

      if (previousAnchor && nextAnchor) {
        const previousTime = times[previousAnchor.index];
        const nextTime = times[nextAnchor.index];
        const ratio = (index - previousAnchor.index) / (nextAnchor.index - previousAnchor.index);

        times[index] = {
          start: previousTime.start + ((nextTime.start - previousTime.start) * ratio),
          end: previousTime.end + ((nextTime.end - previousTime.end) * ratio),
        };
        continue;
      }

      if (previousAnchor) {
        const previousTime = times[previousAnchor.index];
        const offset = (index - previousAnchor.index) * averageDuration;

        times[index] = {
          start: previousTime.end + offset,
          end: previousTime.end + offset + averageDuration,
        };
        continue;
      }

      const nextTime = nextAnchor ? times[nextAnchor.index] : { start: firstStart, end: firstStart };
      const offset = (nextTime.start || firstStart) - ((nextAnchor ? nextAnchor.index : count) - index) * averageDuration;

      times[index] = {
        start: Math.max(0, offset),
        end: Math.max(0.05, Math.max(0, offset) + averageDuration),
      };
    }
  } else {
    const spanStart = Number.isFinite(firstStart) ? firstStart : 0;
    const spanEnd = Number.isFinite(lastEnd) && lastEnd > spanStart ? lastEnd : spanStart + (averageDuration * count);
    const slot = (spanEnd - spanStart) / Math.max(1, count);

    for (let index = 0; index < count; index += 1) {
      const start = spanStart + (slot * index);
      times[index] = { start, end: start + (slot * 0.92) };
    }
  }

  // Garante linha do tempo crescente e durações mínimas.
  let previousStart = 0;

  for (let index = 0; index < count; index += 1) {
    const entry = times[index];
    const start = Math.max(Number(entry?.start) || 0, previousStart);
    const end = Math.max(Number(entry?.end) || 0, start + 0.08);

    times[index] = { start, end };
    previousStart = start;
  }

  return { times, mode, anchorCount: anchors.length };
};

/**
 * Mapeia as palavras alinhadas para os blocos originais da letra.
 *
 * @param {Object} params
 * @param {Array} params.stanzas      Blocos originais (strings ou { text }).
 * @param {Array} params.alignedWords Palavras com { text, start, end } do backend.
 * @param {number} [params.audioDuration]
 * @returns {{ blocks: Array, meta: Object }}
 */
export const mapAlignmentToBlocks = ({ stanzas = [], alignedWords = [], audioDuration = null } = {}) => {
  const alignmentBlocks = buildAlignmentBlocks(stanzas);
  const alignableWords = alignmentBlocks.flatMap((block) => block.words).filter((word) => word.alignable);

  const safeAlignedWords = (Array.isArray(alignedWords) ? alignedWords : [])
    .map((word) => ({
      text: String(word?.text ?? ''),
      normalized: normalizeAlignmentToken(word?.text),
      start: Number(word?.start) || 0,
      end: Math.max(Number(word?.end) || Number(word?.start) || 0, Number(word?.start) || 0),
    }))
    .filter((word, index, list) => word.end >= word.start && index < list.length);

  if (!alignableWords.length || !safeAlignedWords.length) {
    return {
      blocks: alignmentBlocks.map((block) => ({
        index: block.blockIndex,
        wordCount: block.words.length,
        alignableWordCount: 0,
        startSeconds: null,
        endSeconds: null,
        startTime: null,
        endTime: null,
      })),
      meta: {
        mode: 'none',
        reason: alignableWords.length ? 'ALIGNMENT_EMPTY' : 'LYRICS_EMPTY',
        alignedWordCount: safeAlignedWords.length,
        lyricWordCount: alignableWords.length,
        audioDuration,
      },
    };
  }

  const { times, mode, anchorCount } = resolveWordTimes(alignableWords, safeAlignedWords);

  // Índice global da palavra alinhável → tempo
  const timeByWordId = new Map();
  alignableWords.forEach((word, index) => {
    timeByWordId.set(`${word.blockIndex}:${word.wordIndex}`, times[index]);
  });

  let previousBlockEnd = 0;

  const blocks = alignmentBlocks.map((block) => {
    const blockAlignable = block.words.filter((word) => word.alignable);
    const wordTimes = blockAlignable
      .map((word) => timeByWordId.get(`${word.blockIndex}:${word.wordIndex}`))
      .filter(Boolean);

    let startSeconds;
    let endSeconds;

    if (wordTimes.length) {
      startSeconds = wordTimes[0].start;
      endSeconds = wordTimes[wordTimes.length - 1].end;
    } else {
      startSeconds = previousBlockEnd;
      endSeconds = startSeconds + MIN_BLOCK_DURATION_SECONDS;
    }

    // Sem sobreposição e sempre com pelo menos 1 segundo (formato MM:SS).
    startSeconds = Math.max(startSeconds, previousBlockEnd);
    endSeconds = Math.max(endSeconds, startSeconds + 0.5);

    let startTime = formatSecondsToFixedTimecode(startSeconds);
    let endTime = formatSecondsToFixedTimecode(endSeconds);

    if (endTime <= startTime) {
      endTime = formatSecondsToFixedTimecode(Math.floor(startSeconds) + MIN_BLOCK_DURATION_SECONDS);
    }

    previousBlockEnd = Math.max(previousBlockEnd, Math.floor(endSeconds));

    return {
      index: block.blockIndex,
      wordCount: block.words.length,
      alignableWordCount: blockAlignable.length,
      startSeconds: Number(startSeconds.toFixed(3)),
      endSeconds: Number(endSeconds.toFixed(3)),
      startTime,
      endTime,
    };
  });

  const ratio = safeAlignedWords.length / Math.max(1, alignableWords.length);

  return {
    blocks,
    meta: {
      mode,
      anchorCount,
      alignedWordCount: safeAlignedWords.length,
      lyricWordCount: alignableWords.length,
      wordRatio: Number(ratio.toFixed(3)),
      // Fora desta faixa o resultado tende a ser aproximado (a UI avisa o usuário).
      reliable: mode === 'anchors' || (ratio >= 0.8 && ratio <= 1.25),
      audioDuration: audioDuration ?? null,
    },
  };
};