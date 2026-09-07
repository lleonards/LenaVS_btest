/**
 * lyricsAligner.js
 *
 * Mapeia as palavras reconhecidas pelo WhisperX (com tempos) sobre os blocos
 * de letra existentes na LenaVS, SEM nunca criar, excluir, dividir, juntar ou
 * reorganizar blocos. O bloco ganha apenas startTime (primeira palavra
 * encontrada) e endTime (última palavra encontrada).
 */

const normalizeToken = (raw) => String(raw || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[’‘`´"“”]/g, "'")
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const tokenize = (text) => normalizeToken(text).split(/\s+/).filter(Boolean);

const buildHaystack = (asrWords = []) => asrWords
  .map((word, index) => ({
    index,
    tokens: tokenize(word?.word),
    start: Number(word?.start) || 0,
    end: Number(word?.end) || 0,
  }))
  .filter((entry) => entry.tokens.length > 0);

const MAX_LOOKAHEAD = 10;

const matchStanza = (needleTokens, haystack, startIndex) => {
  const total = needleTokens.length;
  let anchor = -1;

  for (let i = startIndex; i < haystack.length; i += 1) {
    if (haystack[i].tokens.includes(needleTokens[0])) {
      anchor = i;
      break;
    }
  }

  if (anchor === -1) {
    return { ok: false, matched: 0, total, start: null, end: null, cursor: startIndex };
  }

  let matched = 1;
  let last = anchor;
  let cursor = anchor + 1;

  for (let needleIndex = 1; needleIndex < total; needleIndex += 1) {
    const targetToken = needleTokens[needleIndex];
    const lookaheadEnd = Math.min(haystack.length, cursor + MAX_LOOKAHEAD);
    let found = -1;

    for (let hi = cursor; hi < lookaheadEnd; hi += 1) {
      if (haystack[hi].tokens.includes(targetToken)) {
        found = hi;
        break;
      }
    }

    if (found !== -1) {
      matched += 1;
      last = found;
      cursor = found + 1;
    }
  }

  const ok = matched >= Math.max(1, Math.ceil(total * 0.3));

  return {
    ok,
    matched,
    total,
    start: haystack[anchor].start,
    end: haystack[last].start,
    cursor: last + 1,
  };
};

const ratioStatus = (matched, total) => {
  if (!total) return 'unmatched';
  const ratio = matched / total;

  if (ratio >= 0.8) return 'synced';
  if (ratio >= 0.4) return 'partial';
  return 'unmatched';
};

/**
 * @param {Array} stanzas  [{ id, text }] — blocos na ordem exata do editor
 * @param {Array} asrWords [{ word, start, end }] — saída do WhisperX
 * @returns [{ stanzaId, start, end, matchedCount, totalWords, status }]
 */
export const mapWordsToStanzas = (stanzas = [], asrWords = []) => {
  const haystack = buildHaystack(asrWords);
  let cursor = 0;

  return stanzas.map((stanza) => {
    const stanzaId = stanza?.id ?? stanza?.stanzaId ?? null;
    const text = String(stanza?.text || '');
    const needleTokens = tokenize(text);

    if (!needleTokens.length || !haystack.length) {
      return {
        stanzaId,
        start: null,
        end: null,
        matchedCount: 0,
        totalWords: needleTokens.length,
        status: 'unmatched',
      };
    }

    const result = matchStanza(needleTokens, haystack, cursor);

    if (!result.ok || result.start == null) {
      return {
        stanzaId,
        start: null,
        end: null,
        matchedCount: result.matched,
        totalWords: result.total,
        status: 'unmatched',
      };
    }

    cursor = Math.max(cursor, result.cursor);

    let start = result.start;
    let end = result.end;

    if (end < start) {
      [start, end] = [end, start];
    }

    return {
      stanzaId,
      start,
      end,
      matchedCount: result.matched,
      totalWords: result.total,
      status: ratioStatus(result.matched, result.total),
    };
  });
};

export default mapWordsToStanzas;
