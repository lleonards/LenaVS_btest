// src/services/stanzaLyrics.js — mesmo comportamento que o backend antigo
// (stanzas por linha em branco OU grupos de 4 linhas).

import mammoth from 'mammoth';

export function separateIntoStanzas(text) {
  const normalized = (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  const hasBlankLines = /\n\s*\n/.test(normalized);

  if (hasBlankLines) {
    const stanzas = normalized
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      stanzas,
      autoSeparated: false,
      message: 'Letra carregada com separação original preservada.',
    };
  }
  const lines = normalized.split('\n').filter((l) => l.trim().length > 0);
  const stanzas = [];
  for (let i = 0; i < lines.length; i += 4) {
    stanzas.push(lines.slice(i, i + 4).join('\n'));
  }
  return {
    stanzas,
    autoSeparated: true,
    message: 'Letra separada automaticamente em estrofes de 4 linhas.',
  };
}

const cleanExtracted = (text, ext) => {
  let t = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (ext === '.lrc') t = t.replace(/^\s*\[[^\]]+\]\s*/gm, '');
  if (ext === '.srt')
    t = t
      .replace(/^\s*\d+\s*$/gm, '')
      .replace(/^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*$/gm, '');
  if (ext === '.rtf')
    t = t
      .replace(/\\'[0-9a-f]{2}/gi, '')
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '');
  return t;
};

async function readPlain(buffer) {
  const utf8 = buffer.toString('utf8');
  // Heurística simples: se houver caractere de substituição, tenta windows-1252
  if (utf8.includes('\uFFFD')) {
    try {
      const { decode } = await import('iconv-lite').then((m) => m.default || m);
      return decode(buffer, 'win1252');
    } catch {
      return utf8;
    }
  }
  return utf8;
}

export async function processLyricsBuffer(buffer, originalName = '') {
  const lower = (originalName || '').toLowerCase();
  const ext = lower.match(/\.[a-z0-9]+$/) ? lower.match(/\.[a-z0-9]+$/)[0] : '';

  let text = '';
  try {
    if (['.txt', '.lrc', '.srt', '.md', '.rtf'].includes(ext)) {
      text = await readPlain(buffer);
    } else if (ext === '.docx') {
      const out = await mammoth.extractRawText({ buffer });
      text = out.value;
    } else if (ext === '.pdf') {
      // Para evitar dependência de canvas pesado, retornamos mensagem amigável.
      // Frontend já trata LYRICS_OCR_FAILED.
      throw Object.assign(new Error('PDF requer OCR via frontend nesta versão.'), { code: 'LYRICS_OCR_REQUIRED' });
    } else {
      throw Object.assign(new Error('Formato de arquivo não suportado.'), { code: 'UNSUPPORTED_LYRICS_FORMAT' });
    }

    text = cleanExtracted(text, ext);
    if (!text || text.length < 2) {
      throw Object.assign(new Error('Não foi encontrado texto legível neste arquivo.'), { code: 'LYRICS_TEXT_NOT_FOUND' });
    }
    return separateIntoStanzas(text);
  } catch (err) {
    const wrapped = new Error(err.message || 'Erro ao processar arquivo de letra.');
    wrapped.code = err.code || 'LYRICS_READ_ERROR';
    throw wrapped;
  }
}
