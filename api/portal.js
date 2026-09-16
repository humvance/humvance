'use strict';
const { signJWT, verifyJWT, getToken, setJSON } = require('./_utils');
const { kv } = require('@vercel/kv');

const STAGE_MAP = {
  'new':          { step:1, label:'تم استلام التقييم',        msg:'تم استلام تقييمكم بنجاح. فريق Humvance سيبدأ المراجعة قريباً.', action:null },
  'p1_review':    { step:2, label:'قيد المراجعة الأولية',    msg:'نراجع معلومات شركتكم ونحدد أولويات الفهم العميق.', action:null },
  'p2_questions': { step:2, label:'إعداد أسئلة متابعة',     msg:'Humvance يُعد أسئلة مخصصة بناءً على وضع شركتكم.', action:null },
  'p2_sent':      { step:3, label:'معلومات إضافية مطلوبة', msg:'نحتاج إلى معلومات إضافية لاستكمال تقييم شركتكم. يرجى الإجابة على الأسئلة.', action:'questions' },
  'p2_waiting':   { step:3, label:'معلومات إضافية مطلوبة', msg:'نحتاج إلى معلومات إضافية. يرجى الإجابة على الأسئلة المرسلة.', action:'questions' },
  'p3_analysis':  { step:4, label:'تحليل المعلومات',        msg:'فريقنا يحلل جميع المعلومات المجمعة ويستعد للمرحلة التالية.', action:null },
  'p4_meeting':   { step:5, label:'اجتماع استكشافي مطلوب',  msg:'سيتواصل معكم فريق Humvance لتحديد موعد اجتماع استكشافي.', action:null },
  'p5_post':      { step:5, label:'مراجعة نتائج الاجتماع',  msg:'فريقنا يراجع نتائج اجتماعنا ويستكمل التحليل.', action:null },
  'p6_deep':      { step:4, label:'استكشاف تفصيلي',         msg:'نجمع معلومات إضافية لتصميم الحل الأنسب لشركتكم.', action:null },
  'p6_waiting':   { step:4, label:'استكشاف تفصيلي',         msg:'بانتظار المعلومات الإضافية لاستكمال التحليل.', action:null },
  'p7_final':     { step:5, label:'اجتماع تفصيلي',          msg:'سيتواصل معكم فريق Humvance لتحديد موعد الاجتماع التفصيلي.', action:null },
  'p8_internal':  { step:6, label:'تصميم الحل',             msg:'فريقنا يعمل على تصميم الحل الأمثل لشركتكم.', action:null },
  'p9_scope':     { step:6, label:'تصميم الحل',             msg:'فريقنا يُعد الحل المقترح لشركتكم.', action:null },
  'p10_pricing':  { step:6, label:'إعداد العرض',            msg:'فريقنا يُعد العرض التجاري لشركتكم.', action:null },
  'p11_approval': { step:7, label:'مراجعة العرض النهائية',  msg:'العرض قيد المراجعة النهائية من فريق Humvance.', action:null },
  'p12_ready':    { step:7, label:'العرض جاهز',             msg:'عرضكم جاهز. يرجى التواصل مع فريق Humvance لمراجعته.', action:'proposal' },
  'p13_sent':     { step:7, label:'بانتظار قراركم',         msg:'عرضكم لديكم. بانتظار قراركم للمضي قدماً.', action:'proposal' },
  'won':          { step:8, label:'تم التعاقد ✓',           msg:'يسعدنا بدء تعاوننا معكم. سيتواصل معكم فريق Humvance لتحديد خطوات انطلاق المشروع.', action:null },
  'lost':         { step:0, label:'مغلق',                   msg:'', action:null }
};

function buildTimeline(client) {
  const events = [];
  const add = (ts, msg, icon) => { if (ts) events.push({ ts, msg, icon }); };
  add(client.createdAt,                    'تم تقديم التقييم',              '📋');
  if (client.pipelineStage && client.pipelineStage !== 'new') {
    add((client.phases?.p1?.generatedAt || client.updatedAt), 'Humvance بدأ مراجعة طلبكم', '🔍');
  }
  add(client.phases?.p2?.sentAt,           'طُلبت معلومات إضافية',          '❓');
  add(client.phases?.p2?.emailSentAt,      'تم إرسال الأسئلة بالإيميل',     '📧');
  add(client.phases?.p2?.answeredAt,       'تم استلام إجاباتكم',            '✅');
  add(client.phases?.p3?.generatedAt,      'Humvance يحلل المعلومات',       '🔬');
  return events.sort((a, b) => a.ts - b.ts);
}

module.exports = async function handler(req, res) {
  setJSON(res);

  // POST — client login: { ref, email }
  if (req.method === 'POST') {
    const { ref, email } = req.body || {};
    if (!ref || !email) return res.status(400).json({ error: 'رقم الطلب والبريد الإلكتروني مطلوبان' });
    try {
      const clientRef = ref.toUpperCase().trim();
      const client = await kv.get(`client:${clientRef}`);
      if (!client) return res.status(404).json({ error: 'رقم الطلب غير موجود' });
      if (!client.email) return res.status(400).json({ error: 'لا يوجد بريد إلكتروني مسجل لهذا الطلب. يرجى التواصل مع info@humvance.com' });
      if (client.email.toLowerCase().trim() !== email.toLowerCase().trim()) {
        return res.status(401).json({ error: 'البريد الإلكتروني لا يطابق رقم الطلب' });
      }
      const token = signJWT({ sub: clientRef, ref: clientRef, role: 'client' });
      return res.status(200).json({ token, ref: clientRef, companyName: client.companyName });
    } catch (err) {
      console.error('[portal login]', err.message);
      return res.status(500).json({ error: 'حدث خطأ في الخادم' });
    }
  }

  // GET — client dashboard data
  if (req.method === 'GET') {
    const payload = verifyJWT(getToken(req));
    if (!payload || payload.role !== 'client') return res.status(401).json({ error: 'غير مصرح — يرجى تسجيل الدخول' });
    try {
      const client = await kv.get(`client:${payload.ref}`);
      if (!client) return res.status(404).json({ error: 'العميل غير موجود' });

      const stage = client.pipelineStage || 'new';
      const info = STAGE_MAP[stage] || STAGE_MAP['new'];
      const p2 = client.phases?.p2 || {};

      let questionsUrl = null;
      if (p2.clientToken && !p2.answeredAt) {
        questionsUrl = `https://www.humvance.com/questions?ref=${encodeURIComponent(payload.ref)}&t=${encodeURIComponent(p2.clientToken)}`;
      }

      return res.status(200).json({
        ref: payload.ref,
        companyName: client.companyName || '—',
        contactName: client.contactName || '—',
        sector: client.sector || '—',
        city: client.city || '—',
        submittedAt: client.createdAt,
        updatedAt: client.updatedAt,
        stageStep: info.step,
        stageLabel: info.label,
        stageMessage: info.msg,
        nextAction: info.action,
        questionsUrl,
        questionsAnswered: !!p2.answeredAt,
        questionsCount: (p2.questions || []).length,
        timeline: buildTimeline(client)
      });
    } catch (err) {
      console.error('[portal data]', err.message);
      return res.status(500).json({ error: 'حدث خطأ في الخادم' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
