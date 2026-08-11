import { separateIntoStanzas, processLyricsFile } from '../utils/lyricsProcessor.js';
import { removeLocalFileSilently } from '../services/storageService.js';
import { syncStanzasWithWhisper } from '../utils/voiceSync.js';

const MAX_SYNC_STANZAS = 120;

const formatEditorTimecode = (value) => {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const processManualLyrics = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Texto da letra não fornecido' });
    }

    const result = separateIntoStanzas(text);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Erro ao processar letra:', error);
    return res.status(500).json({ error: 'Erro ao processar letra' });
  }
};

export const processLyricsFileUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo de letra não fornecido' });
    }

    const result = await processLyricsFile(req.file.path);

    return res.status(200).json({
      success: true,
      fileName: req.file.originalname,
      ...result,
    });
  } catch (error) {
    console.error('Erro ao processar arquivo de letra:', error);
    const detail = String(error?.message || '').replace(/^Erro ao processar arquivo de letra:\s*/i, '');
    const message = detail.toLowerCase();
    const isUnsupported = /formato de arquivo não suportado/i.test(message);
    const isEmpty = /não foi encontrado texto legível/i.test(message);
    const isOcrFailure = /não foi possível reconhecer texto neste pdf/i.test(message);

    return res.status(isUnsupported || isEmpty || isOcrFailure ? 422 : 400).json({
      code: isUnsupported
        ? 'UNSUPPORTED_LYRICS_FORMAT'
        : isOcrFailure
          ? 'LYRICS_OCR_FAILED'
          : isEmpty
            ? 'LYRICS_TEXT_NOT_FOUND'
            : 'LYRICS_READ_ERROR',
      fileName: req.file?.originalname || null,
      error: isUnsupported
        ? `O arquivo "${req.file?.originalname || 'enviado'}" não tem um formato de letra aceito.`
        : isOcrFailure
          ? `Não foi possível reconhecer o texto do PDF "${req.file?.originalname || 'enviado'}" nem com OCR. Verifique a qualidade da imagem e tente novamente.`
          : isEmpty
            ? `Não foi possível ler uma letra no arquivo "${req.file?.originalname || 'enviado'}".`
          : `Erro ao ler o arquivo "${req.file?.originalname || 'enviado'}". Confirme que ele não está corrompido e tente novamente.`,
    });
  } finally {
    await removeLocalFileSilently(req.file?.path);
  }
};

/**
 * POST /api/lyrics/sync
 *
 * Sincroniza as estrofes já separadas com o vocal da música original.
 * A resposta mantém o texto e os IDs existentes, adicionando tempos precisos
 * para o preview/exportação e tempos MM:SS para os campos editáveis do editor.
 */
export const synchronizeLyrics = async (req, res) => {
  const audioUrl = typeof req.body?.audioUrl === 'string'
    ? req.body.audioUrl.trim()
    : '';
  const incomingStanzas = Array.isArray(req.body?.stanzas)
    ? req.body.stanzas
    : [];

  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
    return res.status(400).json({
      code: 'INVALID_AUDIO_URL',
      error: 'A música original não possui uma URL válida para sincronização.',
    });
  }

  const stanzas = incomingStanzas
    .slice(0, MAX_SYNC_STANZAS)
    .map((stanza, index) => ({
      id: stanza?.id ?? `stanza-${index + 1}`,
      text: String(stanza?.text || '').trim(),
    }))
    .filter((stanza) => stanza.text.length > 0);

  if (stanzas.length === 0) {
    return res.status(400).json({
      code: 'LYRICS_REQUIRED_FOR_SYNC',
      error: 'Envie uma letra com pelo menos uma estrofe antes de sincronizar.',
    });
  }

  try {
    const result = await syncStanzasWithWhisper(audioUrl, stanzas, {
      requireVocalTimestamps: true,
    });

    const syncedStanzas = stanzas.map((stanza, index) => {
      const segment = result?.segments?.[index];
      const startTime = Number(segment?.start);
      const endTime = Number(segment?.end);

      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
        return {
          ...stanza,
          startTime: '',
          endTime: '',
          syncStartTime: null,
          syncEndTime: null,
          showOnlyDuringVocal: true,
          syncConfidence: result?.analysis?.stanzas?.[index]?.confidence ?? 0,
        };
      }

      return {
        ...stanza,
        startTime: formatEditorTimecode(startTime),
        endTime: formatEditorTimecode(endTime),
        syncStartTime: startTime,
        syncEndTime: endTime,
        showOnlyDuringVocal: true,
        leadIn: 0,
        hasManualStart: false,
        hasManualEnd: false,
        syncConfidence: result?.analysis?.stanzas?.[index]?.confidence ?? 0,
        syncVerified: result?.analysis?.stanzas?.[index]?.verified ?? false,
      };
    });

    const syncedCount = syncedStanzas.filter(
      (stanza) => Number.isFinite(stanza.syncStartTime) && Number.isFinite(stanza.syncEndTime)
    ).length;

    if (syncedCount === 0) {
      return res.status(422).json({
        code: 'VOCAL_TIMESTAMPS_NOT_FOUND',
        error: 'Não foi possível detectar o vocal na música original. Tente outro arquivo ou ative o WhisperX/Whisper no backend.',
      });
    }

    return res.status(200).json({
      success: true,
      stanzas: syncedStanzas,
      analysis: result.analysis || null,
      syncedCount,
      totalCount: syncedStanzas.length,
    });
  } catch (error) {
    console.error('Erro ao sincronizar letra com vocal:', error);

    if (error?.code === 'VOCAL_TIMESTAMPS_NOT_FOUND') {
      return res.status(422).json({
        code: error.code,
        error: error.message,
      });
    }

    return res.status(500).json({
      code: 'LYRICS_SYNC_ERROR',
      error: error?.message || 'Não foi possível sincronizar a letra com o vocal.',
    });
  }
};
