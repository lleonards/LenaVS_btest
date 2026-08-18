import { syncBlocksFromAudioUrl } from '../services/blockDrivenSync.js';

export const synchronizeLyricsBlocks = async (req, res) => {
  try {
    const { audioUrl, blocks } = req.body || {};
    const result = await syncBlocksFromAudioUrl(audioUrl, blocks);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[block-sync] erro:', error);
    return res.status(422).json({ code: 'LYRICS_SYNC_FAILED', error: error.message || 'Não foi possível sincronizar a letra.' });
  }
};
