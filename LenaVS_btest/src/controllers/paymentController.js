import crypto from 'crypto';
import axios from 'axios';
import stripe from '../config/stripe.js';
import supabase from '../config/supabase.js';
import {
  buildAccessSnapshot,
  calculateExtendedUnlimitedAccessUntil,
  getCreditsRemainingLabel,
  hasUnlimitedAccess,
  parseDateOrNull,
  UNLIMITED_ACCESS_DAYS,
} from '../utils/access.js';

const STRIPE_PROVIDER = 'stripe';
const PAGARME_PROVIDER = 'pagarme';
const DEFAULT_MONTHLY_PRICE_BRL = Number(process.env.UNLIMITED_PRICE_BRL || 39.9);
const DEFAULT_MONTHLY_PRICE_USD = Number(process.env.UNLIMITED_PRICE_USD || 9.9);
const DEFAULT_PAGARME_API_BASE = 'https://api.pagar.me/core/v5';
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS || 300);

const getFrontendUrl = () => String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const getBackendUrl = () => String(process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:10000').replace(/\/$/, '');
const getPagarmeApiBase = () => String(process.env.PAGARME_API_BASE || DEFAULT_PAGARME_API_BASE).replace(/\/$/, '');
const getPagarmeSecretKey = () => String(process.env.PAGARME_SECRET_KEY || '').trim();
const getPagarmeWebhookSecret = () => String(process.env.PAGARME_WEBHOOK_SECRET || '').trim();
const isPagarmeSignatureRequired = () => String(process.env.PAGARME_REQUIRE_WEBHOOK_SIGNATURE || 'false').trim().toLowerCase() === 'true';

const asPositiveAmount = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : fallback;
};

const normalizeStatus = (value, fallback = 'pending') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
};

const getStripePriceId = (currency = 'brl') => {
  const normalizedCurrency = String(currency || 'brl').toLowerCase();

  if (normalizedCurrency === 'usd') {
    return process.env.STRIPE_PRICE_USD || process.env.STRIPE_PRICE_ID_USD || process.env.STRIPE_PRICE_BRL || process.env.STRIPE_PRICE_ID_BRL;
  }

  return process.env.STRIPE_PRICE_BRL || process.env.STRIPE_PRICE_ID_BRL || process.env.STRIPE_PRICE_USD || process.env.STRIPE_PRICE_ID_USD;
};

const getMonthlyPlanPricing = (currency = 'brl') => {
  const normalizedCurrency = String(currency || 'brl').toLowerCase();

  if (normalizedCurrency === 'usd') {
    return {
      currency: 'USD',
      currencyId: 'USD',
      amount: asPositiveAmount(process.env.UNLIMITED_PRICE_USD, DEFAULT_MONTHLY_PRICE_USD),
      label: 'LenaVS Unlimited - 30 dias',
      description: 'Acesso ilimitado ao LenaVS por 30 dias',
    };
  }

  return {
    currency: 'BRL',
    currencyId: 'BRL',
    amount: asPositiveAmount(process.env.UNLIMITED_PRICE_BRL, DEFAULT_MONTHLY_PRICE_BRL),
    label: 'LenaVS Unlimited - 30 dias',
    description: 'Acesso ilimitado ao LenaVS por 30 dias',
  };
};

const normalizeCountryGroup = (value) => {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) return null;

  const brazilValues = ['br', 'brasil', 'brazil', 'pt-br', 'pt_br', 'brl'];
  const intlValues = [
    'intl', 'international', 'internacional', 'other', 'others', 'outro', 'outros',
    'outside_brazil', 'rest_of_world', 'us', 'usa', 'united states', 'estados unidos',
    'ca', 'canada', 'canadá', 'au', 'australia', 'austrália', 'nz', 'new zealand',
    'nova zelandia', 'nova zelândia', 'sg', 'singapore', 'singapura', 'hk', 'hong kong', 'usd',
  ];

  if (brazilValues.includes(normalized)) return 'BR';
  if (intlValues.includes(normalized)) return 'INTL';

  return null;
};

const getCurrencyFromCountryGroup = (countryGroup) => (countryGroup === 'BR' ? 'brl' : 'usd');

const parseAcceptLanguageHeader = (headerValue) => String(headerValue || '')
  .split(',')
  .map((entry) => entry.trim().split(';')[0])
  .filter(Boolean);

const inferCountryGroupFromLocales = (localeCandidates = []) => {
  const normalizedCandidates = localeCandidates
    .flatMap((candidate) => Array.isArray(candidate) ? candidate : [candidate])
    .map((candidate) => String(candidate || '').trim())
    .filter(Boolean);

  const hasBrazilLocale = normalizedCandidates.some((locale) => /(^|[-_])br($|[-_])/i.test(locale));
  return hasBrazilLocale ? 'BR' : null;
};

const resolveCheckoutContext = ({ profile = {}, reqUser = {}, req }) => {
  const savedCountryGroup = normalizeCountryGroup(
    profile.country_group
    || reqUser.country_group
    || reqUser.preferred_currency
    || reqUser.metadata?.country_group
    || reqUser.metadata?.country
  );

  if (savedCountryGroup) {
    return {
      countryGroup: savedCountryGroup,
      currency: getCurrencyFromCountryGroup(savedCountryGroup),
      source: 'saved_country',
    };
  }

  const browserCountryGroup = inferCountryGroupFromLocales([
    req?.body?.browserLanguage,
    req?.body?.browserLocale,
    req?.body?.browserLanguages,
    parseAcceptLanguageHeader(req?.headers?.['accept-language']),
  ]);

  if (browserCountryGroup) {
    return {
      countryGroup: browserCountryGroup,
      currency: getCurrencyFromCountryGroup(browserCountryGroup),
      source: 'browser_language_fallback',
    };
  }

  return {
    countryGroup: 'INTL',
    currency: 'usd',
    source: 'default_international',
  };
};

const buildFrontendRouteUrl = (route = '/') => {
  const normalizedRoute = String(route || '/').startsWith('/') ? String(route || '/') : `/${route}`;
  return `${getFrontendUrl()}/#${normalizedRoute}`;
};

const getReturnUrls = (provider) => ({
  success: `${buildFrontendRouteUrl('/payment/success')}?provider=${provider}`,
  pending: `${buildFrontendRouteUrl('/payment/pending')}?provider=${provider}`,
  failure: `${buildFrontendRouteUrl('/payment/failure')}?provider=${provider}`,
  cancel: `${buildFrontendRouteUrl('/payment/failure')}?provider=${provider}&canceled=1`,
});

const parseJsonEnv = (value, fallback = {}) => {
  if (!value || !String(value).trim()) return fallback;

  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (error) {
    console.warn('Não foi possível interpretar JSON do ambiente:', error.message);
    return fallback;
  }
};

const isPlainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const deepMerge = (base, override) => {
  if (!isPlainObject(base)) return override;
  if (!isPlainObject(override)) return override === undefined ? base : override;

  const result = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;

    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
      continue;
    }

    result[key] = value;
  }

  return result;
};

const compactObject = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => compactObject(item))
      .filter((item) => item !== undefined && item !== null && item !== '');
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.entries(value).reduce((acc, [key, currentValue]) => {
    const nextValue = compactObject(currentValue);

    if (nextValue === undefined || nextValue === null || nextValue === '') {
      return acc;
    }

    if (Array.isArray(nextValue) && nextValue.length === 0) {
      return acc;
    }

    if (isPlainObject(nextValue) && Object.keys(nextValue).length === 0) {
      return acc;
    }

    acc[key] = nextValue;
    return acc;
  }, {});
};

const nameFromEmail = (email) => {
  const local = String(email || '').split('@')[0] || 'Cliente LenaVS';
  const cleaned = local.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.replace(/\b\w/g, (char) => char.toUpperCase()) : 'Cliente LenaVS';
};

const getNestedValue = (obj, path) => {
  if (!obj || typeof obj !== 'object') return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
};

const findFirstValue = (obj, paths) => {
  for (const path of paths) {
    const value = getNestedValue(obj, path);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const findUserProfile = async ({ userId = null, email = null, customerId = null, subscriptionId = null } = {}) => {
  if (userId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data) return data;
  }

  if (subscriptionId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('stripe_subscription_id', String(subscriptionId))
      .maybeSingle();

    if (!error && data) return data;
  }

  if (customerId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('stripe_customer_id', String(customerId))
      .maybeSingle();

    if (!error && data) return data;
  }

  if (email) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .ilike('email', String(email).trim())
      .maybeSingle();

    if (!error && data) return data;
  }

  return null;
};

const upsertPaymentTransaction = async ({
  provider,
  externalId,
  userId = null,
  email = null,
  paymentType = null,
  status = null,
  rawPayload = {},
}) => {
  if (!provider || !externalId) return null;

  const payload = {
    provider,
    external_id: String(externalId),
    user_id: userId,
    email: email ? String(email).trim().toLowerCase() : null,
    payment_type: paymentType,
    status,
    raw_payload: rawPayload,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('payment_transactions')
    .upsert(payload, { onConflict: 'provider,external_id' })
    .select('*')
    .maybeSingle();

  if (error) {
    console.warn('Não foi possível registrar transação de pagamento:', error.message);
    return null;
  }

  return data;
};

const markPaymentGranted = async (provider, externalId) => {
  if (!provider || !externalId) return;

  const { error } = await supabase
    .from('payment_transactions')
    .update({ access_granted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('provider', provider)
    .eq('external_id', String(externalId));

  if (error) {
    console.warn('Não foi possível marcar a transação como liberada:', error.message);
  }
};

const alreadyGrantedAccess = (transaction) => Boolean(transaction?.access_granted_at);

// ─────────────────────────────────────────────────────────────────────────────
// APLICAR ACESSO ILIMITADO (nova assinatura / renovação)
// ─────────────────────────────────────────────────────────────────────────────

const applyUnlimitedAccessToUser = async ({
  userId = null,
  email = null,
  provider,
  externalId,
  customerId = null,
  subscriptionId = null,
}) => {
  const normalizedCustomerId = customerId ? String(customerId) : null;
  const normalizedSubscriptionId = subscriptionId ? String(subscriptionId) : null;
  const profile = await findUserProfile({
    userId,
    email,
    customerId: normalizedCustomerId,
    subscriptionId: normalizedSubscriptionId,
  });

  if (!profile) {
    throw new Error('Usuário do pagamento não encontrado');
  }

  const nextUnlimitedUntil = calculateExtendedUnlimitedAccessUntil(profile.unlimited_access_until, UNLIMITED_ACCESS_DAYS);

  const updatePayload = {
    plan: 'pro',
    subscription_status: 'active',
    unlimited_access_until: nextUnlimitedUntil.toISOString(),
    credits: 0,
    updated_at: new Date().toISOString(),
  };

  if (provider === STRIPE_PROVIDER) {
    if (normalizedCustomerId) {
      updatePayload.stripe_customer_id = normalizedCustomerId;
    }

    if (normalizedSubscriptionId) {
      updatePayload.stripe_subscription_id = normalizedSubscriptionId;
    }
  }

  const { data, error } = await supabase
    .from('users')
    .update(updatePayload)
    .eq('id', profile.id)
    .select('*')
    .single();

  if (error) throw error;

  await markPaymentGranted(provider, externalId);

  return data;
};

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE — FUNÇÕES DE ATUALIZAÇÃO DE ESTADO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marca a assinatura Stripe como FALHA DE PAGAMENTO (past_due).
 * Mantém o plano Pro e o acesso ativo para não punir o usuário imediatamente.
 */
const markStripeSubscriptionPastDue = async ({ customerId = null, email = null, subscriptionId = null }) => {
  if (!customerId && !email && !subscriptionId) return;

  const payload = {
    subscription_status: 'past_due',
    updated_at: new Date().toISOString(),
  };

  if (customerId) payload.stripe_customer_id = String(customerId);
  if (subscriptionId) payload.stripe_subscription_id = String(subscriptionId);

  let query = supabase.from('users').update(payload).select('id');

  if (subscriptionId) {
    query = query.eq('stripe_subscription_id', String(subscriptionId));
  } else if (customerId) {
    query = query.eq('stripe_customer_id', String(customerId));
  } else {
    query = query.ilike('email', String(email).trim());
  }

  const { error } = await query.maybeSingle();
  if (error) {
    console.warn('Não foi possível marcar assinatura como past_due:', error.message);
  }
};

/**
 * Marca a assinatura Stripe como CANCELAMENTO AGENDADO (cancel_at_period_end = true).
 *
 * O usuário MANTÉM acesso Pro até o fim do período já pago.
 * - plan: permanece 'pro'
 * - subscription_status: 'canceled' (sinaliza o cancelamento agendado na interface)
 * - unlimited_access_until: data exata do fim do período pago (current_period_end)
 *
 * REGRA DE NEGÓCIO:
 *   O usuário nunca deve perder acesso Premium antes do término do período já pago.
 */
const markStripeSubscriptionCanceledScheduled = async ({
  customerId = null,
  email = null,
  subscriptionId = null,
  periodEnd,        // Unix timestamp (segundos) ou Date
}) => {
  if (!customerId && !email && !subscriptionId) return;

  // Converter o period_end para ISO string
  let unlimitedUntil = null;
  if (periodEnd) {
    const ts = typeof periodEnd === 'number' ? periodEnd * 1000 : new Date(periodEnd).getTime();
    if (!Number.isNaN(ts)) {
      unlimitedUntil = new Date(ts).toISOString();
    }
  }

  const payload = {
    plan: 'pro',                     // mantém Pro durante o período pago
    subscription_status: 'canceled', // sinaliza o cancelamento agendado
    updated_at: new Date().toISOString(),
  };

  // Define o unlimited_access_until para exatamente quando o período pago termina.
  // Se não tiver period_end disponível, mantém o valor atual (não piora a situação).
  if (unlimitedUntil) {
    payload.unlimited_access_until = unlimitedUntil;
    // subscription_cancel_at: grava explicitamente o fim do período pago no Supabase
    // (campo adicionado na migration — permite consultas diretas na tabela).
    payload.subscription_cancel_at = unlimitedUntil;
  }

  if (customerId) payload.stripe_customer_id = String(customerId);
  if (subscriptionId) payload.stripe_subscription_id = String(subscriptionId);

  let query = supabase.from('users').update(payload).select('id');

  if (subscriptionId) {
    query = query.eq('stripe_subscription_id', String(subscriptionId));
  } else if (customerId) {
    query = query.eq('stripe_customer_id', String(customerId));
  } else {
    query = query.ilike('email', String(email).trim());
  }

  const { error } = await query.maybeSingle();
  if (error) {
    console.warn('Não foi possível marcar cancelamento agendado:', error.message);
  }
};

/**
 * Reativa uma assinatura Stripe (cancel_at_period_end voltou para false
 * ou nova assinatura foi criada após cancelamento).
 */
const reactivateStripeSubscription = async ({
  customerId = null,
  email = null,
  subscriptionId = null,
}) => {
  if (!customerId && !email && !subscriptionId) return;

  const payload = {
    plan: 'pro',
    subscription_status: 'active',
    subscription_cancel_at: null,
    updated_at: new Date().toISOString(),
  };

  if (customerId) payload.stripe_customer_id = String(customerId);
  if (subscriptionId) payload.stripe_subscription_id = String(subscriptionId);

  let query = supabase.from('users').update(payload).select('id');

  if (subscriptionId) {
    query = query.eq('stripe_subscription_id', String(subscriptionId));
  } else if (customerId) {
    query = query.eq('stripe_customer_id', String(customerId));
  } else {
    query = query.ilike('email', String(email).trim());
  }

  const { error } = await query.maybeSingle();
  if (error) {
    console.warn('Não foi possível reativar assinatura:', error.message);
  }
};

/**
 * ENCERRA DEFINITIVAMENTE a assinatura Stripe.
 * Chamado apenas quando customer.subscription.deleted dispara
 * (o período pago já terminou e a Stripe efetivamente encerrou a assinatura).
 *
 * REGRAS:
 *   - plan: 'free'
 *   - subscription_status: 'canceled'
 *   - unlimited_access_until: null (remove qualquer acesso residual)
 *   - credits: 0 (os créditos iniciais NÃO são devolvidos)
 */
const terminateStripeSubscription = async ({
  customerId = null,
  email = null,
  subscriptionId = null,
}) => {
  if (!customerId && !email && !subscriptionId) return;

  const payload = {
    plan: 'free',
    subscription_status: 'canceled',
    unlimited_access_until: null,
    subscription_cancel_at: null,
    credits: 0,
    updated_at: new Date().toISOString(),
  };

  let query = supabase.from('users').update(payload).select('id');

  if (subscriptionId) {
    query = query.eq('stripe_subscription_id', String(subscriptionId));
  } else if (customerId) {
    query = query.eq('stripe_customer_id', String(customerId));
  } else {
    query = query.ilike('email', String(email).trim());
  }

  const { error } = await query.maybeSingle();
  if (error) {
    console.warn('Não foi possível encerrar assinatura definitivamente:', error.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE — HELPERS DE CHECKOUT
// ─────────────────────────────────────────────────────────────────────────────

const fetchStripeCustomerEmail = async (customerId) => {
  if (!customerId) return null;

  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer?.deleted ? null : customer?.email || null;
  } catch (error) {
    console.warn('Não foi possível recuperar o cliente Stripe:', error.message);
    return null;
  }
};

const normalizeStripeEntityId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.id) return String(value.id);
  return null;
};

const fetchStripeCheckoutSession = async (sessionId) => {
  if (!sessionId) return null;

  return stripe.checkout.sessions.retrieve(String(sessionId), {
    expand: ['customer', 'subscription', 'subscription.latest_invoice'],
  });
};

const resolveStripeInvoiceIdFromSession = (session) => {
  const latestInvoice = session?.subscription?.latest_invoice;
  return normalizeStripeEntityId(latestInvoice) || normalizeStripeEntityId(session?.invoice) || null;
};

const syncStripeCheckoutSessionForUser = async ({
  authenticatedUserId,
  authenticatedEmail = null,
  sessionId,
}) => {
  if (!sessionId) {
    return { synced: false, reason: 'session_id_missing' };
  }

  const session = await fetchStripeCheckoutSession(sessionId);
  if (!session) {
    const error = new Error('Sessão Stripe não encontrada');
    error.status = 404;
    throw error;
  }

  const sessionUserId = session.client_reference_id || session.metadata?.user_id || session.subscription?.metadata?.user_id || null;
  const sessionEmail = session.customer_email
    || session.customer_details?.email
    || session.metadata?.email
    || session.customer?.email
    || null;

  const matchesAuthenticatedUser = (
    (sessionUserId && sessionUserId === authenticatedUserId)
    || (
      !sessionUserId
      && sessionEmail
      && authenticatedEmail
      && String(sessionEmail).trim().toLowerCase() === String(authenticatedEmail).trim().toLowerCase()
    )
  );

  if (!matchesAuthenticatedUser) {
    const error = new Error('A sessão Stripe não pertence ao usuário autenticado');
    error.status = 403;
    throw error;
  }

  const paymentConfirmed = ['paid', 'no_payment_required'].includes(String(session.payment_status || '').toLowerCase())
    || String(session.status || '').toLowerCase() === 'complete';

  if (!paymentConfirmed) {
    return {
      synced: false,
      reason: 'payment_not_confirmed',
      payment_status: session.payment_status || null,
      checkout_status: session.status || null,
    };
  }

  const customerId = normalizeStripeEntityId(session.customer);
  const subscriptionId = normalizeStripeEntityId(session.subscription);
  const externalId = resolveStripeInvoiceIdFromSession(session) || session.id;

  const transaction = await upsertPaymentTransaction({
    provider: STRIPE_PROVIDER,
    externalId,
    userId: sessionUserId || authenticatedUserId,
    email: sessionEmail || authenticatedEmail,
    paymentType: 'card',
    status: session.payment_status || session.status || 'completed',
    rawPayload: session,
  });

  if (!alreadyGrantedAccess(transaction)) {
    await applyUnlimitedAccessToUser({
      userId: sessionUserId || authenticatedUserId,
      email: sessionEmail || authenticatedEmail,
      provider: STRIPE_PROVIDER,
      externalId,
      customerId,
      subscriptionId,
    });
  }

  const profile = await findUserProfile({
    userId: sessionUserId || authenticatedUserId,
    email: sessionEmail || authenticatedEmail,
    customerId,
    subscriptionId,
  });

  return {
    synced: true,
    externalId,
    profile,
    session,
  };
};

const buildReferenceFromUserId = (userId) => (userId ? `lenavs:${userId}` : '');

const extractUserIdFromReference = (reference) => {
  const rawReference = String(reference || '').trim();
  const match = rawReference.match(/lenavs:([0-9a-f-]{36})/i);
  return match?.[1] || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGAR.ME — HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const getPagarmeApiHeaders = () => {
  const apiKey = getPagarmeSecretKey();

  if (!apiKey) {
    throw new Error('PAGARME_SECRET_KEY não configurada');
  }

  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
};

const getPagarmeAcceptedPaymentMethods = () => {
  const raw = String(process.env.PAGARME_ACCEPTED_PAYMENT_METHODS || 'pix,credit_card,boleto').trim();
  const methods = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return methods.length ? [...new Set(methods)] : ['pix', 'credit_card', 'boleto'];
};

const getPagarmeRequestUrl = (path) => `${getPagarmeApiBase()}${path}`;

const buildPagarmePlanId = () => String(process.env.PAGARME_PLAN_ID || '').trim() || null;

const buildPagarmePayload = ({ profile, user, returnUrls, checkoutContext, pricing }) => {
  const overrides = parseJsonEnv(process.env.PAGARME_CHECKOUT_OVERRIDES);
  const planId = buildPagarmePlanId();

  const normalizedEmail = String(profile?.email || user?.email || '').trim().toLowerCase();
  const customerName = profile?.display_name || nameFromEmail(normalizedEmail);
  const reference = buildReferenceFromUserId(user?.id);

  const basePayload = {
    customer: {
      name: customerName,
      email: normalizedEmail,
      type: 'individual',
    },
    items: [
      {
        amount: Math.round(pricing.amount * 100),
        description: pricing.label,
        quantity: 1,
        code: 'LENAVS_UNLIMITED',
      },
    ],
    payments: getPagarmeAcceptedPaymentMethods().map((method) => ({ payment_method: method })),
    success_url: returnUrls.success,
    metadata: {
      reference,
      user_id: user?.id || '',
      email: normalizedEmail,
      plan: 'unlimited',
      currency: pricing.currency,
    },
    ...(planId ? { plan_id: planId } : {}),
  };

  return deepMerge(basePayload, compactObject(overrides));
};

const createPagarmeCheckoutSession = async ({ profile, user, returnUrls, checkoutContext, pricing }) => {
  const headers = getPagarmeApiHeaders();
  const payload = buildPagarmePayload({ profile, user, returnUrls, checkoutContext, pricing });

  const response = await axios.post(
    getPagarmeRequestUrl('/orders'),
    payload,
    { headers, timeout: 15000 },
  );

  const checkoutUrl = response.data?.checkouts?.[0]?.payment_url
    || response.data?.checkout?.payment_url
    || response.data?.payment_url
    || null;

  if (!checkoutUrl) {
    throw new Error('URL de checkout do Pagar.me não encontrada na resposta');
  }

  return { sessionUrl: checkoutUrl, orderId: response.data?.id || null };
};

const buildStripeSessionParams = ({ profile, user, returnUrls, checkoutContext, pricing, priceId }) => {
  const overrides = parseJsonEnv(process.env.STRIPE_CHECKOUT_OVERRIDES);

  const normalizedEmail = String(profile?.email || user?.email || '').trim().toLowerCase();

  const baseParams = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: user?.id || undefined,
    customer_email: profile?.stripe_customer_id ? undefined : normalizedEmail,
    customer: profile?.stripe_customer_id || undefined,
    success_url: `${returnUrls.success}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: returnUrls.cancel,
    subscription_data: {
      metadata: {
        user_id: user?.id || '',
        email: normalizedEmail,
      },
    },
    metadata: {
      user_id: user?.id || '',
      email: normalizedEmail,
    },
    allow_promotion_codes: true,
  };

  return deepMerge(baseParams, compactObject(overrides));
};

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK — RAW BODY PARSER
// ─────────────────────────────────────────────────────────────────────────────

const parseWebhookRequest = (req) => {
  let rawBody = req.body;
  let payload = req.body;

  if (Buffer.isBuffer(rawBody)) {
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      payload = {};
    }
  } else if (typeof rawBody === 'string') {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = {};
    }
  }

  return { rawBody, payload };
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGAR.ME — WEBHOOK SIGNATURE VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

const verifyPagarmeWebhookSignature = (rawBody, req) => {
  if (!isPagarmeSignatureRequired()) return true;

  const secret = getPagarmeWebhookSecret();
  if (!secret) return true;

  const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');

  const sha256 = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
  const sha1 = crypto.createHmac('sha1', secret).update(bodyString).digest('hex');

  const signatureHeaders = [
    req.headers['x-pagarme-signature'],
    req.headers['x-hub-signature-256'],
    req.headers['x-hub-signature'],
    req.headers['x-webhook-signature'],
    req.headers['x-signature'],
  ].filter(Boolean);

  if (!signatureHeaders.length) return false;

  const normalizeSignature = (value) => {
    const raw = String(value || '').trim();
    return raw.replace(/^sha256=/i, '').replace(/^sha1=/i, '');
  };

  return signatureHeaders.some((headerValue) => {
    const received = normalizeSignature(headerValue);
    if (!received) return false;

    return [sha256, sha1].some((expectedHash) => {
      const expected = Buffer.from(expectedHash, 'utf8');
      const provided = Buffer.from(received, 'utf8');
      return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
    });
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGAR.ME — WEBHOOK DATA EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

const extractPagarmeWebhookData = (payload) => {
  const eventType = String(
    payload?.type || payload?.event || payload?.name || payload?.event_type || payload?.action || ''
  ).trim().toLowerCase();

  const containers = [
    payload,
    payload?.data,
    payload?.body,
    payload?.current,
    payload?.object,
    payload?.order,
    payload?.charge,
    payload?.invoice,
    payload?.subscription,
    payload?.data?.order,
    payload?.data?.charge,
    payload?.data?.invoice,
    payload?.data?.subscription,
    payload?.data?.object,
  ].filter(Boolean);

  let entityId = null;
  let orderId = null;
  let chargeId = null;
  let subscriptionId = null;
  let email = null;
  let paymentType = null;
  let status = null;
  let userId = null;
  let reference = null;

  for (const container of containers) {
    if (!entityId) {
      entityId = findFirstValue(container, ['id', 'data.id', 'object.id']);
    }

    if (!orderId) {
      orderId = findFirstValue(container, ['order.id', 'last_transaction.order_id', 'data.order.id']);
    }

    if (!chargeId) {
      chargeId = findFirstValue(container, ['charge.id', 'last_transaction.charge_id', 'charges.0.id', 'data.charge.id']);
    }

    if (!subscriptionId) {
      subscriptionId = findFirstValue(container, ['subscription.id', 'data.subscription.id']);
    }

    if (!email) {
      email = findFirstValue(container, [
        'customer.email',
        'customer.emails.0',
        'payer.email',
        'data.customer.email',
        'charges.0.customer.email',
        'last_transaction.customer.email',
        'metadata.email',
        'data.metadata.email',
      ]);
    }

    if (!paymentType) {
      paymentType = findFirstValue(container, [
        'payment_method',
        'last_transaction.payment_method',
        'charge.payment_method',
        'charges.0.payment_method',
      ]);
    }

    if (!status) {
      status = findFirstValue(container, [
        'status',
        'order.status',
        'charge.status',
        'invoice.status',
        'subscription.status',
        'last_transaction.status',
        'charges.0.status',
      ]);
    }

    if (!reference) {
      reference = findFirstValue(container, [
        'metadata.reference',
        'metadata.user_reference',
        'metadata.user_id',
        'data.metadata.reference',
        'checkout_settings.metadata.reference',
        'items.0.code',
        'charges.0.metadata.reference',
      ]);
    }

    if (!userId) {
      userId = findFirstValue(container, [
        'metadata.user_id',
        'data.metadata.user_id',
        'checkout_settings.metadata.user_id',
      ]);
    }
  }

  const normalizedReference = reference || null;
  const extractedUserId = extractUserIdFromReference(normalizedReference) || extractUserIdFromReference(entityId) || userId || null;
  const externalId = orderId || chargeId || subscriptionId || entityId || null;

  return {
    eventType,
    externalId: externalId ? String(externalId) : null,
    orderId: orderId ? String(orderId) : null,
    chargeId: chargeId ? String(chargeId) : null,
    subscriptionId: subscriptionId ? String(subscriptionId) : null,
    userId: extractedUserId ? String(extractedUserId) : null,
    email: email ? String(email).trim().toLowerCase() : null,
    paymentType: paymentType ? String(paymentType).trim().toLowerCase() : null,
    status: normalizeStatus(status || (eventType.includes('.paid') ? 'paid' : 'pending')),
    reference: normalizedReference ? String(normalizedReference) : null,
  };
};

const isPagarmePaymentConfirmed = ({ eventType = '', status = '' }) => {
  const normalizedEvent = String(eventType || '').toLowerCase();
  const normalizedStatus = String(status || '').toLowerCase();

  return (
    normalizedEvent.includes('.paid')
    || ['paid', 'succeeded', 'authorized', 'captured'].includes(normalizedStatus)
  );
};

const syncLatestPagarmeTransactionForUser = async (userId) => {
  if (!userId) return null;

  const { data: transaction, error } = await supabase
    .from('payment_transactions')
    .select('*')
    .eq('provider', PAGARME_PROVIDER)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('Não foi possível consultar a última transação Pagar.me:', error.message);
    return null;
  }

  return transaction || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLERS EXPORTADOS
// ─────────────────────────────────────────────────────────────────────────────

export const createPaymentSession = async (req, res) => {
  try {
    const user = req.user;

    if (!user || !user.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const provider = String(req.body?.provider || STRIPE_PROVIDER).toLowerCase();
    const profile = await findUserProfile({ userId: user.id });

    if (!profile) {
      return res.status(404).json({ error: 'Usuário não encontrado no banco de dados' });
    }

    const checkoutContext = resolveCheckoutContext({ profile, reqUser: user, req });
    const pricing = getMonthlyPlanPricing(checkoutContext.currency);
    const returnUrls = getReturnUrls(provider);

    if (provider === PAGARME_PROVIDER) {
      const session = await createPagarmeCheckoutSession({ profile, user, returnUrls, checkoutContext, pricing });
      return res.json({ sessionUrl: session.sessionUrl, provider: PAGARME_PROVIDER });
    }

    // Default: Stripe
    const priceId = getStripePriceId(checkoutContext.currency);
    if (!priceId) {
      return res.status(500).json({ error: 'Preço Stripe não configurado. Verifique as variáveis STRIPE_PRICE_BRL / STRIPE_PRICE_USD.' });
    }

    const sessionParams = buildStripeSessionParams({ profile, user, returnUrls, checkoutContext, pricing, priceId });
    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.json({ sessionUrl: session.url, provider: STRIPE_PROVIDER });
  } catch (err) {
    console.error('❌ Erro ao criar sessão de pagamento:', err.message);
    return res.status(err.status || 500).json({
      error: err.message || 'Não foi possível criar a sessão de pagamento',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK STRIPE
// ─────────────────────────────────────────────────────────────────────────────

export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();

  if (!webhookSecret) {
    console.error('❌ STRIPE_WEBHOOK_SECRET não configurado. O webhook Stripe não pode ser validado.');
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET não configurado' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      webhookSecret,
      STRIPE_WEBHOOK_TOLERANCE_SECONDS,
    );
  } catch (err) {
    console.error('❌ Erro ao verificar webhook Stripe:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // ── CHECKOUT CONCLUÍDO ─────────────────────────────────────────────────
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const customerEmail = session.customer_email || session.customer_details?.email || session.metadata?.email || null;
      const userId = session.client_reference_id || session.metadata?.user_id || null;
      const transactionId = resolveStripeInvoiceIdFromSession(session) || session.id;

      const transaction = await upsertPaymentTransaction({
        provider: STRIPE_PROVIDER,
        externalId: transactionId,
        userId,
        email: customerEmail,
        paymentType: 'card',
        status: session.payment_status || session.status || 'completed',
        rawPayload: session,
      });

      const isPaidCheckout = ['paid', 'no_payment_required'].includes(String(session.payment_status || '').toLowerCase())
        || String(session.status || '').toLowerCase() === 'complete';

      if (isPaidCheckout && !alreadyGrantedAccess(transaction)) {
        await applyUnlimitedAccessToUser({
          userId,
          email: customerEmail,
          provider: STRIPE_PROVIDER,
          externalId: transactionId,
          customerId: normalizeStripeEntityId(session.customer),
          subscriptionId: normalizeStripeEntityId(session.subscription),
        });
      }
    }

    // ── RENOVAÇÃO BEM-SUCEDIDA ─────────────────────────────────────────────
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      const customerId = normalizeStripeEntityId(invoice.customer);
      const subscriptionId = normalizeStripeEntityId(invoice.subscription);
      const customerEmail = invoice.customer_email || await fetchStripeCustomerEmail(customerId);
      const userId = invoice.parent?.subscription_details?.metadata?.user_id
        || invoice.lines?.data?.[0]?.metadata?.user_id
        || null;
      const transactionId = invoice.id || invoice.payment_intent || `invoice-${subscriptionId || Date.now()}`;

      const transaction = await upsertPaymentTransaction({
        provider: STRIPE_PROVIDER,
        externalId: transactionId,
        userId,
        email: customerEmail,
        paymentType: 'card',
        status: invoice.status || 'paid',
        rawPayload: invoice,
      });

      // Aplica/renova acesso ilimitado a cada invoice pago (renovação mensal)
      if (!alreadyGrantedAccess(transaction)) {
        await applyUnlimitedAccessToUser({
          userId,
          email: customerEmail,
          provider: STRIPE_PROVIDER,
          externalId: transactionId,
          customerId,
          subscriptionId,
        });
      }
    }

    // ── FALHA DE PAGAMENTO ─────────────────────────────────────────────────
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const customerId = normalizeStripeEntityId(invoice.customer);
      const subscriptionId = normalizeStripeEntityId(invoice.subscription);
      const customerEmail = invoice.customer_email || await fetchStripeCustomerEmail(customerId);

      await markStripeSubscriptionPastDue({
        customerId,
        email: customerEmail,
        subscriptionId,
      });
    }

    // ── ASSINATURA ATUALIZADA ──────────────────────────────────────────────
    // Evento disparado quando:
    //   1. Usuário cancela (cancel_at_period_end = true) → agendamento de cancelamento
    //   2. Usuário reativa assinatura cancelada (cancel_at_period_end = false)
    //   3. Status muda para past_due
    //   4. Outras atualizações de assinatura
    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const customerId = normalizeStripeEntityId(subscription.customer);
      const subscriptionId = normalizeStripeEntityId(subscription);
      const customerEmail = await fetchStripeCustomerEmail(customerId);

      const stripeStatus = String(subscription.status || '').toLowerCase();
      const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
      const periodEnd = subscription.current_period_end; // Unix timestamp (segundos)

      if (cancelAtPeriodEnd) {
        // CANCELAMENTO AGENDADO: usuário cancelou, mas ainda está no período pago.
        // Mantém Pro + define unlimited_access_until como o fim do período pago.
        await markStripeSubscriptionCanceledScheduled({
          customerId,
          email: customerEmail,
          subscriptionId,
          periodEnd,
        });
      } else if (stripeStatus === 'active') {
        // REATIVAÇÃO: assinatura foi reativada (ou renovada sem cancelamento pendente).
        await reactivateStripeSubscription({
          customerId,
          email: customerEmail,
          subscriptionId,
        });
      } else if (stripeStatus === 'past_due') {
        await markStripeSubscriptionPastDue({
          customerId,
          email: customerEmail,
          subscriptionId,
        });
      }
      // Outros status (incomplete, trialing, etc.) — sem ação no momento.
    }

    // ── ASSINATURA ENCERRADA DEFINITIVAMENTE ──────────────────────────────
    // Disparado quando a Stripe realmente deleta a assinatura após o período pago terminar.
    // APENAS aqui o acesso Premium é removido e o usuário retorna ao Free.
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = normalizeStripeEntityId(subscription.customer);
      const subscriptionId = normalizeStripeEntityId(subscription);
      const customerEmail = await fetchStripeCustomerEmail(customerId);

      await terminateStripeSubscription({
        customerId,
        email: customerEmail,
        subscriptionId,
      });
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('❌ Erro interno webhook Stripe:', err);
    return res.status(500).json({ error: 'Erro no webhook Stripe' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK PAGAR.ME
// ─────────────────────────────────────────────────────────────────────────────

export const handlePagarmeWebhook = async (req, res) => {
  try {
    const { rawBody, payload } = parseWebhookRequest(req);

    if (!verifyPagarmeWebhookSignature(rawBody, req)) {
      return res.status(400).json({ error: 'Assinatura inválida no webhook Pagar.me' });
    }

    const extracted = extractPagarmeWebhookData(payload);

    if (!extracted.externalId) {
      return res.status(200).json({ received: true, ignored: true, reason: 'external_id_missing' });
    }

    const transaction = await upsertPaymentTransaction({
      provider: PAGARME_PROVIDER,
      externalId: extracted.externalId,
      userId: extracted.userId,
      email: extracted.email,
      paymentType: extracted.paymentType || 'pagarme_checkout',
      status: extracted.status,
      rawPayload: payload,
    });

    if (isPagarmePaymentConfirmed(extracted) && !alreadyGrantedAccess(transaction)) {
      await applyUnlimitedAccessToUser({
        userId: extracted.userId,
        email: extracted.email,
        provider: PAGARME_PROVIDER,
        externalId: extracted.externalId,
      });
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('❌ Erro no webhook Pagar.me:', error.response?.data || error.message || error);
    return res.status(500).json({ error: 'Erro no webhook do Pagar.me' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SUBSCRIPTION STATUS
// ─────────────────────────────────────────────────────────────────────────────

export const getSubscriptionStatus = async (req, res) => {
  try {
    const user = req.user;

    if (!user || !user.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const syncProvider = String(req.query?.sync_provider || '').toLowerCase();

    if (syncProvider === PAGARME_PROVIDER) {
      await syncLatestPagarmeTransactionForUser(user.id);
    }

    if (syncProvider === STRIPE_PROVIDER) {
      const sessionId = String(req.query?.session_id || '').trim();
      if (sessionId) {
        await syncStripeCheckoutSessionForUser({
          authenticatedUserId: user.id,
          authenticatedEmail: user.email,
          sessionId,
        });
      }
    }

    const profile = await findUserProfile({ userId: user.id });

    if (!profile) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const snapshot = buildAccessSnapshot(profile);

    return res.json({
      plan: snapshot.plan,
      credits: profile.credits,
      credits_remaining: snapshot.credits_remaining,
      subscription_status: snapshot.subscription_status,
      unlimited_access_until: snapshot.unlimited_access_until,
      unlimited: snapshot.unlimited,
      access_type: snapshot.unlimited ? 'unlimited' : 'credits',
      // Presente quando assinatura foi cancelada mas período pago ainda não terminou.
      // Frontend usa para exibir: "Plano cancelado. Premium ativo até DD/MM/AAAA."
      cancel_scheduled_at: snapshot.cancel_scheduled_at,
      should_upgrade: !hasUnlimitedAccess(profile) && !getCreditsRemainingLabel(profile),
    });
  } catch (err) {
    console.error('❌ Erro ao buscar assinatura:', err.message);
    return res.status(err.status || 500).json({
      error: err.message || 'Erro ao buscar assinatura',
    });
  }
};
