'use strict';
// Humvance V2 — adversarial review (§23).
//
// Before a Finding can reach a human for approval it is attacked. The point is not
// to produce a score; it is to make the reviewer read the strongest case AGAINST
// the finding before they read the finding.
//
// These checks are deterministic on purpose. A model asked "are there problems
// with this?" tends to agree with whatever it just wrote; a table of rules does
// not. Where a judgement genuinely needs a model, the model DRAFTS and this layer
// still decides whether the draft clears the gate.
//
// What is stored: business-level conclusions. What is never stored: prompts, model
// reasoning, chain-of-thought.

const {
  assessEvidenceStrength, detectUnsupportedCausality, isSelfReport
} = require('./_domain');

const STALE_EVIDENCE_DAYS = 365;

function daysBetween(a, b) { return Math.abs(a - b) / 86400000; }

/**
 * @param {object} bundle
 *   finding            – the draft Finding
 *   evidence           – Evidence[] attached to the Case
 *   hypotheses         – Hypothesis[] on the Case
 *   contradictions     – Contradiction[] on the Case
 *   now                – epoch ms
 * @returns ChallengeReview payload (no ids yet — the repo mints those)
 */
function runChallenge({ finding, evidence = [], hypotheses = [], contradictions = [], now = Date.now() }) {
  const checks = [];
  const add = (id, severity, passed, conclusion) => checks.push({ id, severity, passed, conclusion });

  const supportingIds = new Set(finding?.supporting_evidence || []);
  const counterIds = new Set(finding?.counter_evidence || []);
  const supporting = evidence.filter(e => supportingIds.has(e.evidence_id));
  const counter = evidence.filter(e => counterIds.has(e.evidence_id));
  const openContradictions = contradictions.filter(c => c.state === 'OPEN' || c.state === 'INVESTIGATING');

  // 1 — alternative explanations
  const activeAlternatives = hypotheses.filter(h => ['ACTIVE', 'STRENGTHENED', 'UNRESOLVED'].includes(h.state));
  const testedAlternatives = hypotheses.filter(h => h.state === 'NOT_SUPPORTED' || h.state === 'WEAKENED');
  add('alternative_explanations',
    activeAlternatives.length > 1 ? 'blocking' : 'note',
    activeAlternatives.length <= 1,
    activeAlternatives.length > 1
      ? `${activeAlternatives.length} competing explanations remain live (${activeAlternatives.map(h => h.label || h.hypothesis_id).join(', ')}). The finding asserts one of them.`
      : `${testedAlternatives.length} alternative explanation(s) were tested and set aside.`);

  // 2 — weakest supporting evidence
  const weakest = supporting.filter(e => e.verification_status === 'UNVERIFIED' || e.verification_status === 'DISPUTED');
  add('weakest_evidence',
    weakest.length ? 'warning' : 'note',
    weakest.length === 0,
    weakest.length
      ? `${weakest.length} supporting item(s) are UNVERIFIED or DISPUTED. If they were removed the finding would rest on ${supporting.length - weakest.length} item(s).`
      : 'All supporting evidence is corroborated.');

  // 3 — open contradictions
  add('open_contradictions',
    openContradictions.length ? 'blocking' : 'note',
    openContradictions.length === 0,
    openContradictions.length
      ? `${openContradictions.length} contradiction(s) are unresolved: ${openContradictions.map(c => c.kind).join(', ')}. A finding cannot be approved over an open contradiction without the reviewer addressing it.`
      : 'No unresolved contradictions.');

  // 4 — sponsor bias
  const sponsorItems = supporting.filter(e => e.source_type === 'sponsor_statement');
  const sponsorShare = supporting.length ? sponsorItems.length / supporting.length : 0;
  add('sponsor_bias',
    sponsorShare > 0.5 ? 'blocking' : (sponsorShare > 0 ? 'warning' : 'note'),
    sponsorShare <= 0.5,
    sponsorShare > 0
      ? `${Math.round(sponsorShare * 100)}% of supporting evidence is the sponsor's own account. The sponsor is an interested party and, in this case type, is also a subject of the finding.`
      : 'No sponsor self-report among the supporting evidence.');

  // 5 — self-report bias
  const selfReport = supporting.filter(e => isSelfReport(e.source_type));
  const objective = supporting.filter(e => !isSelfReport(e.source_type));
  add('self_report_bias',
    objective.length === 0 ? 'blocking' : 'note',
    objective.length > 0,
    objective.length === 0
      ? 'Every supporting item is someone describing their own situation. Nothing independent corroborates the accounts.'
      : `${objective.length} item(s) are documents, system records or direct observation.`);

  // 6 — sample limitations
  const distinctSources = new Set(supporting.map(e => `${e.source_type}:${e.source_name}`));
  add('sample_limitations',
    distinctSources.size < 3 ? 'warning' : 'note',
    distinctSources.size >= 3,
    `${distinctSources.size} distinct source(s). ${distinctSources.size < 3
      ? 'A narrow sample cannot distinguish an organisation-wide pattern from a local one.'
      : 'Sample spans several independent sources.'}`);

  // 7 — historical vs current
  const stale = supporting.filter(e => e.source_date && daysBetween(now, new Date(e.source_date).getTime()) > STALE_EVIDENCE_DAYS);
  add('historical_vs_current',
    stale.length ? 'warning' : 'note',
    stale.length === 0,
    stale.length
      ? `${stale.length} supporting item(s) are older than ${STALE_EVIDENCE_DAYS} days and may describe a state the organisation has since left.`
      : 'All supporting evidence is current.');

  // 8 — policy vs practice
  const hasPolicyDoc = supporting.concat(counter).some(e => e.source_type === 'document');
  const hasPractice = supporting.concat(counter).some(e => ['interview', 'observation', 'system_record'].includes(e.source_type));
  const policyPractice = contradictions.some(c => c.kind === 'policy_vs_practice');
  add('policy_vs_practice',
    (hasPolicyDoc && hasPractice && !policyPractice) ? 'warning' : 'note',
    !(hasPolicyDoc && hasPractice && !policyPractice),
    policyPractice
      ? 'A policy/practice divergence is recorded and carried explicitly.'
      : (hasPolicyDoc && hasPractice
        ? 'Both documented policy and observed practice are in evidence but no divergence has been examined. Confirm they actually agree.'
        : 'Not applicable: evidence does not span both documented policy and observed practice.'));

  // 9 — overgeneralisation
  const scopeText = String(finding?.scope || '');
  const scopeIsBroad = /\b(all|every|company[-\s]?wide|organisation[-\s]?wide|organization[-\s]?wide|throughout)\b/i.test(scopeText);
  add('overgeneralisation',
    scopeIsBroad && distinctSources.size < 4 ? 'blocking' : 'note',
    !(scopeIsBroad && distinctSources.size < 4),
    scopeIsBroad && distinctSources.size < 4
      ? `Scope is stated organisation-wide but rests on ${distinctSources.size} source(s). Either narrow the scope to what was observed or widen the evidence.`
      : 'Stated scope is consistent with the breadth of evidence.');

  // 10 — unsupported causality
  const strengthAssessment = assessEvidenceStrength({
    supporting,
    contradicting: counter,
    openContradictions: openContradictions.length,
    testedAlternatives: testedAlternatives.length
  });
  const causal = detectUnsupportedCausality(finding?.statement, strengthAssessment.strength);
  add('unsupported_causality',
    causal.ok ? 'note' : 'blocking',
    causal.ok,
    causal.ok
      ? 'Language is proportionate to the evidence.'
      : causal.error);

  const blocking = checks.filter(c => !c.passed && c.severity === 'blocking');
  const warnings = checks.filter(c => !c.passed && c.severity === 'warning');
  const verdict = blocking.length ? 'BLOCKED' : (warnings.length ? 'PASSED_WITH_QUALIFICATIONS' : 'PASSED');

  return {
    verdict,
    checks,
    blocking_count: blocking.length,
    warning_count: warnings.length,
    assessed_strength: strengthAssessment.strength,
    strength_reasons: strengthAssessment.reasons,
    strength_caps: strengthAssessment.caps,
    summary: blocking.length
      ? `Blocked by ${blocking.length} issue(s): ${blocking.map(c => c.id).join(', ')}.`
      : (warnings.length
        ? `Passed with ${warnings.length} qualification(s): ${warnings.map(c => c.id).join(', ')}.`
        : 'Passed all challenge checks.'),
    // Explicitly recorded so the absence is a decision, not an oversight.
    reasoning_retained: false
  };
}

module.exports = { runChallenge, STALE_EVIDENCE_DAYS };
