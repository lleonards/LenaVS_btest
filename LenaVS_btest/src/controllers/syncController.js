import {
  syncLyricsBlocksAutomatically,
  SYNC_ERRORS,
} from '../services/autoSyncService.js';

const MAX_AUDIO_URL_LENGTH = 2048;
const MAX_BLOCK_TEXT_LENGTH = 4000;

const normalizeSyncError = (error) => {
  switch (error?.code) {
    case SYNC_ERRORS.INVALID_KEY:
      return {
        status: 500,
        code: 'SYNC_INVALID_KEY',
        message: error.message,
      };
    case SYNC_ERRORS.NO_ENGINE:
      return {
        status: 503,
        code: 'SYNC_UNAVAILABLE',
        message: 'A sincronização automática não está configurada no servidor. Defina GROQ_API_KEY (gratuita) ou habilite o WhisperX local.',
      };
    case SYNC_ERRORS.AUDIO_TOO_LARGE:
      return {
        status: 413,
        code: 'SYNC_AUDIO_TOO_LARGE',
        message: error.message,
      };
    case SYNC_ERRORS.RATE_LIMITED:
      return {
        status: 429,
        code: 'SYNC_RATE_LIMITED',
        message: error.message,
      };
    case SYNC_ERRORS.NO_WORDS:
      return {
        status: 422,
        code: 'SYNC_NO_WORDS',
        message: error.message,
      };
    default:
      return {
        status: 500,
        code: 'SYNC_FAILED',
        message: 'Não foi possível sincronizar a letra automaticamente. Tente novamente em instantes.',
      };
  }
};

/**
 * POST /api/lyrics/auto-sync
 *
 * Sincronização automática: detecta internamente o momento de cada palavra
 * cantada no áudio original e define início/fim (MM:SS) de cada bloco da
 * letra, respeitando exatamente a organização de blocos feita na LenaVS.
 *
 * Body: {
 *   audioUrl: string,
 *   stanzas: [{ id: string, text: string }]
 * }
 *
 * Response: {
 *   success: true,
 *   engine: 'groq' | 'whisperx',
 *   language: string | null,
 *   stanzas: [{ id, startTime: 'MM:SS', endTime: 'MM:SS', matched, estimated }],
 *   stats: { blocks, syncedBlocks, estimatedBlocks, wordsDetected }
 * }
 */
export const autoSyncLyrics = async (req, res) => {
  try {
    const audioUrl = String(req.body?.audioUrl || '').trim();
    const rawStanzas = Array.isArray(req.body?.stanzas) ? req.body.stanzas : [];

    if (!audioUrl || audioUrl.length > MAX_AUDIO_URL_LENGTH || !/^https?:\/\//i.test(audioUrl)) {
      return res.status(400).json({
        code: 'SYNC_INVALID_AUDIO',
        error: 'Envie a música original antes de sincronizar.',
      });
    }

    const blocks = rawStanzas
      .map((stanza, index) => ({
        id: String(stanza?.id ?? `block-${index}`),
        text: String(stanza?.text ?? '').slice(0, MAX_BLOCK_TEXT_LENGTH),
      }))
      .filter((stanza) => stanza.text.trim().length > 0);

    if (!blocks.length) {
      return res.status(400).json({
        code: 'SYNC_NO_LYRICS',
        error: 'Envie a letra (arquivo ou colada) antes de sincronizar.',
      });
    }

    console.log(`[autoSync] Iniciando sincronização de ${blocks.length} bloco(s)…`);

    const result = await syncLyricsBlocksAutomatically(audioUrl, blocks);

    console.log(
      `[autoSync] ✅ ${result.engine}: ${result.stats.syncedBlocks}/${result.stats.blocks} blocos sincronizados, `
      + `${result.stats.wordsDetected} palavras detectadas`
    );

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[autoSync] Erro:', error?.message);
    if (error?.stderr) console.error('[autoSync] stderr:', error.stderr);

    const normalized = normalizeSyncError(error);
    return res.status(normalized.status).json({
      code: normalized.code,
      error: normalized.message,
    });
  }
};
