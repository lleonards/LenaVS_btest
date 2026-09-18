import { supabase, supabaseAnon } from '../config/supabase.js';

const normalizeCountryGroup = (value) => {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) return null;

  const brazilValues = ['br', 'brasil', 'brazil', 'pt-br', 'pt_br'];
  const intlValues = [
    'intl',
    'international',
    'internacional',
    'other',
    'others',
    'outro',
    'outros',
    'outside_brazil',
    'rest_of_world',
    'us',
    'usa',
    'united states',
    'estados unidos',
    'ca',
    'canada',
    'canadá',
    'au',
    'australia',
    'austrália',
    'nz',
    'new zealand',
    'nova zelandia',
    'nova zelândia',
    'sg',
    'singapore',
    'singapura',
    'hk',
    'hong kong',
    'usd',
  ];

  if (brazilValues.includes(normalized)) {
    return 'BR';
  }

  if (intlValues.includes(normalized)) {
    return 'INTL';
  }

  return null;
};

const getPreferredCurrency = (countryGroup) => (countryGroup === 'BR' ? 'BRL' : 'USD');

const normalizeDisplayName = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const extractDisplayNameFromUser = (user = {}) => {
  const metadata = user?.user_metadata || user?.raw_user_meta_data || {};
  return (
    normalizeDisplayName(metadata.display_name)
    || normalizeDisplayName(metadata.full_name)
    || normalizeDisplayName(metadata.name)
  );
};

const deriveDisplayNameFromEmail = (email) => {
  const localPart = String(email || '').split('@')[0] || '';
  const normalized = localPart.replace(/[._-]+/g, ' ').trim();
  return normalized ? normalized.replace(/\b\w/g, (character) => character.toUpperCase()) : null;
};

const resolveCountryPreferenceFromUser = (user = {}) => {
  const metadata = user?.user_metadata || user?.raw_user_meta_data || {};

  const countryGroup = normalizeCountryGroup(
    metadata.country_group
    || metadata.country
    || metadata.billing_region
    || metadata.market
  );

  if (!countryGroup) {
    return {
      country_group: null,
      preferred_currency: null,
    };
  }

  return {
    country_group: countryGroup,
    preferred_currency: getPreferredCurrency(countryGroup),
  };
};

const syncCountryPreferenceIfNeeded = async (userId, existingUser, authCountryPreference) => {
  if (!existingUser || !authCountryPreference.country_group) {
    return existingUser;
  }

  const needsCountryUpdate = !existingUser.country_group || !existingUser.preferred_currency;

  if (!needsCountryUpdate) {
    return existingUser;
  }

  const { data, error } = await supabase
    .from('users')
    .update({
      country_group: authCountryPreference.country_group,
      preferred_currency: authCountryPreference.preferred_currency,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) {
    console.warn('Não foi possível sincronizar país/moeda do usuário:', error.message);
    return {
      ...existingUser,
      country_group: existingUser.country_group || authCountryPreference.country_group,
      preferred_currency: existingUser.preferred_currency || authCountryPreference.preferred_currency,
    };
  }

  return data;
};

const ensureUserExists = async (user) => {
  try {
    if (!user?.id) return null;

    const authCountryPreference = resolveCountryPreferenceFromUser(user);

    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (fetchError) {
      console.error('Erro ao buscar usuário no banco:', fetchError);
      // Se for 401/403 do RLS, service_role deve passar — mas se falhar
      // ainda assim podemos criar abaixo como fallback.
    }

    if (existingUser) {
      const countrySyncedUser = await syncCountryPreferenceIfNeeded(user.id, existingUser, authCountryPreference);
      const displayName =
        normalizeDisplayName(countrySyncedUser.display_name)
        || extractDisplayNameFromUser(user)
        || deriveDisplayNameFromEmail(user.email);
      const avatarUrl = String(
        countrySyncedUser.avatar_url
        || user?.user_metadata?.avatar_url
        || user?.user_metadata?.picture
        || user?.user_metadata?.photo_url
        || ''
      ).trim() || null;

      if (
        displayName !== normalizeDisplayName(countrySyncedUser.display_name)
        || avatarUrl !== (countrySyncedUser.avatar_url || null)
        || countrySyncedUser.email !== user.email
      ) {
        const { data: updatedUser, error: profileUpdateError } = await supabase
          .from('users')
          .update({
            email: user.email,
            display_name: displayName,
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id)
          .select('*')
          .maybeSingle();

        if (!profileUpdateError && updatedUser) {
          return updatedUser;
        }
      }

      return countrySyncedUser;
    }

    const trialDays = 3;
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + trialDays);

    const { data, error } = await supabase
      .from('users')
      .insert({
        id: user.id,
        email: user.email,
        display_name: extractDisplayNameFromUser(user) || deriveDisplayNameFromEmail(user.email),
        avatar_url: String(
          user?.user_metadata?.avatar_url
          || user?.user_metadata?.picture
          || user?.user_metadata?.photo_url
          || ''
        ).trim() || null,
        subscription_status: 'trial',
        trial_end: trialEnd.toISOString(),
        credits: 3,
        country_group: authCountryPreference.country_group,
        preferred_currency: authCountryPreference.preferred_currency,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar usuário na tabela users:', error);

      // Se for erro de RLS "new row violates row-level security", o service_role
      // não deveria cair aqui; mas se cair, tenta fallback via upsert.
      if (String(error.message || '').includes('row-level security')) {
        const { data: upserted } = await supabase
          .from('users')
          .upsert({
            id: user.id,
            email: user.email,
            subscription_status: 'trial',
            credits: 3,
            trial_end: trialEnd.toISOString(),
            display_name: extractDisplayNameFromUser(user) || deriveDisplayNameFromEmail(user.email),
          })
          .select()
          .maybeSingle();
        return upserted || null;
      }

      return null;
    }

    return data;
  } catch (err) {
    console.error('Exceção em ensureUserExists:', err);
    return null;
  }
};

/**
 * Valida o JWT apresentado.
 * Usa o cliente SERVICE_ROLE e também tenta o ANON como fallback.
 * Retorna { user, error } sem abortar a request — deixa o caller decidir.
 */
const verifyAccessToken = async (token) => {
  if (!token) {
    return { user: null, error: 'Token não fornecido' };
  }

  // 1) service_role (default)
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data?.user) {
      return { user: data.user, error: null };
    }
  } catch (err) {
    console.warn('Falha em supabase.auth.getUser(service_role):', err?.message);
  }

  // 2) anon fallback (defensivo — algumas libs antigas exigem o cliente certo)
  try {
    const { data, error } = await supabaseAnon.auth.getUser(token);
    if (!error && data?.user) {
      return { user: data.user, error: null };
    }
  } catch (err) {
    console.warn('Falha em supabaseAnon.auth.getUser:', err?.message);
  }

  return { user: null, error: 'Sessão inválida ou expirada. Faça login novamente.' };
};

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : null;

    if (!token) {
      return res.status(401).json({
        error: 'Sessão inválida. Faça login novamente.'
      });
    }

    const { user: supabaseUser, error: verifyError } = await verifyAccessToken(token);

    if (verifyError || !supabaseUser) {
      console.warn('Token inválido ou expirado apresentado.');
      return res.status(403).json({
        error: 'Sessão inválida ou expirada. Faça login novamente.'
      });
    }

    const userRecord = await ensureUserExists(supabaseUser);

    if (!userRecord) {
      return res.status(500).json({
        error: 'Erro no sistema. Tente novamente mais tarde.'
      });
    }

    req.user = {
      id: supabaseUser.id,
      email: supabaseUser.email,
      role: supabaseUser.role || 'user',
      plan: userRecord.plan,
      subscription_status: userRecord.subscription_status,
      trial_end: userRecord.trial_end,
      country_group: userRecord.country_group || resolveCountryPreferenceFromUser(supabaseUser).country_group,
      preferred_currency: userRecord.preferred_currency || resolveCountryPreferenceFromUser(supabaseUser).preferred_currency,
      metadata: supabaseUser.user_metadata || {},
    };

    next();
  } catch (err) {
    console.error('Erro CRÍTICO no middleware authenticateToken:', err);
    return res.status(500).json({
      error: 'Erro no sistema. Tente novamente mais tarde.'
    });
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) return next();

    const { user: supabaseUser } = await verifyAccessToken(token);

    if (supabaseUser) {
      const authCountryPreference = resolveCountryPreferenceFromUser(supabaseUser);

      req.user = {
        id: supabaseUser.id,
        email: supabaseUser.email,
        country_group: authCountryPreference.country_group,
        preferred_currency: authCountryPreference.preferred_currency,
        metadata: supabaseUser.user_metadata || {},
      };
    }
    next();
  } catch (err) {
    next();
  }
};

// Pequeno helper para reconhecer erros de quota/restricted em qualquer ponto
// do servidor. Não altera o comportamento dos handlers existentes; apenas
// expõe a mesma tabela usada em routes/auth.js.
const SUPABASE_ERROR_RULES = [
  /exceed_storage_size_quota|exceed storage size|storage quota/i,
  /restricted due to/i,
  /billing|spend cap|plan upgrade/i,
];

const isSupabaseRestrictedError = (error) => {
  const msg = String(error?.message || error || '');
  return SUPABASE_ERROR_RULES.some((re) => re.test(msg));
};

export { ensureUserExists, verifyAccessToken, isSupabaseRestrictedError };
