import { alignBlocksWithAudio } from '../services/lyricsSyncService.js';
import {
  createOrGetLyricsSyncTask,
  getLyricsSyncTaskForUser,
  publicLyricsSyncTask,
  updateLyricsSyncTask,
} from '../services/lyricsSyncTaskStore.js';

const getFailurePayload = (error) => {
  const isDepsMissing = error?.code === 'ALIGNER_DEPS_MISSING';
  const isTimeout = error?.code === 'ALIGNER_TIMEOUT';

  return {
    code: error?.code || 'LYRICS_SYNC_FAILED',
    error: isDepsMissing
      ? 'O alinhador de letras não está instalado no servidor. Instale as dependências Python antes de usar este recurso.'
      : isTimeout
        ? 'A análise da música excedeu o tempo limite. Tente novamente com um áudio menor.'
        : 'Não foi possível sincronizar a letra com a música. Nenhum tempo foi alterado — seus blocos e sua letra permanecem intactos. Confira se a letra corresponde ao áudio enviado e tente novamente.',
  };
};

const runLyricsSyncTask = async (task) => {
  updateLyricsSyncTask(task.id, {
    status: 'running',
    progress: 5,
    stage: 'downloading',
    message: 'Baixando a música para análise…',
  });

  try {
    const result = await alignBlocksWithAudio({
      audioUrl: task.audioUrl,
      blocks: task.blocks,
      onProgress: ({ progress, stage, message }) => {
        updateLyricsSyncTask(task.id, {
          status: 'running',
          progress,
          stage,
          message,
        });
      },
    });

    updateLyricsSyncTask(task.id, {
      status: 'completed',
      progress: 100,
      stage: 'completed',
      message: 'Letra sincronizada com sucesso.',
      timings: result.timings,
      words: result.words,
    });
  } catch (error) {
    console.error('[lyricsSync] Falha na tarefa:', error?.message);
    if (error?.stderr) {
      console.error('[lyricsSync] stderr:', String(error.stderr).slice(0, 3000));
    }

    const failure = getFailurePayload(error);
    updateLyricsSyncTask(task.id, {
      status: 'failed',
      progress: 100,
      stage: 'failed',
      message: failure.error,
      error: failure,
    });
  }
};

export const syncLyricsBlocks = async (req, res) => {
  try {
    const audioUrl = String(req.body?.audioUrl || '').trim();
    const blocks = req.body?.blocks;
    const requestKey = String(req.body?.requestKey || '').trim().slice(0, 160);

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

    const task = createOrGetLyricsSyncTask({
      userId: req.user.id,
      requestKey,
      audioUrl,
      blocks: blocks.map((block) => ({ text: block.text })),
    });

    if (task.status === 'queued') {
      updateLyricsSyncTask(task.id, {
        status: 'starting',
        progress: 1,
        stage: 'queued',
        message: 'Sincronização iniciando…',
      });

      // Começa depois de enviar o 202 para não manter a conexão HTTP aberta
      // durante o download do áudio e o carregamento do modelo.
      setImmediate(() => {
        runLyricsSyncTask(task).catch((error) => {
          console.error('[lyricsSync] Erro inesperado na fila:', error);
          const failure = getFailurePayload(error);
          updateLyricsSyncTask(task.id, {
            status: 'failed',
            progress: 100,
            stage: 'failed',
            message: failure.error,
            error: failure,
          });
        });
      });
    }

    return res.status(202).json({
      success: true,
      async: true,
      task: publicLyricsSyncTask(task),
      taskId: task.id,
    });
  } catch (error) {
    console.error('[lyricsSync] Erro ao criar tarefa:', error?.message);
    return res.status(500).json({
      code: 'LYRICS_SYNC_QUEUE_FAILED',
      error: 'Não foi possível iniciar a sincronização. Tente novamente.',
    });
  }
};

export const getLyricsSyncStatus = (req, res) => {
  const task = getLyricsSyncTaskForUser(req.params.taskId, req.user.id);

  if (!task) {
    return res.status(404).json({
      code: 'LYRICS_SYNC_TASK_NOT_FOUND',
      error: 'A tarefa de sincronização não foi encontrada ou expirou.',
    });
  }

  const payload = publicLyricsSyncTask(task);
  if (task.status === 'failed' && task.error) {
    return res.status(200).json({ ...payload, ...task.error });
  }

  return res.status(200).json(payload);
};
