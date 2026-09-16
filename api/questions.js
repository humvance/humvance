'use strict';
const { setJSON } = require('./_utils');
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  setJSON(res);

  const { ref, t: token } = req.query;
  if (!ref || !token) return res.status(400).json({ error: 'رابط غير مكتمل' });

  try {
    const client = await kv.get(`client:${ref}`);
    if (!client) return res.status(404).json({ error: 'لم يتم العثور على الاستفسار' });

    const p2 = client.phases?.p2 || {};

    if (req.method === 'GET') {
      if (p2.clientToken !== token) return res.status(403).json({ error: 'رابط غير صحيح أو منتهي الصلاحية' });
      return res.status(200).json({
        alreadyAnswered: !!p2.answeredAt,
        companyName: client.companyName,
        contactName: client.contactName,
        questions: (p2.questions || []).map(q => ({ id: q.id, question: q.question, area: q.area }))
      });
    }

    if (req.method === 'POST') {
      if (p2.clientToken !== token) return res.status(403).json({ error: 'رابط غير صحيح' });
      if (p2.answeredAt) return res.status(400).json({ error: 'تم الإجابة على هذه الأسئلة مسبقاً' });

      const { answers } = req.body || {};
      if (!answers || !Array.isArray(answers)) return res.status(400).json({ error: 'الإجابات مطلوبة' });

      const existingPhases = client.phases || {};
      const updatedPhases = {
        ...existingPhases,
        p2: { ...p2, clientAnswers: answers, answeredAt: Date.now() }
      };

      await kv.set(`client:${ref}`, {
        ...client,
        phases: updatedPhases,
        pipelineStage: 'p3_analysis',
        updatedAt: Date.now()
      });

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[questions]', err.message);
    return res.status(500).json({ error: 'حدث خطأ' });
  }
};
