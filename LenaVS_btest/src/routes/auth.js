import express from 'express';
import { authenticateToken, ensureUserExists } from '../middleware/auth.js';
import { supabase, supabaseAnon } from '../config/supabase.js';

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (value) => EMAIL_REGEX.test(String(value || '').trim());

const COUNTRY_TO_GROUP = {
  BR: 'BR', US: 'INTL', CA: 'INTL', AU: 'INTL', NZ: 'INTL',
  SG: 'INTL', HK: 'INTL', OTHER: 'INTL',
};

const normalizeCountryCode = (value) => {
  const code = String(value || 'BR').trim().toUpperCase();
  return COUNTRY_TO_GROUP[code] ? code : 'OTHER';
};

const buildMetadataFromPayload = ({ name, countryCode, acceptedLegal }) => {
  const group = COUNTRY_TO_GROUP[normalizeCountryCode(countryCode)] || 'INTL';
  return {
    name: String(name || '').trim(),
    full_name: String(name || '').trim(),
    display_name: String(name || '').trim(),
    country_group: group,
    country: group === 'BR' ? 'BR' : 'INTL',
    country_code: normalizeCountryCode(countryCode),
    preferred_currency: group === 'BR' ? 'BRL' : 'USD',
    accepted_legal_terms: Boolean(acceptedLegal),
    legal_acceptance_at: new Date().toISOString(),
    privacy_policy_version: '2026-06',
  };
};

// =====================================================
// Erros técnicos nunca são enviados ao navegador.
// Os detalhes ficam apenas nos logs do backend.
// =====================================================
const SUPABASE_ERROR_MAP = [
  {
    test: (m) => /invalid login credentials|invalid credentials|invalid password|password is incorrect/i.test(m),
    status: 401,
    code: 'INVALID_LOGIN_CREDENTIALS',
    message: 'senha incorreta',
  },
  {
    test: (m) => /email not confirmed|email is not confirmed/i.test(m),
    status: 403,
    code: 'EMAIL_NOT_CONFIRMED',
    message: 'Confirme seu e-mail antes de entrar.',
  },
  {
    test: (m) => /exceed_storage_size_quota|exceed storage size|storage quota/i.test(m),
    status: 402,
    code: 'STORAGE_QUOTA_EXCEEDED',
    message: 'Erro no sistema. Tente novamente mais tarde.',
  },
  {
    test: (m) => /restricted due to/i.test(m),
    status: 402,
    code: 'SUPABASE_RESTRICTED',
    message: 'Erro no sistema. Tente novamente mais tarde.',
  },
  {
    test: (m) => /billing|spend cap|plan upgrade/i.test(m),
    status: 402,
    code: 'BILLING_RESTRICTED',
    message: 'Erro no sistema. Tente novamente mais tarde.',
  },
  {
    test: (m) => /already (registered|exists|in use)/i.test(m),
    status: 409,
    code: 'EMAIL_ALREADY_REGISTERED',
    message: 'Este e-mail já está cadastrado. Tente entrar ou use outro e-mail.',
  },
  {
    test: (m) => /password should be at least|weak password|password.*too short/i.test(m),
    status: 400,
    code: 'WEAK_PASSWORD',
    message: 'A senha precisa ter pelo menos 6 caracteres.',
  },
];

const mapSupabaseError = (error) => {
  const raw = String(error?.message || error || '');
  for (const rule of SUPABASE_ERROR_MAP) if (rule.test(raw)) return { ...rule, raw_message: raw };
  return null;
};

const sendMappedSupabaseError = (res, error) => {
  const mapped = mapSupabaseError(error);
  if (!mapped) return null;
  console.error(`[auth] erro Supabase reconhecido (${mapped.code}):`, error);
  return res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
};

/**
 * GET /api/auth/health
 */
router.get('/health', async (req, res) => {
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) {
      const mapped = mapSupabaseError(error);
      if (mapped) {
        return res.status(mapped.status).json({
          success: false, supabase_reachable: false, code: mapped.code, error: mapped.message,
        });
      }
      console.error('Supabase admin listUsers falhou:', error);
      return res.status(503).json({
        success: false, supabase_reachable: false,
        error: 'Erro no sistema. Tente novamente mais tarde.',
      });
    }
    return res.json({ success: true, supabase_reachable: true, users_sample_count: data?.users?.length ?? 0 });
  } catch (err) {
    console.error('Erro inesperado em /api/auth/health:', err);
    return res.status(500).json({ success: false, supabase_reachable: false, error: 'Erro no sistema. Tente novamente mais tarde.' });
  }
});

/**
 * POST /api/auth/check-email
 */
router.post('/check-email', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ code: 'INVALID_EMAIL', error: 'Digite um e-mail válido.' });
  }

  try {
    const { data, error } = await supabase.auth.admin.getUserByEmail(email);
    const notFound = /not found|user not found|no user found/i.test(String(error?.message || ''));

    if (error && !notFound) {
      const mapped = sendMappedSupabaseError(res, error);
      if (mapped) return mapped;
      console.error('Erro ao verificar e-mail de login:', error);
      return res.status(500).json({ code: 'EMAIL_CHECK_ERROR', error: 'Erro no sistema. Tente novamente mais tarde.' });
    }

    return res.json({ success: true, exists: Boolean(data?.user) });
  } catch (error) {
    console.error('Erro inesperado ao verificar e-mail de login:', error);
    return res.status(500).json({ code: 'EMAIL_CHECK_ERROR', error: 'Erro no sistema. Tente novamente mais tarde.' });
  }
});

/**
 * POST /api/auth/login
 *
 * Faz login com o cliente público do Supabase. A senha nunca é registrada
 * nem enviada para o cliente depois da autenticação.
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
    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const mapped = sendMappedSupabaseError(res, error);
      if (mapped) return mapped;

      console.error('Erro ao fazer login pelo Supabase:', error);
      return res.status(500).json({
        code: 'LOGIN_FAILED',
        error: 'Erro no sistema. Tente novamente mais tarde.',
      });
    }

    if (!data?.session) {
      console.error('Login do Supabase não retornou uma sessão.');
      return res.status(500).json({
        code: 'LOGIN_FAILED',
        error: 'Erro no sistema. Tente novamente mais tarde.',
      });
    }

    return res.json({
      success: true,
      session: data.session,
      user: data.user
        ? { id: data.user.id, email: data.user.email }
        : null,
    });
  } catch (error) {
    console.error('Erro inesperado ao fazer login:', error);
    const mapped = sendMappedSupabaseError(res, error);
    if (mapped) return mapped;
    return res.status(500).json({
      code: 'LOGIN_FAILED',
      error: 'Erro no sistema. Tente novamente mais tarde.',
    });
  }
});

const createPendingAccount = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || '').trim();
  const countryCode = normalizeCountryCode(req.body?.countryCode || req.body?.country || 'BR');
  const acceptedLegal = Boolean(
    req.body?.acceptedLegal ?? req.body?.accepted_legal_terms ?? req.body?.acceptLegal ?? false
  );

  if (!email || !isValidEmail(email)) return res.status(400).json({ code: 'INVALID_EMAIL', error: 'Digite um e-mail válido.' });
  if (!password || password.length < 6) return res.status(400).json({ code: 'WEAK_PASSWORD', error: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (!name || name.length < 2) return res.status(400).json({ code: 'INVALID_NAME', error: 'Informe seu nome completo.' });
  if (!acceptedLegal) return res.status(400).json({ code: 'LEGAL_NOT_ACCEPTED', error: 'Você precisa aceitar os termos e a política de privacidade.' });

  try {
    const metadata = buildMetadataFromPayload({ name, countryCode, acceptedLegal });

    // O cliente anon é obrigatório aqui: o Supabase envia o e-mail de
    // confirmação e mantém email_confirmed_at nulo até o link ser clicado.
    const { data: created, error: createError } = await supabaseAnon.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: req.body?.emailRedirectTo || undefined,
      },
    });

    if (createError || !created?.user) {
      const mapped = sendMappedSupabaseError(res, createError);
      if (mapped) return mapped;

      const msg = String(createError?.message || '').toLowerCase();
      const code = String(createError?.status || createError?.code || '');
      const alreadyExists = msg.includes('already') || msg.includes('exists') || msg.includes('registered') || msg.includes('duplicate') || code === '422';

      if (alreadyExists) {
        return res.status(409).json({ code: 'EMAIL_ALREADY_REGISTERED', error: 'Este e-mail já está cadastrado. Tente entrar ou use outro e-mail.' });
      }

      console.error('Erro ao criar usuário pelo Supabase:', createError);
      return res.status(500).json({ code: 'SIGNUP_FAILED', error: 'Erro no sistema. Tente novamente mais tarde.' });
    }

    if (Array.isArray(created.user.identities) && created.user.identities.length === 0) {
      return res.status(409).json({ code: 'EMAIL_ALREADY_REGISTERED', error: 'Este e-mail já está cadastrado. Tente entrar ou use outro e-mail.' });
    }

    return res.status(201).json({
      success: true,
      user: { id: created.user.id, email, email_confirmed: Boolean(created.user.email_confirmed_at) },
      message: 'Cadastro realizado. Verifique seu e-mail para confirmar a conta antes de entrar.',
      next_step: 'confirm_email',
    });
  } catch (error) {
    console.error('Erro inesperado ao cadastrar usuário:', error);
    const mapped = sendMappedSupabaseError(res, error);
    if (mapped) return mapped;
    return res.status(500).json({ code: 'SIGNUP_FAILED', error: 'Erro no sistema. Tente novamente mais tarde.' });
  }
};

/**
 * POST /api/auth/signup-direct
 *
 * Mantido para compatibilidade com versões anteriores do frontend.
 * Nunca usa service_role para criar ou confirmar usuários.
 */
router.post('/signup-direct', createPendingAccount);

/**
 * POST /api/auth/ensure-account
 */
router.post('/ensure-account', async (req, res) => {
  return createPendingAccount(req, res);
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    return res.json({ success: true, user: { id: req.user.id, email: req.user.email } });
  } catch (err) {
    console.error('Erro na rota /api/auth/me:', err);
    return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Erro no sistema. Tente novamente mais tarde.' });
  }
});

export default router;
