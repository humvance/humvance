'use strict';
const { setJSON } = require('../_utils');
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  setJSON(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminEmail = process.env.ADMIN_EMAIL || 'info@humvance.com';
  const resendKey = process.env.RESEND_API_KEY;

  const { email } = req.body || {};
  if (!email || email.trim().toLowerCase() !== adminEmail.toLowerCase()) {
    // Always return success to avoid email enumeration
    return res.status(200).json({ sent: true });
  }

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));

  try {
    // Store OTP in KV with 15 min expiry
    await kv.set('admin:reset_otp', otp, { ex: 900 });

    if (resendKey) {
      // Send email via Resend
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `Humvance <noreply@humvance.com>`,
          to: [adminEmail],
          subject: 'رمز إعادة تعيين كلمة المرور — Humvance',
          html: `
            <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #e5e7eb">
              <h2 style="margin:0 0 16px;font-size:20px">إعادة تعيين كلمة المرور</h2>
              <p style="color:#6b7280;margin:0 0 24px">استخدم الرمز التالي لإعادة تعيين كلمة مرور لوحة الإدارة:</p>
              <div style="background:#f9fafb;border:2px solid #111;border-radius:8px;padding:24px;text-align:center;font-size:36px;font-weight:900;letter-spacing:8px;font-family:monospace">${otp}</div>
              <p style="color:#9ca3af;font-size:13px;margin:20px 0 0;text-align:center">صالح لمدة 15 دقيقة فقط. إذا لم تطلب هذا، تجاهل الرسالة.</p>
            </div>
          `
        })
      });

      if (!emailRes.ok) {
        const err = await emailRes.text();
        console.error('[forgot] Resend error:', err);
      }
    } else {
      console.log('[forgot] OTP (no email service configured):', otp);
    }

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('[forgot]', err.message);
    return res.status(500).json({ error: 'فشل إرسال رمز إعادة الضبط' });
  }
};
