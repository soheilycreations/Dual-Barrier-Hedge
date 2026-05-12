// Vercel Serverless Function — Deriv PAT → OTP WebSocket URL Proxy
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, appId } = req.body || {};
  if (!token || !appId) return res.status(400).json({ error: 'token and appId required' });

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Deriv-App-ID': appId,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Helper: safe JSON parse
  async function safeJson(r) {
    const text = await r.text();
    try { return { ok: true, data: JSON.parse(text), text }; }
    catch(e) { return { ok: false, data: null, text }; }
  }

  try {
    // ── Step 1: Get Accounts ──
    const accountsRes = await fetch('https://api.deriv.com/trading/v1/options/accounts', { headers });
    const accounts = await safeJson(accountsRes);

    if (!accountsRes.ok || !accounts.ok) {
      return res.status(502).json({
        error: `Deriv accounts API failed (HTTP ${accountsRes.status})`,
        detail: accounts.text.substring(0, 500),
        hint: 'Check App ID and Token permissions'
      });
    }

    const accountList = Array.isArray(accounts.data)
      ? accounts.data
      : (accounts.data.data || accounts.data.accounts || [accounts.data]);

    if (!accountList.length) {
      return res.status(404).json({ error: 'No accounts found', raw: accounts.text.substring(0, 300) });
    }

    // Pick demo account
    const account =
      accountList.find(a => a.is_virtual) ||
      accountList.find(a => a.account_type === 'demo') ||
      accountList.find(a => (a.account_id || a.id || a.loginid || '').toUpperCase().startsWith('VRT')) ||
      accountList[0];

    const accountId = account.account_id || account.id || account.loginid;
    if (!accountId) {
      return res.status(500).json({ error: 'Cannot read account ID', account });
    }

    // ── Step 2: Get OTP WebSocket URL ──
    const otpRes = await fetch(
      `https://api.deriv.com/trading/v1/options/accounts/${accountId}/otp`,
      { method: 'POST', headers }
    );
    const otp = await safeJson(otpRes);

    if (!otpRes.ok || !otp.ok) {
      return res.status(502).json({
        error: `Deriv OTP API failed (HTTP ${otpRes.status})`,
        detail: otp.text.substring(0, 500),
        accountId
      });
    }

    const wsUrl = otp.data.websocket_url || otp.data.url || otp.data.ws_url;
    if (!wsUrl) {
      return res.status(500).json({ error: 'No WebSocket URL in OTP response', otpData: otp.data });
    }

    return res.status(200).json({
      wsUrl,
      accountId,
      balance: account.balance,
      currency: account.currency,
      loginid: accountId,
      is_virtual: account.is_virtual || false
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
};
