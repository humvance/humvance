import { kv } from '@vercel/kv';
import { verifyToken } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!verifyToken(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const refs = await kv.lrange('submission-refs', 0, 199);
    if (!refs || refs.length === 0) return res.json([]);

    const clients = await Promise.all(
      refs.map(async (ref) => {
        const raw = await kv.get(`submission:${ref}`);
        return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      })
    );

    res.json(clients.filter(Boolean));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
