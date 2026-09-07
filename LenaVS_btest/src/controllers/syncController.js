import { syncLyricsWithWhisperX } from '../services/whisperxSyncService.js';

export const synchronizeLyrics = async (req, res) => {
  try {
    const { audioUrl, stanzas } = req.body || {};

    if (!audioUrl || !Array.isArray(stanzas) || stanzas.length === 0) {
      return res.status(400).json({
        code: 'SYNC_INPUT_REQUIRED',
        error: 'Envie a música original e a letra para sincronizar.',
      });
    }

    const result = await syncLyricsWithWhisperX({ audioUrl, stanzas });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[lyrics/sync] Erro na sincronização automática:', error);
    return res.status(422).json({
      code: 'LYRICS_SYNC_FAILED',
      error: error.message || 'Não foi possível sincronizar a letra automaticamente.',
    });
  }
};