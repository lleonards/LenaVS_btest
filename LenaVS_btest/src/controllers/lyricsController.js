import { separateIntoStanzas, processLyricsFile } from '../utils/lyricsProcessor.js';
import { removeLocalFileSilently } from '../services/storageService.js';
import { syncStanzasWithWhisper } from '../utils/voiceSync.js';

const formatSyncTimecode = (value) => {
  const safe = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const centiseconds = Math.round((safe - Math.floor(safe)) * 100);

  const normalizedSeconds = centiseconds >= 100 ? seconds + 1 : seconds;
  const normalizedCentiseconds = centiseconds >= 100 ? 0 : centiseconds;
  const normalizedMinutes = normalizedSeconds >= 60 ? minutes + 1 : minutes;
  const finalSeconds = normalizedSeconds >= 60 ? 0 : normalizedSeconds;

  return `${String(normalizedMinutes).padStart(2, '0')}:${String(finalSeconds).padStart(2, '0')}.${String(normalizedCentiseconds).padStart(2, '0')}`;
};

const normalizeInputStanzas = (stanzas = []) => (
  (Array.isArray(stanzas) ? stanzas : [])
    .map((stanza, index) => ({
      id: stanza?.id ?? `stanza-${index + 1}`,
      text: String(stanza?.text || '').replace(/\r/g, '').trim(),
    }))
    .filter((stanza) => stanza.text.length > 0)
);

const buildAutoSyncSummary = (analysis, total) => {
  const verifiedCount = Number(analysis?.verifiedCount || 0);
  const lowConfidenceCount = Number(analysis?.lowConfidenceCount || 0);
  const speechSegmentsDetected = Number(analysis?.speechSegmentsDetected || 0);

  if (verifiedCount > 0) {
    return {
      type: lowConfidenceCount > 0 ? 'warning' : 'success',
      message: lowConfidenceCount > 0
        ? `Sincronização concluída. ${verifiedCount}/${total} blocos ficaram com alta confiança e ${lowConfidenceCount} precisam de revisão manual.`
        : `Sincronização concluída. ${verifiedCount}/${total} blocos foram alinhados com alta confiança.`,
      speechSegmentsDetected,
    };
  }

  return {
    type: 'warning',
    message: `Sincronização concluída em modo assistido. Revise manualmente os ${total} blocos antes de exportar.`,
    speechSegmentsDetected,
  };
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

export const autoSyncLyrics = async (req, res) => {
  try {
    const audioUrl = String(req.body?.audioUrl || '').trim();
    const stanzas = normalizeInputStanzas(req.body?.stanzas || []);

    if (!audioUrl) {
      return res.status(400).json({ error: 'A música original não foi informada para a sincronização automática.' });
    }

    if (!stanzas.length) {
      return res.status(400).json({ error: 'Nenhum bloco de letra processado foi enviado para sincronização.' });
    }

    const syncResult = await syncStanzasWithWhisper(audioUrl, stanzas, {
      preserveIncomingStanzas: true,
    });

    const segments = Array.isArray(syncResult?.segments) ? syncResult.segments : [];
    const analysis = syncResult?.analysis || null;

    if (segments.length !== stanzas.length) {
      return res.status(500).json({
        error: 'A sincronização retornou uma quantidade de segmentos diferente da quantidade de blocos existentes.',
      });
    }

    const timings = stanzas.map((stanza, index) => {
      const segment = segments[index] || {};
      const start = Math.max(0, Number(segment.start || 0));
      const end = Math.max(start, Number(segment.end || start));
      const analysisEntry = analysis?.stanzas?.[index] || {};

      return {
        id: stanza.id,
        index,
        text: stanza.text,
        startSeconds: Number(start.toFixed(3)),
        endSeconds: Number(end.toFixed(3)),
        startTime: formatSyncTimecode(start),
        endTime: formatSyncTimecode(end),
        showOnlyDuringVocal: segment.showOnlyDuringVocal !== false,
        syncConfidence: segment.confidence ?? analysisEntry.confidence ?? null,
        syncVerified: Boolean(segment.verified ?? analysisEntry.verified),
        syncLowConfidence: Boolean(segment.lowConfidence ?? analysisEntry.lowConfidence ?? true),
        vocalPresence: Boolean(segment.vocalPresence ?? analysisEntry.vocalPresence),
        speechActivityDetected: Boolean(analysisEntry.speechActivityDetected),
        syncSource: analysis?.source || 'original',
        syncEngine: analysis?.transcriptionEngine || 'local-detector',
        syncReason: analysisEntry.reason || null,
      };
    });

    const summary = buildAutoSyncSummary(analysis, stanzas.length);

    return res.status(200).json({
      success: true,
      timings,
      analysis,
      summary,
    });
  } catch (error) {
    console.error('Erro na sincronização automática da letra:', error);
    return res.status(500).json({
      error: error?.message || 'Não foi possível sincronizar a letra automaticamente.',
    });
  }
};
