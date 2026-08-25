/**
 * lyricsAligner.js — Núcleo puro da sincronização automática.
 *
 * Recebe as palavras detectadas no áudio (com timestamps) e os blocos da
 * letra exatamente como organizados na LenaVS, e devolve início/fim de cada
 * bloco em MM:SS. NUNCA divide, junta, reordena ou reescreve os blocos:
 * a detecção por palavra existe apenas para descobrir os tempos.
 */

const SEARCH_WINDOW_WORDS = 80;

/* =========================================================
   Formatação de tempo — apenas minutos e segundos (MM:SS)
========================================================= */

export const formatMinutesSeconds = (value) => {
  const safe = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

/* =========================================================
   Normalização de palavras para comparação
========================================================= */

export const normalizeToken = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '');

export const tokenizeBlockText = (text) =>
  String(text || '')
    .replace(/\r/g, ' ')
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);

/* =========================================================
   Fuzzy matching (Levenshtein limitado)
========================================================= */

const levenshteinBounded = (a, b, maxDistance) => {
  if (a === b) return 0;
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDistance) return maxDistance + 1;
  if (!lenA) return lenB;
  if (!lenB) return lenA;

  let previous = new Array(lenB + 1);
  let current = new Array(lenB + 1);

  for (let j = 0; j <= lenB; j += 1) previous[j] = j;

  for (let i = 1; i <= lenA; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      if (current[j] < rowMin) rowMin = current[j];
    }

    if (rowMin > maxDistance) return maxDistance + 1;
    [previous, current] = [current, previous];
  }

  return previous[lenB];
};

export const tokensMatch = (lyricToken, sungToken) => {
  if (!lyricToken || !sungToken) return false;
  if (lyricToken === sungToken) return true;

  const minLength = Math.min(lyricToken.length, sungToken.length);

  // Prefixo comum (ex.: "cantando" vs "cantand")
  if (minLength >= 5 && (lyricToken.startsWith(sungToken) || sungToken.startsWith(lyricToken))) {
    return true;
  }

  const tolerance = minLength >= 9 ? 2 : minLength >= 4 ? 1 : 0;
  if (tolerance === 0) return false;

  return levenshteinBounded(lyricToken, sungToken, tolerance) <= tolerance;
};

/* =========================================================
   Alinhamento: palavras detectadas → blocos da letra
   (monotônico, na ordem exata escrita pelo usuário)
========================================================= */

/**
 * @param {Array<{word: string, start: number, end: number}>} words palavras detectadas no áudio
 * @param {Array<{id: string, text: string}>} blocks blocos da letra (ordem preservada)
 * @returns {Array<{id: string, startSeconds: number, endSeconds: number, matched: boolean, estimated?: boolean}>}
 */
export const alignBlocksToWords = (words, blocks) => {
  const sungWords = (Array.isArray(words) ? words : [])
    .map((entry) => ({ ...entry, token: normalizeToken(entry.word) }))
    .filter((entry) => entry.token);

  let pointer = 0;

  const aligned = (Array.isArray(blocks) ? blocks : []).map((block) => {
    const tokens = tokenizeBlockText(block.text);
    const matched = [];

    for (const token of tokens) {
      const windowEnd = Math.min(sungWords.length, pointer + SEARCH_WINDOW_WORDS);
      let foundIndex = -1;

      for (let j = pointer; j < windowEnd; j += 1) {
        if (tokensMatch(token, sungWords[j].token)) {
          foundIndex = j;
          break;
        }
      }

      if (foundIndex >= 0) {
        matched.push(sungWords[foundIndex]);
        pointer = foundIndex + 1;
      }
    }

    if (!matched.length) {
      return { id: block.id, startSeconds: null, endSeconds: null, matched: false };
    }

    return {
      id: block.id,
      startSeconds: matched[0].start,
      endSeconds: matched[matched.length - 1].end,
      matched: true,
      matchedWords: matched.length,
      totalWords: tokens.length,
    };
  });

  // Garante monotonicidade (nenhum bloco começa antes do início do anterior)
  let lastStart = 0;
  aligned.forEach((entry) => {
    if (entry.startSeconds === null) return;
    if (entry.startSeconds < lastStart) {
      const shift = lastStart - entry.startSeconds;
      entry.startSeconds = lastStart;
      entry.endSeconds = Math.max(entry.endSeconds + shift, entry.startSeconds);
    }
    if (entry.endSeconds < entry.startSeconds) {
      entry.endSeconds = entry.startSeconds;
    }
    lastStart = entry.startSeconds;
  });

  // Blocos sem correspondência: interpola entre os vizinhos sincronizados
  for (let i = 0; i < aligned.length; i += 1) {
    if (aligned[i].matched) continue;

    let prevIndex = i - 1;
    while (prevIndex >= 0 && !aligned[prevIndex].matched) prevIndex -= 1;
    let nextIndex = i + 1;
    while (nextIndex < aligned.length && !aligned[nextIndex].matched) nextIndex += 1;

    const rangeStart = prevIndex >= 0 ? aligned[prevIndex].endSeconds : 0;
    const rangeEnd = nextIndex < aligned.length ? aligned[nextIndex].startSeconds : null;

    if (rangeEnd === null || rangeEnd <= rangeStart) {
      // Sem referência confiável: encosta no vizinho anterior com 1s estimado
      const fallbackStart = rangeStart;
      aligned[i] = {
        ...aligned[i],
        startSeconds: fallbackStart,
        endSeconds: fallbackStart + 1,
        matched: false,
        estimated: true,
      };
      continue;
    }

    const gapBlocks = nextIndex - prevIndex - 1;
    const slice = (rangeEnd - rangeStart) / (gapBlocks + 1);
    const offset = i - prevIndex;

    aligned[i] = {
      ...aligned[i],
      startSeconds: rangeStart + slice * (offset - 1),
      endSeconds: rangeStart + slice * offset,
      matched: false,
      estimated: true,
    };
  }

  return aligned;
};
