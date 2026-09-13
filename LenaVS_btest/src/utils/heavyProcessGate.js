/**
 * heavyProcessGate.js
 *
 * Porteira de execução única para processos pesados (Demucs e Lyrics Aligner).
 *
 * Em máquina de 1 vCPU / 2GB, rodar dois processos Python/ffmpeg ao mesmo
 * tempo estoura CPU e memória. Este módulo serializa esses trabalhos:
 *  - 1 em execução + 1 na fila;
 *  - se já houver 2 aguardando, rejeita com HEAVY_BUSY (o controller devolve 503).
 */

let running = 0;
let waiting = 0;
let tail = Promise.resolve();

export const runHeavyExclusive = (task) => {
  if (running + waiting >= 2) {
    const busyError = new Error(
      'O servidor já está processando outra tarefa pesada (separação de voz ou sincronização de letra). Tente novamente em instantes.'
    );
    busyError.code = 'HEAVY_BUSY';
    return Promise.reject(busyError);
  }

  waiting += 1;

  const next = tail
    .then(() => {
      waiting -= 1;
      running += 1;
      return task();
    })
    .finally(() => {
      running -= 1;
    });

  // Mantém a corrente viva mesmo se a tarefa falhar.
  tail = next.catch(() => {});

  return next;
};

export default runHeavyExclusive;
