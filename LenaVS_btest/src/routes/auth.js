import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { supabase, supabaseAnon } from '../config/supabase.js';

const router = express.Router();

/* =====================================================
   FLUXO DE AUTENTICAÇÃO (SIMPLIFICADO)
   -----------------------------------------------------
   Cadastro, login e confirmação de e-mail acontecem DIRETO
   entre o frontend e o Supabase Auth (cliente @supabase/supabase-js
   com a anon key). O backend NÃO manipula mais senhas nem sessões.

   Papel do backend aqui:
   - /api/auth/health  → diagnóstico da conexão com o Supabase
   - /api/auth/login   → (deprecated) mantido apenas por compatibilidade
   - /api/auth/me      → retorna o usuário do JWT apresentado

   Todas as demais rotas do app continuam protegidas pelo
   middleware authenticateToken, que valida o JWT do Supabase.
===================================================== */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (value) => EMAIL_REGEX.test(String(value || '').trim());

/**
 * GET /api/auth/health
 * Diagnóstico: confirma que o backend alcança o Supabase Auth.
 */
router.get('/health', async (req, res) => {
  try {
    const { error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) {
      console.error('[auth] Supabase admin listUsers falhou:', error.message);
      return res.status(503).json({
        success: false,
        supabase_reachable: false,
        error: 'Erro no sistema. Tente novamente mais tarde.',
      });
    }
    return res.json({ success: true, supabase_reachable: true });
  } catch (err) {
    console.error('[auth] Erro inesperado em /api/auth/health:', err);
    return res.status(500).json({
      success: false,
      supabase_reachable: false,
      error: 'Erro no sistema. Tente novamente mais tarde.',
    });
  }
});

/**
 * POST /api/auth/login  (DEPRECATED — compatibilidade)
 *
 * O frontend atual faz login direto no Supabase Auth
 * (supabase.auth.signInWithPassword). Esta rota continua de pé
 * apenas para versões antigas do frontend que ainda apontam para cá.
 */
router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ code: 'INVALID_EMAIL', error: 'Digite um e-mail válido.' });
  }
  if (!password) {
    return res.status(400).json({ code: 'PASSWORD_REQUIRED', error: 'Digite sua senha.' });
  }

  try {
    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });

    if (error || !data?.session) {
      console.error('[auth] login (compat) falhou:', error?.message || 'sem sessão');
      const emailNotConfirmed = /email not confirmed/i.test(String(error?.message || ''));
      if (emailNotConfirmed) {
        return res.status(403).json({ code: 'EMAIL_NOT_CONFIRMED', error: 'Confirme seu e-mail antes de entrar.' });
      }
      return res.status(401).json({ code: 'INVALID_LOGIN_CREDENTIALS', error: 'senha incorreta' });
    }

    return res.json({ success: true, session: data.session });
  } catch (error) {
    console.error('[auth] Erro inesperado no login (compat):', error);
    return res.status(500).json({ code: 'LOGIN_FAILED', error: 'Erro no sistema. Tente novamente mais tarde.' });
  }
});

/**
 * GET /api/auth/me
 * Retorna o usuário autenticado (validação do JWT do Supabase).
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    return res.json({ success: true, user: { id: req.user.id, email: req.user.email } });
  } catch (err) {
    console.error('[auth] Erro na rota /api/auth/me:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Erro no sistema. Tente novamente mais tarde.' });
  }
});

export default router;
