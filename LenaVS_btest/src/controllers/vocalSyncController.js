import { downloadSourceValueToTempFile, removeLocalFileSilently } from '../services/storageService.js';
import { synchronizeExistingBlocks } from '../utils/ownVocalSync.js';
export const synchronizeVocalBlocks = async (req, res) => {
  const audioUrl = typeof req.body?.audioUrl === 'string' ? req.body.audioUrl.trim() : '';
  const blocks = Array.isArray(req.body?.blocks) ? req.body.blocks : [];
  if (!audioUrl) return res.status(400).json({ error: 'Música original não encontrada.' });
  if (!blocks.length) return res.status(400).json({ error: 'A letra processada não possui blocos.' });
  if (blocks.some((b) => !b || b.id === undefined || b.id === null)) return res.status(400).json({ error: 'Bloco inválido.' });
  let audioPath = null;
  try {
    audioPath = await downloadSourceValueToTempFile(audioUrl, { prefix: 'vocal-sync', fallbackName: 'original.mp3', mimeType: 'audio/mpeg', folder: 'vocal-sync' });
    const result = await synchronizeExistingBlocks(audioPath, blocks);
    return res.status(200).json({ success: true, duration: result.duration, vocalRegions: result.regions, blocks: result.blocks, detector: 'LenaVS Vocal Detector v1' });
  } catch (error) { console.error('[vocal-sync]', error); return res.status(422).json({ error: error.message || 'Não foi possível analisar o áudio.' }); }
  finally { if (audioPath) await removeLocalFileSilently(audioPath); }
};
