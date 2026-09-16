'use strict';
const { setJSON, requireAdmin } = require('./_utils');
const { kv } = require('@vercel/kv');

// ── Approved 14 Domain Framework ──
const DOMAINS = {
  strategy_alignment:      'Strategy Alignment',
  org_structure:           'Organization Structure',
  roles_accountability:    'Roles & Accountability',
  decision_rights:         'Decision Rights',
  processes_collaboration: 'Processes & Collaboration',
  workforce_capacity:      'Workforce & Capacity',
  skills_capabilities:     'Skills & Capabilities',
  leadership_management:   'Leadership & Management',
  performance_rewards:     'Performance & Rewards',
  culture_engagement:      'Culture & Engagement',
  hr_operating_model:      'HR Operating Model',
  governance_compliance:   'Governance & Compliance',
  people_data_analytics:   'People Data & Analytics',
  ai_future_workforce:     'AI & Future Workforce Readiness'
};

// ── Playbook Hypothesis Catalogue ──
const PLAYBOOKS = {
  decision_dependency: {
    name: 'Decision Dependency (CEO Bottleneck)',
    primaryDomains: ['decision_rights', 'roles_accountability', 'leadership_management'],
    hypotheses: [
      { id: 'DD-H1', text: 'المؤسس/CEO هو نقطة القرار الوحيدة وهذا يعطّل سرعة العمليات' },
      { id: 'DD-H2', text: 'غياب تفويض الصلاحيات الرسمي والموثق' },
      { id: 'DD-H3', text: 'لا توجد سياسات وإجراءات تتيح للموظفين العمل باستقلالية' },
      { id: 'DD-H4', text: 'القيادة الوسطى لا تمتلك صلاحيات كافية لاتخاذ قرارات' },
      { id: 'DD-H5', text: 'عدم وضوح الأدوار والمسؤوليات يجعل كل شيء يُرفع للأعلى' },
      { id: 'DD-H6', text: 'التوسع السريع في العمليات أفقد الشركة قدرة التنسيق' },
      { id: 'DD-H7', text: 'غياب نظام تتبع وقياس يُضطر المؤسس لمتابعة كل التفاصيل' }
    ]
  },
  poor_performance: {
    name: 'Poor Performance & Accountability',
    primaryDomains: ['performance_rewards', 'roles_accountability', 'skills_capabilities'],
    hypotheses: [
      { id: 'PP-H1', text: 'الموظفون لا يمتلكون أهدافاً واضحة وقابلة للقياس' },
      { id: 'PP-H2', text: 'لا يوجد نظام تقييم أداء فعّال أو منتظم' },
      { id: 'PP-H3', text: 'هناك فجوة واضحة في المهارات والكفاءات المطلوبة' },
      { id: 'PP-H4', text: 'منظومة الحوافز والتعويضات لا تحفز على الأداء' },
      { id: 'PP-H5', text: 'بعض الموظفين في أدوار لا تناسب كفاءاتهم الفعلية' },
      { id: 'PP-H6', text: 'المديرون المباشرون لا يمارسون دور الإشراف والتوجيه' },
      { id: 'PP-H7', text: 'ثقافة تتجنب المحاسبة والتغذية الراجعة' },
      { id: 'PP-H8', text: 'غياب برامج تطوير مهني مستمر للموظفين' },
      { id: 'PP-H9', text: 'ضغط العمل الزائد يؤثر سلباً على جودة الأداء' },
      { id: 'PP-H10', text: 'عوامل تنظيمية وبيئية تعيق الأداء الفردي' }
    ]
  },
  growth_structure: {
    name: 'Rapid Growth & Structure Complexity',
    primaryDomains: ['org_structure', 'workforce_capacity', 'processes_collaboration'],
    hypotheses: [
      { id: 'GS-H1', text: 'الهيكل التنظيمي الحالي لم يُصمم للحجم الذي وصلت إليه الشركة' },
      { id: 'GS-H2', text: 'التوظيف السريع أوجد فجوات في الكفاءات والتوافق الوظيفي' },
      { id: 'GS-H3', text: 'عمليات الاستقطاب والتأهيل لا تستوعب وتيرة التوسع' },
      { id: 'GS-H4', text: 'متطلبات السعودة تتصاعد وتعقيداتها تتزايد مع التوسع' },
      { id: 'GS-H5', text: 'الأنظمة والبنية التحتية للموارد البشرية لا تستوعب الحجم الجديد' },
      { id: 'GS-H6', text: 'الثقافة التنظيمية تتبعثر مع النمو الجغرافي أو العددي السريع' },
      { id: 'GS-H7', text: 'تعارض الأولويات وضعف التنسيق بين الأقسام يتصاعد' },
      { id: 'GS-H8', text: 'نموذج تفويض القرارات الحالي لا يناسب حجم المنظمة الجديد' },
      { id: 'GS-H9', text: 'ضغط الامتثال التنظيمي يتصاعد مع كل توسع جغرافي' },
      { id: 'GS-H10', text: 'الشركة لا تمتلك كوادر قيادية كافية لإدارة مرحلة النمو' }
    ]
  }
};

// ── Deterministic Confidence Engine ──
// The LLM NEVER sets confidence. It classifies evidence (strength, supports, contradicts).
// This function calculates the score from evidence relationships.
function calculateConfidence(hypId, evidence) {
  const evFor = evidence.filter(e => (e.supports || []).includes(hypId));
  const evAgainst = evidence.filter(e => (e.contradicts || []).includes(hypId));
  const sourcesFor = new Set(evFor.map(e => e.sourceType));

  let score = 20;
  const factors = [{ type: 'base', delta: 20, description: 'Base score — no data yet' }];
  const caps = [];

  // Supporting evidence (+10 weak, +20 moderate, +30 strong)
  for (const ev of evFor) {
    const delta = ev.strength === 'strong' ? 30 : ev.strength === 'moderate' ? 20 : 10;
    score += delta;
    factors.push({ type: `supporting_${ev.strength}`, evidenceId: ev.id, delta, description: ev.description });
  }

  // Independent corroborating sources bonus (+10 per additional source, max 3)
  if (sourcesFor.size >= 2) {
    const delta = 10 * Math.min(sourcesFor.size - 1, 3);
    score += delta;
    factors.push({ type: 'independent_sources', count: sourcesFor.size, delta, description: `${sourcesFor.size} independent source types corroborate` });
  }

  // Contradicting evidence (-10 weak, -15 moderate, -25 strong)
  for (const ev of evAgainst) {
    const delta = ev.strength === 'strong' ? -25 : ev.strength === 'moderate' ? -15 : -10;
    score += delta;
    factors.push({ type: `contradicting_${ev.strength}`, evidenceId: ev.id, delta, description: ev.description });
  }

  // Caps — applied after summing, floor at 0 before cap check
  score = Math.max(0, score);

  if (evFor.length === 0) {
    score = Math.min(score, 49);
    caps.push('no_supporting_evidence_cap_at_49');
  } else if (sourcesFor.size === 1) {
    score = Math.min(score, 69);
    caps.push('single_source_only_cap_at_69');
  }

  if (evAgainst.length > 0) {
    score = Math.min(score, 69);
    caps.push('contradiction_present_cap_at_69');
  }

  score = Math.min(score, 100);

  const level = score >= 85 ? 'confirmed' : score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low';
  return { score, level, factors, caps, evForCount: evFor.length, evAgainstCount: evAgainst.length };
}

function recalculateAllConfidences(hypotheses, evidence) {
  return hypotheses.map(h => {
    const calc = calculateConfidence(h.id, evidence);
    return {
      ...h,
      confidence: calc.score,
      confidenceLevel: calc.level,
      confidenceFactors: calc.factors,
      evidenceFor: evidence.filter(e => (e.supports || []).includes(h.id)).map(e => e.id),
      evidenceAgainst: evidence.filter(e => (e.contradicts || []).includes(h.id)).map(e => e.id)
    };
  });
}

// ── JSON extraction: returns a parsed object, or null when the response is unusable ──
function parseAIJSON(raw) {
  if (!raw || !raw.trim()) return null;
  const attempts = [
    () => JSON.parse(raw),
    () => { const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/); return m ? JSON.parse(m[1].trim()) : null; },
    () => { const m = raw.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
  ];
  for (const attempt of attempts) {
    try { const v = attempt(); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* next */ }
  }
  return null;
}

// ── Diagnostic Router output contract ──
// Checked BEFORE anything is written to KV. Evidence is intentionally NOT required:
// a client's data may genuinely contain no extractable evidence yet.
function validateRouterOutput(output) {
  const problems = [];
  const arr = v => (Array.isArray(v) ? v : []);

  if (!arr(output.primaryDomains).length)      problems.push('primaryDomains فارغ');
  if (!arr(output.activePlaybooks).length)     problems.push('activePlaybooks فارغ');
  if (!arr(output.symptoms).length)            problems.push('symptoms فارغ');
  if (!arr(output.selectedHypotheses).length)  problems.push('selectedHypotheses فارغ');
  if (!arr(output.questions).length)           problems.push('questions فارغ');
  if (!String(output.summary || '').trim())    problems.push('summary فارغ');

  // Cross-check against the approved catalogue (unchanged 14 domains / 3 playbooks)
  const domainKeys = Object.keys(DOMAINS);
  const playbookKeys = Object.keys(PLAYBOOKS);
  const knownHypIds = new Set(Object.values(PLAYBOOKS).flatMap(p => p.hypotheses.map(h => h.id)));

  const badDomains = [...arr(output.primaryDomains), ...arr(output.secondaryDomains)]
    .filter(d => !domainKeys.includes(d));
  if (badDomains.length) problems.push('نطاقات خارج الإطار المعتمد: ' + badDomains.join(', '));

  const badPlaybooks = arr(output.activePlaybooks).filter(p => !playbookKeys.includes(p));
  if (badPlaybooks.length) problems.push('playbooks خارج الإطار المعتمد: ' + badPlaybooks.join(', '));

  const badHyps = arr(output.selectedHypotheses).map(h => h && h.id).filter(id => id && !knownHypIds.has(id));
  if (badHyps.length) problems.push('فرضيات خارج الكتالوج المعتمد: ' + badHyps.join(', '));

  return problems;
}

function evId() {
  return 'EV-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// ── Client summary helper for prompts ──
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
مشاكل العميل الذاتية: ${(c.mainProblems||[]).join(' | ')||'—'}
ملاحظات: ${c.additionalNotes||'لا يوجد'}`;
}

// ── P1 — Initial AI Review ──
function buildP1Prompt(client) {
  return `أنت Humvance Agent — مستشار استشاري داخلي متخصص في الموارد البشرية والتطوير التنظيمي للشركات السعودية.

وصل هذا العميل عبر نموذج التقييم. مهمتك: مراجعة أولية دقيقة وصادقة. لا توصيات نهائية — فقط ما نفهمه وما لا نعرفه.

${clientSummary(client)}

أجب بـJSON فقط:
{"understood":"ما فهمناه عن الشركة بشكل محدد (3-4 جمل)","apparent_needs":"الاحتياج الظاهر (2-3 جمل تحليلية)","unknown":["معلومة ناقصة 1","..."],"concerns":["إشكالية محتملة 1","..."],"next_step":"الخطوة التالية الموصى بها — جملة واحدة"}`;
}

// ── Diagnostic Router — AI classifies evidence, server calculates confidence ──
function buildDiagnosticRouterPrompt(client, phases) {
  const p1 = phases.p1?.agentOutput || {};
  const p2 = phases.p2 || {};
  const p3 = phases.p3?.agentOutput || {};
  const answersText = (p2.clientAnswers || []).map((a, i) => {
    const q = (p2.questions || [])[i] || {};
    return `س(${q.area||''}): ${q.question||''}\nج: ${a.answer||'—'}`;
  }).join('\n\n');

  const allHyps = Object.values(PLAYBOOKS).flatMap(p =>
    p.hypotheses.map(h => `  ${h.id}: ${h.text}`)
  ).join('\n');
  const domainList = Object.entries(DOMAINS).map(([k, v]) => `  ${k}: ${v}`).join('\n');

  return `أنت Humvance Diagnostic Router.
مهمتك: اختيار الفرضيات المناسبة واستخراج الأدلة الموجودة من بيانات العميل.
تحذير: لا تُعطِ أي رقم confidence — النظام يحسبه تلقائياً من الأدلة.

─── بيانات العميل ───
${clientSummary(client)}

─── P1 ───
ما فهمناه: ${p1.understood||'لم تُنجز P1 بعد'}
الاحتياج الظاهر: ${p1.apparent_needs||'—'}
المخاوف: ${(p1.concerns||[]).join(' | ')||'—'}
ما لا نعرفه: ${(p1.unknown||[]).join(' | ')||'—'}
${answersText ? `\n─── إجابات العميل (P2) ───\n${answersText}` : ''}
${p3.now_know ? `\n─── P3 ───\nما نعرفه: ${p3.now_know}\nالمشاكل: ${(p3.main_problems||[]).join(' | ')}` : ''}

─── الفرضيات المتاحة ───
${allHyps}

─── النطاقات الـ 14 ───
${domainList}

─── JSON فقط ─── لا تضف confidence ───
{"primaryDomains":["1-3 مفاتيح domain أساسية"],"secondaryDomains":["1-4 مفاتيح domain ثانوية"],"symptoms":["3-6 أعراض محددة من البيانات"],"activePlaybooks":["decision_dependency | poor_performance | growth_structure"],"selectedHypotheses":[{"id":"DD-H1","playbook":"decision_dependency","rationale":"لماذا هذه الفرضية ذات صلة بهذا العميل تحديداً"}],"evidence":[{"sourceType":"survey_field | p1_analysis | p2_answer | p3_analysis","source":"اسم الحقل أو المصدر","description":"وصف الدليل","strength":"weak | moderate | strong","supports":["DD-H1"],"contradicts":[]}],"questions":[{"domain":"decision_rights","question":"سؤال تشخيصي مخصص","why":"الفجوة التي يسدها","targetHypotheses":["DD-H1"]}],"summary":"ملخص تشخيصي 3-4 جمل"}

قواعد المخرجات — التزم بها حرفياً:
1. أعد JSON فقط. بدون Markdown، بدون code fences، بدون أي نص قبل JSON أو بعده.
2. اختصر كل قيمة نصية إلى جملة واحدة قصيرة. لا شرح مطوّل.
3. لا تُعِد سرد بيانات العميل أو محتوى P1 — اذكر الاستنتاج الجديد فقط.
4. لا تكرر نفس الفكرة في symptoms و rationale و summary. كل حقل يضيف معلومة مختلفة.
5. primaryDomains: 1-3 | secondaryDomains: 1-4 | symptoms: 3-6 | questions: 4-6.
6. selectedHypotheses: فقط الفرضيات التي تدعمها بيانات موجودة فعلاً، و rationale سطر واحد.
7. evidence: description سطر واحد. لا تخترع أدلة لملء الحقل — اترك المصفوفة فارغة إن لم توجد أدلة حقيقية.
8. summary: 3-4 جمل كحد أقصى.
9. strength: weak=إشارة، moderate=دليل معقول، strong=دليل واضح.
10. لا confidence إطلاقاً — النظام يحسبه من الأدلة.`;
}

// ── Diagnostic Update — AI adds evidence, server recalculates all confidence ──
function buildDiagnosticUpdatePrompt(client, existingDiag, newAnswers) {
  const allItems = (existingDiag.questions || []).flatMap(r => r.items || []);
  const answersText = (newAnswers || []).map(a => {
    const q = allItems.find(q => q.id === a.id) || {};
    return `س(${q.domain||''}): ${q.question||''}\nج: ${a.answer||'—'}`;
  }).join('\n\n');
  const hypText = (existingDiag.hypotheses || []).map(h =>
    `[${h.id}] confidence:${h.confidence||'—'}% (${h.confidenceLevel||'—'}) — ${h.hypothesis}`
  ).join('\n');
  const recentEv = (existingDiag.evidence || []).slice(-8).map(e =>
    `[${e.id}] ${e.sourceType}/${e.strength}: ${e.description} → supports:${(e.supports||[]).join(',')||'—'} contradicts:${(e.contradicts||[]).join(',')||'—'}`
  ).join('\n');

  return `أنت Humvance Diagnostic Engine.
مهمتك: استخراج أدلة جديدة من الإجابات الواردة واقتراح نتائج إذا تراكمت أدلة كافية.
تحذير: لا تُعطِ confidence — النظام يحسبه من الأدلة.

─── إجابات جديدة ───
${answersText||'لا توجد إجابات'}

─── الفرضيات الحالية ───
${hypText||'—'}

─── آخر 8 أدلة مسجلة ───
${recentEv||'—'}

─── ملخص حالي ───
${existingDiag.summary||'—'}

─── JSON فقط ─── لا تضف confidence ───
{"newEvidence":[{"sourceType":"diagnostic_answer | consultant_note | meeting_note","source":"وصف المصدر","description":"الدليل المستخرج","strength":"weak | moderate | strong","supports":["DD-H1"],"contradicts":[]}],"newConflicts":[{"description":"تناقض مكتشف","relatedHypotheses":["DD-H1"],"relatedEvidence":[]}],"proposedFindings":[{"title":"عنوان النتيجة","description":"وصف يجمع الأدلة والتحليل","severity":"critical | major | minor","domain":"domain_key","fromHypotheses":["DD-H1"],"rationale":"لماذا أصبحت نتيجة الآن"}],"newQuestions":[{"domain":"domain_key","question":"سؤال جديد","why":"الفجوة","targetHypotheses":["DD-H1"]}],"updatedSummary":"ملخص محدث"}

قواعد: اقترح finding فقط إذا تراكمت أدلة قوية بدون تناقضات كبيرة. AI لا توافق — المستشار يعتمد.`;
}

// ── P2 — Diagnostic-Driven Client Questions ──
function buildP2Prompt(client, p1, diag) {
  const diagCtx = diag
    ? [
        `النطاقات الأساسية: ${(diag.primaryDomains||[]).join(', ')||'—'}`,
        `الـ Playbooks النشطة: ${(diag.activePlaybooks||[]).join(', ')||'—'}`,
        `الفرضيات النشطة (${(diag.hypotheses||[]).length}):`,
        ...(diag.hypotheses||[]).slice(0, 10).map(h =>
          `  [${h.id}] confidence:${h.confidence||'—'}% — ${h.hypothesis} [أدلة مؤيدة: ${(h.evidenceFor||[]).length}]`
        ),
        `أعراض مرصودة: ${(diag.symptoms||[]).slice(0, 4).join(' | ')||'—'}`
      ].join('\n')
    : 'لم يُهيَّأ التشخيص بعد — استخدم بيانات الاستبيان و P1 فقط';

  return `أنت Humvance Agent — تبني أسئلة أولية مخصصة.

مهمتك: أسئلة تسد فجوات أدلة الفرضيات النشطة. لا تكرر ما هو معروف. رتّب من الأكثر تأثيراً على التشخيص.

─── بيانات العميل ───
${clientSummary(client)}

─── P1 ───
ما فهمناه: ${p1?.understood||'—'}
الاحتياج الظاهر: ${p1?.apparent_needs||'—'}
ما لا نعرفه: ${(p1?.unknown||[]).join(' | ')||'—'}
مخاوف: ${(p1?.concerns||[]).join(' | ')||'—'}

─── حالة التشخيص ───
${diagCtx}

أجب بـJSON فقط:
{"questions":[{"id":"q1","area":"المجال","question":"نص السؤال للعميل","why":"الفرضية المستهدفة والسبب — للمستشار فقط","targetHypotheses":["DD-H1"],"followup":"سؤال متابعة مقترح"}]}

قواعد: 8-12 سؤالاً. كل سؤال يستهدف فرضية نشطة. أسلوب محادثة طبيعي.`;
}

// ── P3 — Diagnostic-Integrated Meeting Preparation ──
function buildP3Prompt(client, phases, diag) {
  const p1 = phases.p1?.agentOutput || {};
  const p2 = phases.p2 || {};
  const answers = p2.clientAnswers || [];
  const questions = p2.questions || [];
  const qaText = questions.map((q, i) => {
    const ans = answers.find(a => a.id === q.id) || answers[i] || {};
    return `س(${q.area}): ${q.question}\nج: ${ans.answer || '—'}`;
  }).join('\n\n');

  const diagCtx = diag
    ? [
        `الفرضيات (${(diag.hypotheses||[]).length}):`,
        ...(diag.hypotheses||[]).map(h => {
          const ef = (diag.evidence||[]).filter(e => (e.supports||[]).includes(h.id));
          const ea = (diag.evidence||[]).filter(e => (e.contradicts||[]).includes(h.id));
          return `  [${h.id}] ${h.confidence||'—'}% (${h.confidenceLevel||'—'}) — ${h.hypothesis}\n    أدلة مؤيدة: ${ef.length} | معارضة: ${ea.length}`;
        }),
        `تناقضات: ${(diag.conflicts||[]).map(c=>c.description).join(' | ')||'لا توجد'}`,
        `نتائج مقترحة: ${(diag.findings||[]).filter(f=>f.status==='proposed').map(f=>f.title).join(' | ')||'لا توجد بعد'}`
      ].join('\n')
    : 'التشخيص غير متاح';

  return `أنت Humvance Agent — تُعد المستشار لاجتماع الاستكشاف مع العميل.

${clientSummary(client)}

─── P1 ───
ما فهمناه: ${p1.understood||'—'}

─── إجابات العميل ───
${qaText||'لا توجد إجابات'}

─── حالة التشخيص ───
${diagCtx}

أجب بـJSON فقط:
{"now_know":"ما أصبحنا نعرفه (3-4 جمل)","main_problems":["مشكلة 1","..."],"root_causes":["سبب 1","..."],"hypotheses_to_challenge":[{"id":"DD-H1","challenge":"كيف نختبر هذه الفرضية في الاجتماع","question":"السؤال المحدد لطرحه على العميل"}],"evidence_to_request":["وثيقة أو بيانات نطلبها 1","..."],"contradictions_to_discuss":["تناقض يحتاج توضيحاً 1","..."],"missing":["معلومة حرجة ناقصة 1","..."],"meeting_objectives":["هدف الاجتماع 1","..."]}`;
}

// ── Quick Analyze (called from index.html public form) ──
function buildQuickAnalyzePrompt(c) {
  return `أنت خبير موارد بشرية وتطوير تنظيمي متخصص في الشركات السعودية.
بناءً على بيانات الاستبيان أدناه، قدم:
1. ملخص تنفيذي (3-4 جمل)
2. نقاط القوة (3 نقاط)
3. الفجوات الجوهرية (3-4 نقاط)
4. المخاطر العاجلة
5. خطة إجراءات 90 يوم (5-6 إجراءات)

الشركة: ${c.companyName||'—'} | القطاع: ${c.sector||'—'} | المدينة: ${c.city||'—'}
الموظفون: ${c.numFulltime||0} | السعودة: ${c.saudiPercent||'؟'}%
إدارة موارد بشرية: ${c.hasHRDept||'—'} | لائحة عمل: ${c.hasPoliciesManual||'—'} | تقييم أداء: ${c.hasPerformanceReview||'—'}
سلم رواتب: ${c.hasSalaryScale||'—'} | GOSI: ${c.gosiCompliant||'—'} | WPS: ${c.wpsCompliance||'—'}
الخدمة المطلوبة: ${c.serviceInterest||'—'} | درجة النضج: ${c.score||0}/100
المشاكل: ${(c.mainProblems||[]).join('، ')}
ملاحظات: ${c.additionalNotes||'—'}

اكتب بالعربية بأسلوب مهني ومختصر. كن محدداً لهذه الشركة.`;
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

  async function callAI(prompt, maxTokens = 4000, label = 'agent') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'Anthropic API error');

    const raw = d.content?.[0]?.text || '';
    // Safe response metadata only — never any key, credential or client content.
    const meta = {
      stop_reason: d.stop_reason || 'unknown',
      output_tokens: d.usage?.output_tokens ?? null,
      max_tokens: maxTokens,
      text_length: raw.length
    };

    const parsed = parseAIJSON(raw);
    if (parsed) return parsed;

    // NEVER return { raw } as a success fallback — an unparseable response is a failure.
    console.error(`[${label}] JSON parse failed`, meta);
    const reason = meta.stop_reason === 'max_tokens'
      ? 'انقطع رد الذكاء الاصطناعي بسبب تجاوز الحد الأقصى للطول قبل اكتمال JSON'
      : 'تعذّر تحليل رد الذكاء الاصطناعي كـJSON صالح';
    throw new Error(`${reason} (stop_reason=${meta.stop_reason}, output_tokens=${meta.output_tokens}, max_tokens=${meta.max_tokens}, length=${meta.text_length})`);
  }

  // ── quick_analyze ──
  if (phase === 'quick_analyze') {
    const clientData = req.body.client || (ref ? await kv.get(`client:${ref}`) : null);
    if (!clientData) return res.status(400).json({ error: 'client أو ref مطلوب' });
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: buildQuickAnalyzePrompt(clientData) }] })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'AI error');
      return res.status(200).json({ analysis: d.content?.[0]?.text || '' });
    } catch (err) {
      console.error('[quick_analyze]', err.message);
      return res.status(500).json({ error: 'فشل التحليل: ' + err.message });
    }
  }

  // ── diagnostic_router ──
  if (phase === 'diagnostic_router') {
    if (!ref) return res.status(400).json({ error: 'ref مطلوب' });
    try {
      const client = await kv.get(`client:${ref}`);
      if (!client) return res.status(404).json({ error: 'العميل غير موجود' });
      // Router-specific ceiling. Its JSON (domains, hypotheses, evidence, 4-6 questions,
      // summary — all Arabic) sits right at the 4000 default and intermittently truncated
      // (confirmed: stop_reason=max_tokens, output_tokens=4000). Headroom only — the prompt
      // rules below keep the output compact. Other phases keep the 4000 default.
      const output = await callAI(buildDiagnosticRouterPrompt(client, client.phases || {}), 6000, 'diagnostic_router');

      // Validate BEFORE persisting — a failed router must never overwrite existing
      // diagnostic state, and must never write an empty diagnostic.
      const problems = validateRouterOutput(output);
      if (problems.length) {
        console.error('[diagnostic_router] output failed validation:', problems);
        return res.status(422).json({
          error: 'مخرجات Diagnostic Router غير صالحة — لم يُحفظ أي تشخيص. أعد المحاولة. التفاصيل: ' + problems.join(' | ')
        });
      }

      const now = Date.now();

      // Stamp evidence IDs
      const evidence = (output.evidence || []).map(e => ({ ...e, id: evId(), createdAt: now }));

      // Build hypothesis objects from PLAYBOOKS catalogue
      const hypIndex = Object.values(PLAYBOOKS).reduce((acc, p) => {
        const pk = Object.keys(PLAYBOOKS).find(k => PLAYBOOKS[k] === p);
        p.hypotheses.forEach(h => { acc[h.id] = { ...h, playbook: pk }; });
        return acc;
      }, {});
      const hypotheses = (output.selectedHypotheses || []).map(sel => {
        const base = hypIndex[sel.id] || { id: sel.id, text: sel.id, playbook: sel.playbook };
        return {
          id: base.id, playbook: sel.playbook || base.playbook,
          hypothesis: base.text, rationale: sel.rationale || '',
          evidenceFor: [], evidenceAgainst: [], conflicts: [],
          status: 'proposed', priority: 2,
          consultantNote: null, approvedAt: null
        };
      });

      // Server calculates confidence deterministically
      const hypothesesWithConf = recalculateAllConfidences(hypotheses, evidence);

      // Build question items with IDs
      const questions = (output.questions || []).map((q, i) => ({
        ...q, id: `dq_${now}_${i}`, answer: null, answeredAt: null
      }));

      const diag = {
        version: '2.0', createdAt: now, updatedAt: now, status: 'active',
        primaryDomains: output.primaryDomains || [],
        secondaryDomains: output.secondaryDomains || [],
        symptoms: output.symptoms || [],
        activePlaybooks: output.activePlaybooks || [],
        hypotheses: hypothesesWithConf,
        questions: [{ round: 1, generatedAt: now, items: questions }],
        evidence, conflicts: [], findings: [],
        summary: output.summary || ''
      };
      await kv.set(`client:${ref}.diagnostic`, diag);
      return res.status(200).json({ success: true, output: diag });
    } catch (err) {
      console.error('[diagnostic_router]', err.message);
      return res.status(500).json({ error: 'Diagnostic Router error: ' + err.message });
    }
  }

  // ── diagnostic_update ──
  if (phase === 'diagnostic_update') {
    if (!ref) return res.status(400).json({ error: 'ref مطلوب' });
    try {
      const client = await kv.get(`client:${ref}`);
      if (!client) return res.status(404).json({ error: 'العميل غير موجود' });
      const existingDiag = (await kv.get(`client:${ref}.diagnostic`)) || {};
      const output = await callAI(buildDiagnosticUpdatePrompt(client, existingDiag, req.body.answers || []), 4000, 'diagnostic_update');
      const now = Date.now();

      // Stamp new evidence IDs
      const newEvidence = (output.newEvidence || []).map(e => ({ ...e, id: evId(), createdAt: now }));
      const allEvidence = [...(existingDiag.evidence || []), ...newEvidence];

      // Recalculate ALL confidences deterministically from full evidence set
      const hypotheses = recalculateAllConfidences(existingDiag.hypotheses || [], allEvidence);

      // Append questions round
      const questions = [...(existingDiag.questions || [])];
      if (output.newQuestions?.length) {
        const items = output.newQuestions.map((q, i) => ({ ...q, id: `dq_${now}_${i}`, answer: null, answeredAt: null }));
        questions.push({ round: questions.length + 1, generatedAt: now, items });
      }

      // Stamp and append conflicts
      const conflicts = [
        ...(existingDiag.conflicts || []),
        ...(output.newConflicts || []).map(c => ({ ...c, id: `CON-${now}-${Math.random().toString(36).slice(2,5).toUpperCase()}`, resolved: false, createdAt: now }))
      ];

      // AI proposes findings; consultant must approve (aiProposed=true, consultantApproved=false)
      const findings = [
        ...(existingDiag.findings || []),
        ...(output.proposedFindings || []).map(f => ({
          ...f,
          id: `FIND-${now}-${Math.random().toString(36).slice(2,5).toUpperCase()}`,
          status: 'proposed', aiProposed: true, consultantApproved: false,
          consultantNote: null, createdAt: now
        }))
      ];

      const updatedDiag = {
        ...existingDiag, updatedAt: now, hypotheses, questions,
        evidence: allEvidence, conflicts, findings,
        summary: output.updatedSummary || existingDiag.summary
      };
      await kv.set(`client:${ref}.diagnostic`, updatedDiag);
      return res.status(200).json({ success: true, output: updatedDiag });
    } catch (err) {
      console.error('[diagnostic_update]', err.message);
      return res.status(500).json({ error: 'Diagnostic Update error: ' + err.message });
    }
  }

  // ── P1 / P2 / P3 ──
  if (!ref) return res.status(400).json({ error: 'ref مطلوب' });

  try {
    const client = await kv.get(`client:${ref}`);
    if (!client) return res.status(404).json({ error: 'العميل غير موجود' });
    const existingPhases = client.phases || {};
    let prompt;

    if (phase === 'p1') {
      prompt = buildP1Prompt(client);
    } else if (phase === 'p2') {
      const diag = await kv.get(`client:${ref}.diagnostic`);
      prompt = buildP2Prompt(client, existingPhases.p1?.agentOutput, diag);
    } else if (phase === 'p3') {
      const diag = await kv.get(`client:${ref}.diagnostic`);
      prompt = buildP3Prompt(client, existingPhases, diag);
    } else {
      return res.status(400).json({ error: 'مرحلة غير معروفة: ' + phase });
    }

    const output = await callAI(prompt, 4000, phase);
    const updatedPhases = {
      ...existingPhases,
      [phase]: { ...(existingPhases[phase] || {}), agentOutput: output, generatedAt: Date.now() }
    };
    await kv.set(`client:${ref}`, { ...client, phases: updatedPhases, updatedAt: Date.now() });
    return res.status(200).json({ success: true, output });
  } catch (err) {
    console.error('[agent]', err.message);
    return res.status(500).json({ error: 'Agent error: ' + err.message });
  }
};
