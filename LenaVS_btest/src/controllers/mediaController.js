import path from 'path';
import {
  buildStorageObjectPath,
  uploadLocalFileToStorage,
  removeLocalFileSilently,
  downloadSourceValueToTempFile,
  inferContentType,
} from '../services/storageService.js';
import {
  createInstrumentalWithDemucsFromLocalFile,
  removeDirectorySilently,
} from '../services/demucsService.js';
import { alignLyricsWithAudio } from '../services/lyricsAlignmentService.js';

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
 * Sincroniza automaticamente a letra (já organizada em blocos na LenaVS) com a
 * música original, usando forced alignment palavra por palavra.
 *
 * Body: {
 *   audioUrl: string,                     // URL pública da música original
 *   stanzas: [{ text: string, id?: string }]  // blocos EXATOS da LenaVS
 * }
 *
 * Response: {
 *   success: true,
 *   engine: 'torchaudio-mms-fa',
 *   alignedOn: 'vocals' | 'original',
 *   duration: number,
 *   blocks: [{
 *     index, text, startTime, endTime, matched, words: [{word, start, end}]
 *   }]
 * }
 *
 * Regras de negócio:
 *  - A letra NÃO é reorganizada: os blocos são alinhados na ordem exata enviada;
 *  - Bloco.início = momento em que a 1ª palavra do bloco é cantada;
 *  - Bloco.fim    = momento em que a última palavra do bloco é cantada;
 *  - O editor continua exibindo apenas mm:ss (sem milissegundos).
 */
export const syncLyricsWithAudio = async (req, res) => {
  const rawAudioUrl = typeof req.body?.audioUrl === 'string' ? req.body.audioUrl.trim() : '';
  const rawBlocks = Array.isArray(req.body?.stanzas) ? req.body.stanzas : (Array.isArray(req.body?.blocks) ? req.body.blocks : []);

  if (!rawAudioUrl) {
    return res.status(400).json({ error: 'audioUrl inválido ou ausente' });
  }

  const blocks = rawBlocks
    .map((b) => ({ text: String(b?.text ?? b ?? '').trim() }))
    .filter((b) => b.text.length > 0);

  if (blocks.length === 0) {
    return res.status(400).json({ error: 'Envie a letra em blocos (stanzas) para sincronizar.' });
  }

  let sourceAudioPath = null;

  try {
    console.log('[syncLyrics] Baixando áudio de origem para o alinhamento…');

    sourceAudioPath = await downloadSourceValueToTempFile(rawAudioUrl, {
      prefix: 'sync-source',
      fallbackName: 'musica-original.mp3',
      mimeType: 'audio/mpeg',
      folder: 'lyrics-sync',
    });

    const result = await alignLyricsWithAudio({
      audioPath: sourceAudioPath,
      blocks,
      preferVocals: true,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[syncLyrics] Erro:', error.message);

    if (error?.code === 'ALIGNMENT_UNAVAILABLE') {
      return res.status(503).json({ code: error.code, error: error.message });
    }

    const status = error?.code === 'ALIGNMENT_TIMEOUT' ? 504 : 500;
    return res.status(status).json({
      code: error?.code || 'LYRICS_ALIGNMENT_FAILED',
      error: error.message || 'Falha ao sincronizar a letra.',
    });
  } finally {
    await removeLocalFileSilently(sourceAudioPath);
  }
};
