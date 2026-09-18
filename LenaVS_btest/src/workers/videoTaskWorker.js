import { parentPort, workerData } from 'worker_threads';
import { processVideoGenerationTask } from '../services/videoGenerationService.js';

const safePostMessage = (payload) => {
  if (parentPort) {
    parentPort.postMessage(payload);
  }
};

const run = async () => {
  try {
    const result = await processVideoGenerationTask({
      taskId: workerData.taskId,
      userId: workerData.userId,
      payload: workerData.payload,
      onProgress: async ({ progress, stage, message }) => {
        safePostMessage({
          type: 'progress',
          progress,
          stage,
          message,
        });
      },
    });

    safePostMessage({
      type: 'completed',
      result,
    });
  } catch (error) {
    safePostMessage({
      type: 'failed',
      error: error?.message || 'Erro ao processar o vídeo',
    });
    process.exitCode = 1;
  }
};

run();
