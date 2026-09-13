import { EventEmitter } from 'events';

const clampInteger = (value, fallback, min, max) => {
  const numeric = Number.parseInt(value, 10);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
};

const createQueueError = (message, code = 'RESOURCE_QUEUE_FULL') => {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  return error;
};

/**
 * Serializa os processos que mais consomem CPU/RAM.
 *
 * O servidor de produção da LenaVS pode ter apenas 1 vCPU e 2 GB de RAM.
 * Renderização, Lyrics Aligner e Demucs não devem rodar em paralelo nesse
 * cenário. A fila é intencionalmente pequena: é melhor responder 503 e
 * preservar o servidor do que acumular processos que serão mortos pelo OOM.
 */
class HeavyTaskGate {
  constructor() {
    this.concurrency = clampInteger(
      process.env.HEAVY_TASK_CONCURRENCY,
      1,
      1,
      2
    );
    this.maxPending = clampInteger(
      process.env.HEAVY_TASK_MAX_PENDING,
      2,
      1,
      10
    );
    this.active = 0;
    this.pending = [];
    this.events = new EventEmitter();
    this.events.setMaxListeners(0);
  }

  getStatus() {
    return {
      active: this.active,
      pending: this.pending.length,
      concurrency: this.concurrency,
      maxPending: this.maxPending,
    };
  }

  run(label, task) {
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('A tarefa pesada precisa ser uma função.'));
    }

    if (this.pending.length >= this.maxPending) {
      return Promise.reject(createQueueError(
        'O servidor está processando outras tarefas pesadas. Tente novamente em alguns instantes.'
      ));
    }

    return new Promise((resolve, reject) => {
      this.pending.push({
        label: String(label || 'heavy-task'),
        task,
        resolve,
        reject,
      });
      this._drain();
    });
  }

  _drain() {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const item = this.pending.shift();
      if (!item) continue;

      this.active += 1;
      this.events.emit('started', {
        label: item.label,
        ...this.getStatus(),
      });

      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active = Math.max(0, this.active - 1);
          this.events.emit('finished', {
            label: item.label,
            ...this.getStatus(),
          });
          this._drain();
        });
    }
  }
}

let singleton = null;

export const getHeavyTaskGate = () => {
  if (!singleton) {
    singleton = new HeavyTaskGate();
  }

  return singleton;
};

export const getHeavyTaskStatus = () => getHeavyTaskGate().getStatus();