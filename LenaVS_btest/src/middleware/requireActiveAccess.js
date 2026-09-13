import { supabase } from '../config/supabase.js';
import { hasUnlimitedAccess } from '../utils/access.js';

export const requireActiveAccess = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        error: 'Usuário não autenticado ou token inválido'
      });
    }

    const userId = req.user.id;

    const { data: user, error } = await supabase
      .from('users')
      .select('plan, credits, subscription_status, unlimited_access_until')
      .eq('id', userId)
      .single();

    if (error || !user) {
      console.error('Erro ao buscar usuário no banco:', error);
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
