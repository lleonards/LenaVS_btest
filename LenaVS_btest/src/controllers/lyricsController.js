// src/controllers/lyricsController.js
import { separateIntoStanzas } from '../services/stanzaLyrics.js';
import { processLyricsBuffer } from '../services/stanzaLyrics.js';
import { syncStanzasToAudio } from '../services/stanzaAligner.js';
import { formatSecondsToMmSs } from '../utils/mmSs.js';

const DEFAULT_STANZA_ID_PREFIX = 'stanza';

const safeId = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s.length > 0 ? s : fallback;
};

export async function processManualLyrics(req, res) {
  try {
    const { text } = req.validated;
    const result = separateIntoStanzas(text);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[lyrics/manual]', err);
    return res.status(500).json({ code: 'LYRICS_PROCESS_ERROR', error: 'Falha ao processar a letra.' });
  }
}

export async function processLyricsFileUpload(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 'NO_FILE', error: 'Arquivo de letra não enviado.' });
    }
    const result = await processLyricsBuffer(req.file.buffer, req.file.originalname || '');
    return res.json({
      success: true,
      fileName: req.file.originalname || null,
      ...result,
    });
  } catch (err) {
    console.error('[lyrics/upload]', err);
    return res.status(400).json({
      code: err.code || 'LYRICS_READ_ERROR',
      error: err.message || 'Falha ao ler o arquivo de letra.',
    });
  }
}

/**
 * POST /api/lyrics/sync
 *
 * Diferente do legado: **NUNCA** devolve 422 quando o motor não encontra vocal.
 * Sempre devolve 200 e marca as estrofes que estão em trecho sem vocal com
 * vocalPresence=false, deixando o frontend escondê-las naturalmente.
 */
export async function synchronizeLyrics(req, res) {
  const startedAt = Date.now();
  try {
    const { audioUrl, stanzas: incomingStanzas } = req.validated;

    const cleanedStanzas = incomingStanzas
      .map((s, idx) => ({
        id: safeId(s.id, `${DEFAULT_STANZA_ID_PREFIX}-${idx + 1}`),
        text: String(s.text || '').trim(),
      }))
      .filter((s) => s.text.length > 0);

    if (cleanedStanzas.length === 0) {
      return res.status(400).json({
        code: 'LYRICS_REQUIRED_FOR_SYNC',
        error: 'Envie ao menos uma estrofe com texto não vazio.',
      });
    }

    const audioMaxMinutes = Number(process.env.MAX_AUDIO_MINUTES || 15);

    const syncResult = await syncStanzasToAudio(audioUrl, cleanedStanzas, {
      audioMaxMinutes,
      leadInSec: Number(process.env.VAD_LEAD_IN_SEC || 0.35),
      trailOutSec: Number(process.env.VAD_TRAIL_OUT_SEC || 0.6),
    });

    const syncedStanzas = cleanedStanzas.map((stanza, idx) => {
      const slot = syncResult.assignments[idx] || {};
      const hasTimestamps =
        Number.isFinite(slot.start) && Number.isFinite(slot.end) && slot.end > slot.start;
      const hasVocal = slot.vocalPresence === true && hasTimestamps;
      const reason = slot.reason || (hasVocal ? 'vad-segment-aligned' : 'sem-vocal-confirmado');

      if (!hasVocal) {
        return {
          id: stanza.id,
          text: stanza.text,
          startTime: '00:00',
          endTime: '00:00',
          syncStartTime: null,
          syncEndTime: null,
          showOnlyDuringVocal: true,
          vocalPresence: false,
          syncVocalPresence: false,
          syncBlocked: true,
          syncVerified: false,
          syncReason: reason,
          syncConfidence: 0,
          leadIn: Number(process.env.VAD_LEAD_IN_SEC || 0.35),
          hasManualStart: false,
          hasManualEnd: false,
        };
      }

      return {
        id: stanza.id,
        text: stanza.text,
        startTime: formatSecondsToMmSs(slot.start),
        endTime: formatSecondsToMmSs(slot.end),
        syncStartTime: slot.start,
        syncEndTime: slot.end,
        showOnlyDuringVocal: true,
        vocalPresence: true,
        syncVocalPresence: true,
        syncBlocked: false,
        syncVerified: true,
        syncReason: reason,
        syncConfidence: Number((slot.confidence ?? 0).toFixed?.(3) ?? 0),
        leadIn: Number(process.env.VAD_LEAD_IN_SEC || 0.35),
        hasManualStart: false,
        hasManualEnd: false,
      };
    });

    const syncedCount = syncedStanzas.filter(
      (s) => Number.isFinite(s.syncStartTime) && Number.isFinite(s.syncEndTime)
    ).length;

    return res.json({
      success: true,
      syncedCount,
      totalCount: syncedStanzas.length,
      stanzas: syncedStanzas,
      analysis: {
        method: syncResult.method,
        audioDurationSec: syncResult.audioDurationSec,
        vocalRatio: syncResult.vocalRatio,
        vocalSegments: syncResult.vocalSegments,
        coverage: syncResult.coverage,
        elapsedMs: Date.now() - startedAt,
      },
    });
  } catch (err) {
    console.error('[lyrics/sync]', err);
    // Continua 4xx (não 5xx) porque o 4xx aqui é um erro real de input.
    const status = err.status && err.status < 500 ? err.status : 500;
    return res.status(status).json({
      code: err.code || 'SYNC_ERROR',
      error: err.userMessage || err.message || 'Falha ao sincronizar letra.',
    });
  }
}
