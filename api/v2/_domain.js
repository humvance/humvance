'use strict';
// Humvance V2 — pure domain layer. No I/O, no framework, no env. Everything here
// is a function of its arguments, which is what makes the rules testable and what
// makes "the backend enforces this, not the prompt" a true statement.
//
// Lineage note: the shape of this file is deliberately borrowed from Phase 3's
// api/_meeting-core.js — declarative transition table, pure validators, allow-listed
// update fields, snapshot + staleness detection. What is NOT borrowed is its
// permissive isValidRef; V2 identifiers come from _ids.js and never touch storage
// key grammar. See §9 of the lineage plan.

// ── Case lifecycle ───────────────────────────────────────────────────────────

const CASE_STATES = Object.freeze([
  'INTAKE',
  'STRUCTURING',
  'INVESTIGATION_PLANNING',
  'HUMAN_REVIEW',
  'AWAITING_EVIDENCE',
  'ANALYZING_EVIDENCE',
  'CLARIFICATION_REQUIRED',
  'FINDING_DRAFT',
  'CHALLENGE_REVIEW',
  'HUMAN_APPROVAL',
  'APPROVED'
]);

// Declarative and total: a transition not listed here does not exist. Reading the
// table is how you audit the lifecycle; there is no second place to look.
const CASE_TRANSITIONS = Object.freeze({
  INTAKE:                 ['STRUCTURING'],
  STRUCTURING:            ['INVESTIGATION_PLANNING'],
  INVESTIGATION_PLANNING: ['HUMAN_REVIEW'],
  HUMAN_REVIEW:           ['AWAITING_EVIDENCE', 'INVESTIGATION_PLANNING'],
  AWAITING_EVIDENCE:      ['ANALYZING_EVIDENCE'],
  ANALYZING_EVIDENCE:     ['FINDING_DRAFT', 'CLARIFICATION_REQUIRED'],
  CLARIFICATION_REQUIRED: ['AWAITING_EVIDENCE'],
  FINDING_DRAFT:          ['CHALLENGE_REVIEW'],
  CHALLENGE_REVIEW:       ['HUMAN_APPROVAL', 'FINDING_DRAFT', 'AWAITING_EVIDENCE'],
  HUMAN_APPROVAL:         ['APPROVED', 'FINDING_DRAFT', 'AWAITING_EVIDENCE'],
  // A Finding revised after approval puts the Case back into drafting. The old
  // approval does not travel with it — see approvalCoversFinding().
  APPROVED:               ['FINDING_DRAFT']
});

// Transitions a human reviewer must make. The AI may propose them; it may not
// perform them. Enforced in canTransition(), not in a prompt.
const HUMAN_ONLY_TRANSITIONS = Object.freeze(new Set([
  'HUMAN_REVIEW->AWAITING_EVIDENCE',   // the investigation plan is accepted
  'HUMAN_APPROVAL->APPROVED',          // the finding is approved
  'HUMAN_APPROVAL->FINDING_DRAFT',     // approved-with-modification / rejected
  'HUMAN_APPROVAL->AWAITING_EVIDENCE', // more evidence required
  'APPROVED->FINDING_DRAFT'            // a superseding revision is opened
]));

const ACTOR_TYPES = Object.freeze(['human', 'ai', 'system']);

function isCaseState(s) { return CASE_STATES.includes(s); }

/**
 * The single authority on whether a Case may move.
 * Returns { ok:true } or { ok:false, code, error } — never throws on bad input,
 * because bad input is the normal case at an API boundary.
 */
function canTransition(from, to, actorType) {
  if (!isCaseState(from)) return { ok: false, code: 'invalid_state', error: `unknown state "${from}"` };
  if (!isCaseState(to))   return { ok: false, code: 'invalid_state', error: `unknown state "${to}"` };
  if (!ACTOR_TYPES.includes(actorType)) {
    return { ok: false, code: 'invalid_actor', error: `unknown actor type "${actorType}"` };
  }
  if (from === to) return { ok: false, code: 'invalid_transition', error: 'a Case may not transition to its current state' };

  const allowed = CASE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return { ok: false, code: 'invalid_transition', error: `${from} -> ${to} is not a defined transition` };
  }

  // The hard governance line. AI may READ, EXTRACT, CLASSIFY, ANALYZE, PROPOSE,
  // DRAFT, CHALLENGE, FLAG and SUMMARIZE. It may not approve, and it may not walk
  // a Case across a decision gate on a human's behalf.
  if (actorType !== 'human' && HUMAN_ONLY_TRANSITIONS.has(`${from}->${to}`)) {
    return {
      ok: false,
      code: 'human_required',
      error: `${from} -> ${to} requires a human actor; actor type was "${actorType}"`
    };
  }
  return { ok: true };
}

// ── Client-visible status (§30: simple outside, sophisticated inside) ─────────
//
// The client never sees internal state names, competing hypotheses, challenge
// prompts or evidence arithmetic. They see where the work is and what is wanted
// from them.
const CLIENT_STATUS = Object.freeze({
  INTAKE:                 'Understanding',
  STRUCTURING:            'Understanding',
  INVESTIGATION_PLANNING: 'Reviewing',
  HUMAN_REVIEW:           'Reviewing',
  AWAITING_EVIDENCE:      'Clarifying',
  ANALYZING_EVIDENCE:     'Reviewing',
  CLARIFICATION_REQUIRED: 'Clarifying',
  FINDING_DRAFT:          'Reviewing',
  CHALLENGE_REVIEW:       'Reviewing',
  HUMAN_APPROVAL:         'Reviewing',
  APPROVED:               'Finding Ready'
});
// 'Complete' is reserved for the Engagement close that V2 deliberately defers.
const CLIENT_STATUS_VALUES = Object.freeze(['Understanding', 'Reviewing', 'Clarifying', 'Finding Ready', 'Complete']);

function clientStatusFor(state) { return CLIENT_STATUS[state] || 'Understanding'; }

// ── Claims ───────────────────────────────────────────────────────────────────

const CLAIM_VERIFICATION = Object.freeze([
  'UNVERIFIED', 'PARTIALLY_SUPPORTED', 'SUPPORTED', 'CONTRADICTED', 'SUPERSEDED'
]);
const CLAIM_ORIGINS = Object.freeze(['sponsor', 'employee', 'document', 'system', 'humvance_reviewer']);

// A sponsor's account of their own company is a claim, not a diagnosis, and it
// stays UNVERIFIED until evidence moves it. This is the product's whole premise.
function isClaimVerification(v) { return CLAIM_VERIFICATION.includes(v); }

// ── Hypotheses ───────────────────────────────────────────────────────────────

const HYPOTHESIS_STATES = Object.freeze([
  'PROPOSED', 'ACTIVE', 'STRENGTHENED', 'WEAKENED', 'NOT_SUPPORTED', 'UNRESOLVED'
]);
const HYPOTHESIS_TRANSITIONS = Object.freeze({
  PROPOSED:      ['ACTIVE', 'NOT_SUPPORTED'],
  ACTIVE:        ['STRENGTHENED', 'WEAKENED', 'NOT_SUPPORTED', 'UNRESOLVED'],
  STRENGTHENED:  ['WEAKENED', 'UNRESOLVED', 'ACTIVE'],
  WEAKENED:      ['STRENGTHENED', 'NOT_SUPPORTED', 'UNRESOLVED', 'ACTIVE'],
  NOT_SUPPORTED: ['ACTIVE'],          // new evidence can revive a discarded line
  UNRESOLVED:    ['ACTIVE', 'STRENGTHENED', 'WEAKENED', 'NOT_SUPPORTED']
});
function canHypothesisTransition(from, to) {
  if (!HYPOTHESIS_STATES.includes(from) || !HYPOTHESIS_STATES.includes(to)) return false;
  if (from === to) return true; // idempotent
  return (HYPOTHESIS_TRANSITIONS[from] || []).includes(to);
}

// ── Evidence ─────────────────────────────────────────────────────────────────
//
// SOURCE ≠ AI INTERPRETATION. These are different fields, they are never merged,
// and an AI-authored field can never be promoted into original_content. Legacy V1
// diagnostic text has no provenance and therefore is not V2 evidence — it can only
// enter as source_type 'legacy_unverified', which never counts toward strength.

const EVIDENCE_SOURCE_TYPES = Object.freeze([
  'interview',           // a person's account — self-report
  'survey',              // aggregated self-report
  'document',            // policy, org chart, delegation matrix
  'system_record',       // HRIS/ERP/ticketing export
  'observation',         // a reviewer observed it
  'sponsor_statement',   // the sponsor's own account — self-report, and interested
  'legacy_unverified'    // imported V1 material with no provenance
]);
// Source types that are a person describing their own situation. A finding built
// only from these cannot reach STRONG, no matter how many of them there are.
const SELF_REPORT_TYPES = Object.freeze(['interview', 'survey', 'sponsor_statement']);
const EVIDENCE_VERIFICATION = Object.freeze(['UNVERIFIED', 'CORROBORATED', 'DISPUTED', 'SUPERSEDED']);

function isSelfReport(sourceType) { return SELF_REPORT_TYPES.includes(sourceType); }

// ── Contradictions ───────────────────────────────────────────────────────────

const CONTRADICTION_KINDS = Object.freeze([
  'person_vs_person', 'policy_vs_practice', 'claim_vs_data',
  'current_vs_historical', 'finding_vs_counterexample'
]);
const CONTRADICTION_STATES = Object.freeze(['OPEN', 'INVESTIGATING', 'RESOLVED', 'ACCEPTED_AS_TENSION']);

// ── Findings and evidence sufficiency ────────────────────────────────────────

const EVIDENCE_STRENGTH = Object.freeze(['LIMITED', 'MODERATE', 'STRONG']);
const FINDING_STATES = Object.freeze(['DRAFT', 'CHALLENGED', 'AWAITING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'REJECTED']);

/**
 * Structured evidence sufficiency — the refactored descendant of Phase 2's
 * calculateConfidence(). The arithmetic survives as *rules*; the 0–100 number does
 * not survive at all, because a number implies a precision the evidence does not
 * have and invites clients to compare scores across unrelated things.
 *
 * Returns a bounded category plus the reasons and the caps that produced it, so a
 * reviewer can audit the judgement rather than trust it.
 */
function assessEvidenceStrength({ supporting = [], contradicting = [], openContradictions = 0, testedAlternatives = 0 } = {}) {
  const reasons = [];
  const caps = [];

  const usable = supporting.filter(e => e.source_type !== 'legacy_unverified');
  const excludedLegacy = supporting.length - usable.length;
  if (excludedLegacy > 0) {
    reasons.push(`${excludedLegacy} legacy item(s) excluded: imported V1 material has no provenance and is not counted as evidence`);
  }

  const independentSources = new Set(usable.map(e => `${e.source_type}:${e.source_name}`)).size;
  const nonSelfReport = usable.filter(e => !isSelfReport(e.source_type));
  const nonSelfReportSources = new Set(nonSelfReport.map(e => `${e.source_type}:${e.source_name}`)).size;

  reasons.push(`${independentSources} independent supporting source(s)`);
  reasons.push(`${nonSelfReportSources} of them are not self-report`);
  if (contradicting.length) reasons.push(`${contradicting.length} contradicting item(s) on record`);
  if (testedAlternatives) reasons.push(`${testedAlternatives} alternative explanation(s) explicitly tested`);

  let strength;
  if (usable.length === 0) {
    strength = 'LIMITED';
    caps.push('no usable supporting evidence');
  } else if (independentSources < 2) {
    strength = 'LIMITED';
    caps.push('single source: a finding resting on one source cannot exceed LIMITED');
  } else if (nonSelfReportSources === 0) {
    strength = 'LIMITED';
    caps.push('self-report only: no document, system record or observation corroborates the accounts');
  } else if (openContradictions > 0) {
    strength = 'MODERATE';
    caps.push(`${openContradictions} unresolved contradiction(s): cannot exceed MODERATE while a contradiction is open`);
  } else if (independentSources >= 3 && nonSelfReportSources >= 1 && testedAlternatives >= 1) {
    strength = 'STRONG';
  } else {
    strength = 'MODERATE';
    if (independentSources < 3) caps.push('fewer than 3 independent sources');
    if (testedAlternatives < 1) caps.push('no alternative explanation has been explicitly tested');
  }

  return { strength, reasons, caps, independentSources, nonSelfReportSources };
}

// ── Causality guardrail (§22) ────────────────────────────────────────────────
//
// A finding that is not STRONG must not be phrased as established cause. This is a
// lint, not a censor: it flags, the reviewer decides, and the flag is auditable.

const CAUSAL_PATTERNS = [
  /\bcaused by\b/i, /\bcauses\b/i, /\bis causing\b/i, /\bbecause of\b/i,
  /\bdue to\b/i, /\bleads to\b/i, /\bresults in\b/i, /\bproves\b/i,
  /\bdemonstrates that\b/i, /\bthe reason (is|for)\b/i,
  // Arabic: JavaScript's \b is defined over [A-Za-z0-9_], so an Arabic letter is a
  // non-word character and \b would never fire between two of them. These patterns
  // are deliberately unanchored - the product's primary language is Arabic and a
  // causal claim must be caught there first, not only in English.
  /بسبب/, /يؤدي إلى/, /تؤدي إلى/, /يثبت/, /ناتج عن/, /ناتجة عن/, /نتيجة ل/
];
const HEDGED_PHRASES = [
  'associated with', 'consistent with', 'may contribute to',
  'available evidence suggests', 'cannot exclude',
  'مرتبط بـ', 'يتوافق مع', 'قد يسهم في'
];

function detectUnsupportedCausality(text, strength) {
  const t = String(text || '');
  const hits = CAUSAL_PATTERNS.filter(re => re.test(t)).map(re => re.source);
  if (!hits.length) return { ok: true, hits: [], hedged: false };
  const hedged = HEDGED_PHRASES.some(p => t.toLowerCase().includes(p.toLowerCase()));
  if (strength === 'STRONG') return { ok: true, hits, hedged };
  return {
    ok: false,
    hits,
    hedged,
    error: `causal language used with ${strength} evidence; prefer "associated with", "consistent with", "may contribute to", "available evidence suggests", "cannot exclude"`
  };
}

// ── Approvals (§24) ──────────────────────────────────────────────────────────

const APPROVAL_DECISIONS = Object.freeze(['APPROVED', 'MODIFIED', 'MORE_EVIDENCE_REQUIRED', 'REJECTED']);
const APPROVABLE_ARTIFACTS = Object.freeze(['finding', 'evidencereq']);

/**
 * Version-bound approval. An approval of Finding v1 says nothing about v2 — this
 * is the rule that stops "approved once, edited later" from becoming a signed-off
 * finding nobody signed off on.
 */
function approvalCoversFinding(approval, finding) {
  if (!approval || !finding) return false;
  return approval.artifact_type === 'finding'
      && approval.artifact_id === finding.finding_id
      && approval.artifact_version === finding.version
      && approval.organization_id === finding.organization_id
      && approval.decision === 'APPROVED';
}

// A change is material — and so voids an existing approval — when it touches what
// the finding actually asserts or what bounds it. Fixing a typo in `title` is not
// material; changing `statement`, `scope` or `limitations` is.
const FINDING_MATERIAL_FIELDS = Object.freeze(['statement', 'scope', 'limitations', 'alternative_explanations', 'evidence_strength']);

function isMaterialFindingChange(before, after) {
  return FINDING_MATERIAL_FIELDS.some(f => JSON.stringify(before?.[f]) !== JSON.stringify(after?.[f]));
}

// ── Allow-listed updates (ported pattern from Phase 3 _meeting-core) ─────────
//
// Deny by default. A field absent from this table cannot be changed through the
// update path at all, which removes the whole class of "blind whole-object
// overwrite" bugs that Phase 3's diagnostic POST had.

const UPDATABLE_FIELDS = Object.freeze({
  case:       ['title', 'assigned_reviewer', 'metadata'],
  claim:      ['statement', 'verification_status', 'metadata'],
  hypothesis: ['statement', 'state', 'metadata'],
  evidence:   ['verification_status', 'limitations', 'metadata'],
  finding:    ['statement', 'scope', 'limitations', 'alternative_explanations', 'evidence_strength', 'metadata'],
  evidencereq:['status', 'reason', 'requested_item', 'metadata']
});

function validateUpdate(type, body) {
  const allowed = UPDATABLE_FIELDS[type];
  if (!allowed) return { ok: false, code: 'invalid_type', error: `no update policy for "${type}"` };
  const keys = Object.keys(body || {}).filter(k => k !== 'expected_version' && k !== 'actor_type');
  if (!keys.length) return { ok: false, code: 'empty_update', error: 'no updatable fields supplied' };
  const rejected = keys.filter(k => !allowed.includes(k));
  if (rejected.length) {
    return { ok: false, code: 'field_not_updatable', error: `not updatable: ${rejected.join(', ')}` };
  }
  return { ok: true, fields: keys };
}

// ── Snapshots and staleness (ported concept from Phase 3 _meeting-core) ──────
//
// A Finding cites the evidence as it stood when it was drafted. If the evidence
// set moves afterwards, the Finding is stale and must be re-examined rather than
// silently re-interpreted. This is the beginning of evidence versioning.

function buildEvidenceSnapshot(evidenceList, now) {
  const items = (evidenceList || [])
    .map(e => ({ evidence_id: e.evidence_id, version: e.version, verification_status: e.verification_status }))
    .sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  return { taken_at: now, count: items.length, items };
}

function isSnapshotStale(snapshot, evidenceList) {
  if (!snapshot) return true;
  const current = buildEvidenceSnapshot(evidenceList, snapshot.taken_at);
  if (current.count !== snapshot.count) return true;
  return JSON.stringify(current.items) !== JSON.stringify(snapshot.items);
}

// ── Evidence Request burden gate (§20) ───────────────────────────────────────
//
// Every request spends the client's goodwill. The gate is five questions and it is
// answered on the server, so a request that fails it cannot be sent at all.

const BURDEN_QUESTIONS = Object.freeze([
  'already_held',            // do we already have it?
  'answerable_from_existing',// can existing evidence answer it?
  'materially_changes',      // will it change the investigation?
  'lower_burden_source',     // is there a cheaper source?
  'necessary_now'            // is it needed now?
]);

function evaluateBurdenGate(g) {
  const missing = BURDEN_QUESTIONS.filter(q => typeof g?.[q] !== 'boolean');
  if (missing.length) {
    return { ok: false, code: 'burden_gate_incomplete', error: `unanswered burden questions: ${missing.join(', ')}` };
  }
  const blocks = [];
  if (g.already_held)             blocks.push('we already hold this');
  if (g.answerable_from_existing) blocks.push('existing evidence can answer this');
  if (!g.materially_changes)      blocks.push('it would not materially change the investigation');
  if (g.lower_burden_source)      blocks.push('a lower-burden source exists');
  if (!g.necessary_now)           blocks.push('it is not needed at this stage');
  if (blocks.length) return { ok: false, code: 'burden_gate_failed', error: `client burden gate: ${blocks.join('; ')}` };
  return { ok: true };
}

const EVIDENCE_REQUEST_STATES = Object.freeze([
  'PROPOSED', 'APPROVED', 'REJECTED', 'SENT', 'RECEIVED', 'CANCELLED'
]);

// ── Audit (§25) ──────────────────────────────────────────────────────────────
//
// Business-level provenance only. No prompts, no model reasoning, no
// chain-of-thought — those are neither durable nor appropriate to keep.

const AUDIT_EVENTS = Object.freeze([
  'case.created', 'case.state_changed', 'case.updated',
  'claim.created', 'claim.updated',
  'hypothesis.created', 'hypothesis.state_changed',
  'evidence.attached', 'evidence.updated',
  'contradiction.recorded', 'contradiction.updated',
  'evidence_request.proposed', 'evidence_request.decided',
  'finding.drafted', 'finding.revised',
  'challenge.completed',
  'approval.recorded',
  'security.rejected'
]);

module.exports = {
  CASE_STATES, CASE_TRANSITIONS, HUMAN_ONLY_TRANSITIONS, ACTOR_TYPES,
  isCaseState, canTransition,
  CLIENT_STATUS, CLIENT_STATUS_VALUES, clientStatusFor,
  CLAIM_VERIFICATION, CLAIM_ORIGINS, isClaimVerification,
  HYPOTHESIS_STATES, HYPOTHESIS_TRANSITIONS, canHypothesisTransition,
  EVIDENCE_SOURCE_TYPES, SELF_REPORT_TYPES, EVIDENCE_VERIFICATION, isSelfReport,
  CONTRADICTION_KINDS, CONTRADICTION_STATES,
  EVIDENCE_STRENGTH, FINDING_STATES, assessEvidenceStrength,
  detectUnsupportedCausality, CAUSAL_PATTERNS, HEDGED_PHRASES,
  APPROVAL_DECISIONS, APPROVABLE_ARTIFACTS, approvalCoversFinding,
  FINDING_MATERIAL_FIELDS, isMaterialFindingChange,
  UPDATABLE_FIELDS, validateUpdate,
  buildEvidenceSnapshot, isSnapshotStale,
  BURDEN_QUESTIONS, evaluateBurdenGate, EVIDENCE_REQUEST_STATES,
  AUDIT_EVENTS
};
