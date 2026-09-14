import { kv } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const submission = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { ref } = submission;
    if (!ref) return res.status(400).json({ error: 'Missing ref' });

    await kv.set(`submission:${ref}`, JSON.stringify(submission));
    await kv.lpush('submission-refs', ref);

    res.status(200).json({ success: true, ref });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
