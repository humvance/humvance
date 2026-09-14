import Anthropic from '@anthropic-ai/sdk';
import { kv } from './_db.js';
import { verifyToken } from './_auth.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  if (!verifyToken(req)) return res.status(401).json({ error: 'Unauthorized' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { client: c } = body;
  if (!c) return res.status(400).json({ error: 'Missing client data' });

  const prompt = `أنت خبير موارد بشرية وتطوير تنظيمي متخصص في الشركات السعودية.
بناءً على بيانات الاستبيان أدناه، قدم:
1. ملخص تنفيذي (3-4 جمل)
2. نقاط القوة (3 نقاط)
3. الفجوات الجوهرية (3-4 نقاط)
4. المخاطر العاجلة (مخاطر نظامية أو تشغيلية)
5. خطة إجراءات 90 يوم (5-6 إجراءات أساسية)

بيانات الشركة:
- الشركة: ${c.companyName} | القطاع: ${c.sector} | المدينة: ${c.city}
- الموظفون: ${c.numFulltime || 0} موظف | السعودة: ${c.saudiPercent || '؟'}%
- إدارة الموارد البشرية: ${c.hasHRDept}
- لائحة العمل: ${c.hasPoliciesManual}
- تقييم الأداء: ${c.hasPerformanceReview}
- سلم الرواتب: ${c.hasSalaryScale}
- GOSI: ${c.gosiCompliant} | WPS: ${c.wpsCompliance}
- نطاقات: ${c.nitaqatTier || '؟'}
- الخدمة المطلوبة: ${c.serviceInterest}
- درجة النضج: ${c.score}/100
- المشاكل الرئيسية: ${(c.mainProblems || []).join('، ')}
- ملاحظات العميل: ${c.additionalNotes || '—'}

اكتب بالعربية بأسلوب مهني ومختصر. كن محدداً بناءً على هذه الشركة تحديداً.`;

  try {
    const message = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const analysis = message.content[0].text;

    // Save analysis to KV
    try {
      const raw = await kv.get(`submission:${c.ref}`);
      if (raw) {
        const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
        await kv.set(`submission:${c.ref}`, JSON.stringify({
          ...existing,
          aiAnalysis: analysis,
          analyzedAt: Date.now()
        }));
      }
    } catch (e) { /* non-critical */ }

    res.json({ analysis });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
