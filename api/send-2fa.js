 
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, code, nome } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Dados obrigatorios' });
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'VaultChat <onboarding@resend.dev>',
        to: [email],
        subject: '🔐 Seu código VaultChat',
        html: `<div style="background:#0A0B0D;padding:40px;font-family:sans-serif;text-align:center"><div style="background:#0F1114;border:1px solid #2A2D38;border-radius:18px;padding:40px;max-width:400px;margin:0 auto"><div style="font-size:40px;margin-bottom:16px">🔒</div><h2 style="color:#F0EEE8;margin:0 0 8px">VaultChat</h2><p style="color:#7A7D8A;margin:0 0 24px">Olá ${nome || 'Usuário'}! Seu código:</p><div style="background:#161820;border:1px solid #1D9E75;border-radius:14px;padding:24px;margin:0 0 16px"><span style="font-size:36px;font-weight:800;color:#1D9E75;letter-spacing:10px;font-family:monospace">${code}</span></div><p style="color:#7A7D8A;font-size:13px">Expira em 5 minutos</p></div></div>`
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data });
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}