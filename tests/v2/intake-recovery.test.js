'use strict';
// Diagnostic Intake V2 — promotion recovery, idempotency and concurrency.
//
// WHAT THIS FILE IS FOR
//
// Accepting a submission is one human decision followed by six writes to a store
// that has no transactions: an Organization, a Case, a primary Claim, a belief
// Claim, up to three Evidence items, and the review record that links them. Any of
// those writes can be the last one a process ever makes.
//
// The first implementation treated the decision and the work as the same thing, so
// an interruption anywhere left the submission ACCEPTED with nothing to show for it
// and no way back in: a retry was refused as "already decided". These tests inject
// a failure at each boundary and then prove the two properties that fix costs:
//
//   DURABLE   — the human decision survives, and is never asked for twice.
//   RESUMABLE — the work converges, and running it again creates nothing new.
//
// The fault injector wraps the real store, so the failures are real write failures
// at real boundaries, not mocked service calls.

const { suite, test, assert } = require('./harness');
const { createStore } = require('../../api/v2/_store');
const { createService } = require('../../api/v2/_service');

// ── fixtures ─────────────────────────────────────────────────────────────────

let ns = 0;
function freshStore() {
  return createStore({ V2_STORE_DRIVER: 'memory', V2_NAMESPACE: `v2rec${++ns}` });
}

const REVIEWER   = { actor_id: 'act_reviewer_hv', actor_type: 'human', role: 'admin' };
const REVIEWER_B = { actor_id: 'act_reviewer_b',  actor_type: 'human', role: 'admin' };
const AI         = { actor_id: 'act_ai', actor_type: 'ai', role: 'reviewer' };

function submission(overrides = {}) {
  return Object.assign({
    organization_context: { company_name: 'Recovery Co', sector: 'Testing', employee_count_band: '51-200' },
    respondent_context: { name: 'R. Ecovery', role_title: 'Managing Director', email: 'md@recovery.example' },
    case_intent: 'DYSFUNCTION',
    reported_situation: 'Orders that used to go out the same day now wait three or four days for my signature.',
    scope: { kind: 'process', labels: ['Procurement'] },
    timeline: { first_noticed_approx: 'around March', pattern: 'increasing' },
    recent_examples: [
      { what_happened: 'A reorder waited four days.', approx_when: 'two weeks ago', observable_consequence: 'Out of stock.' },
      { what_happened: 'A renewal missed its date.', approx_when: 'last month', observable_consequence: 'Paid rack rate.' },
      { what_happened: 'Two managers gave different dates.', approx_when: 'this quarter', observable_consequence: 'Client escalated.' }
    ],
    observed_impact: [{ kind: 'delays', description: 'Days rather than hours.' }],
    change_context: [{ kind: 'rapid_growth', note: 'Two new branches.' }],
    client_belief: 'I think my managers are not confident enough to decide on their own.',
    evidence_availability: [{ kind: 'delegation_matrix' }],
    desired_outcome: 'Understand why everything reaches me before we open two more branches.',
    consent: { data_use: true, ai_transparency_ack: true, sensitive_data_ack: true },
    locale: 'en'
  }, overrides);
}

// ── fault injection ──────────────────────────────────────────────────────────

class InjectedFailure extends Error {
  constructor(where) { super(`injected failure at ${where}`); this.code = 'injected_failure'; this.status = 500; }
}

/**
 * A view of `store` in which the nth write of a given (operation, type) throws.
 * Everything else passes straight through to the real store, so the state left
 * behind is exactly the state a crash at that point would leave.
 */
function faultyView(store, { op, type, nth }) {
  const counts = new Map();
  const view = Object.create(store);
  for (const name of ['put', 'putIfAbsent']) {
    view[name] = (...args) => {
      const key = `${name}:${args[0]}`;
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      if (name === op && args[0] === type && n === nth) throw new InjectedFailure(`${key} #${n}`);
      return store[name](...args);
    };
  }
  return view;
}

function keysOfType(store, type) { return [...store._dump().keys()].filter(k => k.split(':')[2] === type); }
function readAll(store, type) { return keysOfType(store, type).map(k => JSON.parse(store._dump().get(k))); }
function auditEvents(store) { return readAll(store, 'audit').map(a => a.event); }
function countEvent(store, event) { return auditEvents(store).filter(e => e === event).length; }

/** Submit, then return the pending row a reviewer would act on. */
async function submitAndList(service, body = submission()) {
  const received = await service.receiveIntake(body);
  const { submissions } = await service.listIntakeSubmissions(REVIEWER);
  const row = submissions.find(r => r.submission_reference === received.submission_reference);
  return { received, row };
}

/** The end state every completed promotion must converge on. */
function assertConverged(store, label) {
  assert.equal(keysOfType(store, 'org').length, 1, `${label}: exactly one organization`);
  assert.equal(keysOfType(store, 'case').length, 1, `${label}: exactly one case`);
  assert.equal(keysOfType(store, 'claim').length, 2, `${label}: exactly two claims`);
  assert.equal(keysOfType(store, 'evidence').length, 3, `${label}: exactly three evidence items`);
  assert.equal(keysOfType(store, 'intakeseed').length, 1, `${label}: still one seed`);
  assert.equal(keysOfType(store, 'intakereview').length, 1, `${label}: still one review`);

  const kase = readAll(store, 'case')[0];
  assert.equal(kase.status, 'INTAKE', `${label}: the case is still in INTAKE`);
  assert.ok(kase.primary_claim_id, `${label}: the case has its primary claim`);
  const claims = readAll(store, 'claim');
  assert.equal(claims.filter(c => c.is_primary).length, 1, `${label}: exactly one primary claim`);
  assert.equal(claims.filter(c => c.verification_status === 'UNVERIFIED').length, 2, `${label}: both claims UNVERIFIED`);

  const review = readAll(store, 'intakereview')[0];
  assert.equal(review.status, 'ACCEPTED', `${label}: the decision stands`);
  assert.equal(review.promotion_state, 'COMPLETE', `${label}: the promotion is complete`);
  assert.equal(review.resulting_case_id, kase.case_id, `${label}: the review links to the case`);
  assert.equal(review.resulting_organization_id, kase.organization_id, `${label}: and to the organization`);

  // Nothing concluded, at any point, on any path.
  for (const t of ['hypothesis', 'finding', 'challenge', 'approval', 'contradiction']) {
    assert.equal(keysOfType(store, t).length, 0, `${label}: no ${t}`);
  }
  // The audit says each thing happened once.
  assert.equal(countEvent(store, 'case.created'), 1, `${label}: one case.created`);
  assert.equal(countEvent(store, 'claim.created'), 2, `${label}: two claim.created`);
  assert.equal(countEvent(store, 'evidence.attached'), 3, `${label}: three evidence.attached`);
  assert.equal(countEvent(store, 'intake.promotion_completed'), 1, `${label}: one promotion_completed`);
  // Provenance inside the tenant survived, wherever the interruption fell.
  const orgScoped = readAll(store, 'audit').filter(a => a.event === 'intake.accepted' && a.organization_id);
  assert.equal(orgScoped.length, 1, `${label}: the case carries exactly one provenance entry`);
}

/** Index entries must be a set: a resumed attach must not double-list an id. */
function assertNoDuplicateIndexEntries(store, label) {
  for (const [key, raw] of store._dump()) {
    if (key.split(':')[2] !== 'index') continue;
    const entries = JSON.parse(raw).map(e => JSON.stringify(e));
    assert.equal(new Set(entries).size, entries.length, `${label}: index ${key} has a duplicate entry`);
  }
}

// The six boundaries, in the order the promotion reaches them.
const BOUNDARIES = [
  { label: 'before the Organization exists',        op: 'putIfAbsent', type: 'org',          nth: 1, expect: { org: 0, case: 0, claim: 0, evidence: 0 } },
  { label: 'after the Organization, before the Case', op: 'putIfAbsent', type: 'case',        nth: 1, expect: { org: 1, case: 0, claim: 0, evidence: 0 } },
  { label: 'after the Case, during the primary Claim', op: 'putIfAbsent', type: 'claim',      nth: 1, expect: { org: 1, case: 1, claim: 0, evidence: 0 } },
  { label: 'during the client-belief Claim',        op: 'putIfAbsent', type: 'claim',         nth: 2, expect: { org: 1, case: 1, claim: 1, evidence: 0 } },
  { label: 'part-way through the Evidence',         op: 'putIfAbsent', type: 'evidence',      nth: 2, expect: { org: 1, case: 1, claim: 2, evidence: 1 } },
  { label: 'at the final review linkage',           op: 'put',         type: 'intakereview',  nth: 2, expect: { org: 1, case: 1, claim: 2, evidence: 3 } }
];

// ─────────────────────────────────────────────────────────────────────────────

suite('intake recovery — a failure at any boundary is recoverable', () => {

  for (const b of BOUNDARIES) {
    test(`interrupted ${b.label}: the decision survives and the promotion resumes`, async () => {
      const store = freshStore();
      const service = createService(store);
      const { row } = await submitAndList(service);
      const seedBefore = store._dump().get(keysOfType(store, 'intakeseed')[0]);

      // The attempt that dies.
      const broken = createService(faultyView(store, b));
      const err = await assert.rejects(
        broken.decideIntake(REVIEWER, {
          intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version
        }),
        'injected_failure'
      );
      assert.ok(err, 'the failure surfaced to the caller');

      // What is left behind: the decision, durably, and exactly the objects that
      // had been written before the interruption.
      const mid = readAll(store, 'intakereview')[0];
      assert.equal(mid.status, 'ACCEPTED', 'the human decision is durable');
      assert.equal(mid.promotion_state, 'PENDING', 'and the work is marked unfinished');
      assert.ok(mid.promotion_plan, 'the plan was written down before anything was created');
      assert.equal(mid.resulting_case_id, null, 'a half-built promotion does not look finished');
      assert.ok(mid.promotion_last_error, 'why it stopped is recorded');
      for (const [type, n] of Object.entries(b.expect)) {
        assert.equal(keysOfType(store, type).length, n, `${type} count after the interruption`);
      }

      // Deciding again is refused — the human is not asked twice.
      await assert.rejects(
        service.decideIntake(REVIEWER, {
          intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: mid.version
        }),
        'promotion_incomplete'
      );

      // Resuming finishes it.
      const out = await service.resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id });
      assert.equal(out.resumed, true);
      assert.equal(out.case.status, 'INTAKE');
      assertConverged(store, b.label);
      assertNoDuplicateIndexEntries(store, b.label);

      // And the client's own words were never touched by any of it.
      assert.equal(store._dump().get(keysOfType(store, 'intakeseed')[0]), seedBefore, 'seed immutable throughout');
    });
  }

  test('a resumed promotion reuses the planned identifiers rather than minting new ones', async () => {
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);

    const broken = createService(faultyView(store, { op: 'putIfAbsent', type: 'evidence', nth: 2 }));
    await assert.rejects(broken.decideIntake(REVIEWER, {
      intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version
    }), 'injected_failure');

    const plan = readAll(store, 'intakereview')[0].promotion_plan;
    const out = await service.resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id });

    assert.equal(out.organization.org_id, plan.organization_id, 'organization landed on its planned id');
    assert.equal(out.case.case_id, plan.case_id, 'case landed on its planned id');
    assert.equal(out.primary_claim.claim_id, plan.primary_claim_id, 'primary claim landed on its planned id');
    assert.equal(out.belief_claim.claim_id, plan.belief_claim_id, 'belief claim landed on its planned id');
    assert.deepEqual(out.evidence.map(e => e.evidence_id), plan.evidence_ids, 'evidence landed on its planned ids');
    // Only the two that were missing were created on the resume.
    assert.equal(out.created.evidence, 2, 'the evidence item that already existed was not recreated');
    assert.equal(out.created.case, false, 'the case was not recreated');
    assert.equal(out.created.organization, false, 'the organization was not recreated');
  });

  test('a case left without its primary claim is completed, not duplicated', async () => {
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);

    const broken = createService(faultyView(store, { op: 'putIfAbsent', type: 'claim', nth: 1 }));
    await assert.rejects(broken.decideIntake(REVIEWER, {
      intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version
    }), 'injected_failure');

    const stranded = readAll(store, 'case')[0];
    assert.equal(stranded.primary_claim_id, null, 'the interrupted case has no primary claim yet');

    const out = await service.resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id });
    assert.equal(out.case.case_id, stranded.case_id, 'the same case was completed');
    assert.equal(out.case.primary_claim_id, out.primary_claim.claim_id, 'and now carries its claim');
    assert.equal(keysOfType(store, 'case').length, 1, 'no second case');
  });
});

suite('intake recovery — idempotency and concurrency', () => {

  /** Run two decisions genuinely in parallel and report what each one did. */
  async function race(service, intakeseed_id, version, a, b) {
    const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, code: e.code, message: e.message }));
    return Promise.all([
      settle(service.decideIntake(a.actor, { intakeseed_id, decision: a.decision, expected_version: version })),
      settle(service.decideIntake(b.actor, { intakeseed_id, decision: b.decision, expected_version: version }))
    ]);
  }

  // A — two ACCEPTs on the same version, issued concurrently.
  test('two concurrent ACCEPTs on the same version produce one decision and one case', async () => {
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);

    const [x, y] = await race(service, row.intakeseed_id, row.version,
      { actor: REVIEWER, decision: 'ACCEPTED' }, { actor: REVIEWER_B, decision: 'ACCEPTED' });

    const winners = [x, y].filter(r => r.ok);
    const losers = [x, y].filter(r => !r.ok);
    assert.equal(winners.length, 1, 'exactly one ACCEPT succeeded');
    assert.equal(losers.length, 1, 'exactly one was refused');
    // Which refusal you get depends on how the two calls interleave: the atomic
    // claim (decision_conflict) when they truly overlap, the version check or the
    // lifecycle check when one lands first. All three refuse before anything is built.
    assert.ok(['decision_conflict', 'version_conflict', 'invalid_state', 'promotion_incomplete'].includes(losers[0].code),
      `the loser was refused on the decision, got "${losers[0].code}"`);
    assert.equal(keysOfType(store, 'intakedecision').length, 1, 'exactly one decision marker exists');

    assert.equal(keysOfType(store, 'case').length, 1, 'one case');
    assert.equal(keysOfType(store, 'org').length, 1, 'one organization');
    assert.equal(keysOfType(store, 'claim').length, 2, 'two claims, not four');
    assert.equal(keysOfType(store, 'evidence').length, 3, 'three evidence items, not six');
    assert.equal(readAll(store, 'intakereview')[0].status, 'ACCEPTED');
  });

  // F — ACCEPT vs REJECT on the same version, issued concurrently, both orders.
  test('ACCEPT and REJECT racing on the same version: one wins, and a losing ACCEPT builds nothing', async () => {
    for (const [first, second] of [['ACCEPTED', 'REJECTED'], ['REJECTED', 'ACCEPTED']]) {
      const store = freshStore();
      const service = createService(store);
      const { row } = await submitAndList(service);

      const [x, y] = await race(service, row.intakeseed_id, row.version,
        { actor: REVIEWER, decision: first }, { actor: REVIEWER_B, decision: second });

      const winners = [x, y].filter(r => r.ok);
      assert.equal(winners.length, 1, `${first} vs ${second}: exactly one decision was recorded`);

      const review = readAll(store, 'intakereview')[0];
      const expectedObjects = review.status === 'ACCEPTED' ? 1 : 0;
      assert.equal(keysOfType(store, 'org').length, expectedObjects,
        `${first} vs ${second}: organizations match the decision that won (${review.status})`);
      assert.equal(keysOfType(store, 'case').length, expectedObjects,
        `${first} vs ${second}: cases match the decision that won`);
      if (review.status === 'REJECTED') {
        assert.equal(review.promotion_state, null, 'a rejection has no promotion at all');
      }
    }
  });

  // B–E are the boundary tests in the suite above; this pins the sequential form
  // of A, where the second caller can see the first one's decision.
  test('a second ACCEPT issued after the first has landed is refused on the decision', async () => {
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);
    const first = await service.decideIntake(REVIEWER, {
      intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version
    });
    await assert.rejects(
      service.decideIntake(REVIEWER_B, {
        intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version
      }),
      'invalid_state'
    );
    assert.equal(first.review.decided_by, REVIEWER.actor_id, 'the first reviewer owns the decision');
    assert.equal(keysOfType(store, 'case').length, 1, 'one case');
  });

  // G
  test('resuming an already-complete promotion is a no-op that reports the truth', async () => {
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);
    const done = await service.decideIntake(REVIEWER, {
      intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version
    });

    const before = JSON.stringify([...store._dump().entries()].map(([k]) => k).sort());
    const auditsBefore = readAll(store, 'audit').length;

    const again = await service.resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id });
    assert.equal(again.already_complete, true);
    assert.equal(again.resumed, false);
    assert.equal(again.case.case_id, done.case.case_id, 'it reports the case that exists');
    assert.equal(again.evidence.length, 3, 'and the evidence that exists');

    const after = JSON.stringify([...store._dump().entries()].map(([k]) => k).sort());
    assert.equal(after, before, 'not one new key was written');
    assert.equal(readAll(store, 'audit').length, auditsBefore, 'and not one new audit entry');

    // A third call behaves the same.
    const third = await service.resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id });
    assert.equal(third.already_complete, true);
    assert.equal(keysOfType(store, 'case').length, 1);
  });

  test('a completed promotion cannot be re-decided into a second case', async () => {
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);
    const done = await service.decideIntake(REVIEWER, {
      intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version
    });
    await assert.rejects(
      service.decideIntake(REVIEWER, {
        intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: done.review.version
      }),
      'invalid_state'
    );
    assert.equal(keysOfType(store, 'case').length, 1, 'still one case');
  });

  test('resume refuses on a rejected or undecided submission', async () => {
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);

    await assert.rejects(
      service.resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id }),
      'nothing_to_resume'
    );
    await service.decideIntake(REVIEWER, {
      intakeseed_id: row.intakeseed_id, decision: 'REJECTED', expected_version: row.version
    });
    await assert.rejects(
      service.resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id }),
      'nothing_to_resume'
    );
    assert.equal(keysOfType(store, 'org').length, 0, 'a rejected submission still builds nothing');
  });

  test('an AI actor cannot resume a promotion', async () => {
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);
    const broken = createService(faultyView(store, { op: 'putIfAbsent', type: 'case', nth: 1 }));
    await assert.rejects(broken.decideIntake(REVIEWER, {
      intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version
    }), 'injected_failure');

    await assert.rejects(
      service.resumeIntakePromotion(AI, { intakeseed_id: row.intakeseed_id }),
      'human_required'
    );
    assert.equal(keysOfType(store, 'case').length, 0, 'and it built nothing while being refused');
  });

  test('two failures in a row still converge on one case', async () => {
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);

    await assert.rejects(createService(faultyView(store, { op: 'putIfAbsent', type: 'case', nth: 1 }))
      .decideIntake(REVIEWER, { intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version }),
      'injected_failure');
    await assert.rejects(createService(faultyView(store, { op: 'putIfAbsent', type: 'evidence', nth: 2 }))
      .resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id }),
      'injected_failure');

    const mid = readAll(store, 'intakereview')[0];
    assert.equal(mid.promotion_attempts >= 2, true, 'both attempts are counted');
    assert.equal(mid.promotion_state, 'PENDING', 'still unfinished');

    const out = await service.resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id });
    assert.equal(out.resumed, true);
    assertConverged(store, 'two failures');
    assertNoDuplicateIndexEntries(store, 'two failures');
  });

  test('the epistemic mapping is identical whether the promotion ran straight through or resumed', async () => {
    const strip = o => {
      const c = JSON.parse(JSON.stringify(o));
      // Timestamps and identifiers differ between runs; the SEMANTICS must not.
      const drop = x => {
        if (Array.isArray(x)) return x.map(drop);
        if (x && typeof x === 'object') {
          const y = {};
          for (const [k, v] of Object.entries(x)) {
            if (/_id$|_at$|^version$|^updated_by|^submission_reference$|^original_source_reference$/.test(k)) continue;
            y[k] = drop(v);
          }
          return y;
        }
        return x;
      };
      return JSON.stringify(drop(c));
    };

    const clean = freshStore(); const cleanSvc = createService(clean);
    const a = await submitAndList(cleanSvc);
    const straight = await cleanSvc.decideIntake(REVIEWER, {
      intakeseed_id: a.row.intakeseed_id, decision: 'ACCEPTED', expected_version: a.row.version
    });

    const broken = freshStore(); const brokenSvc = createService(broken);
    const b = await submitAndList(brokenSvc);
    await assert.rejects(createService(faultyView(broken, { op: 'putIfAbsent', type: 'claim', nth: 2 }))
      .decideIntake(REVIEWER, { intakeseed_id: b.row.intakeseed_id, decision: 'ACCEPTED', expected_version: b.row.version }),
      'injected_failure');
    const resumed = await brokenSvc.resumeIntakePromotion(REVIEWER, { intakeseed_id: b.row.intakeseed_id });

    assert.equal(strip(resumed.case.metadata), strip(straight.case.metadata), 'case metadata identical');
    assert.equal(strip(resumed.primary_claim), strip(straight.primary_claim), 'primary claim identical');
    assert.equal(strip(resumed.belief_claim), strip(straight.belief_claim), 'belief claim identical');
    assert.equal(strip(resumed.evidence), strip(straight.evidence), 'evidence identical');
    assert.equal(resumed.case.status, 'INTAKE');
    assert.equal(straight.case.status, 'INTAKE');
  });

  test('recovery is auditable: the trail names the interruption and the resume', async () => {
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);
    await assert.rejects(createService(faultyView(store, { op: 'putIfAbsent', type: 'evidence', nth: 1 }))
      .decideIntake(REVIEWER, { intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version }),
      'injected_failure');
    await service.resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id });

    const events = auditEvents(store);
    assert.includes(events, 'intake.received');
    assert.includes(events, 'intake.accepted');
    assert.includes(events, 'intake.promotion_resumed');
    assert.includes(events, 'intake.promotion_completed');
    assert.equal(countEvent(store, 'intake.accepted'), 2, 'the decision, once in the holding area and once in the tenant');
    assert.equal(countEvent(store, 'intake.promotion_resumed'), 1);
    assert.equal(countEvent(store, 'intake.promotion_completed'), 1);

    const resume = readAll(store, 'audit').find(a => a.event === 'intake.promotion_resumed');
    assert.equal(resume.actor_type, 'human', 'a person resumed it');
    assert.ok(resume.details.previous_error, 'and the trail says what it is recovering from');
  });

  test('a store with no transactions is described honestly, not papered over', async () => {
    // The guarantee is convergence, not atomicity: each attempt moves strictly
    // closer to the planned end state. This test pins the property that makes that
    // true — every object the promotion will create has an address decided before
    // the first write, so a retry can recognise its own earlier work.
    const store = freshStore();
    const service = createService(store);
    const { row } = await submitAndList(service);
    await assert.rejects(createService(faultyView(store, { op: 'putIfAbsent', type: 'org', nth: 1 }))
      .decideIntake(REVIEWER, { intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED', expected_version: row.version }),
      'injected_failure');

    const plan = readAll(store, 'intakereview')[0].promotion_plan;
    assert.ok(plan.organization_id && plan.case_id && plan.primary_claim_id, 'ids exist before the objects do');
    assert.equal(plan.evidence_ids.length, 3, 'one per example');
    assert.equal(keysOfType(store, 'org').length, 0, 'and not one of them has been written yet');

    const out = await service.resumeIntakePromotion(REVIEWER, { intakeseed_id: row.intakeseed_id });
    assert.equal(out.organization.org_id, plan.organization_id);
    assert.equal(out.case.case_id, plan.case_id);
  });
});
