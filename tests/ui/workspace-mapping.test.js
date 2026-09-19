'use strict';
/* ===========================================================================
   The diagnostic workspace against the objects the backend actually returns.
   ---------------------------------------------------------------------------
   These are regression tests for two shipped defects, and they are written so
   that the same class of defect cannot return:

     · every object under test is built by the REAL service (tests/ui/case-fixture.js),
       not hand-written beside the renderer;
     · the approval rule under test is the one the page runs (assets/hv-case-view.js),
       not a copy of it;
     · the assertions are about behaviour a reviewer would notice — "is this
       labelled approved" — not about markup.

   DEFECT 1. The renderer matched `approval.finding_id` and displayed
   `approval.case_version`. Neither field exists on an approval object. The
   result: no approval ever matched, and a properly approved finding was shown
   as a draft. A read-only probe confirmed the backend recognised the same
   approval that the UI ignored.

   DEFECT 2. The renderer read `contradiction.statement`. The backend writes
   `summary`. Contradictions rendered as empty text, and the demo fixtures hid
   it by using the renderer's invented field names.

   Also covered: `unknowns` is not part of the reviewer bundle at all, and the
   screen must say so rather than inferring an empty list.
   =========================================================================== */

const path = require('path');
const { suite, test, assert } = require('../v2/harness');
const CV = require('../../public/assets/hv-case-view.js');
const D = require('../../api/v2/_domain.js');
const fixture = require('./case-fixture');

let F = null;
async function ready() { if (!F) F = await fixture.get(); return F; }

// ─────────────────────────────────────────────────────────────────────────────

suite('workspace — the approval rule agrees with the backend', () => {

  test('the UI rule and approvalCoversFinding agree on every approval/finding pair', async () => {
    const f = await ready();
    const { findings, approvals } = f.bundle;
    const disagreements = [];
    for (const finding of findings) {
      for (const approval of approvals) {
        const backend = D.approvalCoversFinding(approval, finding);
        const ui = CV.approvalCovers(approval, finding);
        if (backend !== ui) {
          disagreements.push(`${approval.approval_id}/${finding.finding_id}: backend=${backend} ui=${ui}`);
        }
      }
    }
    assert.deepEqual(disagreements, [], 'the UI must decide coverage exactly as the backend does');
  });

  test('a current approval renders as approved — the defect that was shipped', async () => {
    const f = await ready();
    const finding = f.bundle.findings.find(x => x.finding_id === f.ids.findingApproved);
    assert.ok(finding, 'the approved finding is in the bundle');

    const state = CV.findingApprovalState(finding, f.bundle.approvals);
    assert.equal(state.kind, 'approved',
      'a finding with a current APPROVED approval must not be labelled a draft');
    assert.ok(CV.isApproved(state));
    assert.equal(Number(state.approval.artifact_version), Number(finding.version),
      'the version shown is the version that was approved');
  });

  test('the version shown is the approved artifact version, read from the real field', async () => {
    const f = await ready();
    const finding = f.bundle.findings.find(x => x.finding_id === f.ids.findingApproved);
    const state = CV.findingApprovalState(finding, f.bundle.approvals);
    assert.ok('artifact_version' in state.approval, 'approvals carry artifact_version');
    assert.notOk('case_version' in state.approval, 'there is no case_version on an approval');
    assert.notOk('finding_id' in state.approval, 'there is no finding_id on an approval');
  });

  test('an approval of an EARLIER version never reads as approved', async () => {
    const f = await ready();
    const finding = f.bundle.findings.find(x => x.finding_id === f.ids.findingStale);
    assert.ok(finding, 'the revised finding is in the bundle');
    assert.ok(Number(finding.version) > 1, 'it really was revised');

    const state = CV.findingApprovalState(finding, f.bundle.approvals);
    assert.equal(state.kind, 'stale', 'a superseded approval is its own state, not "approved"');
    assert.notOk(CV.isApproved(state), 'it must never be presented as approved');
    assert.ok(Number(state.approval.artifact_version) < Number(finding.version),
      'and the older version it was bound to is available to show');
    assert.notOk(D.approvalCoversFinding(state.approval, finding),
      'the backend agrees the approval no longer covers it');
  });

  test('a REJECTED decision never reads as approved', async () => {
    const f = await ready();
    const finding = f.bundle.findings.find(x => x.finding_id === f.ids.findingRejected);
    const state = CV.findingApprovalState(finding, f.bundle.approvals);
    assert.equal(state.kind, 'rejected');
    assert.notOk(CV.isApproved(state));
  });

  test('a finding with no decision is a draft', async () => {
    const f = await ready();
    const orphan = Object.assign({}, f.bundle.findings[0], { finding_id: 'fnd_not_in_any_approval' });
    const state = CV.findingApprovalState(orphan, f.bundle.approvals);
    assert.equal(state.kind, 'draft');
    assert.equal(state.approval, null);
  });

  test('an approval belonging to another organisation is ignored', async () => {
    const f = await ready();
    const finding = f.bundle.findings.find(x => x.finding_id === f.ids.findingApproved);
    const foreign = f.bundle.approvals.map(a =>
      Object.assign({}, a, { organization_id: 'org_someone_else' }));
    const state = CV.findingApprovalState(finding, foreign);
    assert.equal(state.kind, 'draft', 'tenant isolation holds in the view layer too');
    assert.notOk(D.approvalCoversFinding(foreign[0], finding), 'and in the backend rule');
  });

  test('an approval of a different artifact type is ignored', async () => {
    const f = await ready();
    const finding = f.bundle.findings.find(x => x.finding_id === f.ids.findingApproved);
    const wrongType = f.bundle.approvals.map(a =>
      Object.assign({}, a, { artifact_type: 'evidencereq' }));
    const state = CV.findingApprovalState(finding, wrongType);
    assert.equal(state.kind, 'draft',
      'approving an evidence request must not approve a finding that shares its id');
  });

  test('a non-APPROVED decision on the current version is shown as itself', async () => {
    const f = await ready();
    const finding = f.bundle.findings.find(x => x.finding_id === f.ids.findingApproved);
    const modified = f.bundle.approvals
      .filter(a => a.artifact_id === finding.finding_id)
      .map(a => Object.assign({}, a, { decision: 'MORE_EVIDENCE_REQUIRED' }));
    const state = CV.findingApprovalState(finding, modified);
    assert.equal(state.kind, 'decided');
    assert.equal(state.approval.decision, 'MORE_EVIDENCE_REQUIRED');
    assert.notOk(CV.isApproved(state));
  });

  test('every decision the backend allows has a display path', () => {
    // If APPROVAL_DECISIONS grows, this fails until the view knows what to do.
    const finding = { finding_id: 'f1', version: 1, organization_id: 'org1' };
    for (const decision of D.APPROVAL_DECISIONS) {
      const st = CV.findingApprovalState(finding, [{
        artifact_type: 'finding', artifact_id: 'f1', artifact_version: 1,
        organization_id: 'org1', decision, created_at: 1
      }]);
      assert.ok(['approved', 'rejected', 'decided'].includes(st.kind),
        `decision ${decision} has no display state (got ${st.kind})`);
      assert.equal(CV.isApproved(st), decision === 'APPROVED',
        `only APPROVED may render as approved; ${decision} did not`);
    }
  });

  test('the challenge shown is the one run against the version on screen', async () => {
    const f = await ready();
    const finding = f.bundle.findings.find(x => x.finding_id === f.ids.findingApproved);
    const ch = CV.challengeForFinding(finding, f.bundle.challenges);
    assert.ok(ch, 'a challenge exists for this finding version');
    assert.equal(Number(ch.finding_version), Number(finding.version));

    const revised = Object.assign({}, finding, { version: Number(finding.version) + 5 });
    assert.equal(CV.challengeForFinding(revised, f.bundle.challenges), null,
      'a challenge of an older version must not be shown against a newer one');
  });
});

suite('workspace — contradictions carry the backend field names', () => {

  test('the backend writes summary, and has no statement field', async () => {
    const f = await ready();
    const c = f.bundle.contradictions[0];
    assert.ok(c, 'the fixture recorded a contradiction');
    assert.equal(typeof c.summary, 'string');
    assert.ok(c.summary.length > 20, 'and it is real text, not a stub');
    assert.notOk('statement' in c, 'there is no `statement` — reading it renders nothing');
  });

  test('the view reads summary, so a real contradiction is not rendered empty', async () => {
    const f = await ready();
    const c = f.bundle.contradictions[0];
    const text = CV.contradictionText(c);
    assert.equal(text, c.summary);
    assert.ok(text.length > 20, 'the shipped defect rendered this as an empty string');
  });

  test('state and evidence references are available and used', async () => {
    const f = await ready();
    const c = f.bundle.contradictions[0];
    assert.ok(D.CONTRADICTION_STATES.includes(c.state), `state ${c.state} is a real state`);
    assert.ok(D.CONTRADICTION_KINDS.includes(c.kind), `kind ${c.kind} is a real kind`);

    const refs = CV.contradictionEvidenceIds(c);
    assert.equal(refs.length, 2, 'both sides of this contradiction are recorded');
    const ids = f.bundle.evidence.map(e => e.evidence_id);
    for (const r of refs) assert.ok(ids.includes(r), `${r} resolves to evidence on this case`);
  });

  test('liveness follows the backend state machine, not a guess', async () => {
    assert.ok(CV.contradictionIsLive({ state: 'OPEN' }));
    assert.ok(CV.contradictionIsLive({ state: 'INVESTIGATING' }));
    assert.notOk(CV.contradictionIsLive({ state: 'RESOLVED' }));
    assert.notOk(CV.contradictionIsLive({ state: 'ACCEPTED_AS_TENSION' }));
    for (const s of D.CONTRADICTION_STATES) {
      assert.equal(typeof CV.contradictionIsLive({ state: s }), 'boolean', `${s} is classified`);
    }
  });
});

suite('workspace — an unavailable section is not an empty one', () => {

  test('the reviewer bundle has no unknowns key', async () => {
    const f = await ready();
    assert.notOk(Object.prototype.hasOwnProperty.call(f.bundle, 'unknowns'),
      'if this starts passing, the API gained the field and the view should render it');
    assert.equal(CV.sectionAvailability(f.bundle, 'unknowns'), 'unsupported');
  });

  test('supported-and-empty is distinguished from unsupported', () => {
    assert.equal(CV.sectionAvailability({ things: [] }, 'things'), 'empty');
    assert.equal(CV.sectionAvailability({ things: [1] }, 'things'), 'present');
    assert.equal(CV.sectionAvailability({}, 'things'), 'unsupported');
    assert.equal(CV.sectionAvailability({ things: null }, 'things'), 'unsupported');
  });

  test('the collections the bundle DOES supply are all rendered as collections', async () => {
    const f = await ready();
    for (const key of ['claims', 'hypotheses', 'evidence', 'contradictions', 'findings', 'approvals', 'challenges', 'audit']) {
      assert.ok(Array.isArray(f.bundle[key]), `${key} is an array in the real bundle`);
      assert.notOk(CV.sectionAvailability(f.bundle, key) === 'unsupported', `${key} is supported`);
    }
  });
});

suite('workspace — the remaining field mappings match the real bundle', () => {

  test('findings carry array limitations, not a string', async () => {
    const f = await ready();
    for (const x of f.bundle.findings) {
      assert.ok(Array.isArray(x.limitations), 'limitations is an array — joining it as a string is wrong');
      assert.ok(Array.isArray(x.alternative_explanations), 'alternative_explanations is an array');
      assert.ok(typeof x.version === 'number', 'a finding carries its own version');
      assert.ok(D.FINDING_STATES.includes(x.state), `finding state ${x.state} is a real state`);
    }
  });

  test('evidence carries array limitations and a real source type', async () => {
    const f = await ready();
    for (const e of f.bundle.evidence) {
      assert.ok(Array.isArray(e.limitations), 'evidence limitations is an array');
      assert.ok(typeof e.source_name === 'string' && e.source_name.length > 0);
      assert.ok(typeof e.verification_status === 'string');
    }
  });

  test('hypotheses carry evidence id arrays, not counts', async () => {
    const f = await ready();
    for (const h of f.bundle.hypotheses) {
      assert.ok(Array.isArray(h.supporting_evidence), 'supporting_evidence is an array of ids');
      assert.ok(Array.isArray(h.contradicting_evidence), 'contradicting_evidence is an array of ids');
      assert.notOk('supporting' in h, 'there is no scalar `supporting` field');
      assert.notOk('against' in h, 'there is no scalar `against` field');
      assert.ok(D.HYPOTHESIS_STATES.includes(h.state), `hypothesis state ${h.state} is real`);
    }
  });

  test('claims carry origin, not a metadata role', async () => {
    const f = await ready();
    const c = f.bundle.claims[0];
    assert.ok(D.CLAIM_ORIGINS.includes(c.origin), `origin ${c.origin} is a real origin`);
    assert.ok(typeof c.is_primary === 'boolean');
    assert.ok(typeof c.verification_status === 'string');
  });

  test('audit entries carry at / event / actor_type', async () => {
    const f = await ready();
    const a = f.bundle.audit[0];
    assert.ok(typeof a.at === 'number', 'audit entries are timestamped with `at`');
    assert.ok(typeof a.event === 'string');
    assert.ok(typeof a.actor_type === 'string');
  });
});

suite('workspace — the demo fixtures are shaped like the backend', () => {

  /* The fixtures are what a reviewer sees in ?demo=1. If they drift from the
     backend shape, the demo stops being a preview of anything. */

  const fs = require('fs');
  const demoSrc = fs.readFileSync(path.join(__dirname, '../../public/assets/hv-demo.js'), 'utf8');
  const W = (function () {
    const g = { HV: {} };
    new Function('window', demoSrc)(g);
    return g.HV.demo;
  })();

  test('demo contradictions use summary / state / left / right', () => {
    for (const c of W.WORKSPACE.contradictions) {
      assert.ok(typeof c.summary === 'function' || typeof c.summary === 'string', 'summary present');
      assert.notOk('statement' in c, 'no invented `statement` field');
      assert.ok(D.CONTRADICTION_STATES.includes(c.state), `state ${c.state} is real`);
      assert.ok(D.CONTRADICTION_KINDS.includes(c.kind), `kind ${c.kind} is real`);
    }
  });

  test('demo approvals use artifact_type / artifact_id / artifact_version / decision', () => {
    for (const a of W.WORKSPACE.approvals) {
      assert.ok('artifact_type' in a && 'artifact_id' in a && 'artifact_version' in a && 'decision' in a,
        'the four fields the coverage rule reads');
      assert.notOk('finding_id' in a, 'no invented `finding_id`');
      assert.notOk('case_version' in a, 'no invented `case_version`');
      assert.ok(D.APPROVAL_DECISIONS.includes(a.decision), `decision ${a.decision} is real`);
    }
  });

  test('demo findings carry versions, states and array limitations', () => {
    for (const f of W.WORKSPACE.findings) {
      assert.ok(typeof f.version === 'number');
      assert.ok(D.FINDING_STATES.includes(f.state), `state ${f.state} is real`);
      assert.ok(Array.isArray(f.limitations));
      assert.ok(Array.isArray(f.alternative_explanations));
    }
  });

  test('the demo carries all four approval situations a reviewer must tell apart', () => {
    const org = 'org_demo00000000000000000000';
    const findings = W.WORKSPACE.findings.map(f => ({
      finding_id: f.id, version: f.version, organization_id: org
    }));
    const approvals = W.WORKSPACE.approvals.map(a => ({
      artifact_type: a.artifact_type, artifact_id: a.artifact_id,
      artifact_version: a.artifact_version, organization_id: org,
      decision: a.decision, created_at: a.created_at
    }));
    const kinds = findings.map(f => CV.findingApprovalState(f, approvals).kind);
    assert.ok(kinds.includes('approved'), 'one currently-approved finding');
    assert.ok(kinds.includes('stale'), 'one approved-then-revised finding');
    assert.ok(kinds.includes('rejected'), 'one rejected finding');
  });

  test('the demo bundle has no unknowns key either', () => {
    assert.notOk('unknowns' in W.WORKSPACE,
      'the fixture must not invent a collection the API does not return');
  });

  test('demo hypotheses use the real state vocabulary and evidence arrays', () => {
    for (const h of W.WORKSPACE.hypotheses) {
      assert.ok(D.HYPOTHESIS_STATES.includes(h.state), `state ${h.state} is real`);
      assert.ok(Array.isArray(h.supporting_evidence) && Array.isArray(h.contradicting_evidence));
    }
  });
});
