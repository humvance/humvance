'use strict';
const { setJSON, requireAdmin } = require('./_utils');
const { kv } = require('@vercel/kv');

function buildQuickAnalyzePrompt(c) {
  return `أنت خبير موارد بشرية وتطوير تنظيمي متخصص في الشركات السعودية.
بناءً على بيانات الاستبيان أدناه، قدم:
1. ملخص تنفيذي (3-4 جمل)
2. نقاط القوة (3 نقاط)
3. الفجوات الجوهرية (3-4 نقاط)
4. المخاطر العاجلة (مخاطر نظامية أو تشغيلية)
5. خطة إجراءات 90 يوم (5-6 إجراءات أساسية)

بيانات الشركة:
- الشركة: ${c.companyName||'—'} | القطاع: ${c.sector||'—'} | المدينة: ${c.city||'—'}
- الموظفون: ${c.numFulltime||0} موظف | السعودة: ${c.saudiPercent||'؟'}%
- إدارة الموارد البشرية: ${c.hasHRDept||'—'}
- لائحة العمل: ${c.hasPoliciesManual||'—'}
- تقييم الأداء: ${c.hasPerformanceReview||'—'}
- سلم الرواتب: ${c.hasSalaryScale||'—'}
- GOSI: ${c.gosiCompliant||'—'}
- WPS: ${c.wpsCompliance||'—'}
- نطاقات: ${c.nitaqatTier||'؟'}
- الخدمة المطلوبة: ${c.serviceInterest||'—'}
- درجة النضج: ${c.score||0}/100
- المشاكل الرئيسية: ${(c.mainProblems||[]).join('، ')}
- ملاحظات العميل: ${c.additionalNotes||'—'}

اكتب بالعربية بأسلوب مهني ومختصر. لا تكن روتينياً — كن محدداً بناءً على هذه الشركة.`;
}

function clientSummary(c) {
  const f = v => v === 'yes' ? 'نعم' : v === 'partial' ? 'جزئي' : v === 'no' ? 'لا' : v || '—';
  return `الشركة: ${c.companyName||'—'} | القطاع: ${c.sector||'—'} | المدينة: ${c.city||'—'}
المسؤول: ${c.contactName||'—'} ${c.contactTitle?'('+c.contactTitle+')':''}
الموظفون: ${c.numFulltime||'—'} | السعودة: ${c.saudiPercent||'—'}% | الفروع: ${c.numBranches||'—'}
إدارة الموارد البشرية: ${f(c.hasHRDept)} | لائحة العمل: ${f(c.hasPoliciesManual)} | هيكل تنظيمي: ${f(c.hasOrgChart)}
وزارة الموارد: ${f(c.laborRegistered)} | GOSI: ${f(c.gosiCompliant)} | WPS: ${f(c.wpsCompliance)}
سلم رواتب: ${f(c.hasSalaryScale)} | تقييم الأداء: ${f(c.hasPerformanceReview)} | خطة تدريبية: ${f(c.hasTrainingPlan)}
الخدمة المطلوبة: ${c.serviceInterest||'—'} | الميزانية: ${c.budgetRange||'—'}
درجة النضج الأولية: ${c.score||0}/100
ملاحظات العميل: ${c.additionalNotes||'لا يوجد'}`;
}

function buildP1Prompt(client) {
  return `أنت Humvance Agent — مستشار استشاري داخلي متخصص في الموارد البشرية والتطوير التنظيمي للشركات السعودية.

وصل هذا العميل عبر نموذج التقييم على الموقع. مهمتك الآن: مراجعة أولية دقيقة وصادقة. لا توصيات نهائية ولا تقارير — فقط ما نفهمه، وما لا نعرفه بعد.

${clientSummary(client)}

أجب بصيغة JSON فقط — لا تضف أي نص قبله أو بعده:
{
  "understood": "ما فهمناه عن الشركة وضعها الحالي بشكل محدد لهذا العميل (3-4 جمل)",
  "apparent_needs": "الاحتياج الظاهر بناءً على المعلومات المتاحة (2-3 جمل تحليلية)",
  "unknown": ["معلومة ناقصة تؤثر على فهمنا 1", "معلومة ناقصة 2", "..."],
  "concerns": ["شيء يحتاج فهم أعمق أو قد يكون إشكالية 1", "..."],
  "next_step": "الخطوة التالية الموصى بها بشكل محدد وعملي جملة واحدة"
}`;
}

function buildP2Prompt(client, p1) {
  return `أنت Humvance Agent.

بناءً على المعلومات الأولية ومخرجات المراجعة الأولية، ابنِ قائمة أسئلة أولية مخصصة تماماً لهذا العميل.

${clientSummary(client)}

مخرجات المراجعة الأولية:
ما فهمناه: ${p1?.understood||'—'}
الاحتياج الظاهر: ${p1?.apparent_needs||'—'}
ما لا نعرفه: ${(p1?.unknown||[]).join(' | ')||'—'}
مخاوف: ${(p1?.concerns||[]).join(' | ')||'—'}

قواعد صارمة:
- كل سؤال مبني على وضع هذه الشركة تحديداً — لا أسئلة عامة
- اسأل فقط عما نحتاجه لفهم المشكلة الحقيقية
- 8 إلى 12 سؤالاً مرتبة من الأهم إلى الأقل أهمية
- صغ الأسئلة بأسلوب محادثة طبيعي، ليست استبياناً رسمياً

أجب بصيغة JSON فقط:
{
  "questions": [
    {
      "id": "q1",
      "area": "المجال مثال الهيكل التنظيمي أو إدارة الموارد البشرية",
      "question": "نص السؤال للعميل",
      "why": "لماذا نسأل هذا — للمؤسس فقط لا يظهر للعميل",
      "followup": "سؤال متابعة مقترح"
    }
  ]
}`;
}

function buildP3Prompt(client, phases) {
  const p1 = phases.p1?.agentOutput || {};
  const p2 = phases.p2 || {};
  const answers = (p2.clientAnswers || []);
  const questions = p2.questions || [];
  const qaText = questions.map((q, i) => {
    const ans = answers.find(a => a.id === q.id) || answers[i] || {};
    return `السؤال (${q.area}): ${q.question}\nالإجابة: ${ans.answer || '—'}`;
  }).join('\n\n');

  return `أنت Humvance Agent.

حللت إجابات العميل على الأسئلة الأولية. مهمتك: تقييم عميق لما اكتشفناه حتى الآن.

${clientSummary(client)}

ما فهمناه من المراجعة الأولية: ${p1.understood||'—'}
الاحتياج الظاهر: ${p1.apparent_needs||'—'}

أسئلة وإجابات العميل:
${qaText||'لا توجد إجابات'}

أجب بصيغة JSON فقط:
{
  "now_know": "ما أصبحنا نعرفه الآن (3-4 جمل)",
  "main_problems": ["مشكلة رئيسية 1", "مشكلة رئيسية 2", "..."],
  "root_causes": ["سبب جذري محتمل 1", "..."],
  "missing": ["معلومة لا تزال ناقصة 1", "..."],
  "contradictions": ["تناقض أو شيء يستحق التوضيح 1"],
  "discussion_areas": ["موضوع يجب مناقشته في الاجتماع 1", "..."],
  "meeting_objectives": ["هدف الاجتماع 1", "هدف 2", "..."]
}`;
}

module.exports = async function handler(req, res) {
  setJSON(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY غير مضبوط في Vercel' });

  const { phase, ref } = req.body || {};
  if (!phase) return res.status(400).json({ error: 'phase مطلوب' });

  // quick_analyze: legacy single-pass analysis — returns { analysis } text
  if (phase === 'quick_analyze') {
    const clientData = req.body.client || (ref ? await kv.get(`client:${ref}`) : null);
    if (!clientData) return res.status(400).json({ error: 'client أو ref مطلوب' });
    try {
      const qaRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: buildQuickAnalyzePrompt(clientData) }] })
      });
      const qaData = await qaRes.json();
      if (!qaRes.ok) throw new Error(qaData.error?.message || 'AI error');
      return res.status(200).json({ analysis: qaData.content?.[0]?.text || '' });
    } catch (err) {
      console.error('[agent quick_analyze]', err.message);
      return res.status(500).json({ error: 'فشل التحليل: ' + err.message });
    }
  }

  if (!ref) return res.status(400).json({ error: 'ref مطلوب' });

  try {
    const client = await kv.get(`client:${ref}`);
    if (!client) return res.status(404).json({ error: 'العميل غير موجود' });

    const existingPhases = client.phases || {};
    let prompt;

    if (phase === 'p1') prompt = buildP1Prompt(client);
    else if (phase === 'p2') prompt = buildP2Prompt(client, existingPhases.p1?.agentOutput);
    else if (phase === 'p3') prompt = buildP3Prompt(client, existingPhases);
    else return res.status(400).json({ error: 'مرحلة غير معروفة: ' + phase });

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiData.error?.message || 'Anthropic API error');

    const raw = aiData.content?.[0]?.text || '{}';
    let output;
    try {
      output = JSON.parse(raw);
    } catch {
      try {
        const mdMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (mdMatch) {
          output = JSON.parse(mdMatch[1].trim());
        } else {
          const braceMatch = raw.match(/\{[\s\S]*\}/);
          output = JSON.parse(braceMatch ? braceMatch[0] : raw);
        }
      } catch {
        console.error('[agent] JSON parse failed, raw:', raw.slice(0, 300));
        output = { raw };
      }
    }

    const updatedPhases = {
      ...existingPhases,
      [phase]: {
        ...(existingPhases[phase] || {}),
        agentOutput: output,
        generatedAt: Date.now()
      }
    };

    await kv.set(`client:${ref}`, { ...client, phases: updatedPhases, updatedAt: Date.now() });

    return res.status(200).json({ success: true, output });
  } catch (err) {
    console.error('[agent]', err.message);
    return res.status(500).json({ error: 'Agent error: ' + err.message });
  }
};
