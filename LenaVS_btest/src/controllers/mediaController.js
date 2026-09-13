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
