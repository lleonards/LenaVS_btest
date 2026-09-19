// =========================================================
// LenaVS — Lock serial para tarefas pesadas
// ---------------------------------------------------------
// O servidor Render tem 1 CPU / 2 GB de RAM. Demucs (PyTorch) e
// o CTC Forced Aligner (ONNX) NÃO podem rodar simultaneamente.
// Este módulo garante execução exclusiva: uma tarefa termina e
// libera a memória antes da próxima começar.
//
// Usado por:
//   • src/controllers/mediaController.js  (Demucs / instrumental)
//   • src/services/lyricsAlignService.js  (CTC / sincronização)
// =========================================================

let chain = Promise.resolve();

/**
 * Executa `task` com exclusão mútua: só roda quando nenhuma outra
 * tarefa pesada está em andamento. Erros são propagados ao chamador
 * sem quebrar a fila.
 *
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export const runExclusiveHeavyTask = (task) => {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
};

/** Quantas tarefas pesadas estão aguardando/executando (diagnóstico). */
export const getHeavyTaskQueueInfo = () => ({ pending: pendingHeavyJobs });

let pendingHeavyJobs = 0;

/**
 * Igual a runExclusiveHeavyTask, mas também contabiliza a fila
 * para os endpoints de status.
 */
export const runExclusiveHeavyTaskTracked = (task) => {
  pendingHeavyJobs += 1;

  const run = runExclusiveHeavyTask(async () => {
    try {
      return await task();
    } finally {
      pendingHeavyJobs = Math.max(0, pendingHeavyJobs - 1);
    }
  });

  return run;
};
