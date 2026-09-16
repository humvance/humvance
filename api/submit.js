'use strict';
const { setJSON } = require('./_utils');
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  setJSON(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const submission = req.body;
    if (!submission || !submission.ref) {
      return res.status(400).json({ error: 'بيانات الاستبيان غير مكتملة' });
    }

    const { ref } = submission;
    const data = { ...submission, submittedAt: Date.now() };

    await kv.set(`client:${ref}`, data);
    await kv.lpush('clients:refs', ref);

    return res.status(200).json({ success: true, ref });
  } catch (err) {
    console.error('[submit]', err.message);
    return res.status(500).json({ error: 'فشل حفظ الاستبيان' });
  }
};
