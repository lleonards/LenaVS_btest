import {
  syncLyricsStanzasWithAligner,
} from '../services/lyricsAlignerService.js';

/**
 * POST /api/lyrics/auto-sync
 *
 * Sincronização automática: usa o Lyrics Aligner como motor de alinhamento.
 *
 * O Lyrics Aligner analisa a música junto com a letra fornecida pelo usuário
 * e identifica o momento exato em que cada palavra da letra é cantada.
 *
 * A LenaVS já separa a letra em blocos conforme o usuário escreveu —
 * essa organização é mantida EXATAMENTE como está. O Lyrics Aligner serve
 * apenas para descobrir os tempos das palavras. Ele NÃO cria, exclui,
 * divide, junta ou reorganiza blocos.
 *
 * Body:    { audioUrl: string, blocks: [{ text: string }] }
 * Response:{ success: true, blocks: [{ text, startTime, endTime }], ... }
 *
 * startTime/endTime são segundos com milissegundos (ex.: 10.012).
 * O editor continua mostrando somente minutos e segundos (mm:ss).
 */
export const autoSyncLyrics = async (req, res) => {
  try {
    const rawAudioUrl = req.body?.audioUrl;
    const audioUrl = typeof rawAudioUrl === 'string' ? rawAudioUrl.trim() : '';
    const rawBlocks = req.body?.blocks;

    if (!audioUrl) {
      return res.status(400).json({ code: 'SYNC_AUDIO_URL_MISSING', error: 'audioUrl da música original inválido ou ausente' });
    }

    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
      return res.status(400).json({ code: 'SYNC_BLOCKS_MISSING', error: 'Nenhum bloco de letra fornecido' });
    }

    const blocks = rawBlocks
      .map((block) => ({ text: String(block?.text ?? '') }))
      .filter((block) => block.text.length > 0);

    if (!blocks.length) {
      return res.status(400).json({ code: 'SYNC_BLOCKS_MISSING', error: 'Nenhum bloco de letra fornecido' });
    }

    console.log('[autoSyncLyrics] Executando Lyrics Aligner…');

    const result = await syncLyricsStanzasWithAligner(audioUrl, blocks);

    return res.status(200).json({
      success: true,
      engine: 'lyrics-aligner-ctc',
      ...result,
    });
  } catch (error) {
    console.error('[autoSyncLyrics] Erro:', error?.message);

    if (error?.stderr) {
      console.error('[autoSyncLyrics] stderr:', error.stderr);
    }

    const message = String(error?.message || '');

    if (error?.code === 'LYRICS_ALIGNER_DISABLED') {
      return res.status(503).json({ code: 'LYRICS_ALIGNER_DISABLED', error: 'O Lyrics Aligner está desativado no servidor. Habilite LYRICS_ALIGNER_ENABLED=1 para usar a sincronização automática.' });
    }

    if (error?.code === 'LYRICS_ALIGNER_TIMEOUT') {
      return res.status(504).json({ code: 'LYRICS_ALIGNER_TIMEOUT', error: 'O Lyrics Aligner demorou mais do que o esperado para concluir. Tente novamente com uma música menor ou em um horário com menos carga.' });
    }

    if (error?.code === 'LYRICS_ALIGNER_OUTPUT_NOT_FOUND' || error?.code === 'LYRICS_ALIGNER_OUTPUT_INVALID') {
      return res.status(502).json({ code: 'LYRICS_ALIGNER_FAILED', error: 'O Lyrics Aligner concluiu, mas não retornou alinhamento legível. Tente novamente com uma música mais limpa ou verifique a letra.' });
    }

    if (error?.code === 'LYRICS_ALIGNER_EMPTY') {
      return res.status(422).json({ code: 'LYRICS_ALIGNER_EMPTY', error: 'O Lyrics Aligner não conseguiu alinhar nenhuma palavra da letra. Verifique se a letra corresponde ao que é cantado na música.' });
    }

    const isAlignerUnavailable = (
      message.includes('no module named ctc_forced_aligner')
      || message.includes('command not found')
      || message.includes('is not recognized as an internal or external command')
    );

    if (isAlignerUnavailable) {
      return res.status(503).json({ code: 'LYRICS_ALIGNER_UNAVAILABLE', error: 'O Lyrics Aligner não está disponível no servidor. Instale as dependências Python antes de usar a sincronização automática.' });
    }

    return res.status(500).json({
      error: 'Não foi possível sincronizar automaticamente. Tente novamente mais tarde.',
    });
  }
};
