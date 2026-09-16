'use strict';
const { setJSON } = require('./_utils');
const { kv } = require('@vercel/kv');

// Reference identifiers are minted client-side by genRef() in public/index.html:
//     `HUM-${new Date().getFullYear()}-${1000..9999}`
// i.e. HUM-<4-digit year>-<4-digit number>. Nothing else is a legitimate ref.
//
// `ref` is interpolated directly into the KV key (`client:${ref}`), so an
// unvalidated value can address ANY key in the namespace - a trailing
// ".diagnostic" or ".meeting.<id>" would overwrite that client's diagnostic or
// meeting artifact. The anchored pattern below is the boundary that prevents it.
const REF_PATTERN = /^HUM-[0-9]{4}-[0-9]{4}$/;

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

    // Reject non-strings outright rather than relying on coercion: String(['HUM-2026-1234'])
    // silently yields a valid-looking ref. Then normalise exactly as portal login does
    // (ref.toUpperCase().trim()) so the stored key and a later portal lookup cannot disagree.
    if (typeof submission.ref !== 'string') {
      return res.status(400).json({ error: 'المعرف المرجعي غير صالح' });
    }
    const ref = submission.ref.toUpperCase().trim();
    if (!REF_PATTERN.test(ref)) {
      return res.status(400).json({ error: 'المعرف المرجعي غير صالح' });
    }

    // Intake CREATES ONLY. An existing record is never overwritten by an
    // unauthenticated request. genRef() is random, so a colliding ref is
    // re-minted when the visitor retries.
    const existing = await kv.get(`client:${ref}`);
    if (existing) {
      return res.status(409).json({ error: 'المعرف المرجعي مستخدم مسبقاً. يرجى إعادة الإرسال.' });
    }

    // Store the normalised ref so the record's own field matches its key.
    const data = { ...submission, ref, submittedAt: Date.now() };

    await kv.set(`client:${ref}`, data);
    await kv.lpush('clients:refs', ref);

    return res.status(200).json({ success: true, ref });
  } catch (err) {
    console.error('[submit]', err.message);
    return res.status(500).json({ error: 'فشل حفظ الاستبيان' });
  }
};
