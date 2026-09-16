'use strict';
const { hashPassword, signJWT, setJSON } = require('../_utils');
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  setJSON(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'كلمة المرور مطلوبة' });
    }

    const storedHash = await kv.get('admin:password_hash');
    if (!storedHash) {
      return res.status(400).json({ error: 'لم يتم إعداد حساب الإدارة بعد' });
    }

    const inputHash = hashPassword(password);
    if (inputHash !== storedHash) {
      return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    }

    const token = signJWT({ role: 'admin' });
    return res.status(200).json({ token });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ error: 'خطأ في تسجيل الدخول' });
  }
};
