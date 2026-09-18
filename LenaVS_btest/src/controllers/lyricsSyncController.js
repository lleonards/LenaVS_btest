import {
  syncLyricsWithAudio,
  warmupAligner,
  ALIGNER_UNAVAILABLE_MESSAGE,
  getAlignerQueueInfo,
} from '../services/lyricsAlignService.js';
import { buildBlockTimecodes } from '../utils/fixedTimecode.js';

const MAX_BLOCKS = 400;

const normalizeStanzaPayload = (rawStanzas) => {
  if (!Array.isArray(rawStanzas)) return null;

  const blocks = rawStanzas
    .slice(0, MAX_BLOCKS)
    .map((stanza) => (typeof stanza === 'string' ? stanza : String(stanza?.text ?? '')));

  if (!blocks.length) return null;
  if (!blocks.some((block) => block.trim())) return null;

  return blocks;
};

const normalizeError = (error) => {
  if (!error) {
    return { status: 500, message: 'Erro ao sincronizar a letra.' };
  }

  if (error.code === 'ALIGN_UNAVAILABLE') {
    return { status: 503, message: error.message || ALIGNER_UNAVAILABLE_MESSAGE };
  }

  if (error.code === 'ALIGN_TIMEOUT') {
    return {
      status: 504,
      message: 'A sincronização demorou mais do que o esperado. Tente novamente com uma música mais curta ou em um horário com menos carga no servidor.',
    };
  }

  if (error.code === 'ALIGN_AUDIO_PREPARE_FAILED' || error.code === 'MEDIA_READ_ERROR') {
    return {
      status: 422,
      message: 'Não foi possível ler o áudio enviado. Confirme que o arquivo está íntegro e tente novamente.',
    };
  }

  if (error.code === 'ALIGN_NO_LYRICS') {
    return { status: 400, message: 'Envie a letra antes de sincronizar.' };
  }

  if (error.code === 'ALIGN_PROCESS_FAILED' || error.code === 'ALIGN_INVALID_OUTPUT') {
    const details = `${error.stderr || ''} ${error.stdout || ''}`.toLowerCase();

    if (details.includes('memory') || details.includes('killed')) {
      return {
        status: 507,
        message: 'O servidor ficou sem memória durante a sincronização. Tente uma música mais curta ou aumente a memória da máquina.',
      };
    }

    return {
      status: 500,
      message: 'O alinhador não conseguiu sincronizar esta letra com o áudio. Confirme se a letra corresponde à música enviada e tente novamente.',
    };
  }

  return {
    status: error.status || 500,
    message: error.message || 'Erro ao sincronizar a letra.',
  };
};

/**
 * POST /api/lyrics/sync
 *
 * Sincroniza automaticamente os blocos de letra com a música original.
 * O texto e a divisão dos blocos NÃO são alterados: apenas os tempos.
 *
 * Body:     { audioUrl: string, stanzas: string[] }
 * Response: { success: true, blocks: [{ index, startTime, endTime, ... }], ... }
 */
export const syncLyrics = async (req, res) => {
  const rawAudioUrl = req.body?.audioUrl;
  const audioUrl = typeof rawAudioUrl === 'string' ? rawAudioUrl.trim() : '';
  const blocks = normalizeStanzaPayload(req.body?.stanzas);

  if (!audioUrl) {
    return res.status(400).json({
      code: 'ALIGN_MISSING_AUDIO',
      error: 'Envie a música original antes de sincronizar a letra.',
    });
  }

  if (!blocks) {
    return res.status(400).json({
      code: 'ALIGN_NO_LYRICS',
      error: 'Envie a letra antes de sincronizar.',
    });
  }

  try {
    console.log(`[syncLyrics] Iniciando sincronização de ${blocks.length} bloco(s)…`);

    const result = await syncLyricsWithAudio({ audioUrl, stanzas: blocks });
    const timecodes = buildBlockTimecodes(result.blocks);

    if (timecodes.length !== blocks.length) {
      console.warn(
        `[syncLyrics] Tempos recebidos (${timecodes.length}) diferentes dos blocos enviados (${blocks.length}).`,
      );
    }

    console.log(
      `[syncLyrics] Concluído em ${result.elapsedSec ?? '?'}s — ${timecodes.length} bloco(s) com tempo.`,
    );

    return res.status(200).json({
      success: true,
      engine: result.engine,
      mode: result.mode,
      language: result.language,
      durationSec: result.durationSec,
      wordCount: result.wordCount,
      elapsedSec: result.elapsedSec,
      blocks: timecodes,
      // Palavras com tempo ficam disponíveis para uso futuro (karaokê por palavra),
      // mas o Editor de Letras mostra somente início e fim de cada bloco em MM:SS.
      words: Array.isArray(result.words) ? result.words : undefined,
    });
  } catch (error) {
    console.error('[syncLyrics] Erro:', error.message);
    if (error?.stderr) console.error('[syncLyrics] stderr:', String(error.stderr).slice(0, 2000));

    const normalized = normalizeError(error);

    return res.status(normalized.status).json({
      code: error.code || 'ALIGN_ERROR',
      error: normalized.message,
    });
  }
};

/**
 * POST /api/lyrics/sync/warmup
 * Pré-baixa/valida o modelo de alinhamento (rota de manutenção).
 */
export const warmupSyncEngine = async (req, res) => {
  try {
    const result = await warmupAligner();
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[warmupSyncEngine] Erro:', error.message);
    const normalized = normalizeError(error);
    return res.status(normalized.status).json({
      code: error.code || 'ALIGN_ERROR',
      error: normalized.message,
    });
  }
};

/**
 * GET /api/lyrics/sync/status
 * Mostra se o alinhador está disponível e quantos jobs estão na fila.
 */
export const getSyncStatus = async (req, res) => {
  const queue = getAlignerQueueInfo();

  try {
    const { ensureAlignerAvailable } = await import('../services/lyricsAlignService.js');
    const availability = await ensureAlignerAvailable();
    return res.status(200).json({ success: true, available: true, ...availability, queue });
  } catch (error) {
    return res.status(200).json({
      success: true,
      available: false,
      queue,
      reason: error.message || ALIGNER_UNAVAILABLE_MESSAGE,
    });
  }
};
