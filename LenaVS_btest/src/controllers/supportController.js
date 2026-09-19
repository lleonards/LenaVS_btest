import { sendSupportContact } from '../utils/emailService.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/support/report-error
 *
 * Body: { name, email, description }
 *
 * Se o usuário estiver autenticado (req.user), name e email podem ser
 * omitidos — o backend usará os dados da conta como fallback.
 */
export const reportError = async (req, res) => {
  try {
    const { name, email, description } = req.body;

    const resolvedName = String(name || req.user?.display_name || '').trim();
    const resolvedEmail = String(email || req.user?.email || '').trim();
    const resolvedDescription = String(description || '').trim();

    if (!resolvedName) {
      return res.status(400).json({ error: 'Nome é obrigatório.' });
    }

    if (!resolvedEmail) {
      return res.status(400).json({ error: 'E-mail é obrigatório.' });
    }

    if (!EMAIL_REGEX.test(resolvedEmail)) {
      return res.status(400).json({ error: 'Informe um e-mail válido.' });
    }

    if (!resolvedDescription) {
      return res.status(400).json({ error: 'Mensagem é obrigatória.' });
    }

    if (resolvedDescription.length < 10) {
      return res.status(400).json({ error: 'Mensagem deve ter no mínimo 10 caracteres.' });
    }

    await sendSupportContact({
      name: resolvedName,
      email: resolvedEmail,
      description: resolvedDescription,
    });

    return res.status(200).json({
      success: true,
      message: 'Mensagem enviada com sucesso. Nossa equipe responderá em até 24 horas.',
    });
  } catch (error) {
    console.error('Erro ao enviar mensagem de suporte:', error);
    return res.status(500).json({
      error: 'Não foi possível enviar sua mensagem. Tente novamente em alguns instantes.',
    });
  }
};
