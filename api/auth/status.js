import { kv } from '../_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const hash = await kv.get('admin:passwordHash');
    res.json({ setupDone: !!hash });
  } catch {
    res.json({ setupDone: false });
  }
}
