const MAX_JOB_AGE_MS = 60 * 60 * 1000;
const jobs = new Map();

export const createSyncJob = () => {
  const id = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  jobs.set(id, {
    id,
    status: 'queued',
    createdAt: Date.now(),
    result: null,
    error: null,
  });
  return jobs.get(id);
};

export const updateSyncJob = (id, patch) => {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
};

export const getSyncJob = (id) => jobs.get(id) || null;

// Limpa jobs antigos periodicamente (memória do processo)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > MAX_JOB_AGE_MS) {
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000);
cleanupTimer.unref?.();
