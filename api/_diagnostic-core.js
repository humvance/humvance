'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Humvance shared diagnostic core.
//
// Extracted verbatim from api/agent.js at commit 57526a2 (Checkpoint 0).
// The bodies below are byte-identical to the verified Phase 2 implementation —
// this module exists so Phase 3 can reuse the approved catalogue, the
// deterministic confidence engine and the JSON hardening WITHOUT editing the
// verified router.
//
// DO NOT change behaviour here. The 14 domains, the 3 playbooks and the
// confidence algorithm are approved architecture and are frozen.
// ─────────────────────────────────────────────────────────────────────────────

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

module.exports = {
  DOMAINS,
  PLAYBOOKS,
  calculateConfidence,
  recalculateAllConfidences,
  parseAIJSON
};
