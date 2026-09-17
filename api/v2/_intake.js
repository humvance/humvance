'use strict';
// Humvance V2 — Diagnostic Intake: the anonymous submission boundary.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE IS FOR
//
// SUBMISSION ≠ CASE. A stranger on the internet can reach this code path. What
// they produce is an immutable record of what they told us, and nothing else:
//
//   * no Organization        * no Hypothesis
//   * no Case                * no Finding
//   * no Claim               * no Approval
//   * no Evidence            * no membership, no access, no diagnosis
//
// A submission becomes a Case only when a human reviewer accepts it, in
// _service.decideIntake(). Until then it is a PENDING INTAKE SEED sitting in a
// holding area, and the only thing that has happened is that somebody talked to us.
//
// TWO OBJECTS, ON PURPOSE
//
//   intakeseed    — what the client submitted. Written once with putIfAbsent and
//                   NEVER updated. There is no code path in this file or any
//                   other that writes an existing seed key a second time.
//   intakereview  — what Humvance did about it. Mutable, version-checked, and
//                   entirely separate, so that recording a decision can never
//                   rewrite the client's own words.
//
// The brief asks the seed to carry a `status`. It carries it on the review record
// instead, because a status is a fact about OUR handling, not about their
// submission, and mixing the two is exactly how an "immutable" record stops being
// one.
//
// PRE-TENANT
//
// Neither object has an `organization_id`, because no organization exists yet.
// _repo.readScoped() must therefore never be used on them — its tenant check
// would compare undefined to undefined and pass. Reads go through the functions
// below, which are reachable only from the authenticated reviewer surface.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const D = require('./_domain');
const { newId, isId, ALPHABET } = require('./_ids');
const { scanUntrusted } = require('./_untrusted');

// Every submission id and the whole audit trail for the holding area live under
// these two index names. Both are inside the V2 key alphabet.
const INTAKE_INDEX = 'intake-submissions';
const INTAKE_AUDIT_INDEX = 'intake-audit';

// ── Limits ───────────────────────────────────────────────────────────────────
//
// Every bound is here, in one table, so that "how much can an anonymous caller
// write" is a single thing to read rather than a property you have to reconstruct
// from twenty call sites. Over-length is REJECTED, not truncated: silently
// cutting a client's sentence in half would corrupt the one thing this record is
// for.

const LIMITS = Object.freeze({
  body_bytes:            64 * 1024,
  company_name:          200,
  sector:                120,
  respondent_name:       120,
  respondent_role:       120,
  email:                 254,
  phone:                 40,
  reported_situation:    5000,
  scope_label:           120,
  scope_labels:          10,
  first_noticed_approx:  80,
  associated_change_note: 500,
  example_what_happened: 1500,
  example_approx_when:   80,
  example_area:          120,
  example_consequence:   800,
  impact_description:    500,
  impact_unit:           40,
  impact_basis:          300,
  impact_entries:        11,
  change_note:           300,
  change_entries:        11,
  client_belief:         2000,
  availability_note:     300,
  availability_entries:  12,
  desired_outcome:       2000
});

// ── Schema ───────────────────────────────────────────────────────────────────
//
// An ALLOW-LIST, not a filter. Anything not named here is a rejection, not a
// field that gets quietly dropped — a caller who sends `status`, `organization_id`
// or `verification_status` is told no, rather than being left to believe it
// worked. This is the rule that makes `{ ...submission }` impossible here.

const TOP_LEVEL_KEYS = Object.freeze([
  'organization_context', 'respondent_context', 'case_intent', 'reported_situation',
  'scope', 'timeline', 'recent_examples', 'observed_impact', 'change_context',
  'client_belief', 'evidence_availability', 'desired_outcome', 'consent', 'locale'
]);
const ORG_CONTEXT_KEYS   = Object.freeze(['company_name', 'sector', 'employee_count_band', 'growth_stage']);
const RESPONDENT_KEYS    = Object.freeze(['name', 'role_title', 'email', 'phone', 'preferred_contact']);
const SCOPE_KEYS         = Object.freeze(['kind', 'labels']);
const TIMELINE_KEYS      = Object.freeze(['first_noticed_approx', 'pattern', 'associated_change_note']);
const EXAMPLE_KEYS       = Object.freeze(['what_happened', 'approx_when', 'area', 'observable_consequence']);
const IMPACT_KEYS        = Object.freeze(['kind', 'description', 'quantification']);
const QUANTIFICATION_KEYS= Object.freeze(['value', 'unit', 'basis']);
const CHANGE_KEYS        = Object.freeze(['kind', 'note']);
const AVAILABILITY_KEYS  = Object.freeze(['kind', 'note']);
const CONSENT_KEYS       = Object.freeze(['data_use', 'ai_transparency_ack', 'sensitive_data_ack']);

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const LOCALES = Object.freeze(['ar', 'en']);

class IntakeError extends Error {
  constructor(code, message, field = null) {
    super(message);
    this.name = 'IntakeError';
    this.code = code;
    this.field = field;
    this.status = 400;
  }
}

function fail(code, message, field) { throw new IntakeError(code, message, field); }

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Reject any key the schema does not name. Deny by default, loudly. */
function assertOnlyKeys(obj, allowed, where) {
  const extra = Object.keys(obj).filter(k => !allowed.includes(k));
  if (extra.length) {
    fail('unknown_field', `unexpected field(s) at ${where}: ${extra.join(', ')}`, where);
  }
}

function str(value, { max, required = false, where, allowEmpty = false }) {
  if (value === undefined || value === null) {
    if (required) fail('missing_field', `${where} is required`, where);
    return null;
  }
  if (typeof value !== 'string') fail('invalid_type', `${where} must be a string`, where);
  const trimmed = value.trim();
  if (!trimmed.length && !allowEmpty) {
    if (required) fail('missing_field', `${where} is required`, where);
    return null;
  }
  // Rejected, never truncated: a half-sentence is a corrupted record.
  if (trimmed.length > max) {
    fail('field_too_long', `${where} exceeds ${max} characters (got ${trimmed.length})`, where);
  }
  return trimmed;
}

function enumVal(value, allowed, { required = false, where }) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('missing_field', `${where} is required`, where);
    return null;
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail('invalid_enum', `${where} must be one of: ${allowed.join(', ')}`, where);
  }
  return value;
}

function arr(value, { max, where }) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('invalid_type', `${where} must be an array`, where);
  if (value.length > max) {
    fail('too_many_entries', `${where} accepts at most ${max} entries (got ${value.length})`, where);
  }
  return value;
}

function assertTrue(value, where) {
  if (value !== true) fail('consent_required', `${where} must be explicitly true`, where);
  return true;
}

/**
 * Validate an anonymous submission and return the normalised payload.
 *
 * Returns the caller's content and NOTHING derived: no status, no ids, no
 * provenance, no verification, no interpretation. Those are minted server-side by
 * buildIntakeSeed(), which is the only function that can put them in a record.
 *
 * Throws IntakeError (status 400) on the first violation.
 */
function validateIntakeSubmission(body) {
  if (!isPlainObject(body)) fail('malformed_body', 'a JSON object body is required');
  assertOnlyKeys(body, TOP_LEVEL_KEYS, 'body');

  // 1 — organisation context
  if (!isPlainObject(body.organization_context)) fail('missing_field', 'organization_context is required', 'organization_context');
  assertOnlyKeys(body.organization_context, ORG_CONTEXT_KEYS, 'organization_context');
  const organization_context = {
    company_name:        str(body.organization_context.company_name, { max: LIMITS.company_name, required: true, where: 'organization_context.company_name' }),
    sector:              str(body.organization_context.sector, { max: LIMITS.sector, where: 'organization_context.sector' }),
    employee_count_band: enumVal(body.organization_context.employee_count_band, D.INTAKE_EMPLOYEE_BANDS, { where: 'organization_context.employee_count_band' }),
    growth_stage:        enumVal(body.organization_context.growth_stage, D.INTAKE_GROWTH_STAGES, { where: 'organization_context.growth_stage' })
  };

  // 1b — respondent. Data minimisation: a name, a role, and one way to reply.
  if (!isPlainObject(body.respondent_context)) fail('missing_field', 'respondent_context is required', 'respondent_context');
  assertOnlyKeys(body.respondent_context, RESPONDENT_KEYS, 'respondent_context');
  const email = str(body.respondent_context.email, { max: LIMITS.email, required: true, where: 'respondent_context.email' });
  if (!EMAIL_RE.test(email)) fail('invalid_email', 'respondent_context.email is not a valid address', 'respondent_context.email');
  const respondent_context = {
    name:              str(body.respondent_context.name, { max: LIMITS.respondent_name, required: true, where: 'respondent_context.name' }),
    role_title:        str(body.respondent_context.role_title, { max: LIMITS.respondent_role, required: true, where: 'respondent_context.role_title' }),
    email,
    phone:             str(body.respondent_context.phone, { max: LIMITS.phone, where: 'respondent_context.phone' }),
    preferred_contact: enumVal(body.respondent_context.preferred_contact, D.INTAKE_CONTACT_PREFERENCES, { where: 'respondent_context.preferred_contact' })
  };

  // 2 — why they came. An intent, not a diagnosis.
  const case_intent = enumVal(body.case_intent, D.CASE_INTENTS, { required: true, where: 'case_intent' });

  // 3 — what is happening. This is the whole point of the form.
  const reported_situation = str(body.reported_situation, { max: LIMITS.reported_situation, required: true, where: 'reported_situation' });

  // 4 — where
  if (!isPlainObject(body.scope)) fail('missing_field', 'scope is required', 'scope');
  assertOnlyKeys(body.scope, SCOPE_KEYS, 'scope');
  const rawLabels = arr(body.scope.labels, { max: LIMITS.scope_labels, where: 'scope.labels' });
  const scope = {
    kind: enumVal(body.scope.kind, D.INTAKE_SCOPE_KINDS, { required: true, where: 'scope.kind' }),
    labels: rawLabels.map((l, i) => str(l, { max: LIMITS.scope_label, required: true, where: `scope.labels[${i}]` }))
  };

  // 5 — when. Association is recorded as association. Nothing here says "because".
  if (!isPlainObject(body.timeline)) fail('missing_field', 'timeline is required', 'timeline');
  assertOnlyKeys(body.timeline, TIMELINE_KEYS, 'timeline');
  const timeline = {
    first_noticed_approx:   str(body.timeline.first_noticed_approx, { max: LIMITS.first_noticed_approx, where: 'timeline.first_noticed_approx' }),
    pattern:                enumVal(body.timeline.pattern, D.INTAKE_TEMPORAL_PATTERNS, { required: true, where: 'timeline.pattern' }),
    associated_change_note: str(body.timeline.associated_change_note, { max: LIMITS.associated_change_note, where: 'timeline.associated_change_note' })
  };

  // 6 — concrete examples. What happened, not why.
  const rawExamples = arr(body.recent_examples, { max: D.MAX_RECENT_EXAMPLES, where: 'recent_examples' });
  const recent_examples = rawExamples.map((ex, i) => {
    if (!isPlainObject(ex)) fail('invalid_type', `recent_examples[${i}] must be an object`, `recent_examples[${i}]`);
    assertOnlyKeys(ex, EXAMPLE_KEYS, `recent_examples[${i}]`);
    return {
      what_happened:          str(ex.what_happened, { max: LIMITS.example_what_happened, required: true, where: `recent_examples[${i}].what_happened` }),
      approx_when:            str(ex.approx_when, { max: LIMITS.example_approx_when, where: `recent_examples[${i}].approx_when` }),
      area:                   str(ex.area, { max: LIMITS.example_area, where: `recent_examples[${i}].area` }),
      observable_consequence: str(ex.observable_consequence, { max: LIMITS.example_consequence, where: `recent_examples[${i}].observable_consequence` })
    };
  });

  // 7 — impact. A number the client offers stays a number the client offered.
  const rawImpact = arr(body.observed_impact, { max: LIMITS.impact_entries, where: 'observed_impact' });
  const seenImpact = new Set();
  const observed_impact = rawImpact.map((im, i) => {
    if (!isPlainObject(im)) fail('invalid_type', `observed_impact[${i}] must be an object`, `observed_impact[${i}]`);
    assertOnlyKeys(im, IMPACT_KEYS, `observed_impact[${i}]`);
    const kind = enumVal(im.kind, D.INTAKE_IMPACT_KINDS, { required: true, where: `observed_impact[${i}].kind` });
    if (seenImpact.has(kind)) fail('duplicate_entry', `observed_impact contains "${kind}" more than once`, `observed_impact[${i}].kind`);
    seenImpact.add(kind);

    let quantification = null;
    if (im.quantification !== undefined && im.quantification !== null) {
      if (!isPlainObject(im.quantification)) fail('invalid_type', `observed_impact[${i}].quantification must be an object`, `observed_impact[${i}].quantification`);
      assertOnlyKeys(im.quantification, QUANTIFICATION_KEYS, `observed_impact[${i}].quantification`);
      const value = im.quantification.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail('invalid_type', `observed_impact[${i}].quantification.value must be a finite number`, `observed_impact[${i}].quantification.value`);
      }
      quantification = {
        value,
        unit:  str(im.quantification.unit, { max: LIMITS.impact_unit, required: true, where: `observed_impact[${i}].quantification.unit` }),
        basis: str(im.quantification.basis, { max: LIMITS.impact_basis, where: `observed_impact[${i}].quantification.basis` }),
        // Server-set, always. Humvance derives no monetary impact and no ROI from
        // this; it is recorded as something the client said, and stays that way.
        source: 'CLIENT_STATED'
      };
    }
    return {
      kind,
      description: str(im.description, { max: LIMITS.impact_description, where: `observed_impact[${i}].description` }),
      quantification
    };
  });

  // 8 — change context. Contextual signals. Sequence is not mechanism.
  const rawChanges = arr(body.change_context, { max: LIMITS.change_entries, where: 'change_context' });
  const seenChange = new Set();
  const change_context = rawChanges.map((ch, i) => {
    if (!isPlainObject(ch)) fail('invalid_type', `change_context[${i}] must be an object`, `change_context[${i}]`);
    assertOnlyKeys(ch, CHANGE_KEYS, `change_context[${i}]`);
    const kind = enumVal(ch.kind, D.INTAKE_CHANGE_CONTEXT_KINDS, { required: true, where: `change_context[${i}].kind` });
    if (seenChange.has(kind)) fail('duplicate_entry', `change_context contains "${kind}" more than once`, `change_context[${i}].kind`);
    seenChange.add(kind);
    return { kind, note: str(ch.note, { max: LIMITS.change_note, where: `change_context[${i}].note` }) };
  });

  // 9 — what they think is causing it. Optional: uncertainty is an acceptable
  // answer, and pressing for one would manufacture a belief that was not there.
  const client_belief = str(body.client_belief, { max: LIMITS.client_belief, where: 'client_belief' });

  // 10 — what information EXISTS. Not evidence. Nothing has been received.
  const rawAvail = arr(body.evidence_availability, { max: LIMITS.availability_entries, where: 'evidence_availability' });
  const seenAvail = new Set();
  const evidence_availability = rawAvail.map((av, i) => {
    if (!isPlainObject(av)) fail('invalid_type', `evidence_availability[${i}] must be an object`, `evidence_availability[${i}]`);
    assertOnlyKeys(av, AVAILABILITY_KEYS, `evidence_availability[${i}]`);
    const kind = enumVal(av.kind, D.INTAKE_EVIDENCE_AVAILABILITY_KINDS, { required: true, where: `evidence_availability[${i}].kind` });
    if (seenAvail.has(kind)) fail('duplicate_entry', `evidence_availability contains "${kind}" more than once`, `evidence_availability[${i}].kind`);
    seenAvail.add(kind);
    return { kind, note: str(av.note, { max: LIMITS.availability_note, where: `evidence_availability[${i}].note` }) };
  });

  // 11 — what they want to understand or decide. NOT which intervention to buy.
  const desired_outcome = str(body.desired_outcome, { max: LIMITS.desired_outcome, required: true, where: 'desired_outcome' });

  // 12 — consent, explicitly, three separate acknowledgements.
  if (!isPlainObject(body.consent)) fail('consent_required', 'consent is required', 'consent');
  assertOnlyKeys(body.consent, CONSENT_KEYS, 'consent');
  const consent = {
    data_use:            assertTrue(body.consent.data_use, 'consent.data_use'),
    ai_transparency_ack: assertTrue(body.consent.ai_transparency_ack, 'consent.ai_transparency_ack'),
    sensitive_data_ack:  assertTrue(body.consent.sensitive_data_ack, 'consent.sensitive_data_ack')
  };

  const locale = enumVal(body.locale, LOCALES, { where: 'locale' }) || 'ar';

  return {
    organization_context, respondent_context, case_intent, reported_situation,
    scope, timeline, recent_examples, observed_impact, change_context,
    client_belief, evidence_availability, desired_outcome, consent, locale
  };
}

// ── Untrusted content ────────────────────────────────────────────────────────

/**
 * Walk every string in the normalised payload and scan it. The text itself is
 * never altered — an instruction-shaped sentence inside a client's description is
 * a fact about the submission, and deleting it would destroy the thing a reviewer
 * most needs to see.
 */
function scanSubmission(payload) {
  const fields = {};
  let hidden = false;

  (function walk(node, path) {
    if (typeof node === 'string') {
      const scan = scanUntrusted(node);
      if (!scan.clean || scan.hidden_characters) {
        fields[path] = { flags: scan.flags, hidden_characters: scan.hidden_characters };
        if (scan.hidden_characters) hidden = true;
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (isPlainObject(node)) { for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k); }
  })(payload, '');

  const paths = Object.keys(fields);
  return {
    clean: paths.length === 0,
    hidden_characters: hidden,
    flagged_fields: paths,
    detail: fields,
    // Said out loud in the record: scanning describes the content, it does not
    // obey it and it does not edit it.
    policy: 'Flagged text is stored verbatim as client-reported content. It confers no instruction, permission or authority.'
  };
}

// ── Server-minted identifiers ────────────────────────────────────────────────

// Opaque, unguessable, and deliberately unlike a V1 ref (`HUM-2026-1234`) so the
// two can never be confused by a human or matched by a V1 pattern. It is a
// quotable handle, not a key: nothing is addressable by it.
function newSubmissionReference() {
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 12; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `HVS-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`.toUpperCase();
}

const SUBMISSION_REFERENCE_RE = /^HVS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

// ── Record builders ──────────────────────────────────────────────────────────

/**
 * Build the immutable seed. Every field that is not the client's own content is
 * set HERE, from server state — there is no path by which a caller supplies an
 * id, a status, a timestamp, a provenance marker or a verification status.
 */
function buildIntakeSeed(payload, { now = Date.now() } = {}) {
  const intakeseed_id = newId('seed');
  return {
    intakeseed_id,
    submission_reference: newSubmissionReference(),
    submitted_at: now,

    // Exactly what the client sent, normalised and nothing more.
    organization_context: payload.organization_context,
    respondent_context: payload.respondent_context,
    case_intent: payload.case_intent,
    reported_situation: payload.reported_situation,
    scope: payload.scope,
    timeline: payload.timeline,
    recent_examples: payload.recent_examples,
    observed_impact: payload.observed_impact,
    change_context: payload.change_context,
    client_belief: payload.client_belief,
    evidence_availability: payload.evidence_availability,
    desired_outcome: payload.desired_outcome,
    consent: payload.consent,
    locale: payload.locale,

    untrusted_scan: scanSubmission(payload),

    // The semantic rules, carried in the record rather than in a document.
    epistemic_status: D.INTAKE_EPISTEMIC_STATUS,
    record_kind: 'PENDING_INTAKE_SEED',
    immutable: true,
    note: 'Client-reported submission. Not a Case, not Evidence, not a finding. Nothing here has been verified.'
  };
}

/** The review record: separate object, separate lifecycle, separate key. */
function buildIntakeReview(seed, { now = Date.now() } = {}) {
  return {
    intakereview_id: newId('irv'),
    intakeseed_id: seed.intakeseed_id,
    submission_reference: seed.submission_reference,

    // THE DECISION — made once by a human, then final.
    status: 'PENDING_REVIEW',
    decided_at: null,
    decided_by: null,
    decided_by_type: null,
    decision_reason: null,

    // THE EXECUTION — a separate concern with a separate lifetime. null until an
    // ACCEPT, then PENDING until every object in the plan exists, then COMPLETE.
    promotion_state: null,
    promotion_plan: null,
    promotion_attempts: 0,
    promotion_started_at: null,
    promotion_completed_at: null,
    promotion_last_error: null,

    created_at: now,
    updated_at: now,
    version: 1,

    // Named `resulting_*` rather than `organization_id` on purpose: this record is
    // pre-tenant, and a field called `organization_id` would look like a tenant
    // scope to _repo.readScoped() and to the next person reading this file. They are
    // set only when the promotion is COMPLETE — while it is PENDING the ids live in
    // the plan, where they cannot be mistaken for objects that already exist.
    resulting_organization_id: null,
    resulting_case_id: null
  };
}

/**
 * Mint every identifier the promotion will need, BEFORE anything is created.
 *
 * This is the whole recovery design in one function. The plan is written down in
 * the same update that records the human decision, so from that moment every object
 * the promotion will create has a known address. A resumed run asks the store "does
 * `case_id` exist yet?" instead of "did I already make a case for this?" — the first
 * question has an answer, the second does not.
 *
 * Without it, a crash between creating an object and recording its id produces a
 * duplicate on retry, because the retry has no way to recognise its own earlier work.
 */
function buildPromotionPlan(seed, { organization_id = null } = {}) {
  return {
    // When the reviewer chose an organisation they already belong to, the plan
    // records THAT id and marks it pre-existing, so a resume never tries to create
    // an organisation that was never the promotion's to create.
    organization_id: organization_id || newId('org'),
    organization_preexisting: !!organization_id,
    case_id: newId('case'),
    primary_claim_id: newId('clm'),
    // Planned only when there is something to put in it: an absent belief must not
    // leave a planned id that a resume would then try to fill.
    belief_claim_id: seed.client_belief ? newId('clm') : null,
    evidence_ids: seed.recent_examples.map(() => newId('evd')),
    planned_at: Date.now()
  };
}

// ── Persistence for the holding area ─────────────────────────────────────────
//
// Small and deliberately narrow. Only the functions below touch the two
// pre-tenant types, and there is no update path for a seed at all.

function createIntakeRepo(store) {

  async function putSeed(seed) {
    const written = await store.putIfAbsent('intakeseed', seed.intakeseed_id, seed);
    if (!written) {
      const e = new IntakeError('id_collision', 'identifier collision');
      e.status = 500;
      throw e;
    }
    return seed;
  }

  async function getSeed(intakeseed_id) {
    if (!isId('seed', intakeseed_id)) return null;
    return store.get('intakeseed', intakeseed_id);
  }

  /**
   * Claim the decision atomically.
   *
   * `setIfAbsent` is the only operation in this store that cannot be interleaved:
   * on Redis it is SET NX, and it either writes or reports that somebody already
   * did. Everything else here is read-modify-write, which two serverless instances
   * can run at the same time and both believe they won — which is precisely what
   * "one human decision per submission" cannot tolerate, because the loser would go
   * on to build a second Organization and a second Case from the same submission.
   *
   * Returns { won:true, marker } or { won:false, marker } with the marker that the
   * winner wrote, so the caller can say who decided and when.
   */
  async function claimDecision(intakereview_id, marker) {
    const won = await store.putIfAbsent('intakedecision', intakereview_id, marker);
    if (won) return { won: true, marker };
    return { won: false, marker: await store.get('intakedecision', intakereview_id) };
  }

  async function getDecisionMarker(intakereview_id) {
    if (!isId('irv', intakereview_id)) return null;
    return store.get('intakedecision', intakereview_id);
  }

  async function putReview(review) {
    const written = await store.putIfAbsent('intakereview', review.intakereview_id, review);
    if (!written) {
      const e = new IntakeError('id_collision', 'identifier collision');
      e.status = 500;
      throw e;
    }
    return review;
  }

  async function getReview(intakereview_id) {
    if (!isId('irv', intakereview_id)) return null;
    return store.get('intakereview', intakereview_id);
  }

  /** Version-checked, same discipline as _repo.updateObject. Seeds have no twin. */
  async function updateReview(intakereview_id, expected_version, mutate) {
    const current = await getReview(intakereview_id);
    if (!current) {
      const e = new IntakeError('not_found', 'intake review not found');
      e.status = 404;
      throw e;
    }
    if (expected_version === undefined || expected_version === null) {
      const e = new IntakeError('version_required', 'expected_version is required');
      e.status = 400;
      throw e;
    }
    if (Number(expected_version) !== Number(current.version)) {
      const e = new IntakeError('version_conflict',
        `stale update: expected version ${expected_version}, stored version is ${current.version}`);
      e.status = 409;
      throw e;
    }
    const draft = JSON.parse(JSON.stringify(current));
    const next = await mutate(draft);
    next.version = current.version + 1;
    next.updated_at = Date.now();
    await store.put('intakereview', intakereview_id, next);
    return next;
  }

  async function indexSubmission(entry) {
    await store.appendToIndex(INTAKE_INDEX, entry);
  }

  /**
   * The holding area, newest first. Returns SUMMARIES — a reviewer list has no
   * business carrying the client's narrative, their email or their examples.
   */
  async function listSubmissions({ status = null, limit = 100 } = {}) {
    const entries = await store.readIndex(INTAKE_INDEX);
    const out = [];
    for (const entry of entries.slice().reverse()) {
      if (out.length >= limit) break;
      const review = await getReview(entry.intakereview_id);
      if (!review) continue;
      if (status && review.status !== status) continue;
      const seed = await getSeed(entry.intakeseed_id);
      if (!seed) continue;
      out.push({
        intakeseed_id: seed.intakeseed_id,
        intakereview_id: review.intakereview_id,
        submission_reference: seed.submission_reference,
        submitted_at: seed.submitted_at,
        company_name: seed.organization_context.company_name,
        case_intent: seed.case_intent,
        scope_kind: seed.scope.kind,
        status: review.status,
        promotion_state: review.promotion_state,
        version: review.version,
        untrusted_flagged: !seed.untrusted_scan.clean,
        resulting_case_id: review.resulting_case_id
      });
    }
    return out;
  }

  /**
   * Audit for the holding area. Pre-tenant events have no organization, so they
   * cannot go through _repo.audit() — which would compose an org-scoped index name
   * out of null. They are recorded here, in the same shape, under their own index.
   */
  async function auditIntake(event, { actor, subject_type, subject_id, summary = '', details = {} }) {
    if (!D.AUDIT_EVENTS.includes(event)) {
      const e = new IntakeError('invalid_audit_event', `unknown audit event "${event}"`);
      e.status = 500;
      throw e;
    }
    const entry = {
      audit_id: newId('aud'),
      organization_id: null,
      case_id: null,
      event,
      at: Date.now(),
      actor_id: actor.actor_id,
      actor_type: actor.actor_type,
      actor_role: actor.role || null,
      subject_type,
      subject_id,
      summary: String(summary).slice(0, 500),
      details
    };
    await store.put('audit', entry.audit_id, entry);
    await store.appendToIndex(INTAKE_AUDIT_INDEX, entry.audit_id);
    return entry;
  }

  async function readIntakeAudit(subject_id = null) {
    const ids = await store.readIndex(INTAKE_AUDIT_INDEX);
    const out = [];
    for (const id of ids) {
      const e = await store.get('audit', id);
      if (!e) continue;
      if (subject_id && e.subject_id !== subject_id && e.details?.intakeseed_id !== subject_id) continue;
      out.push(e);
    }
    return out.sort((a, b) => a.at - b.at);
  }

  return {
    putSeed, getSeed, putReview, getReview, updateReview,
    claimDecision, getDecisionMarker,
    indexSubmission, listSubmissions, auditIntake, readIntakeAudit
  };
}

module.exports = {
  LIMITS, TOP_LEVEL_KEYS, IntakeError,
  validateIntakeSubmission, scanSubmission,
  newSubmissionReference, SUBMISSION_REFERENCE_RE,
  buildIntakeSeed, buildIntakeReview, buildPromotionPlan,
  createIntakeRepo, INTAKE_INDEX, INTAKE_AUDIT_INDEX
};
