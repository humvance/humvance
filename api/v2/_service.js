'use strict';
// Humvance V2 — application service. Composes the pure domain rules with storage,
// so that every rule is enforced in exactly one place and can be tested without a
// server, a network or a database.
//
// HTTP lives in case.js and does nothing but parse, call in here, and map errors.

const D = require('./_domain');
const { runChallenge } = require('./_challenge');
const { scanUntrusted, splitSourceAndInterpretation } = require('./_untrusted');
const { createRepo, RepoError, idx } = require('./_repo');

function fail(code, message, status = 400) { throw new RepoError(code, message, status); }

function createService(store) {
  const repo = createRepo(store);

  const actorOf = (principal) => ({
    actor_id: principal.actor_id,
    actor_type: principal.actor_type,
    role: principal.role
  });

  // ── Organization ───────────────────────────────────────────────────────────

  async function createOrganization(principal, { name, country = null, size_band = null, metadata = {} }) {
    if (typeof name !== 'string' || !name.trim()) fail('invalid_name', 'organization name is required');
    const actor = actorOf(principal);
    const now = Date.now();
    const { newId } = require('./_ids');
    const org_id = newId('org');
    const org = {
      org_id, organization_id: org_id,       // self-scoped, so the tenant check is uniform
      name: name.trim().slice(0, 200), country, size_band,
      created_at: now, created_by: actor.actor_id, created_by_type: actor.actor_type,
      updated_at: now, updated_by: actor.actor_id, updated_by_type: actor.actor_type,
      version: 1, metadata
    };
    if (!await store.putIfAbsent('org', org_id, org)) fail('id_collision', 'identifier collision', 500);
    return org;
  }

  async function getOrganization(principal, organization_id) {
    return repo.readScoped('org', organization_id, organization_id);
  }

  // ── Case + primary Claim ───────────────────────────────────────────────────

  async function createCase(principal, organization_id, { title, case_type, sponsor_claim, claim_origin = 'sponsor', legacy_source_ref = null, metadata = {} }) {
    if (typeof title !== 'string' || !title.trim()) fail('invalid_title', 'title is required');
    if (typeof sponsor_claim !== 'string' || !sponsor_claim.trim()) fail('invalid_claim', 'sponsor_claim is required');
    if (!D.CLAIM_ORIGINS.includes(claim_origin)) fail('invalid_claim_origin', `claim_origin must be one of ${D.CLAIM_ORIGINS.join(', ')}`);
    const actor = actorOf(principal);

    const kase = await repo.createObject('case', 'case', organization_id, actor, {
      case_type: String(case_type || 'organizational_diagnosis').slice(0, 64),
      title: title.trim().slice(0, 200),
      status: 'INTAKE',
      client_visible_status: D.clientStatusFor('INTAKE'),
      primary_claim_id: null,
      assigned_reviewer: null,
      approved_finding_id: null,
      approved_finding_version: null,
      engagement_id: null,
      legacy_source_ref,                 // forward hook for V1 migration; never trusted
      metadata
    });

    // The sponsor's account is recorded as a CLAIM, unverified. It is the thing to
    // be investigated, not the conclusion. This single decision is what separates
    // Humvance from a questionnaire that repeats back what the owner already said.
    const claim = await repo.createObject('claim', 'claim', organization_id, actor, {
      case_id: kase.case_id,
      statement: sponsor_claim.trim().slice(0, 2000),
      origin: claim_origin,
      verification_status: 'UNVERIFIED',
      is_primary: true,
      supporting_evidence: [],
      contradicting_evidence: [],
      metadata: {}
    });

    kase.primary_claim_id = claim.claim_id;
    kase.version = 2;
    kase.updated_at = Date.now();
    await store.put('case', kase.case_id, kase);

    await repo.attachToIndex(idx.orgCases(organization_id), kase.case_id);
    await repo.attachToIndex(idx.caseClaims(kase.case_id), claim.claim_id);

    await repo.audit('case.created', {
      organization_id, case_id: kase.case_id, actor,
      subject_type: 'case', subject_id: kase.case_id,
      summary: `Case opened: ${kase.title}`,
      details: { case_type: kase.case_type, primary_claim_id: claim.claim_id }
    });
    await repo.audit('claim.created', {
      organization_id, case_id: kase.case_id, actor,
      subject_type: 'claim', subject_id: claim.claim_id,
      summary: 'Primary sponsor claim recorded as UNVERIFIED',
      details: { origin: claim_origin }
    });

    return { case: kase, primary_claim: claim };
  }

  async function getCase(principal, organization_id, case_id) {
    return repo.readScoped('case', case_id, organization_id);
  }

  async function transitionCase(principal, organization_id, case_id, to_state, expected_version) {
    const actor = actorOf(principal);
    const current = await repo.readScoped('case', case_id, organization_id);
    if (!current) fail('not_found', 'case not found', 404);

    const verdict = D.canTransition(current.status, to_state, actor.actor_type);
    if (!verdict.ok) {
      await repo.audit('security.rejected', {
        organization_id, case_id, actor, subject_type: 'case', subject_id: case_id,
        summary: `Rejected transition ${current.status} -> ${to_state}`,
        details: { code: verdict.code, reason: verdict.error }
      });
      fail(verdict.code, verdict.error, verdict.code === 'human_required' ? 403 : 409);
    }

    // Entering APPROVED is not a state change, it is the consequence of a decision.
    // The decision must already exist, must be a human's, and must bind to the
    // exact version of the finding on the table.
    if (to_state === 'APPROVED') {
      const bundle = await repo.loadCaseBundle(case_id, organization_id);
      const finding = bundle.findings.find(f => f.finding_id === current.pending_finding_id) ||
                      bundle.findings.slice().sort((a, b) => b.updated_at - a.updated_at)[0];
      if (!finding) fail('no_finding', 'cannot approve a case with no finding', 409);
      const covering = bundle.approvals.find(a => D.approvalCoversFinding(a, finding));
      if (!covering) {
        await repo.audit('security.rejected', {
          organization_id, case_id, actor, subject_type: 'case', subject_id: case_id,
          summary: 'Rejected APPROVED: no human approval covers the current finding version',
          details: { finding_id: finding.finding_id, finding_version: finding.version }
        });
        fail('approval_required',
          `no human approval covers finding ${finding.finding_id} version ${finding.version}`, 409);
      }
      current.approved_finding_id = finding.finding_id;
      current.approved_finding_version = finding.version;
    }

    if (current.status === 'APPROVED' && to_state === 'FINDING_DRAFT') {
      // A superseding revision has opened. The previous approval stays in the audit
      // trail but stops being the Case's answer.
      current.approved_finding_id = null;
      current.approved_finding_version = null;
    }

    const next = await repo.updateObject('case', case_id, organization_id, actor, expected_version, async draft => {
      draft.status = to_state;
      draft.client_visible_status = D.clientStatusFor(to_state);
      draft.approved_finding_id = current.approved_finding_id;
      draft.approved_finding_version = current.approved_finding_version;
      return draft;
    });

    await repo.audit('case.state_changed', {
      organization_id, case_id, actor, subject_type: 'case', subject_id: case_id,
      summary: `${current.status} -> ${to_state}`,
      details: { from: current.status, to: to_state, client_visible_status: next.client_visible_status }
    });
    return next;
  }

  // ── Hypotheses ─────────────────────────────────────────────────────────────

  async function addHypothesis(principal, organization_id, case_id, { label, statement, metadata = {} }) {
    const actor = actorOf(principal);
    const kase = await repo.readScoped('case', case_id, organization_id);
    if (!kase) fail('not_found', 'case not found', 404);
    if (typeof statement !== 'string' || !statement.trim()) fail('invalid_statement', 'statement is required');

    const h = await repo.createObject('hypothesis', 'hypothesis', organization_id, actor, {
      case_id,
      label: String(label || '').slice(0, 40) || null,
      statement: statement.trim().slice(0, 1000),
      state: 'PROPOSED',
      supporting_evidence: [],
      contradicting_evidence: [],
      missing_evidence: [],
      disconfirming_tests: [],
      metadata
    });
    await repo.attachToIndex(idx.caseHypotheses(case_id), h.hypothesis_id);
    await repo.audit('hypothesis.created', {
      organization_id, case_id, actor, subject_type: 'hypothesis', subject_id: h.hypothesis_id,
      summary: `Hypothesis proposed${h.label ? ` (${h.label})` : ''}`,
      details: { state: 'PROPOSED' }
    });
    return h;
  }

  async function setHypothesisState(principal, organization_id, hypothesis_id, to_state, expected_version, { because = '' } = {}) {
    const actor = actorOf(principal);
    const current = await repo.readScoped('hypothesis', hypothesis_id, organization_id);
    if (!current) fail('not_found', 'hypothesis not found', 404);
    if (!D.canHypothesisTransition(current.state, to_state)) {
      fail('invalid_transition', `hypothesis ${current.state} -> ${to_state} is not allowed`, 409);
    }
    const next = await repo.updateObject('hypothesis', hypothesis_id, organization_id, actor, expected_version,
      async draft => { draft.state = to_state; return draft; });
    await repo.audit('hypothesis.state_changed', {
      organization_id, case_id: current.case_id, actor,
      subject_type: 'hypothesis', subject_id: hypothesis_id,
      summary: `${current.state} -> ${to_state}`,
      details: { from: current.state, to: to_state, because: String(because).slice(0, 300) }
    });
    return next;
  }

  // ── Evidence ───────────────────────────────────────────────────────────────

  async function addEvidence(principal, organization_id, case_id, input) {
    const actor = actorOf(principal);
    const kase = await repo.readScoped('case', case_id, organization_id);
    if (!kase) fail('not_found', 'case not found', 404);
    if (!D.EVIDENCE_SOURCE_TYPES.includes(input.source_type)) {
      fail('invalid_source_type', `source_type must be one of ${D.EVIDENCE_SOURCE_TYPES.join(', ')}`);
    }
    if (typeof input.source_name !== 'string' || !input.source_name.trim()) {
      fail('invalid_source_name', 'source_name is required — evidence without provenance is not evidence');
    }
    if (typeof input.original_content !== 'string' || !input.original_content.trim()) {
      fail('invalid_content', 'original_content is required');
    }

    // Submitted content is untrusted. Scan it, record what the scan found, and
    // store the text unmodified — editing a client's document would destroy the
    // provenance the finding will later rest on.
    const scan = scanUntrusted(input.original_content);
    const split = splitSourceAndInterpretation(input);

    const e = await repo.createObject('evidence', 'evidence', organization_id, actor, {
      case_id,
      source_type: input.source_type,
      source_name: input.source_name.trim().slice(0, 200),
      source_date: input.source_date || null,
      submitted_by: String(input.submitted_by || actor.actor_id).slice(0, 200),
      original_source_reference: input.original_source_reference || null,
      original_content: split.original_content,
      ai_extraction: split.ai_extraction,
      ai_interpretation: split.ai_interpretation,
      provenance_note: split.provenance_note,
      verification_status: 'UNVERIFIED',
      limitations: Array.isArray(input.limitations) ? input.limitations.slice(0, 20) : [],
      related_claims: [], related_hypotheses: [], related_findings: [],
      untrusted_scan: scan,
      metadata: input.metadata || {}
    });
    await repo.attachToIndex(idx.caseEvidence(case_id), e.evidence_id);

    await repo.audit('evidence.attached', {
      organization_id, case_id, actor, subject_type: 'evidence', subject_id: e.evidence_id,
      summary: `Evidence attached from ${e.source_type}: ${e.source_name}`,
      details: { source_type: e.source_type, self_report: D.isSelfReport(e.source_type), scan_flags: scan.flags }
    });
    if (!scan.clean) {
      // An injection attempt inside a client document is a finding about the
      // document, and the reviewer should see it.
      await repo.audit('security.rejected', {
        organization_id, case_id, actor, subject_type: 'evidence', subject_id: e.evidence_id,
        summary: 'Submitted content contains instruction-shaped text; stored as untrusted data and not acted upon',
        details: { flags: scan.flags, hidden_characters: scan.hidden_characters }
      });
    }
    return e;
  }

  /**
   * Update evidence through the allow-list only. The fields a reviewer may change
   * are the ones ABOUT the evidence — its verification status and known
   * limitations. original_content is not in the list and never will be: correcting
   * a source would destroy the provenance a finding rests on. A correction is new
   * evidence, not an edit.
   */
  async function updateEvidence(principal, organization_id, evidence_id, patch, expected_version) {
    const actor = actorOf(principal);
    const v = D.validateUpdate('evidence', patch);
    if (!v.ok) fail(v.code, v.error, 400);
    if (patch.verification_status && !D.EVIDENCE_VERIFICATION.includes(patch.verification_status)) {
      fail('invalid_verification_status', `verification_status must be one of ${D.EVIDENCE_VERIFICATION.join(', ')}`);
    }
    const before = await repo.readScoped('evidence', evidence_id, organization_id);
    if (!before) fail('not_found', 'evidence not found', 404);

    const after = await repo.updateObject('evidence', evidence_id, organization_id, actor, expected_version,
      async draft => { for (const k of v.fields) draft[k] = patch[k]; return draft; });

    await repo.audit('evidence.updated', {
      organization_id, case_id: before.case_id, actor,
      subject_type: 'evidence', subject_id: evidence_id,
      summary: `Evidence updated (${v.fields.join(', ')})`,
      details: { fields: v.fields, verification_status: after.verification_status }
    });
    return after;
  }

  // ── Contradictions ─────────────────────────────────────────────────────────

  async function recordContradiction(principal, organization_id, case_id, { kind, summary, left_evidence_id, right_evidence_id, metadata = {} }) {
    const actor = actorOf(principal);
    if (!D.CONTRADICTION_KINDS.includes(kind)) fail('invalid_kind', `kind must be one of ${D.CONTRADICTION_KINDS.join(', ')}`);
    const kase = await repo.readScoped('case', case_id, organization_id);
    if (!kase) fail('not_found', 'case not found', 404);

    const c = await repo.createObject('contradiction', 'contradiction', organization_id, actor, {
      case_id, kind,
      summary: String(summary || '').slice(0, 1000),
      left_evidence_id: left_evidence_id || null,
      right_evidence_id: right_evidence_id || null,
      state: 'OPEN',
      metadata
    });
    await repo.attachToIndex(idx.caseContradictions(case_id), c.contradiction_id);
    await repo.audit('contradiction.recorded', {
      organization_id, case_id, actor, subject_type: 'contradiction', subject_id: c.contradiction_id,
      summary: `Contradiction recorded (${kind})`,
      details: { kind, state: 'OPEN' }
    });
    return c;
  }

  // ── Evidence requests ──────────────────────────────────────────────────────

  async function proposeEvidenceRequest(principal, organization_id, case_id, { requested_item, reason, uncertainty_resolved, burden_gate, estimated_burden = 'unknown' }) {
    const actor = actorOf(principal);
    const kase = await repo.readScoped('case', case_id, organization_id);
    if (!kase) fail('not_found', 'case not found', 404);
    if (typeof requested_item !== 'string' || !requested_item.trim()) fail('invalid_request', 'requested_item is required');

    const gate = D.evaluateBurdenGate(burden_gate);
    if (!gate.ok) fail(gate.code, gate.error, 409);

    const r = await repo.createObject('evidencereq', 'evidenceReq', organization_id, actor, {
      case_id,
      requested_item: requested_item.trim().slice(0, 500),
      reason: String(reason || '').slice(0, 1000),
      uncertainty_resolved: String(uncertainty_resolved || '').slice(0, 500),
      estimated_burden,
      burden_gate,
      status: 'PROPOSED',
      proposed_by: actor.actor_id,
      proposed_by_type: actor.actor_type,
      approved_by: null,
      decided_at: null,
      sent_at: null,
      received_at: null,
      metadata: {}
    });
    await repo.attachToIndex(idx.caseEvidenceReqs(case_id), r.evidence_request_id);
    await repo.audit('evidence_request.proposed', {
      organization_id, case_id, actor, subject_type: 'evidencereq', subject_id: r.evidence_request_id,
      summary: `Evidence request proposed: ${r.requested_item}`,
      details: { burden: estimated_burden }
    });
    return r;
  }

  /** A material client request goes out only after a human says so. */
  async function decideEvidenceRequest(principal, organization_id, evidence_request_id, decision, expected_version, { comment = '' } = {}) {
    const actor = actorOf(principal);
    if (!['APPROVED', 'REJECTED'].includes(decision)) fail('invalid_decision', 'decision must be APPROVED or REJECTED');
    if (actor.actor_type !== 'human') {
      fail('human_required', 'an evidence request to a client must be approved by a human', 403);
    }
    const current = await repo.readScoped('evidencereq', evidence_request_id, organization_id);
    if (!current) fail('not_found', 'evidence request not found', 404);
    if (current.status !== 'PROPOSED') fail('invalid_state', `request is ${current.status}, not PROPOSED`, 409);

    const next = await repo.updateObject('evidencereq', evidence_request_id, organization_id, actor, expected_version, async draft => {
      draft.status = decision;
      draft.approved_by = actor.actor_id;
      draft.decided_at = Date.now();
      return draft;
    });
    await repo.audit('evidence_request.decided', {
      organization_id, case_id: current.case_id, actor,
      subject_type: 'evidencereq', subject_id: evidence_request_id,
      summary: `Evidence request ${decision.toLowerCase()} by human reviewer`,
      details: { decision, comment: String(comment).slice(0, 300) }
    });
    return next;
  }

  // ── Findings ───────────────────────────────────────────────────────────────

  async function draftFinding(principal, organization_id, case_id, input) {
    const actor = actorOf(principal);
    const kase = await repo.readScoped('case', case_id, organization_id);
    if (!kase) fail('not_found', 'case not found', 404);
    if (kase.status !== 'FINDING_DRAFT') fail('invalid_state', `a finding may only be drafted in FINDING_DRAFT; case is ${kase.status}`, 409);
    if (typeof input.statement !== 'string' || !input.statement.trim()) fail('invalid_statement', 'statement is required');
    if (typeof input.scope !== 'string' || !input.scope.trim()) fail('invalid_scope', 'scope is required — an unbounded finding cannot be approved');

    const bundle = await repo.loadCaseBundle(case_id, organization_id);
    const supportingIds = Array.isArray(input.supporting_evidence) ? input.supporting_evidence : [];
    const counterIds = Array.isArray(input.counter_evidence) ? input.counter_evidence : [];
    const known = new Set(bundle.evidence.map(e => e.evidence_id));
    for (const id of supportingIds.concat(counterIds)) {
      if (!known.has(id)) fail('unknown_evidence', `evidence ${id} is not attached to this case`, 400);
    }

    const supporting = bundle.evidence.filter(e => supportingIds.includes(e.evidence_id));
    const counter = bundle.evidence.filter(e => counterIds.includes(e.evidence_id));
    const openContradictions = bundle.contradictions.filter(c => c.state === 'OPEN' || c.state === 'INVESTIGATING').length;
    const tested = bundle.hypotheses.filter(h => h.state === 'NOT_SUPPORTED' || h.state === 'WEAKENED').length;
    const assessment = D.assessEvidenceStrength({ supporting, contradicting: counter, openContradictions, testedAlternatives: tested });

    const f = await repo.createObject('finding', 'finding', organization_id, actor, {
      case_id,
      statement: input.statement.trim().slice(0, 4000),
      scope: input.scope.trim().slice(0, 1000),
      supporting_evidence: supportingIds,
      counter_evidence: counterIds,
      alternative_explanations: Array.isArray(input.alternative_explanations) ? input.alternative_explanations.slice(0, 20) : [],
      limitations: Array.isArray(input.limitations) ? input.limitations.slice(0, 20) : [],
      evidence_strength: assessment.strength,
      strength_reasons: assessment.reasons,
      strength_caps: assessment.caps,
      evidence_snapshot: D.buildEvidenceSnapshot(bundle.evidence, Date.now()),
      state: 'DRAFT',
      drafted_by_type: actor.actor_type,
      metadata: input.metadata || {}
    });
    await repo.attachToIndex(idx.caseFindings(case_id), f.finding_id);

    await repo.updateObject('case', case_id, organization_id, actor, kase.version, async draft => {
      draft.pending_finding_id = f.finding_id; return draft;
    });

    await repo.audit('finding.drafted', {
      organization_id, case_id, actor, subject_type: 'finding', subject_id: f.finding_id,
      summary: `Finding drafted with ${assessment.strength} evidence`,
      details: { evidence_strength: assessment.strength, caps: assessment.caps, supporting: supportingIds.length, counter: counterIds.length }
    });
    return f;
  }

  /**
   * Revise a finding. If the change is material and the finding was already
   * approved, the approval is voided here — the Case stops having an approved
   * answer, and a fresh human review is required.
   */
  async function reviseFinding(principal, organization_id, finding_id, patch, expected_version) {
    const actor = actorOf(principal);
    const before = await repo.readScoped('finding', finding_id, organization_id);
    if (!before) fail('not_found', 'finding not found', 404);

    const v = D.validateUpdate('finding', patch);
    if (!v.ok) fail(v.code, v.error, 400);

    const after = await repo.updateObject('finding', finding_id, organization_id, actor, expected_version, async draft => {
      for (const k of v.fields) draft[k] = patch[k];
      draft.state = 'DRAFT';
      return draft;
    });

    const material = D.isMaterialFindingChange(before, after);
    const kase = await repo.readScoped('case', before.case_id, organization_id);

    if (material && kase && kase.approved_finding_id === finding_id) {
      await repo.updateObject('case', kase.case_id, organization_id, actor, kase.version, async draft => {
        draft.approved_finding_id = null;
        draft.approved_finding_version = null;
        draft.pending_finding_id = finding_id;
        return draft;
      });
    }

    await repo.audit('finding.revised', {
      organization_id, case_id: before.case_id, actor,
      subject_type: 'finding', subject_id: finding_id,
      summary: material
        ? `Finding materially revised to version ${after.version}; any prior approval no longer applies`
        : `Finding revised to version ${after.version} (non-material)`,
      details: { material, from_version: before.version, to_version: after.version, fields: v.fields }
    });
    return { finding: after, material_change: material };
  }

  // ── Challenge ──────────────────────────────────────────────────────────────

  async function runChallengeReview(principal, organization_id, case_id, finding_id) {
    const actor = actorOf(principal);
    const bundle = await repo.loadCaseBundle(case_id, organization_id);
    if (!bundle) fail('not_found', 'case not found', 404);
    if (bundle.case.status !== 'CHALLENGE_REVIEW') {
      fail('invalid_state', `challenge review runs in CHALLENGE_REVIEW; case is ${bundle.case.status}`, 409);
    }
    const finding = bundle.findings.find(f => f.finding_id === finding_id);
    if (!finding) fail('not_found', 'finding not found on this case', 404);

    const result = runChallenge({
      finding,
      evidence: bundle.evidence,
      hypotheses: bundle.hypotheses,
      contradictions: bundle.contradictions,
      now: Date.now()
    });

    const c = await repo.createObject('challenge', 'challenge', organization_id, actor, {
      case_id,
      finding_id,
      finding_version: finding.version,
      ...result
    });
    await repo.attachToIndex(idx.caseChallenges(case_id), c.challenge_id);
    await repo.audit('challenge.completed', {
      organization_id, case_id, actor, subject_type: 'challenge', subject_id: c.challenge_id,
      summary: `Adversarial review: ${result.verdict}. ${result.summary}`,
      details: { verdict: result.verdict, blocking: result.blocking_count, warnings: result.warning_count, finding_version: finding.version }
    });
    return c;
  }

  // ── Approval ───────────────────────────────────────────────────────────────

  /**
   * The decision. Everything above this line is preparation; this is the only
   * place a human commits Humvance to a statement about a client's organisation.
   */
  async function recordApproval(principal, organization_id, { case_id, artifact_type, artifact_id, artifact_version, decision, comment = '' }) {
    const actor = actorOf(principal);

    if (!D.APPROVAL_DECISIONS.includes(decision)) fail('invalid_decision', `decision must be one of ${D.APPROVAL_DECISIONS.join(', ')}`);
    if (!D.APPROVABLE_ARTIFACTS.includes(artifact_type)) fail('invalid_artifact_type', `artifact_type must be one of ${D.APPROVABLE_ARTIFACTS.join(', ')}`);

    // Belt and braces: the HTTP layer already checked approval authority, but an
    // approval is the one operation where a second, local check is worth its cost.
    if (actor.actor_type !== 'human') {
      await repo.audit('security.rejected', {
        organization_id, case_id, actor, subject_type: 'approval', subject_id: null,
        summary: 'Rejected approval attempt by a non-human actor',
        details: { actor_type: actor.actor_type, artifact_type, artifact_id }
      });
      fail('human_required', 'AI actors may not approve material findings', 403);
    }

    const bundle = await repo.loadCaseBundle(case_id, organization_id);
    if (!bundle) fail('not_found', 'case not found', 404);
    if (bundle.case.status !== 'HUMAN_APPROVAL') {
      fail('invalid_state', `approval is recorded in HUMAN_APPROVAL; case is ${bundle.case.status}`, 409);
    }

    const artifact = artifact_type === 'finding'
      ? bundle.findings.find(f => f.finding_id === artifact_id)
      : bundle.evidenceRequests.find(r => r.evidence_request_id === artifact_id);
    if (!artifact) fail('not_found', `${artifact_type} not found on this case`, 404);

    // Version binding. Approving "the finding" is meaningless; a reviewer approves
    // a specific version, and says which one they read.
    if (Number(artifact_version) !== Number(artifact.version)) {
      await repo.audit('security.rejected', {
        organization_id, case_id, actor, subject_type: 'approval', subject_id: artifact_id,
        summary: 'Rejected approval bound to a stale artifact version',
        details: { submitted_version: artifact_version, current_version: artifact.version }
      });
      fail('version_conflict',
        `approval names version ${artifact_version} but the ${artifact_type} is now at version ${artifact.version}; re-read it before approving`, 409);
    }

    if (artifact_type === 'finding' && decision === 'APPROVED') {
      const challenge = bundle.challenges
        .filter(c => c.finding_id === artifact_id && c.finding_version === artifact.version)
        .sort((a, b) => b.created_at - a.created_at)[0];
      if (!challenge) {
        fail('challenge_required', 'this finding version has not been through adversarial review', 409);
      }
      if (challenge.verdict === 'BLOCKED' && comment.trim().length < 20) {
        fail('challenge_blocked',
          'the adversarial review is BLOCKED; approving over it requires a written reviewer justification of at least 20 characters', 409);
      }
    }

    const a = await repo.createObject('approval', 'approval', organization_id, actor, {
      case_id,
      artifact_type,
      artifact_id,
      artifact_version: Number(artifact_version),
      reviewer_id: actor.actor_id,
      reviewer_role: actor.role,
      decision,
      comment: String(comment).slice(0, 2000)
    });
    await repo.attachToIndex(idx.caseApprovals(case_id), a.approval_id);

    if (artifact_type === 'finding') {
      // bumpVersion:false — the approval binds to this exact version number, so
      // recording the outcome must not move it out from under the approval.
      await repo.updateObject('finding', artifact_id, organization_id, actor, artifact.version, async draft => {
        draft.state = decision === 'APPROVED' ? 'APPROVED'
                    : decision === 'REJECTED' ? 'REJECTED'
                    : 'DRAFT';
        return draft;
      }, { bumpVersion: false });
    }

    await repo.audit('approval.recorded', {
      organization_id, case_id, actor, subject_type: 'approval', subject_id: a.approval_id,
      summary: `Human decision: ${decision} on ${artifact_type} version ${artifact_version}`,
      details: { decision, artifact_type, artifact_id, artifact_version: Number(artifact_version), reviewer_role: actor.role }
    });
    return a;
  }

  // ── Views ──────────────────────────────────────────────────────────────────

  async function getReviewerView(principal, organization_id, case_id) {
    const bundle = await repo.loadCaseBundle(case_id, organization_id);
    if (!bundle) return null;
    const audit = await repo.readAudit(case_id, organization_id);
    return { ...bundle, audit };
  }

  /**
   * What the client sees. Simple outside, sophisticated inside: no competing
   * hypotheses, no challenge internals, no strength arithmetic, and no finding at
   * all until a human has approved one.
   */
  async function getClientView(principal, organization_id, case_id) {
    const bundle = await repo.loadCaseBundle(case_id, organization_id);
    if (!bundle) return null;
    const kase = bundle.case;
    const pendingRequests = bundle.evidenceRequests.filter(r => r.status === 'APPROVED' || r.status === 'SENT');
    const approvedFinding = kase.approved_finding_id
      ? bundle.findings.find(f => f.finding_id === kase.approved_finding_id)
      : null;

    return {
      case_id: kase.case_id,
      title: kase.title,
      current_focus: kase.title,
      status: kase.client_visible_status,
      what_we_need_from_you: pendingRequests.map(r => ({ item: r.requested_item, why: r.reason })),
      next_step: nextStepText(kase.status),
      decision_needed: kase.status === 'HUMAN_APPROVAL' ? false : false,
      approved_finding: approvedFinding ? {
        statement: approvedFinding.statement,
        scope: approvedFinding.scope,
        evidence_strength: approvedFinding.evidence_strength,   // bounded category, never a score
        limitations: approvedFinding.limitations,
        alternative_explanations: approvedFinding.alternative_explanations,
        approved_version: kase.approved_finding_version
      } : null
    };
  }

  function nextStepText(state) {
    switch (state) {
      case 'INTAKE':
      case 'STRUCTURING':            return 'Humvance is reviewing what you told us.';
      case 'INVESTIGATION_PLANNING':
      case 'HUMAN_REVIEW':           return 'A Humvance reviewer is planning the investigation.';
      case 'AWAITING_EVIDENCE':
      case 'CLARIFICATION_REQUIRED': return 'We need a few specifics from you to continue.';
      case 'ANALYZING_EVIDENCE':     return 'We are working through what you shared.';
      case 'FINDING_DRAFT':
      case 'CHALLENGE_REVIEW':
      case 'HUMAN_APPROVAL':         return 'A Humvance reviewer is finalising the finding.';
      case 'APPROVED':               return 'Your finding is ready to review together.';
      default:                       return '';
    }
  }

  return {
    repo, idx,
    createOrganization, getOrganization,
    createCase, getCase, transitionCase,
    addHypothesis, setHypothesisState,
    addEvidence, updateEvidence, recordContradiction,
    proposeEvidenceRequest, decideEvidenceRequest,
    draftFinding, reviseFinding,
    runChallengeReview, recordApproval,
    getReviewerView, getClientView
  };
}

module.exports = { createService };
