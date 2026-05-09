export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, code, nome } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Dados obrigatorios' });
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'VaultChat <onboarding@resend.dev>',
        to: [email],
        subject: 'Seu codigo VaultChat',
        html: '<div style="background:#0A0B0D;padding:40px;text-align:center"><h2 style="color:#1D9E75">VaultChat</h2><p style="color:#F0EEE8">Ola ' + (nome||'Usuario') + '! Seu codigo:</p><h1 style="color:#1D9E75;letter-spacing:10px">' + code + '</h1><p style="color:#7A7D8A">Expira em 5 minutos</p></div>'
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data });
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}