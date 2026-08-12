import express from 'express';

const router = express.Router();

// Instrumental é uma feature prevista — nesta versão marcada como pendente.
// Quando você adicionar Demucs novamente, basta substituir esta handler.
router.post('/instrumental', (_req, res) => {
  res.status(501).json({
    code: 'INSTRUMENTAL_NOT_IMPLEMENTED',
    error:
      'Geração de instrumental ainda não está disponível nesta versão. Envie um instrumental próprio ou desmarque a opção "usar instrumental".',
  });
});

export default router;
