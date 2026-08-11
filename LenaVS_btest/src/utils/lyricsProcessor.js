/**
 * Processador de letras
 * Separa texto em estrofes e normaliza acentuação
 */

import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import WordExtractor from 'word-extractor';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';

// PDF.js precisa destas APIs quando renderiza páginas no Node.js.
if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D;

const OCR_LANGUAGE = process.env.OCR_LANGUAGE || 'por+eng';
const OCR_MAX_PAGES = Math.max(1, Number.parseInt(process.env.OCR_MAX_PAGES || '30', 10));
const OCR_SCALE = Math.min(3, Math.max(1, Number.parseFloat(process.env.OCR_SCALE || '2')));

/**
 * Normaliza texto preservando acentos e caracteres especiais
 */
export const normalizeText = (text) => {
  if (!text) return '';
  
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
};

/**
 * Separa texto em estrofes
 */
export const separateIntoStanzas = (text) => {
  const normalizedText = normalizeText(text);
  
  const hasBlankLines = /\n\s*\n/.test(normalizedText);
  
  if (hasBlankLines) {
    const stanzas = normalizedText
      .split(/\n\s*\n/)
      .map(stanza => stanza.trim())
      .filter(stanza => stanza.length > 0);
    
    return {
      stanzas,
      autoSeparated: false,
      message: 'Letra carregada com separação original preservada'
    };
  } else {
    const lines = normalizedText
      .split('\n')
      .filter(line => line.trim().length > 0);
    
    const stanzas = [];
    
    for (let i = 0; i < lines.length; i += 4) {
      const stanza = lines.slice(i, i + 4).join('\n');
      stanzas.push(stanza);
    }
    
    return {
      stanzas,
      autoSeparated: true,
      message: 'Letra separada automaticamente em estrofes de 4 linhas'
    };
  }
};

/**
 * Lê arquivo .txt corrigindo automaticamente encoding
 */
const readTextFileWithEncodingFix = (filePath) => {
  const buffer = fs.readFileSync(filePath);

  // Tenta UTF-8 primeiro
  const utf8Text = buffer.toString('utf8');

  // Se detectar caractere inválido, converte de Windows-1252
  if (utf8Text.includes('�')) {
    return iconv.decode(buffer, 'win1252');
  }

  return utf8Text;
};

const cleanExtractedText = (text, ext) => {
  let cleaned = normalizeText(text);

  if (ext === '.lrc') {
    cleaned = cleaned.replace(/^\s*\[[^\]]+\]\s*/gm, '');
  }

  if (ext === '.srt') {
    cleaned = cleaned
      .replace(/^\s*\d+\s*$/gm, '')
      .replace(/^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*$/gm, '');
  }

  if (ext === '.rtf') {
    cleaned = cleaned
      .replace(/\\'[0-9a-f]{2}/gi, '')
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '');
  }

  return normalizeText(cleaned);
};

const readDocFile = async (filePath) => {
  const extractor = new WordExtractor();
  const document = await extractor.extract(filePath);
  return document.getBody();
};

const recognizePdfImages = async (filePath) => {
  const pdf = await getDocument({
    data: new Uint8Array(fs.readFileSync(filePath)),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const pagesToRead = Math.min(pdf.numPages, OCR_MAX_PAGES);
  const worker = await createWorker(OCR_LANGUAGE);
  const pageTexts = [];

  try {
    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: OCR_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));

      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise;

      const result = await worker.recognize(canvas.toBuffer('image/png'));
      const pageText = String(result?.data?.text || '').trim();
      if (pageText) pageTexts.push(pageText);
    }
  } finally {
    await worker.terminate();
    if (typeof pdf.cleanup === 'function') pdf.cleanup();
    if (typeof pdf.destroy === 'function') await pdf.destroy();
  }

  return pageTexts.join('\n\n');
};

/**
 * Processa arquivo de letra (.txt, .lrc, .srt, .md, .rtf, .docx, .doc, .pdf)
 */
export const processLyricsFile = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  let text = '';
  
  try {
    if (['.txt', '.lrc', '.srt', '.md', '.rtf'].includes(ext)) {
      text = readTextFileWithEncodingFix(filePath);
    } 
    else if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    } 
    else if (ext === '.pdf') {
      const result = await pdfParse(fs.readFileSync(filePath));
      text = result.text;

      // PDFs escaneados geralmente não possuem camada de texto. Nesse caso,
      // renderizamos as páginas e aplicamos OCR antes de considerar o arquivo vazio.
      if (normalizeText(text).length < 20) {
        text = await recognizePdfImages(filePath);
      }
    }
    else if (ext === '.doc') {
      text = await readDocFile(filePath);
    } 
    else {
      throw new Error('Formato de arquivo não suportado');
    }

    text = cleanExtractedText(text, ext);

    if (!text) {
      const emptyError = new Error(
        ext === '.pdf'
          ? 'Não foi possível reconhecer texto neste PDF, mesmo após tentar OCR nas páginas. Verifique a qualidade da imagem e tente novamente.'
          : 'Não foi encontrado texto legível neste arquivo.'
      );
      emptyError.code = ext === '.pdf' ? 'LYRICS_OCR_FAILED' : 'LYRICS_TEXT_NOT_FOUND';
      throw emptyError;
    }
    
    return separateIntoStanzas(text);
    
  } catch (error) {
    const wrappedError = new Error(`Erro ao processar arquivo de letra: ${error.message}`);
    wrappedError.code = error.code;
    throw wrappedError;
  }
};

/**
 * Valida tempo no formato mm:ss
 */
export const validateTimeFormat = (time) => {
  if (!time) return '00:00';
  
  const digits = time.replace(/\D/g, '');
  const limited = digits.slice(0, 4).padStart(4, '0');
  
  const minutes = limited.slice(0, 2);
  const seconds = limited.slice(2, 4);
  
  const validSeconds = Math.min(parseInt(seconds), 59)
    .toString()
    .padStart(2, '0');
  
  return `${minutes}:${validSeconds}`;
};

/**
 * Converte tempo mm:ss para segundos
 */
export const timeToSeconds = (time) => {
  const [minutes, seconds] = time.split(':').map(Number);
  return minutes * 60 + seconds;
};

/**
 * Converte segundos para formato mm:ss
 */
export const secondsToTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')}`;
};
