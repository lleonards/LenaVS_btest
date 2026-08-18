const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const UNLIMITED_ACCESS_DAYS = 30;

export const parseDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const isFutureDate = (value) => {
  const date = parseDateOrNull(value);
  return Boolean(date && date.getTime() > Date.now());
};

/**
 * Retorna true se o usuário tem acesso ilimitado ativo no momento.
 * Funciona corretamente para todos os estados:
 *   - Pro ativo: unlimited_access_until > now
 *   - Cancelamento agendado (ainda no período pago): unlimited_access_until > now
 *   - Cancelado/encerrado: unlimited_access_until null ou no passado → false
 */
export const hasUnlimitedAccess = (user = {}) => {
  const unlimitedUntil = parseDateOrNull(user?.unlimited_access_until);

  if (unlimitedUntil) {
    return unlimitedUntil.getTime() > Date.now();
  }

  // Fallback para assinaturas que não possuem unlimited_access_until preenchido
  return user?.plan === 'pro' && user?.subscription_status === 'active';
};

/**
 * Retorna a data em que o acesso Premium será encerrado quando há
 * um cancelamento agendado (cancel_at_period_end).
 *
 * Condição:
 *   - plan = 'pro'
 *   - subscription_status = 'canceled'
 *   - unlimited_access_until > now (ainda dentro do período pago)
 *
 * Retorna null em qualquer outro estado.
 */
export const getCancelScheduledAt = (user = {}) => {
  if (
    user?.plan === 'pro' &&
    user?.subscription_status === 'canceled' &&
    isFutureDate(user?.unlimited_access_until)
  ) {
    return parseDateOrNull(user.unlimited_access_until);
  }
  return null;
};

export const getCreditsRemainingLabel = (user = {}) => (
  hasUnlimitedAccess(user) ? 'unlimited' : Math.max(0, Number(user?.credits) || 0)
);

export const calculateExtendedUnlimitedAccessUntil = (currentValue, days = UNLIMITED_ACCESS_DAYS) => {
  const now = Date.now();
  const current = parseDateOrNull(currentValue);
  const baseTime = current && current.getTime() > now ? current.getTime() : now;
  return new Date(baseTime + (days * MS_PER_DAY));
};

export const buildAccessSnapshot = (user = {}) => {
  const unlimitedUntil = parseDateOrNull(user?.unlimited_access_until);
  const unlimited = hasUnlimitedAccess(user);
  const cancelScheduledAt = getCancelScheduledAt(user);

  return {
    unlimited,
    unlimited_access_until: unlimitedUntil ? unlimitedUntil.toISOString() : null,
    plan: unlimited ? 'pro' : (user?.plan || 'free'),
    subscription_status: unlimited
      ? (user?.subscription_status || 'active')
      : (user?.subscription_status || 'inactive'),
    credits_remaining: getCreditsRemainingLabel(user),
    // Presente apenas quando a assinatura foi cancelada mas o período pago ainda está em vigor.
    // Exibir na interface: "Plano cancelado. Premium ativo até <data>."
    cancel_scheduled_at: cancelScheduledAt ? cancelScheduledAt.toISOString() : null,
  };
};
