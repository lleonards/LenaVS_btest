import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TASKS_DIR = path.join(__dirname, '../../uploads/tasks');

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
  return dirPath;
};

const getTaskFilePath = (taskId) => path.join(TASKS_DIR, `${taskId}.json`);

const writeJsonAtomic = async (filePath, data) => {
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tempPath, filePath);
};

export const ensureTaskStore = async () => {
  await ensureDir(TASKS_DIR);
};

export const createTaskRecord = async (task) => {
  await ensureTaskStore();
  const now = new Date().toISOString();
  const record = {
    id: task.id,
    userId: task.userId,
    payload: task.payload,
    status: task.status || 'queued',
    progress: task.progress ?? 0,
    attempts: task.attempts ?? 0,
    maxAttempts: task.maxAttempts ?? 3,
    stage: task.stage || 'queued',
    message: task.message || 'Preparando processamento',
    result: task.result || null,
    error: task.error || null,
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || now,
    startedAt: task.startedAt || null,
    completedAt: task.completedAt || null,
    lastHeartbeatAt: task.lastHeartbeatAt || null,
  };

  await writeJsonAtomic(getTaskFilePath(record.id), record);
  return record;
};

export const getTaskRecord = async (taskId) => {
  try {
    const raw = await fs.promises.readFile(getTaskFilePath(taskId), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

export const updateTaskRecord = async (taskId, patch = {}) => {
  const current = await getTaskRecord(taskId);
  if (!current) {
    return null;
  }

  const updated = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await writeJsonAtomic(getTaskFilePath(taskId), updated);
  return updated;
};

export const listTaskRecords = async () => {
  await ensureTaskStore();
  const entries = await fs.promises.readdir(TASKS_DIR);
  const tasks = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) => {
        const raw = await fs.promises.readFile(path.join(TASKS_DIR, entry), 'utf8');
        return JSON.parse(raw);
      })
  );

  return tasks.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
};

export const listRecoverableTasks = async () => {
  const tasks = await listTaskRecords();
  return tasks.filter((task) => ['queued', 'processing'].includes(task.status));
};
