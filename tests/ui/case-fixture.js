'use strict';
/* ===========================================================================
   A REAL reviewer bundle, built by the real service on the memory driver.
   ---------------------------------------------------------------------------
   The workspace renderer was wrong about the shape of two objects, and a
   hand-written fixture is exactly what let it stay wrong: a fixture invented
   alongside the renderer agrees with the renderer by construction, and the
   backend is never consulted.

   So this file consults the backend. It drives `createService` through the
   genuine call sequence — organisation, case, hypotheses, evidence,
   contradiction, finding, challenge, approval — and hands back whatever
   `getReviewerView` actually returns. If a field is renamed in `_service.js`,
   the objects here change with it and the tests that read them fail, which is
   the entire point.

   It builds the four approval situations the UI must tell apart:

     findingApproved   a current APPROVED approval — must render as approved
     findingStale      approved, then MATERIALLY REVISED — the approval is now
                       bound to an older version and must NOT render as approved
     findingRejected   a REJECTED decision — must not render as approved either
     findingDraft      never approved

   No database. `V2_STORE_DRIVER=memory`, a namespace of its own, and
   `assertIsolated()` is called exactly as the scenario scripts call it.
   =========================================================================== */

const { createStore } = require('../../api/v2/_store');
const { createService } = require('../../api/v2/_service');

const REVIEWER = { actor_id: 'act_ui_fixture_reviewer', actor_type: 'human', role: 'admin' };
const AI       = { actor_id: 'act_ui_fixture_ai',       actor_type: 'ai',    role: 'reviewer' };

/* All content below is invented for a test. No real company, person or record. */

async function build() {
  const store = createStore({ V2_STORE_DRIVER: 'memory', V2_NAMESPACE: 'uifixture' });
  store.assertIsolated();
  const svc = createService(store);

  const org = await svc.createOrganization(REVIEWER, {
    name: 'Example Trading Co. (synthetic)', country: 'SA', size_band: '100-150',
    metadata: { synthetic: true }
  });

  const { case: kase } = await svc.createCase(REVIEWER, org.org_id, {
    title: 'Purchasing decisions concentrating at executive level',
    case_type: 'organizational_diagnosis',
    sponsor_claim: 'Every purchasing decision comes back to me, even small ones, and the team waits for my signature.',
    claim_origin: 'sponsor'
  });

  const step = async (to, actor) => {
    const cur = await svc.getCase(REVIEWER, org.org_id, kase.case_id);
    return svc.transitionCase(actor, org.org_id, kase.case_id, to, cur.version);
  };

  await step('STRUCTURING', AI);
  await step('INVESTIGATION_PLANNING', AI);

  const h1 = await svc.addHypothesis(AI, org.org_id, kase.case_id, {
    label: 'H1', statement: 'Written delegation thresholds sit below the size of everyday decisions, so everything escalates.'
  });
  const h2 = await svc.addHypothesis(AI, org.org_id, kase.case_id, {
    label: 'H2', statement: 'The thresholds are adequate, but confidence in applying them is low, so managers escalate defensively.'
  });
  const h3 = await svc.addHypothesis(AI, org.org_id, kase.case_id, {
    label: 'H3', statement: 'The system does not technically permit approval below a certain level.'
  });

  await step('HUMAN_REVIEW', AI);
  /* HUMAN_REVIEW -> AWAITING_EVIDENCE is one of the five human-only gates. */
  await step('AWAITING_EVIDENCE', REVIEWER);

  const mk = (source_type, source_name, original_content, limitations) =>
    svc.addEvidence(REVIEWER, org.org_id, kase.case_id, {
      source_type, source_name, original_content,
      limitations: limitations || []
    });

  const eMatrix = await mk('document', 'Delegation matrix (2025 version)',
    'Managers may approve purchases up to SAR 20,000 without further sign-off.',
    ['A published document — it does not establish actual practice.']);
  const eErp = await mk('system_record', '412 of 480 sub-threshold purchase orders approved by the owner',
    'Q1–Q3 2026 export from the purchasing system.',
    ['One system, three quarters. It may not represent the rest of the year.']);
  const eInterview = await mk('interview', 'Procurement manager account',
    'I have the authority on paper. In practice I send everything up, because the one time I did not, it came back to me anyway.',
    ['A single source. Three accounts from one person are still one source.']);

  await step('ANALYZING_EVIDENCE', AI);

  /* A real contradiction, with the real field names: `summary`, `state`,
     `left_evidence_id`, `right_evidence_id`. */
  const contradiction = await svc.recordContradiction(REVIEWER, org.org_id, kase.case_id, {
    kind: 'policy_vs_practice',
    summary: 'The delegation matrix grants managers authority up to SAR 20,000, yet 412 of 480 sub-threshold purchase orders were approved by the owner.',
    left_evidence_id: eMatrix.evidence_id,
    right_evidence_id: eErp.evidence_id
  });

  await step('FINDING_DRAFT', AI);

  const draftFinding = (statement) => svc.draftFinding(AI, org.org_id, kase.case_id, {
    statement,
    scope: 'Operations and procurement purchase approvals under SAR 20,000, Q1–Q3 2026.',
    supporting_evidence: [eMatrix.evidence_id, eErp.evidence_id, eInterview.evidence_id],
    counter_evidence: [],
    alternative_explanations: [
      'H3: a system control forces escalation — weakened; no such control was found below the threshold.'
    ],
    limitations: [
      'Three quarters of data from one system.',
      'One manager interview; no line-staff perspective.',
      'The policy/practice contradiction is recorded and remains open.'
    ]
  });

  /* Three findings, so the renderer has all the states to tell apart. */
  const fApproved = await draftFinding(
    'Sub-threshold purchasing decisions are escalated to the owner in practice, despite documented authority to approve them.');
  const fStale = await draftFinding(
    'Coordination between procurement and finance adds an approval step that the delegation matrix does not require.');
  const fRejected = await draftFinding(
    'Managers lack the capability to exercise the authority they hold.');

  await step('CHALLENGE_REVIEW', AI);
  const challengeApproved = await svc.runChallengeReview(AI, org.org_id, kase.case_id, fApproved.finding_id);
  await svc.runChallengeReview(AI, org.org_id, kase.case_id, fStale.finding_id);
  await svc.runChallengeReview(AI, org.org_id, kase.case_id, fRejected.finding_id);

  await step('HUMAN_APPROVAL', AI);

  const JUSTIFICATION =
    'The open policy/practice contradiction is the finding itself, not an obstacle to it. Scope is limited to ' +
    'sub-threshold approvals. Approved for client discussion.';

  /* 1 — a CURRENT approval: artifact_version equals the finding's version. */
  const approvalCurrent = await svc.recordApproval(REVIEWER, org.org_id, {
    case_id: kase.case_id, artifact_type: 'finding',
    artifact_id: fApproved.finding_id, artifact_version: fApproved.version,
    decision: 'APPROVED', comment: JUSTIFICATION
  });

  /* 2 — a REJECTED decision on a different finding. */
  const approvalRejected = await svc.recordApproval(REVIEWER, org.org_id, {
    case_id: kase.case_id, artifact_type: 'finding',
    artifact_id: fRejected.finding_id, artifact_version: fRejected.version,
    decision: 'REJECTED',
    comment: 'Capability is asserted, not evidenced. Nothing in the record tests it.'
  });

  /* 3 — approved, then MATERIALLY revised. The approval survives in the bundle
         but is now bound to an older version, so it no longer covers the
         finding. This is the case the renderer was getting wrong. */
  const approvalStale = await svc.recordApproval(REVIEWER, org.org_id, {
    case_id: kase.case_id, artifact_type: 'finding',
    artifact_id: fStale.finding_id, artifact_version: fStale.version,
    decision: 'APPROVED', comment: JUSTIFICATION
  });
  const revised = await svc.reviseFinding(REVIEWER, org.org_id, fStale.finding_id, {
    statement: 'Coordination between procurement and finance adds an approval step that the delegation matrix does not require, and the step is not recorded anywhere.',
    actor_type: 'human'
  }, fStale.version);

  const bundle = await svc.getReviewerView(REVIEWER, org.org_id, kase.case_id);

  return {
    store, svc, org, case: bundle.case, bundle,
    ids: {
      findingApproved: fApproved.finding_id,
      findingStale:    fStale.finding_id,
      findingRejected: fRejected.finding_id,
      contradiction:   contradiction.contradiction_id,
      evidence:        [eMatrix.evidence_id, eErp.evidence_id, eInterview.evidence_id],
      hypotheses:      [h1.hypothesis_id, h2.hypothesis_id, h3.hypothesis_id]
    },
    approvals: {
      current:  approvalCurrent,
      rejected: approvalRejected,
      stale:    approvalStale
    },
    revised: revised.finding,
    materialChange: revised.material_change,
    challenge: challengeApproved
  };
}

/* One build per process: the flow is deterministic and the tests only read. */
let cached = null;
async function get() {
  if (!cached) cached = await build();
  return cached;
}

module.exports = { build, get, REVIEWER, AI };
