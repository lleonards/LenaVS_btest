import {
  createSyncJob,
  getSyncJob,
  updateSyncJob,
} from '../services/lyricsSyncStore.js';
import { runLyricsAlignment } from '../services/lyricsSyncService.js';

const MAX_BLOCKS = 200;

const normalizeStanzasPayload = (raw) => {
  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const output = [];

  for (const item of raw) {
    const id = String(item?.id || '').trim();
    const text = String(item?.text ?? '').replace(/\r/g, '').trim();

    if (!id || !text || seen.has(id)) continue;

    seen.add(id);
    output.push({ id, text });
  }

  return output;
};

const normalizeSyncError = (error) => {
  const code = error?.code;

  if (code === 'WHISPERX_UNAVAILABLE') {
    return 'O alinhamento WhisperX não está disponível no servidor. Verifique as dependências Python do backend (requirements-whisperx.txt).';
  }

  if (code === 'WHISPERX_TIMEOUT') {
    return 'A sincronização demorou mais do que o esperado. Tente novamente com um áudio menor ou em um horário com menos carga.';
  }

  if (code === 'WHISPERX_PROCESS_FAILED') {
    const stderr = String(error?.stderr || '').toLowerCase();

    if (stderr.includes('out of memory') || stderr.includes('cannot allocate memory') || stderr.includes('killed')) {
      return 'O servidor ficou sem memória ao processar o áudio. Aumente o plano da máquina ou reduza o tamanho do arquivo.';
    }

    if (stderr.includes('no module named whisperx')) {
      return 'O pacote WhisperX não está instalado no servidor.';
    }

    return 'O processo de alinhamento falhou. Consulte os logs do backend para o detalhe técnico.';
  }

  if (code === 'WHISPERX_INVALID_OUTPUT') {
    return 'O alinhamento retornou uma resposta inválida. Tente novamente.';
  }

  return error?.message || 'Erro ao sincronizar a letra. Tente novamente.';
};

/**
 * POST /api/lyrics/sync
 *
 * Recebe a música original + a letra JÁ organizada em blocos pela LenaVS.
 * Cria um job assíncrono e responde imediatamente com { jobId }.
 * O frontend faz polling em GET /api/lyrics/sync/:jobId até concluir.
 */
export const startLyricsSync = async (req, res) => {
  const audioUrl = String(req.body?.audioUrl || '').trim();
  const stanzas = normalizeStanzasPayload(req.body?.stanzas);

  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
    return res.status(400).json({ error: 'audioUrl inválido ou ausente' });
  }

  if (!stanzas.length) {
    return res.status(400).json({
      error: 'Nenhum bloco de letra válido foi recebido. Adicione a letra antes de sincronizar.',
    });
  }

  if (stanzas.length > MAX_BLOCKS) {
    return res.status(400).json({
      error: `A letra possui mais de ${MAX_BLOCKS} blocos. Divida em projetos menores.`,
    });
  }

  const job = createSyncJob();

  // Responde antes de processar (evita timeout do proxy/Render)
  res.status(202).json({ success: true, jobId: job.id });

  runLyricsAlignment({ audioUrl, stanzas })
    .then(({ blocks, words, language }) => {
      // REGRA PRINCIPAL: o WhisperX só descobre tempos; a estrutura da letra
      // da LenaVS (quantidade e ordem dos blocos) precisa ser preservada.
      if (blocks.length !== stanzas.length) {
        throw new Error('O alinhamento devolveu uma quantidade diferente de blocos.');
      }

      const orderMatches = blocks.every((block, index) => block.id === stanzas[index].id);
      if (!orderMatches) {
        throw new Error('O alinhamento devolveu os blocos em ordem diferente.');
      }

      updateSyncJob(job.id, {
        status: 'done',
        result: { blocks, words, language },
      });
    })
    .catch((error) => {
      console.error(`[lyricsSync] Falha no job ${job.id}:`, error?.message);
      if (error?.stderr) {
        console.error(`[lyricsSync] stderr do job ${job.id}:`, error.stderr);
      }
      updateSyncJob(job.id, {
        status: 'error',
        error: normalizeSyncError(error),
      });
    });
};

/**
 * GET /api/lyrics/sync/:jobId
 */
export const getLyricsSyncStatus = async (req, res) => {
  const job = getSyncJob(String(req.params?.jobId || ''));

  if (!job) {
    return res.status(404).json({
      error: 'Job de sincronização não encontrado ou expirado.',
    });
  }

  return res.json({ success: true, ...job });
};
