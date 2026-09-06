import crypto from 'crypto';

const TASK_TTL_MS = Number(process.env.LYRICS_SYNC_TASK_TTL_MS || 60 * 60 * 1000);
const tasks = new Map();
const requestKeys = new Map();

const now = () => new Date().toISOString();

const cleanupExpiredTasks = () => {
  const expirationTime = Date.now() - TASK_TTL_MS;

  for (const [taskId, task] of tasks.entries()) {
    if (new Date(task.updatedAt).getTime() < expirationTime) {
      tasks.delete(taskId);
      if (task.requestKey) {
        requestKeys.delete(`${task.userId}:${task.requestKey}`);
      }
    }
  }
};

const toPublicTask = (task) => {
  if (!task) return null;

  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    stage: task.stage,
    message: task.message,
    timings: task.timings,
    words: task.words,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
};

export const createOrGetLyricsSyncTask = ({ userId, requestKey, audioUrl, blocks }) => {
  cleanupExpiredTasks();

  const normalizedRequestKey = String(requestKey || '').trim();
  const deduplicationKey = normalizedRequestKey
    ? `${userId}:${normalizedRequestKey}`
    : null;

  if (deduplicationKey) {
    const existingTaskId = requestKeys.get(deduplicationKey);
    const existingTask = existingTaskId ? tasks.get(existingTaskId) : null;

    if (existingTask) {
      return existingTask;
    }

    requestKeys.delete(deduplicationKey);
  }

  const timestamp = now();
  const task = {
    id: crypto.randomUUID(),
    userId,
    requestKey: normalizedRequestKey || null,
    audioUrl,
    blocks,
    status: 'queued',
    progress: 0,
    stage: 'queued',
    message: 'Sincronização aguardando processamento.',
    timings: null,
    words: 0,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  tasks.set(task.id, task);
  if (deduplicationKey) {
    requestKeys.set(deduplicationKey, task.id);
  }

  return task;
};

export const getLyricsSyncTaskForUser = (taskId, userId) => {
  cleanupExpiredTasks();
  const task = tasks.get(String(taskId || ''));

  if (!task || task.userId !== userId) {
    return null;
  }

  return task;
};

export const updateLyricsSyncTask = (taskId, patch = {}) => {
  const task = tasks.get(taskId);
  if (!task) return null;

  Object.assign(task, patch, { updatedAt: now() });
  return task;
};

export const publicLyricsSyncTask = toPublicTask;