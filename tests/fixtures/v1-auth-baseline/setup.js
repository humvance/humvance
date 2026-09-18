'use strict';
const { hashPassword, signJWT, setJSON } = require('../_utils');
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  setJSON(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const existing = await kv.get('admin:password_hash');
    if (existing) {
      return res.status(409).json({ error: 'الإعداد مكتمل بالفعل. الرجاء تسجيل الدخول.' });
    }

    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const hash = hashPassword(password);
    await kv.set('admin:password_hash', hash);

    const token = signJWT({ role: 'admin' });
    return res.status(200).json({ token });
  } catch (err) {
    console.error('[auth/setup]', err.message);
    return res.status(500).json({ error: 'فشل الإعداد. تحقق من إعداد قاعدة البيانات.' });
  }
};
