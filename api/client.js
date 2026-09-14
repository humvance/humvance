import { kv } from '@vercel/kv';
import { verifyToken } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!verifyToken(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'Missing ref' });

  try {
    if (req.method === 'GET') {
      const raw = await kv.get(`submission:${ref}`);
      if (!raw) return res.status(404).json({ error: 'Not found' });
      res.json(typeof raw === 'string' ? JSON.parse(raw) : raw);

    } else if (req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const raw = await kv.get(`submission:${ref}`);
      if (!raw) return res.status(404).json({ error: 'Not found' });
      const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const updated = { ...existing, ...body, ref };
      await kv.set(`submission:${ref}`, JSON.stringify(updated));
      res.json({ success: true });

    } else {
      res.status(405).end();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
