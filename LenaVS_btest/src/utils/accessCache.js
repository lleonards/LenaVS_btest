/**
 * accessCache.js
 *
 * Cache em memória com TTL curto para o snapshot de acesso do usuário.
 *
 * Motivo: durante a sincronização do karaokê, o frontend consulta o status
 * do vídeo em loop. Sem cache, cada requisição disparava SELECTs repetidos
 * ao Supabase — em uma máquina de 1 vCPU / 2GB isso derrubava o servidor.
 *
 * Padrão: stale-while-revalidate — se o dado está expirado, devolve o último
 * valor conhecido enquanto busca o novo, evitando picos de latência.
 */
import { supabase } from '../config/supabase.js';

const TTL_MS = 10000; // 10s

const cache = new Map();

/**
 * Retorna o snapshot (plan, credits, subscription_status, unlimited_access_until)
 * de um usuário, com cache de 10s.
 */
export const getCachedUserSnapshot = async (userId, { force = false } = {}) => {
  if (!userId) return null;

  const now = Date.now();
  const hit = cache.get(userId);

  if (!force && hit && now - hit.at < TTL_MS) {
    return hit.data;
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('plan, credits, subscription_status, unlimited_access_until')
      .eq('id', userId)
      .single();

    if (error || !data) {
      if (hit) return hit.data; // stale-while-revalidate
      return null;
    }

    cache.set(userId, { at: now, data });
    return data;
  } catch (err) {
    if (hit) return hit.data;
    return null;
  }
};

/**
 * Invalida o cache (usar após consumo/atualização de créditos).
 */
export const invalidateCachedUser = (userId) => {
  if (userId) cache.delete(userId);
};

export default getCachedUserSnapshot;
