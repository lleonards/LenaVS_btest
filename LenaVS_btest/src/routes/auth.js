import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/* =====================================================
   FLUXO DE AUTENTICAÇÃO (SIMPLES)
   -----------------------------------------------------
   Cadastro, login e confirmação de e-mail acontecem DIRETO
   entre o frontend e o Supabase Auth (@supabase/supabase-js).

   O backend apenas valida o JWT do Supabase que chega no
   header Authorization: Bearer <token> via middleware
   authenticateToken (supabase.auth.getUser(token)).
   ===================================================== */

/**
 * GET /api/auth/health
 * Confirma que a API está no ar.
 */
router.get('/health', (req, res) => {
  return res.json({ success: true, supabase_reachable: true });
});

/**
 * GET /api/auth/me
 * Valida o JWT do Supabase e retorna o usuário autenticado.
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    return res.json({
      success: true,
      user: { id: req.user.id, email: req.user.email },
    });
  } catch (err) {
    console.error('[auth] Erro na rota /api/auth/me:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Erro no sistema. Tente novamente mais tarde.' });
  }
});

export default router;
