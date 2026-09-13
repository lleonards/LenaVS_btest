import { getCachedUserSnapshot } from '../utils/accessCache.js';
import { hasUnlimitedAccess } from '../utils/access.js';

export const requireActiveAccess = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        error: 'Usuário não autenticado ou token inválido'
      });
    }

    // Snapshot com cache de 10s — evita SELECT repetido no Supabase a cada
    // requisição de polling/sync (o principal causador de sobrecarga).
    const user = await getCachedUserSnapshot(req.user.id);

    if (!user) {
      console.error(`Usuário ${req.user.id} não encontrado no banco (requireActiveAccess)`);
      return res.status(403).json({
        error: 'Acesso negado: Perfil de usuário não encontrado no banco de dados.'
      });
    }

    if (hasUnlimitedAccess(user)) {
      return next();
    }

    if ((user.plan === 'free' || !user.plan) && (Number(user.credits) || 0) > 0) {
      return next();
    }

    return res.status(403).json({
      error: 'Créditos esgotados. Obtenha o plano ilimitado para continuar usando a plataforma.',
      code: 'NO_CREDITS',
      action: 'UPGRADE_REQUIRED'
    });
  } catch (err) {
    console.error('Erro CRÍTICO no requireActiveAccess:', err);
    return res.status(500).json({
      error: 'Erro interno ao verificar permissões de acesso.'
    });
  }
};
