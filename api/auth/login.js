import { kv } from '@vercel/kv';
import { hashPassword, makeToken } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { password } = body;
    if (!password) return res.status(400).json({ error: 'Missing password' });

    const storedHash = await kv.get('admin:passwordHash');
    if (!storedHash) return res.status(404).json({ error: 'Admin not configured', setupRequired: true });

    const inputHash = await hashPassword(password);
    if (inputHash !== storedHash) {
      return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    }

    const token = makeToken();
    res.json({ success: true, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
