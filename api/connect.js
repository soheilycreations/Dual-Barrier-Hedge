// Vercel Serverless Function — Deriv PAT → OTP WebSocket URL Proxy
// This runs server-side, bypassing browser CORS restrictions.

module.exports = async function handler(req, res) {
  // CORS headers — allow the Vercel-hosted frontend to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, appId, preferDemo } = req.body || {};

  if (!token || !appId) {
    return res.status(400).json({ error: 'token and appId are required' });
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Deriv-App-ID': appId,
    'Content-Type': 'application/json'
  };

  try {
    // ── Step 1: Get Accounts ──
    const accountsRes = await fetch('https://api.deriv.com/trading/v1/options/accounts', { headers });

    if (!accountsRes.ok) {
      const errText = await accountsRes.text();
      return res.status(accountsRes.status).json({
        error: `Auth failed (${accountsRes.status})`,
        detail: errText
      });
    }

    const accountsData = await accountsRes.json();
    const accountList = Array.isArray(accountsData)
      ? accountsData
      : (accountsData.data || accountsData.accounts || [accountsData]);

    if (!accountList || accountList.length === 0) {
      return res.status(404).json({ error: 'No accounts found. Check token permissions.' });
    }

    // ── Step 2: Pick account (demo preferred) ──
    let account;
    if (preferDemo !== false) {
      account =
        accountList.find(a => a.is_virtual) ||
        accountList.find(a => a.account_type === 'demo') ||
        accountList.find(a => (a.account_id || a.id || a.loginid || '').toUpperCase().startsWith('VRT')) ||
        accountList[0];
    } else {
      account = accountList.find(a => !a.is_virtual && a.account_type !== 'demo') || accountList[0];
    }

    const accountId = account.account_id || account.id || account.loginid;
    if (!accountId) {
      return res.status(500).json({ error: 'Could not determine account ID', account });
    }

    // ── Step 3: Get OTP WebSocket URL ──
    const otpRes = await fetch(
      `https://api.deriv.com/trading/v1/options/accounts/${accountId}/otp`,
      { method: 'POST', headers }
    );

    if (!otpRes.ok) {
      const errText = await otpRes.text();
      return res.status(otpRes.status).json({
        error: `OTP failed (${otpRes.status})`,
        detail: errText,
        accountId
      });
    }

    const otpData = await otpRes.json();
    const wsUrl = otpData.websocket_url || otpData.url || otpData.ws_url;

    if (!wsUrl) {
      return res.status(500).json({
        error: 'WebSocket URL not found in OTP response',
        otpData
      });
    }

    return res.status(200).json({
      wsUrl,
      accountId,
      balance: account.balance,
      currency: account.currency,
      loginid: accountId,
      email: account.email || '',
      is_virtual: account.is_virtual || false
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
