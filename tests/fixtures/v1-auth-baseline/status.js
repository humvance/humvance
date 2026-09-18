'use strict';
const { verifyJWT, getToken, setJSON } = require('../_utils');
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  setJSON(res);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const hash = await kv.get('admin:password_hash');
    const setupDone = Boolean(hash);

    // Is the caller authenticated FOR THE ADMIN APPLICATION?
    // A portal token (role:'client') is a validly signed JWT but must never
    // make the Admin SPA believe it is logged in.
    const token = getToken(req);
    const payload = token ? verifyJWT(token) : null;
    const authenticated = Boolean(payload) && payload.role === 'admin';

    return res.status(200).json({ setupDone, authenticated });
  } catch (err) {
    console.error('[auth/status]', err.message);
    return res.status(200).json({ setupDone: false, authenticated: false });
  }
};
