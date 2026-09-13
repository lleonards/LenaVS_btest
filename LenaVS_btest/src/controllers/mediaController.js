import fs from 'fs';
import path from 'path';
import {
  buildStorageObjectPath,
  createTempFilePath,
  uploadLocalFileToStorage,
  removeLocalFileSilently,
  downloadSourceValueToTempFile,
  inferContentType,
} from '../services/storageService.js';
import { alignLyrics } from '../services/lyricsAlignerService.js';
import { mapWordsToStanzas } from '../utils/lyricsAligner.js';
import { secondsToTime } from '../utils/lyricsProcessor.js';
import {
  createInstrumentalWithDemucsFromLocalFile,
  removeDirectorySilently,
} from '../services/demucsService.js';

const normalizeDemucsError = (error) => {
  if (!error) {
    return 'Erro ao criar instrumental com Demucs.';
  }

  if (error.code === 'DEMUCS_UNAVAILABLE') {
    return error.message;
  }

  if (error.code === 'DEMUCS_TIMEOUT') {
    return 'O Demucs demorou mais do que o esperado para concluir. Tente novamente com um áudio menor ou em um horário com menos carga.';
  }

  if (error.code === 'DEMUCS_OUTPUT_NOT_FOUND') {
    return 'O Demucs terminou, mas a faixa instrumental não foi encontrada. Verifique se o áudio enviado está íntegro e tente novamente.';
  }

  if (error.code === 'DEMUCS_PROCESS_FAILED') {
    const stderr = String(error.stderr || '').toLowerCase();

    if (stderr.includes('no module named demucs')) {
      return 'O pacote Demucs não está instalado no servidor. Instale as dependências Python do backend antes de usar esta função.';
    }

    if (stderr.includes('killed') || stderr.includes('out of memory') || stderr.includes('cannot allocate memory')) {
      return 'O servidor ficou sem memória ao separar o áudio com Demucs. Aumente o plano da máquina ou reduza o tamanho do arquivo.';
    }

    return 'O processo local do Demucs falhou ao separar o áudio. Consulte os logs do backend para ver o detalhe técnico.';
  }

  return error.message || 'Erro ao criar instrumental com Demucs.';
};

/**
 * POST /api/media/instrumental
 *
 * Gera versão instrumental (sem voz) usando Demucs executado localmente no servidor.
 * Faz upload do resultado para o Supabase Storage e retorna a URL pública.
 *
 * Body:    { audioUrl: string }
 * Response: { success: true, instrumentalUrl: string, duration?: number }
 */
export const createInstrumental = async (req, res) => {
  const userId = req.user?.id || req.user?.sub || 'anonymous';
  const rawAudioUrl = req.body?.audioUrl;
  const audioUrl = typeof rawAudioUrl === 'string' ? rawAudioUrl.trim() : '';

  if (!audioUrl) {
    return res.status(400).json({ error: 'audioUrl inválido ou ausente' });
  }

  let sourceAudioPath = null;
  let demucsJobRoot = null;
  let instrumentalLocalPath = null;

  try {
    console.log('[createInstrumental] Baixando áudio de origem para processamento local…');

    const fallbackName = (() => {
      try {
        return path.basename(new URL(audioUrl).pathname) || 'musica-original.mp3';
      } catch {
        return 'musica-original.mp3';
      }
    })();

    sourceAudioPath = await downloadSourceValueToTempFile(audioUrl, {
      prefix: 'instrumental-source',
      fallbackName,
      mimeType: 'audio/mpeg',
      folder: 'instrumental-source',
    });

    console.log('[createInstrumental] Executando Demucs local…');
    const demucsResult = await createInstrumentalWithDemucsFromLocalFile(sourceAudioPath);
    demucsJobRoot = demucsResult.jobRoot;
    instrumentalLocalPath = demucsResult.instrumentalPath;

    const storagePath = buildStorageObjectPath({
      category: 'media/instrumental',
      userId,
      prefix: 'instrumental',
      originalName: path.basename(instrumentalLocalPath || 'instrumental.mp3'),
      mimeType: 'audio/mpeg',
      fallbackExtension: '.mp3',
    });

    const uploaded = await uploadLocalFileToStorage({
      localPath: instrumentalLocalPath,
      storagePath,
      contentType: inferContentType({ originalName: instrumentalLocalPath, mimeType: 'audio/mpeg' }),
    });

    console.log('[createInstrumental] Instrumental enviado ao Supabase:', uploaded.publicUrl);

    return res.status(200).json({
      success: true,
      instrumentalUrl: uploaded.publicUrl,
      duration: demucsResult.duration,
      engine: 'demucs-local',
    });
  } catch (error) {
    console.error('[createInstrumental] Erro:', error.message);

    if (error?.stderr) {
      console.error('[createInstrumental] stderr:', error.stderr);
    }

    const status = error?.code === 'DEMUCS_UNAVAILABLE' ? 503 : 500;

    return res.status(status).json({
      error: normalizeDemucsError(error),
    });
  } finally {
    await removeLocalFileSilently(sourceAudioPath);
    await removeLocalFileSilently(instrumentalLocalPath);
    await removeDirectorySilently(demucsJobRoot);
  }
};

/**
 * POST /api/media/sync-lyrics
 *
 * Sincronização automática de letras com o Lyrics Aligner
 * (ctc-forced-aligner==1.0.2, executado em Python 3.12):
 *  - O Aligner apenas DESCOBRE os tempos de cada palavra cantada no áudio.
 *  - A estrutura de blocos da letra (usuario) é SEMPRE preservada: nenhum
 *    bloco é criado, excluído, dividido, juntado ou reorganizado.
 *  - Cada bloco recebe startTime (primeira palavra encontrada) e endTime
 *    (última palavra encontrada), em mm:ss (sem milissegundos).
 *
 * Body:    { audioUrl: string, stanzas: [{ id, text }], language?: string }
 * Response: { success, language, engine: 'lyrics-aligner',
 *             stanzas: [{ id, startTime, endTime, status, matchedWords, totalWords }] }
 */
export const syncLyricsWithAligner = async (req, res) => {
  const userId = req.user?.id || req.user?.sub || 'anonymous';
  const audioUrl = typeof req.body?.audioUrl === 'string' ? req.body.audioUrl.trim() : '';
  const stanzas = Array.isArray(req.body?.stanzas) ? req.body.stanzas : [];
  const language = typeof req.body?.language === 'string' ? req.body.language.trim() : '';

  const validStanzas = stanzas
    .map((stanza, index) => ({
      id: stanza?.id ?? `stanza-${index + 1}`,
      text: String(stanza?.text || '').trim(),
    }))
    .filter((stanza) => stanza.text.length > 0);

  if (!audioUrl) {
    return res.status(400).json({ error: 'audioUrl inválido ou ausente' });
  }

  if (!validStanzas.length) {
    return res.status(400).json({ error: 'Nenhuma letra (bloco) fornecida para sincronizar' });
  }

  let audioPath = null;
  let transcriptPath = null;

  try {
    const fallbackName = (() => {
      try {
        return path.basename(new URL(audioUrl).pathname) || 'musica-original.mp3';
      } catch {
        return 'musica-original.mp3';
      }
    })();

    audioPath = await downloadSourceValueToTempFile(audioUrl, {
      prefix: 'sync-lyrics-source',
      fallbackName,
      mimeType: 'audio/mpeg',
      folder: 'sync-lyrics',
    });

    transcriptPath = await createTempFilePath({
      prefix: 'lyrics-prompt',
      originalName: 'letra.txt',
      mimeType: 'text/plain',
      fallbackExtension: '.txt',
      folder: 'sync-lyrics',
    });

    await fs.promises.writeFile(
      transcriptPath,
      validStanzas.map((stanza) => stanza.text).join('\n'),
      'utf8'
    );

    console.log('[syncLyrics] Executando Lyrics Aligner (alinhamento de palavras)...');
    const result = await alignLyrics({ audioPath, transcriptPath, language });

    const mapped = mapWordsToStanzas(validStanzas, result.words || []);
    const formatted = mapped.map((item) => ({
      id: item.stanzaId,
      startTime: item.start != null ? secondsToTime(item.start) : null,
      endTime: item.end != null ? secondsToTime(item.end) : null,
      status: item.status,
      matchedWords: item.matchedCount,
      totalWords: item.totalWords,
    }));

    return res.json({
      success: true,
      language: result.language || null,
      engine: 'lyrics-aligner',
      stanzas: formatted,
    });
  } catch (error) {
    console.error('[syncLyrics] Erro:', error?.message || error);

    if (error?.stderr) {
      console.error('[syncLyrics] stderr:', error.stderr);
    }

    const status = error?.code === 'ALIGNER_UNAVAILABLE' ? 503 : 500;
    let message = 'Não foi possível sincronizar a letra automaticamente. Tente novamente ou ajuste os tempos manualmente.';

    if (error?.code === 'ALIGNER_UNAVAILABLE') {
      message = 'O Lyrics Aligner não está disponível no servidor. Verifique se o requirements-aligner.txt foi instalado em um ambiente Python 3.12.';
    } else if (error?.code === 'ALIGNER_TIMEOUT') {
      message = 'A sincronização demorou mais do que o esperado. Tente com um áudio mais curto ou em um horário com menos carga.';
    } else if (error?.code === 'ALIGNER_PROCESS_FAILED') {
      message = 'Não foi possível alinhar esta música com a letra. Este recurso pode não funcionar 100% — revise os tempos manualmente.';
    }

    return res.status(status).json({ code: 'SYNC_FAILED', error: message });
  } finally {
    if (audioPath) await removeLocalFileSilently(audioPath);
    if (transcriptPath) await removeLocalFileSilently(transcriptPath);
  }
};
