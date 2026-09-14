// Shared auth helpers — not exposed as an endpoint (underscore prefix)

export function verifyToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;

  // Simple HMAC-SHA256 token verification without external libs
  // Token format: base64(timestamp:hmac)
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [timestamp, hmac] = decoded.split(':');
    if (!timestamp || !hmac) return false;

    // Expire after 8 hours
    const age = Date.now() - parseInt(timestamp);
    if (age > 8 * 60 * 60 * 1000) return false;

    const expected = makeHmac(timestamp, process.env.SESSION_SECRET || 'humvance-secret');
    return hmac === expected;
  } catch {
    return false;
  }
}

export function makeToken() {
  const timestamp = Date.now().toString();
  const hmac = makeHmac(timestamp, process.env.SESSION_SECRET || 'humvance-secret');
  return Buffer.from(`${timestamp}:${hmac}`).toString('base64');
}

function makeHmac(data, secret) {
  // Simple deterministic hash without crypto module (works in Edge Runtime)
  let h = 0;
  const str = secret + data + secret;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36) + str.length.toString(36);
}

export async function hashPassword(pwd) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pwd + ':humvance:salt2026');
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
