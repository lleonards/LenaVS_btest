/**
 * lyricsSyncController.js
 *
 * POST /api/lyrics/sync
 *
 * Sincroniza automaticamente os blocos de letra com a música original usando
 * o ctc-forced-aligner 1.0.2 (Python 3.12).
 *
 * O Lyrics Aligner descobre o tempo de cada palavra. A LenaVS usa esses tempos
 * apenas para definir o início/fim de cada bloco EXISTENTE — a divisão em
 * blocos criada pelo usuário permanece exatamente como está.
 *
 * Atomicidade: a resposta de sucesso só sai quando TODOS os blocos foram
 * alinhados. Em qualquer falha, o endpoint responde erro e NENHUM tempo é
 * alterado — os blocos e a letra do usuário permanecem intactos.
 *
 * Body:     { audioUrl: string, blocks: [{ text: string }, ...] }
 * Response: { success: true, timings: [{ start: "mm:ss", end: "mm:ss" }, ...] }
 */

import { alignBlocksWithAudio } from '../services/lyricsSyncService.js';

export const syncLyricsBlocks = async (req, res) => {
  try {
    const audioUrl = String(req.body?.audioUrl || '').trim();
    const blocks = req.body?.blocks;

    if (!audioUrl) {
      return res.status(400).json({ error: 'audioUrl é obrigatório' });
    }

    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({ error: 'Nenhum bloco de letra foi enviado' });
    }

    const hasInvalidBlock = blocks.some(
      (block) => !block || typeof block !== 'object' || typeof block.text !== 'string'
    );

    if (hasInvalidBlock) {
      return res.status(400).json({ error: 'Formato de blocos inválido' });
    }

    const result = await alignBlocksWithAudio({ audioUrl, blocks });

    return res.status(200).json({
      success: true,
      timings: result.timings,
      words: result.words,
    });
  } catch (error) {
    console.error(
      '[lyricsSync] Erro na sincronização automática de letras:',
      error?.message
    );

    const isDepsMissing = error?.code === 'ALIGNER_DEPS_MISSING';
    const status = isDepsMissing ? 503 : 422;

    return res.status(status).json({
      code: error?.code || 'LYRICS_SYNC_FAILED',
      error: isDepsMissing
        ? 'O alinhador de letras (ctc-forced-aligner 1.0.2) não está instalado no servidor. Instale as dependências Python antes de usar este recurso.'
        : 'Não foi possível sincronizar a letra com a música. Nenhum tempo foi alterado — seus blocos e sua letra permanecem intactos. Confira se a letra corresponde ao áudio enviado e tente novamente.',
    });
  }
};
