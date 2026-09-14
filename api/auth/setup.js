import { kv } from '@vercel/kv';
import { hashPassword, makeToken } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Only allow setup if not already configured
    const existing = await kv.get('admin:passwordHash');
    if (existing) return res.status(409).json({ error: 'Admin already configured' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { password } = body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password too short' });
    }

    const hash = await hashPassword(password);
    await kv.set('admin:passwordHash', hash);

    const token = makeToken();
    res.json({ success: true, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
