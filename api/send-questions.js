'use strict';
const { setJSON, requireAdmin } = require('./_utils');
const { kv } = require('@vercel/kv');

function buildEmail(client, link) {
  const name = client.contactName || 'عزيزي العميل';
  const company = client.companyName || '';
  return {
    subject: `لديك أسئلة من Humvance — ${company}`,
    html: `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F6F5F1;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border:1px solid #E2E1DD;border-radius:10px;overflow:hidden">
  <div style="background:#0A0A0A;padding:22px 28px">
    <span style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-.3px">Humvance</span>
  </div>
  <div style="padding:32px 28px">
    <p style="font-size:16px;color:#0A0A0A;margin:0 0 16px">السلام عليكم ${name}،</p>
    <p style="font-size:14px;color:#444;line-height:1.8;margin:0 0 24px">
      شكراً لتواصلكم مع <strong>Humvance</strong>. لمساعدتنا في فهم وضع <strong>${company}</strong> بشكل أفضل وتقديم خدمة مخصصة لاحتياجاتكم، نرجو منكم الإجابة على عدد من الأسئلة.
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${link}" style="display:inline-block;background:#0A0A0A;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:700">الإجابة على الأسئلة →</a>
    </div>
    <p style="font-size:12px;color:#888;margin:24px 0 4px">أو انسخ هذا الرابط في متصفحك:</p>
    <p style="font-size:12px;color:#555;direction:ltr;text-align:left;word-break:break-all;margin:0">${link}</p>
  </div>
  <div style="background:#F6F5F1;border-top:1px solid #E2E1DD;padding:14px 28px;text-align:center">
    <p style="font-size:11px;color:#999;margin:0">هذا الرابط مخصص لـ ${company} فقط · <a href="https://humvance.com" style="color:#999">humvance.com</a></p>
  </div>
</div>
</body>
</html>`,
    text: `السلام عليكم ${name}،\n\nلديكم أسئلة من Humvance. يرجى فتح الرابط التالي للإجابة:\n\n${link}\n\nشكراً،\nفريق Humvance`
  };
}

module.exports = async function handler(req, res) {
  setJSON(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'RESEND_API_KEY غير مضبوط في Vercel' });

  const { ref } = req.body || {};
  if (!ref) return res.status(400).json({ error: 'ref مطلوب' });

  try {
    const client = await kv.get(`client:${ref}`);
    if (!client) return res.status(404).json({ error: 'العميل غير موجود' });

    const p2 = client.phases?.p2 || {};
    if (!p2.clientToken) return res.status(400).json({ error: 'يجب اعتماد الأسئلة أولاً قبل الإرسال' });
    if (!client.email) return res.status(400).json({ error: 'لا يوجد بريد إلكتروني للعميل' });

    const link = `https://www.humvance.com/questions?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(p2.clientToken)}`;
    const { subject, html, text } = buildEmail(client, link);

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: 'Humvance <info@humvance.com>',
        to: [client.email],
        subject,
        html,
        text
      })
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.message || data.name || 'Resend error');

    // Mark email as sent
    const existingPhases = client.phases || {};
    await kv.set(`client:${ref}`, {
      ...client,
      phases: {
        ...existingPhases,
        p2: { ...p2, emailSentAt: Date.now(), emailTo: client.email }
      },
      updatedAt: Date.now()
    });

    return res.status(200).json({ success: true, emailId: data.id, sentTo: client.email });
  } catch (err) {
    console.error('[send-questions]', err.message);
    return res.status(500).json({ error: 'فشل إرسال الإيميل: ' + err.message });
  }
};
