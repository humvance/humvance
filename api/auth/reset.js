'use strict';
const { hashPassword, signJWT, setJSON } = require('../_utils');
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  setJSON(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { otp, newPassword } = req.body || {};

  if (!otp || !newPassword) {
    return res.status(400).json({ error: 'الرمز وكلمة المرور مطلوبان' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }

  try {
    const storedOtp = await kv.get('admin:reset_otp');

    if (!storedOtp || storedOtp !== otp) {
      return res.status(401).json({ error: 'الرمز غير صحيح أو منتهي الصلاحية' });
    }

    // Delete OTP so it can't be reused
    await kv.del('admin:reset_otp');

    const hash = hashPassword(newPassword);
    await kv.set('admin:password_hash', hash);

    const token = signJWT({ role: 'admin' });
    return res.status(200).json({ success: true, token });
  } catch (err) {
    console.error('[reset]', err.message);
    return res.status(500).json({ error: 'فشل إعادة تعيين كلمة المرور' });
  }
};
