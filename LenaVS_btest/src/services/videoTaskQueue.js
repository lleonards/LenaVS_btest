import { Worker } from 'worker_threads';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  ensureTaskStore,
  createTaskRecord,
  getTaskRecord,
  updateTaskRecord,
  listRecoverableTasks,
} from './videoTaskStore.js';

const clampInteger = (value, fallback, min, max) => {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
};

const friendlyErrorMessage = (error) => {
  const message = String(error?.message || error || 'Erro ao processar o vídeo').trim();
  return message || 'Erro ao processar o vídeo';
};

const toPublicStatus = (internalStatus) => {
  if (internalStatus === 'completed') return 'completed';
  if (internalStatus === 'error') return 'error';
  return 'processing';
};

class VideoTaskQueue {
  constructor() {
    const cpuCount = Math.max(1, os.cpus().length || 1);
    const defaultWorkers = Math.max(1, Math.min(4, cpuCount - 1 || 1));

    this.workerConcurrency = clampInteger(process.env.VIDEO_WORKER_CONCURRENCY, defaultWorkers, 1, 8);
    this.maxAttempts = clampInteger(process.env.VIDEO_TASK_MAX_ATTEMPTS, 3, 1, 10);
    this.maxPendingTasks = clampInteger(process.env.VIDEO_MAX_PENDING_TASKS, 100, 5, 1000);
    this.syncWaitTimeoutMs = clampInteger(process.env.VIDEO_SYNC_WAIT_TIMEOUT_MS, 840000, 60000, 1800000);
    this.events = new EventEmitter();
    this.events.setMaxListeners(0);
    this.queue = [];
    this.activeWorkers = new Map();
    this.started = false;
    this.startPromise = null;
  }

  async start() {
    if (this.started) {
      return;
    }

    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = (async () => {
      await ensureTaskStore();
      const recoverableTasks = await listRecoverableTasks();

      for (const task of recoverableTasks) {
        if (!this.queue.includes(task.id)) {
          this.queue.push(task.id);
        }
      }

      this.started = true;
      this.startPromise = null;
      this._drainQueue();
    })();

    await this.startPromise;
  }

  getSynchronousResponseTimeoutMs() {
    return this.syncWaitTimeoutMs;
  }

  async enqueueTask({ userId, payload }) {
    await this.start();

    if (this.queue.length + this.activeWorkers.size >= this.maxPendingTasks) {
      const error = new Error('O sistema está com alto volume no momento. Tente novamente em instantes.');
      error.status = 503;
      throw error;
    }

    const task = await createTaskRecord({
      id: randomUUID(),
      userId,
      payload,
      status: 'queued',
      progress: 0,
      maxAttempts: this.maxAttempts,
      stage: 'queued',
      message: 'Preparando processamento',
    });

    console.info(`[video-task] nova task ${task.id} criada para usuário ${userId}`);
    this.queue.push(task.id);
    this.events.emit(task.id, task);
    this._drainQueue();

    return task;
  }

  async getTaskForUser(taskId, userId) {
    const task = await getTaskRecord(taskId);
    if (!task) {
      return null;
    }

    if (String(task.userId) !== String(userId)) {
      return null;
    }

    return task;
  }

  async getPublicTaskStatus(taskId, userId) {
    const task = await this.getTaskForUser(taskId, userId);
    if (!task) {
      return null;
    }

    return this._toPublicTask(task);
  }

  async waitForCompletion(taskId, timeoutMs = this.syncWaitTimeoutMs) {
    const current = await getTaskRecord(taskId);
    if (current && ['completed', 'error'].includes(current.status)) {
      return current;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(async () => {
        cleanup();
        const latest = await getTaskRecord(taskId);
        resolve(latest);
      }, timeoutMs);

      const listener = (task) => {
        if (!task || !['completed', 'error'].includes(task.status)) {
          return;
        }

        cleanup();
        resolve(task);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.events.removeListener(taskId, listener);
      };

      this.events.on(taskId, listener);
    });
  }

  async _handleWorkerProgress(taskId, message) {
    const updatedTask = await updateTaskRecord(taskId, {
      progress: Math.min(99, Math.max(1, Number(message.progress) || 0)),
      stage: message.stage || 'processing',
      message: message.message || 'Processando vídeo',
      status: 'processing',
      lastHeartbeatAt: new Date().toISOString(),
    });

    if (updatedTask) {
      this.events.emit(taskId, updatedTask);
    }
  }

  async _handleWorkerSuccess(taskId, result) {
    const updatedTask = await updateTaskRecord(taskId, {
      status: 'completed',
      progress: 100,
      stage: 'completed',
      message: 'Vídeo pronto para download',
      result,
      error: null,
      completedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    });

    console.info(`[video-task] task ${taskId} concluída com sucesso`);

    if (updatedTask) {
      this.events.emit(taskId, updatedTask);
    }
  }

  async _handleWorkerFailure(taskId, attempt, error) {
    const latest = await getTaskRecord(taskId);
    const nextAttempt = Number(attempt) || 1;
    const maxAttempts = Number(latest?.maxAttempts) || this.maxAttempts;
    const message = friendlyErrorMessage(error);

    if (nextAttempt < maxAttempts) {
      console.warn(`[video-task] task ${taskId} falhou na tentativa ${nextAttempt}. Nova tentativa será executada.`);
      const updatedTask = await updateTaskRecord(taskId, {
        status: 'queued',
        progress: 0,
        stage: 'retrying',
        message: 'Reprocessando vídeo após instabilidade',
        error: message,
        lastHeartbeatAt: new Date().toISOString(),
      });

      if (updatedTask) {
        this.events.emit(taskId, updatedTask);
      }

      const retryDelayMs = Math.min(15000, 2000 * nextAttempt);
      setTimeout(() => {
        if (!this.queue.includes(taskId)) {
          this.queue.push(taskId);
          this._drainQueue();
        }
      }, retryDelayMs);

      return;
    }

    console.error(`[video-task] task ${taskId} encerrada com erro definitivo: ${message}`);
    const updatedTask = await updateTaskRecord(taskId, {
      status: 'error',
      progress: 0,
      stage: 'error',
      message: 'Não foi possível concluir o vídeo',
      error: message,
      completedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    });

    if (updatedTask) {
      this.events.emit(taskId, updatedTask);
    }
  }

  async _processTask(taskId) {
    const task = await getTaskRecord(taskId);
    if (!task || ['completed', 'error'].includes(task.status) || this.activeWorkers.has(taskId)) {
      return;
    }

    const attempt = (Number(task.attempts) || 0) + 1;
    const workerPath = new URL('../workers/videoTaskWorker.js', import.meta.url);

    console.info(`[video-task] iniciando task ${taskId} (tentativa ${attempt})`);
    const updatedTask = await updateTaskRecord(taskId, {
      status: 'processing',
      progress: Math.max(1, Number(task.progress) || 0),
      attempts: attempt,
      stage: 'processing',
      message: 'Iniciando processamento do vídeo',
      startedAt: task.startedAt || new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      error: null,
    });

    if (updatedTask) {
      this.events.emit(taskId, updatedTask);
    }

    const worker = new Worker(workerPath, {
      workerData: {
        taskId,
        userId: task.userId,
        payload: task.payload,
      },
    });

    this.activeWorkers.set(taskId, worker);

    let settled = false;
    const finish = async () => {
      this.activeWorkers.delete(taskId);
      this._drainQueue();
    };

    worker.on('message', async (message) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'progress') {
        await this._handleWorkerProgress(taskId, message);
        return;
      }

      if (message.type === 'completed' && !settled) {
        settled = true;
        await this._handleWorkerSuccess(taskId, message.result);
        await finish();
        return;
      }

      if (message.type === 'failed' && !settled) {
        settled = true;
        await this._handleWorkerFailure(taskId, attempt, new Error(message.error));
        await finish();
      }
    });

    worker.on('error', async (error) => {
      if (settled) return;
      settled = true;
      await this._handleWorkerFailure(taskId, attempt, error);
      await finish();
    });

    worker.on('exit', async (code) => {
      if (settled) return;
      if (code === 0) {
        await finish();
        return;
      }

      settled = true;
      await this._handleWorkerFailure(taskId, attempt, new Error(`Worker finalizado com código ${code}`));
      await finish();
    });
  }

  _drainQueue() {
    while (this.activeWorkers.size < this.workerConcurrency && this.queue.length > 0) {
      const nextTaskId = this.queue.shift();
      if (!nextTaskId) {
        continue;
      }

      if (this.activeWorkers.has(nextTaskId)) {
        continue;
      }

      this._processTask(nextTaskId).catch(async (error) => {
        console.error('Erro ao iniciar task de vídeo:', error);
        await this._handleWorkerFailure(nextTaskId, 1, error);
        this.activeWorkers.delete(nextTaskId);
        this._drainQueue();
      });
    }
  }

  _toPublicTask(task) {
    return {
      taskId: task.id,
      status: toPublicStatus(task.status),
      progress: task.status === 'completed' ? 100 : Math.max(0, Math.min(99, Number(task.progress) || 0)),
      message:
        task.status === 'completed'
          ? 'Vídeo pronto para download'
          : task.status === 'error'
          ? task.error || 'Não foi possível concluir o vídeo'
          : task.message || 'Processando vídeo',
      videoUrl: task.result?.videoUrl || null,
      fileName: task.result?.fileName || null,
      downloadFileName: task.result?.downloadFileName || null,
      error: task.status === 'error' ? task.error || 'Erro ao processar o vídeo' : null,
    };
  }
}

let singleton = null;

export const getVideoTaskQueue = () => {
  if (!singleton) {
    singleton = new VideoTaskQueue();
  }

  return singleton;
};

export const initializeVideoTaskQueue = async () => {
  const queue = getVideoTaskQueue();
  await queue.start();
  return queue;
};
