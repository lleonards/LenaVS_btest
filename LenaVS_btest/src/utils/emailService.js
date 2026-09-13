import nodemailer from 'nodemailer';

/**
 * Configuração do transporter de email
 */
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // true somente para porta 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

/**
 * Escape simples para evitar problemas com HTML no email
 */
const escapeHtml = (text = '') => {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Envia email de relatório de erro (uso interno legado)
 */
export const sendErrorReport = async (errorData) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: process.env.ERROR_REPORT_EMAIL || 'suporte@lenavs.com',
      subject: `[LenaVS] Relatório de Erro - ${new Date().toLocaleString('pt-BR')}`,
      html: `
        <h2>Relatório de Erro - LenaVS</h2>

        <p>
          <strong>Usuário:</strong>
          ${escapeHtml(errorData.userEmail || 'Anônimo')}
        </p>

        <p>
          <strong>Data/Hora:</strong>
          ${new Date().toLocaleString('pt-BR')}
        </p>

        <p><strong>Descrição:</strong></p>
        <p>${escapeHtml(errorData.description || '')}</p>

        <hr>

        <p><strong>Informações Técnicas:</strong></p>
        <pre>
${escapeHtml(JSON.stringify(errorData.technicalInfo || {}, null, 2))}
        </pre>
      `,
    };

    await transporter.sendMail(mailOptions);

    return {
      success: true,
      message: 'Relatório enviado com sucesso',
    };

  } catch (error) {
    console.error('Erro ao enviar email:', error);
    throw new Error('Falha ao enviar relatório de erro');
  }
};


/**
 * Envia mensagem de contato de suporte
 *
 * @param {{ name: string, email: string, description: string }} params
 */
export const sendSupportContact = async ({ name, email, description }) => {
  try {
    const transporter = createTransporter();

    const now = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'medium',
    });

    const body =
      `Nome: ${name}\n\n` +
      `E-mail: ${email}\n\n` +
      `Data/Hora: ${now}\n\n` +
      `Mensagem:\n\n${description}`;


    const mailOptions = {
      from: process.env.SMTP_USER,
      to: process.env.SUPPORT_EMAIL || 'suporte@lenavs.com',
      replyTo: email,
      subject: 'LenaVS | Suporte',

      text: body,

      html: `
        <h2>Novo contato de suporte - LenaVS</h2>

        <p>
          <strong>Nome:</strong>
          ${escapeHtml(name)}
        </p>

        <p>
          <strong>E-mail:</strong>
          ${escapeHtml(email)}
        </p>

        <p>
          <strong>Data/Hora:</strong>
          ${escapeHtml(now)}
        </p>

        <hr />

        <p>
          <strong>Mensagem:</strong>
        </p>

        <p>
          ${escapeHtml(description).replace(/\n/g, '<br />')}
        </p>
      `,
    };

    await transporter.sendMail(mailOptions);

    return {
      success: true,
    };

  } catch (error) {
    console.error('Erro ao enviar e-mail de suporte:', error);
    throw new Error('Falha ao enviar e-mail de suporte');
  }
};
