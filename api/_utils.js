'use strict';
const crypto = require('crypto');

function hashPassword(pwd) {
  return crypto.createHash('sha256')
    .update(pwd + ':humvance:salt2026')
    .digest('hex');
}

function signJWT(payload) {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'hv-change-this-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  if (!token) return null;
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'hv-change-this-secret';
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    const sigBuf = Buffer.from(sig, 'base64url');
    const expBuf = Buffer.from(expected, 'base64url');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function setJSON(res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
}

// Authorization for internal/admin endpoints.
//
// A valid signature is NOT authorization. Portal tokens (role:'client') are
// signed with the same secret as admin tokens, so every admin endpoint must
// check the role as well — otherwise a client can read another client's data
// simply by changing ?ref=.
//
// Returns { ok:true, payload } or { ok:false, code, error }.
function requireAdmin(req) {
  const payload = verifyJWT(getToken(req));
  if (!payload) return { ok: false, code: 401, error: 'Unauthorized' };
  if (payload.role !== 'admin') return { ok: false, code: 403, error: 'غير مصرح' };
  return { ok: true, payload };
}

module.exports = { hashPassword, signJWT, verifyJWT, getToken, setJSON, requireAdmin };
