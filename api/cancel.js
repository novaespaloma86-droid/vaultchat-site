const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name } = req.body || {};

  try {
    // E-mail para o USUÁRIO que cancelou
    await resend.emails.send({
      from: 'VaultChat <onboarding@resend.dev>',
      to: email || 'novaespaloma86@gmail.com',
      subject: '😔 Sua assinatura VaultChat foi cancelada',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0A0B0D;color:#F0EEE8;padding:32px;border-radius:12px;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="background:#1D9E75;width:48px;height:48px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-size:24px;">🔒</div>
            <h2 style="margin:12px 0 4px;font-size:22px;">VaultChat</h2>
          </div>
          <h3 style="color:#F0EEE8;font-size:18px;margin-bottom:12px;">Assinatura cancelada</h3>
          <p style="color:#7A7D8A;line-height:1.6;margin-bottom:16px;">
            Olá${name ? ' ' + name : ''}! Confirmamos o cancelamento da sua assinatura VaultChat.
          </p>
          <div style="background:#1A1D24;border:1px solid #2A2D38;border-radius:8px;padding:16px;margin-bottom:20px;">
            <p style="color:#7A7D8A;font-size:13px;margin:0 0 8px;">O que acontece agora:</p>
            <ul style="color:#F0EEE8;font-size:13px;line-height:1.8;padding-left:16px;margin:0;">
              <li>Você mantém acesso até o fim do período pago</li>
              <li>Seus dados serão apagados em 30 dias</li>
              <li>Sem cobranças futuras</li>
            </ul>
          </div>
          <p style="color:#7A7D8A;font-size:13px;line-height:1.6;">
            Sentiremos sua falta! Se mudar de ideia, é só voltar em 
            <a href="https://vaultchat-site.vercel.app" style="color:#1D9E75;">vaultchat.com.br</a>
          </p>
          <hr style="border:none;border-top:1px solid #2A2D38;margin:24px 0;">
          <p style="color:#7A7D8A;font-size:11px;text-align:center;">© 2025 VaultChat · Todos os direitos reservados</p>
        </div>
      `
    });

    // E-mail de notificação para VOCÊ (admin)
    await resend.emails.send({
      from: 'VaultChat <onboarding@resend.dev>',
      to: 'novaespaloma86@gmail.com',
      subject: '⚠️ Novo cancelamento VaultChat',
      html: `
        <div style="font-family:sans-serif;padding:24px;">
          <h3>Novo cancelamento</h3>
          <p><strong>E-mail:</strong> ${email || 'não informado'}</p>
          <p><strong>Nome:</strong> ${name || 'não informado'}</p>
          <p><strong>Data:</strong> ${new Date().toLocaleString('pt-BR')}</p>
        </div>
      `
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao enviar e-mail' });
  }
};
