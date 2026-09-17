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
const { loadMembership, grantOrg, hasOrg } = require('./_membership');
const Intake = require('./_intake');

function fail(code, message, status = 400) { throw new RepoError(code, message, status); }

function createService(store) {
  const repo = createRepo(store);
  const intakeRepo = Intake.createIntakeRepo(store);

  // The actor an anonymous submission is attributed to. It is not a person and it
  // is not a reviewer: it can write one immutable record into the holding area and
  // nothing else. Every decision that follows is taken by a named human.
  const SYSTEM_INTAKE_ACTOR = Object.freeze({
    actor_id: 'system:intake',
    actor_type: 'system',
    role: null
  });

  const actorOf = (principal) => ({
    actor_id: principal.actor_id,
    actor_type: principal.actor_type,
    role: principal.role
  });

  // ── Organization ───────────────────────────────────────────────────────────

  /**
   * `opts.id` is supplied only by the intake promotion, which minted it and wrote it
   * down before any object existed (see _intake.buildPromotionPlan). It is not
   * reachable from an HTTP body — api/v2/case.js calls this with two arguments — and
   * when it names an organisation that already exists, this returns that
   * organisation rather than creating a second one, which is what makes an
   * interrupted promotion safe to retry.
   */
  async function createOrganization(principal, { name, country = null, size_band = null, metadata = {} }, { id: plannedId = null } = {}) {
    if (typeof name !== 'string' || !name.trim()) fail('invalid_name', 'organization name is required');
    const actor = actorOf(principal);
    const now = Date.now();
    const { newId, isId } = require('./_ids');
    if (plannedId !== null && !isId('org', plannedId)) fail('invalid_id', 'planned organization id is malformed', 500);

    if (plannedId) {
      const existing = await store.get('org', plannedId);
      if (existing) {
        // A previous attempt created it. Membership may or may not have been granted
        // before the interruption, so make sure of it; grantOrg is idempotent.
        await grantOrg(store, actor.actor_id, plannedId, { granted_by: 'creation' });
        return existing;
      }
    }

    const org_id = plannedId || newId('org');
    const org = {
      org_id, organization_id: org_id,       // self-scoped, so the tenant check is uniform
      name: name.trim().slice(0, 200), country, size_band,
      created_at: now, created_by: actor.actor_id, created_by_type: actor.actor_type,
      updated_at: now, updated_by: actor.actor_id, updated_by_type: actor.actor_type,
      version: 1, metadata
    };
    if (!await store.putIfAbsent('org', org_id, org)) fail('id_collision', 'identifier collision', 500);

    // The creator becomes a member. This is the only bootstrap path into an
    // organisation, and it is an ownership rule applied on the server — not a
    // claim the caller made, and not a default granted to everyone.
    await grantOrg(store, actor.actor_id, org_id, { granted_by: 'creation' });

    await repo.audit('organization.created', {
      organization_id: org_id, case_id: null, actor,
      subject_type: 'org', subject_id: org_id,
      summary: `Organization created: ${org.name}`,
      details: { country, size_band }
    });
    await repo.audit('access.granted', {
      organization_id: org_id, case_id: null, actor,
      subject_type: 'membership', subject_id: actor.actor_id,
      summary: 'Creator granted membership of the new organization',
      details: { via: 'creation', principal_id: actor.actor_id }
    });
    return org;
  }

  /**
   * Extend membership to another principal. Only an existing member may do it,
   * only a human reviewer, and the target is named explicitly — there is no way
   * for a principal to grant itself access to an organisation it cannot already
   * reach.
   */
  async function grantOrganizationAccess(principal, organization_id, target_principal_id) {
    const actor = actorOf(principal);
    if (actor.actor_type !== 'human') {
      fail('human_required', 'granting organization access requires a human reviewer', 403);
    }
    if (typeof target_principal_id !== 'string' || !target_principal_id.trim()) {
      fail('invalid_principal', 'target_principal_id is required');
    }
    const mine = await loadMembership(store, actor.actor_id);
    if (!hasOrg(mine, organization_id)) {
      // Not 403: the caller must not learn that this organisation exists.
      fail('not_found', 'not found', 404);
    }
    const org = await repo.readScoped('org', organization_id, organization_id);
    if (!org) fail('not_found', 'organization not found', 404);

    let result;
    try {
      result = await grantOrg(store, target_principal_id.trim(), organization_id, { granted_by: actor.actor_id });
    } catch (err) {
      fail('invalid_principal', err.message, 400);
    }

    await repo.audit('access.granted', {
      organization_id, case_id: null, actor,
      subject_type: 'membership', subject_id: target_principal_id.trim(),
      summary: `Organization access granted to ${target_principal_id.trim()}`,
      details: { via: 'grant', already_had_access: !result.granted }
    });
    return { organization_id, principal_id: target_principal_id.trim(), granted: result.granted };
  }

  /** The organisations this principal may act in, read from server-side state. */
  async function listMyOrganizations(principal) {
    const actor = actorOf(principal);
    const m = await loadMembership(store, actor.actor_id);
    const out = [];
    for (const id of m.orgs) {
      const org = await repo.readScoped('org', id, id);
      if (org) out.push({ org_id: org.org_id, name: org.name, created_at: org.created_at });
    }
    return { principal_id: actor.actor_id, organizations: out };
  }

  async function getOrganization(principal, organization_id) {
    return repo.readScoped('org', organization_id, organization_id);
  }

  // ── Case + primary Claim ───────────────────────────────────────────────────

  /**
   * `opts.case_id` / `opts.claim_id` come from the intake promotion plan and are not
   * reachable from HTTP (api/v2/case.js calls this with three arguments). With them,
   * this function becomes resumable at the granularity it actually needs: a crash
   * between creating the Case and creating its primary Claim leaves a Case whose
   * `primary_claim_id` is null, and that is a state a retry has to be able to finish
   * rather than trip over.
   */
  async function createCase(principal, organization_id, { title, case_type, sponsor_claim, claim_origin = 'sponsor', legacy_source_ref = null, metadata = {} }, { case_id: plannedCaseId = null, claim_id: plannedClaimId = null } = {}) {
    if (typeof title !== 'string' || !title.trim()) fail('invalid_title', 'title is required');
    if (typeof sponsor_claim !== 'string' || !sponsor_claim.trim()) fail('invalid_claim', 'sponsor_claim is required');
    if (!D.CLAIM_ORIGINS.includes(claim_origin)) fail('invalid_claim_origin', `claim_origin must be one of ${D.CLAIM_ORIGINS.join(', ')}`);
    const actor = actorOf(principal);

    let kase = plannedCaseId ? await store.get('case', plannedCaseId) : null;
    const caseExisted = !!kase;
    if (!kase) {
      kase = await repo.createObject('case', 'case', organization_id, actor, {
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
      }, { id: plannedCaseId });
    }

    // The sponsor's account is recorded as a CLAIM, unverified. It is the thing to
    // be investigated, not the conclusion. This single decision is what separates
    // Humvance from a questionnaire that repeats back what the owner already said.
    let claim = plannedClaimId ? await store.get('claim', plannedClaimId) : null;
    const claimExisted = !!claim;
    if (!claim) {
      claim = await repo.createObject('claim', 'claim', organization_id, actor, {
        case_id: kase.case_id,
        statement: sponsor_claim.trim().slice(0, 2000),
        origin: claim_origin,
        verification_status: 'UNVERIFIED',
        is_primary: true,
        supporting_evidence: [],
        contradicting_evidence: [],
        metadata: {}
      }, { id: plannedClaimId });
    }

    if (kase.primary_claim_id !== claim.claim_id) {
      kase.primary_claim_id = claim.claim_id;
      kase.version = 2;
      kase.updated_at = Date.now();
      await store.put('case', kase.case_id, kase);
    }

    await repo.attachToIndex(idx.orgCases(organization_id), kase.case_id);
    await repo.attachToIndex(idx.caseClaims(kase.case_id), claim.claim_id);

    // Audited only when something was actually created, so that resuming an
    // interrupted promotion does not write a second "Case opened" into the trail.
    if (!caseExisted) {
      await repo.audit('case.created', {
        organization_id, case_id: kase.case_id, actor,
        subject_type: 'case', subject_id: kase.case_id,
        summary: `Case opened: ${kase.title}`,
        details: { case_type: kase.case_type, primary_claim_id: claim.claim_id }
      });
    }
    if (!claimExisted) {
      await repo.audit('claim.created', {
        organization_id, case_id: kase.case_id, actor,
        subject_type: 'claim', subject_id: claim.claim_id,
        summary: 'Primary sponsor claim recorded as UNVERIFIED',
        details: { origin: claim_origin }
      });
    }

    return { case: kase, primary_claim: claim, created: { case: !caseExisted, claim: !claimExisted } };
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

  /**
   * `opts.id` comes from the intake promotion plan; see createOrganization. When it
   * names an evidence item that already exists, that item is returned untouched —
   * evidence is never rewritten, so a resumed promotion must recognise its own
   * earlier work rather than attach a second copy of the same client example.
   */
  async function addEvidence(principal, organization_id, case_id, input, { id: plannedId = null } = {}) {
    const actor = actorOf(principal);
    const kase = await repo.readScoped('case', case_id, organization_id);
    if (!kase) fail('not_found', 'case not found', 404);
    if (plannedId) {
      const existing = await store.get('evidence', plannedId);
      if (existing) {
        await repo.attachToIndex(idx.caseEvidence(case_id), plannedId);
        return existing;
      }
    }
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
    }, { id: plannedId });
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

  // ── Diagnostic Intake V2 — the holding area ────────────────────────────────
  //
  // An anonymous submission lands here and STOPS. Everything below the
  // receiveIntake() boundary requires an authenticated human, and the transition
  // from "somebody told us something" to "Humvance has a Case" happens in exactly
  // one place: decideIntake(), under a human decision.

  /**
   * Anonymous. Creates one immutable seed and one review record in PENDING_REVIEW.
   * Creates no Organization, no Case, no Claim, no Evidence, no membership.
   *
   * Returns only what the submitter needs to quote back to us.
   */
  async function receiveIntake(body) {
    const payload = Intake.validateIntakeSubmission(body);   // throws IntakeError (400)
    const seed = Intake.buildIntakeSeed(payload);
    const review = Intake.buildIntakeReview(seed);

    // Artifact before index, same discipline as _repo: a failure between the two
    // leaves an orphan nobody sees, not a list entry pointing at nothing.
    await intakeRepo.putSeed(seed);
    await intakeRepo.putReview(review);
    await intakeRepo.indexSubmission({
      intakeseed_id: seed.intakeseed_id,
      intakereview_id: review.intakereview_id,
      submitted_at: seed.submitted_at
    });

    await intakeRepo.auditIntake('intake.received', {
      actor: SYSTEM_INTAKE_ACTOR,
      subject_type: 'intakeseed',
      subject_id: seed.intakeseed_id,
      summary: `Anonymous intake received (${seed.case_intent}); held for human review`,
      details: {
        submission_reference: seed.submission_reference,
        case_intent: seed.case_intent,
        scope_kind: seed.scope.kind,
        examples: seed.recent_examples.length,
        untrusted_flagged: !seed.untrusted_scan.clean,
        untrusted_fields: seed.untrusted_scan.flagged_fields
      }
    });

    return {
      success: true,
      submission_reference: seed.submission_reference,
      status: 'RECEIVED',
      received_at: seed.submitted_at
    };
  }

  /** Reviewer surface. The HTTP layer has already established who is asking. */
  async function listIntakeSubmissions(principal, { status = 'PENDING_REVIEW', limit = 100 } = {}) {
    if (status !== null && !D.INTAKE_REVIEW_STATES.includes(status)) {
      fail('invalid_status', `status must be one of ${D.INTAKE_REVIEW_STATES.join(', ')}`);
    }
    const bounded = Math.min(Math.max(Number(limit) || 100, 1), 200);
    return { submissions: await intakeRepo.listSubmissions({ status, limit: bounded }) };
  }

  async function getIntakeSubmission(principal, intakeseed_id) {
    const seed = await intakeRepo.getSeed(intakeseed_id);
    if (!seed) return null;
    const summaries = await intakeRepo.listSubmissions({ status: null, limit: 1000 });
    const row = summaries.find(s => s.intakeseed_id === intakeseed_id);
    const review = row ? await intakeRepo.getReview(row.intakereview_id) : null;
    const audit = await intakeRepo.readIntakeAudit(intakeseed_id);
    return { seed, review, audit };
  }

  /**
   * Compose a Case title without inventing a judgement.
   *
   * §23 in one function: an OPPORTUNITY submission describes a company preparing
   * for growth, and naming it as a disorder would relabel it as dysfunction before
   * anyone has looked at anything.
   */
  function neutralCaseTitle(seed) {
    return `${seed.organization_context.company_name} — ${D.intentNeutralLabel(seed.case_intent)}`;
  }

  /**
   * A second Claim on an existing Case, using the same primitives createCase()
   * uses for the first one. Internal to promotion by design: it is NOT exposed as
   * an operation on api/v2/case.js, because widening the authenticated Case API
   * was not needed for this sprint and an unused operation is an unused attack
   * surface. See docs/ENGINEERING-STATE.md for the deferred `add_claim`.
   */
  async function createSecondaryClaim(actor, organization_id, case_id, { statement, origin = 'sponsor', metadata = {} }, { id: plannedId = null } = {}) {
    if (plannedId) {
      const existing = await store.get('claim', plannedId);
      if (existing) {
        await repo.attachToIndex(idx.caseClaims(case_id), plannedId);
        return existing;
      }
    }
    const claim = await repo.createObject('claim', 'claim', organization_id, actor, {
      case_id,
      statement: String(statement).trim().slice(0, 2000),
      origin,
      verification_status: 'UNVERIFIED',
      is_primary: false,
      supporting_evidence: [],
      contradicting_evidence: [],
      metadata
    }, { id: plannedId });
    await repo.attachToIndex(idx.caseClaims(case_id), claim.claim_id);
    await repo.audit('claim.created', {
      organization_id, case_id, actor, subject_type: 'claim', subject_id: claim.claim_id,
      summary: 'Client belief recorded as a secondary claim, UNVERIFIED',
      details: { origin, is_primary: false, source: 'diagnostic_intake_v2' }
    });
    return claim;
  }

  /** The client's own words for one example, transcribed, nothing added. */
  function exampleAsSourceText(ex) {
    const parts = [`[What happened]\n${ex.what_happened}`];
    if (ex.observable_consequence) parts.push(`[Observable consequence]\n${ex.observable_consequence}`);
    if (ex.area) parts.push(`[Where]\n${ex.area}`);
    if (ex.approx_when) parts.push(`[Approximately when]\n${ex.approx_when}`);
    return parts.join('\n\n');
  }

  /**
   * THE HUMAN GATE.
   *
   * Accept turns a submission into an Organization, a Case in INTAKE, the
   * sponsor's account as an UNVERIFIED primary Claim, the client's belief as an
   * UNVERIFIED secondary Claim, and their examples as self-report Evidence.
   *
   * What it deliberately does NOT do: propose a hypothesis, draft a finding,
   * assess evidence strength, or move the Case out of INTAKE. Accepting a
   * submission means "this is worth investigating", not "we know what is wrong".
   *
   * Reject creates nothing at all.
   */
  /**
   * Copy an atomically-claimed decision onto the readable review record.
   *
   * The marker is the decision; this record is how everything else reads it. They
   * are two writes, so a process can die between them — which is why this is
   * idempotent and is re-run by resumeIntakePromotion(). A review still showing
   * PENDING_REVIEW while a marker exists is not an undecided submission; it is a
   * decided one whose projection did not land.
   */
  async function projectDecision(review, marker) {
    if (review.status !== 'PENDING_REVIEW') return review;
    return intakeRepo.updateReview(review.intakereview_id, review.version, async draft => {
      draft.status = marker.decision;
      draft.decided_at = marker.decided_at;
      draft.decided_by = marker.decided_by;
      draft.decided_by_type = marker.decided_by_type;
      draft.decision_reason = marker.decision_reason;
      if (marker.decision === 'ACCEPTED') {
        draft.promotion_state = 'PENDING';
        draft.promotion_plan = marker.promotion_plan;
        draft.promotion_started_at = marker.decided_at;
        draft.promotion_case_title = marker.case_title;
      }
      return draft;
    });
  }

  async function decideIntake(principal, { intakeseed_id, decision, expected_version, reason = '', title = null, organization_id = null }) {
    const actor = actorOf(principal);

    if (!D.INTAKE_REVIEW_DECISIONS.includes(decision)) {
      fail('invalid_decision', `decision must be one of ${D.INTAKE_REVIEW_DECISIONS.join(', ')}`);
    }
    // Belt and braces: the HTTP layer already required approval authority, but
    // promoting a stranger's submission into a tenant is the second place in this
    // system where a human commits Humvance to something.
    if (actor.actor_type !== 'human') {
      fail('human_required', 'accepting or rejecting an intake submission requires a human reviewer', 403);
    }

    const seed = await intakeRepo.getSeed(intakeseed_id);
    if (!seed) fail('not_found', 'intake submission not found', 404);

    const summaries = await intakeRepo.listSubmissions({ status: null, limit: 1000 });
    const row = summaries.find(s => s.intakeseed_id === intakeseed_id);
    if (!row) fail('not_found', 'intake submission not found', 404);
    const review = await intakeRepo.getReview(row.intakereview_id);
    if (!review) fail('not_found', 'intake review not found', 404);

    if (!D.canIntakeReviewTransition(review.status, decision)) {
      // An ACCEPT whose promotion was interrupted is NOT an invitation to decide
      // again — the human already decided. It is an invitation to finish the work,
      // and the error says which operation does that.
      if (review.status === 'ACCEPTED' && review.promotion_state === 'PENDING') {
        fail('promotion_incomplete',
          'this submission was already accepted; its promotion did not finish. Resume it with resume_promotion rather than deciding again', 409);
      }
      fail('invalid_state', `submission is already ${review.status}; a decided submission is not re-decided`, 409);
    }

    // ── everything that can refuse happens BEFORE anything is created ────────
    //
    // This ordering is the whole design of this function, and it was not the
    // first one: creating the Organization before the version check meant a
    // stale "Accept" left an orphaned tenant and Case behind, created by a
    // decision that was then refused. Nothing is created until the decision has
    // been claimed, and the decision cannot be claimed twice.

    let resolvedOrg = null;
    let decision_title = null;
    if (decision === 'ACCEPTED') {
      if (title !== null && typeof title !== 'string') fail('invalid_title', 'title must be a string');
      const proposed = (title && title.trim()) ? title.trim().slice(0, 200) : neutralCaseTitle(seed);
      if (seed.case_intent === 'OPPORTUNITY') {
        const hits = D.containsPathologyLanguage(proposed);
        if (hits.length) {
          fail('pathology_language_in_opportunity_title',
            `an OPPORTUNITY submission must not be titled as a disorder (found: ${hits.join(', ')})`, 409);
        }
      }
      // Reuse an organisation only if the reviewer is already a member of it.
      // Accepting a submission never grants anybody access they did not have.
      if (organization_id) {
        const mine = await loadMembership(store, actor.actor_id);
        if (!hasOrg(mine, organization_id)) fail('not_found', 'not found', 404);
        resolvedOrg = await repo.readScoped('org', organization_id, organization_id);
        if (!resolvedOrg) fail('not_found', 'organization not found', 404);
      }
      decision_title = proposed;
    }

    // A stale view of the submission is refused here, before the decision is
    // claimed, so that a reviewer working from an out-of-date screen spends nothing.
    if (expected_version === undefined || expected_version === null) {
      fail('version_required', 'expected_version is required', 400);
    }
    if (Number(expected_version) !== Number(review.version)) {
      fail('version_conflict',
        `stale decision: expected version ${expected_version}, stored version is ${review.version}`, 409);
    }

    // THE CLAIM. `setIfAbsent` is atomic; the version check above is not. Two
    // reviewers pressing the button in the same instant both pass the version check
    // — they read the same version — and without this one of them would go on to
    // build a second Organization and a second Case from the same submission.
    //
    // On an ACCEPT the marker also carries the PROMOTION PLAN: every identifier the
    // promotion will use, minted before a single object exists. That ordering is
    // what makes the work resumable — from here on, "did I already create the case?"
    // is a question the store can answer.
    const plan = decision === 'ACCEPTED'
      ? Intake.buildPromotionPlan(seed, { organization_id: resolvedOrg ? resolvedOrg.org_id : null })
      : null;

    const claim = await intakeRepo.claimDecision(review.intakereview_id, {
      intakereview_id: review.intakereview_id,
      intakeseed_id: seed.intakeseed_id,
      decision,
      decided_at: Date.now(),
      decided_by: actor.actor_id,
      decided_by_type: actor.actor_type,
      decision_reason: String(reason).slice(0, 1000),
      case_title: decision_title,
      promotion_plan: plan
    });
    if (!claim.won) {
      fail('decision_conflict',
        `this submission was decided (${claim.marker?.decision}) by another reviewer; it is not decided twice`, 409);
    }

    const claimed = await projectDecision(review, claim.marker);

    if (decision === 'REJECTED') {
      const next = claimed;
      await intakeRepo.auditIntake('intake.rejected', {
        actor,
        subject_type: 'intakeseed',
        subject_id: seed.intakeseed_id,
        summary: 'Intake submission rejected by a human reviewer; no organization or case created',
        details: { submission_reference: seed.submission_reference, reason: String(reason).slice(0, 300) }
      });
      return { decision: 'REJECTED', review: next, organization: null, case: null };
    }

    // ── ACCEPT — past this line the decision is already durable ──────────────
    //
    // The audit entry for the decision is written FIRST, so that an interruption
    // during the promotion still leaves a trail saying a human accepted this. The
    // promotion's own completion is audited separately when it finishes.
    await intakeRepo.auditIntake('intake.accepted', {
      actor,
      subject_type: 'intakeseed',
      subject_id: seed.intakeseed_id,
      summary: 'Intake submission accepted by a human reviewer; promotion started',
      details: {
        submission_reference: seed.submission_reference,
        case_intent: seed.case_intent,
        planned_organization_id: plan.organization_id,
        planned_case_id: plan.case_id,
        organization_preexisting: plan.organization_preexisting
      }
    });

    const promoted = await runPromotion(principal, seed, claimed, { resumed: false });
    return { decision: 'ACCEPTED', ...promoted };
  }

  /**
   * Resume a promotion that was interrupted. Requires no new human decision,
   * because the human already made one — this only finishes carrying it out.
   *
   * Safe to call any number of times, including when the promotion is already
   * COMPLETE, in which case it reports what exists and creates nothing.
   */
  async function resumeIntakePromotion(principal, { intakeseed_id }) {
    const actor = actorOf(principal);
    if (actor.actor_type !== 'human') {
      fail('human_required', 'resuming a promotion requires a human reviewer', 403);
    }

    const seed = await intakeRepo.getSeed(intakeseed_id);
    if (!seed) fail('not_found', 'intake submission not found', 404);
    const summaries = await intakeRepo.listSubmissions({ status: null, limit: 1000 });
    const row = summaries.find(s => s.intakeseed_id === intakeseed_id);
    if (!row) fail('not_found', 'intake submission not found', 404);
    let review = await intakeRepo.getReview(row.intakereview_id);
    if (!review) fail('not_found', 'intake review not found', 404);

    // A decision that was claimed but never projected onto the review record is
    // still a decision. Finish the projection before judging the state, or an
    // interruption in that one-statement window would look like "never decided".
    const marker = await intakeRepo.getDecisionMarker(review.intakereview_id);
    if (marker && review.status === 'PENDING_REVIEW') {
      review = await projectDecision(review, marker);
    }

    if (review.status !== 'ACCEPTED') {
      fail('nothing_to_resume',
        `only an accepted submission has a promotion to resume; this one is ${review.status}`, 409);
    }
    if (review.promotion_state === 'COMPLETE') {
      // Requirement G: a repeated recovery call is a no-op that reports the truth.
      const org = await store.get('org', review.resulting_organization_id);
      const kase = await store.get('case', review.resulting_case_id);
      return {
        decision: 'ACCEPTED', resumed: false, already_complete: true,
        review, organization: org, case: kase,
        primary_claim: kase ? await store.get('claim', kase.primary_claim_id) : null,
        belief_claim: review.promotion_plan?.belief_claim_id
          ? await store.get('claim', review.promotion_plan.belief_claim_id) : null,
        evidence: await Promise.all((review.promotion_plan?.evidence_ids || []).map(id => store.get('evidence', id))),
        created: { organization: false, case: false, primary_claim: false, belief_claim: false, evidence: 0 }
      };
    }

    await intakeRepo.auditIntake('intake.promotion_resumed', {
      actor,
      subject_type: 'intakeseed',
      subject_id: seed.intakeseed_id,
      summary: `Promotion resumed after an interrupted attempt (attempt ${(review.promotion_attempts || 0) + 1})`,
      details: {
        submission_reference: seed.submission_reference,
        previous_error: review.promotion_last_error,
        planned_case_id: review.promotion_plan?.case_id
      }
    });

    const promoted = await runPromotion(principal, seed, review, { resumed: true });
    return { decision: 'ACCEPTED', resumed: true, already_complete: false, ...promoted };
  }

  /**
   * Execute the promotion plan. Idempotent by construction: every object has a
   * planned identifier, so each step is "does this id exist yet?" rather than "have I
   * done this before?". Running it twice creates nothing the second time.
   *
   * The store offers no transaction, so this is NOT atomic and does not pretend to
   * be. What it guarantees is convergence: each attempt moves strictly closer to the
   * planned end state, and the end state is the same whichever attempt reaches it.
   */
  async function runPromotion(principal, seed, review, { resumed = false } = {}) {
    const actor = actorOf(principal);
    const plan = review.promotion_plan;
    if (!plan) fail('promotion_plan_missing', 'this accepted submission has no promotion plan', 500);

    const created = { organization: false, case: false, primary_claim: false, belief_claim: false, evidence: 0 };

    try {
      // 1 — Organization. Pre-existing when the reviewer chose one they belong to.
      let org;
      if (plan.organization_preexisting) {
        org = await repo.readScoped('org', plan.organization_id, plan.organization_id);
        if (!org) fail('not_found', 'organization named by the promotion plan no longer exists', 404);
      } else {
        const before = await store.get('org', plan.organization_id);
        org = await createOrganization(principal, {
          name: seed.organization_context.company_name,
          size_band: seed.organization_context.employee_count_band,
          metadata: {
            sector: seed.organization_context.sector,
            growth_stage: seed.organization_context.growth_stage,
            source: 'diagnostic_intake_v2',
            intakeseed_id: seed.intakeseed_id,
            submission_reference: seed.submission_reference
          }
        }, { id: plan.organization_id });
        created.organization = !before;
      }

      // 2 — Case and the sponsor's account as its primary Claim.
      const out = await createCase(principal, org.org_id, {
        title: review.promotion_case_title || neutralCaseTitle(seed),
        case_type: 'organizational_diagnosis',
        sponsor_claim: seed.reported_situation,
        claim_origin: 'sponsor',
        metadata: {
          // The intent travels as Case metadata rather than as a new first-class
          // column: constraining `case_type` would change the authenticated Case API,
          // which this sprint does not do. Recorded as debt.
          case_intent: seed.case_intent,
          intake_source: 'diagnostic_intake_v2',
          intakeseed_id: seed.intakeseed_id,
          intakereview_id: review.intakereview_id,
          submission_reference: seed.submission_reference,
          intake_scope: seed.scope,
          intake_timeline: seed.timeline,
          intake_observed_impact: seed.observed_impact,
          intake_change_context: seed.change_context,
          intake_evidence_availability: seed.evidence_availability,
          intake_desired_outcome: seed.desired_outcome,
          epistemic_status: D.INTAKE_EPISTEMIC_STATUS
        }
      }, { case_id: plan.case_id, claim_id: plan.primary_claim_id });
      created.case = out.created.case;
      created.primary_claim = out.created.claim;


      // 3 — The client's belief, preserved as a belief.
      let beliefClaim = null;
      if (plan.belief_claim_id) {
        const before = await store.get('claim', plan.belief_claim_id);
        beliefClaim = await createSecondaryClaim(actor, org.org_id, out.case.case_id, {
          statement: seed.client_belief,
          origin: 'sponsor',
          metadata: {
            role: 'client_belief',
            epistemic_status: D.INTAKE_EPISTEMIC_STATUS.client_belief,
            note: 'What the client thinks may be causing the situation. Recorded to be tested, not assumed.',
            intakeseed_id: seed.intakeseed_id
          }
        }, { id: plan.belief_claim_id });
        created.belief_claim = !before;
      }

      // 4 — Recent examples as self-report evidence. One source name for all of
      // them, on purpose: three stories from one person is one independent source,
      // and assessEvidenceStrength() counts `source_type:source_name` pairs.
      const sourceName = `Sponsor (${seed.respondent_context.role_title})`.slice(0, 200);
      const evidence = [];
      for (let i = 0; i < seed.recent_examples.length; i++) {
        const ex = seed.recent_examples[i];
        const plannedId = plan.evidence_ids[i];
        const before = await store.get('evidence', plannedId);
        const e = await addEvidence(principal, org.org_id, out.case.case_id, {
          source_type: 'sponsor_statement',
          source_name: sourceName,
          // Deliberately null: `approx_when` is free text ("a few months ago") and
          // feeding it to Date.parse would put NaN into the staleness check.
          source_date: null,
          submitted_by: sourceName,
          original_source_reference: `intake:${seed.submission_reference}#example-${i + 1}`,
          original_content: exampleAsSourceText(ex),
          limitations: [
            'Self-reported by the sponsor, who is an interested party',
            'Single source; nothing independent corroborates it',
            'Recalled from memory; timing is approximate and unverified',
            ex.approx_when ? `Client-stated timing: ${ex.approx_when}` : 'No timing supplied'
          ],
          metadata: {
            intake_example_index: i + 1,
            intakeseed_id: seed.intakeseed_id,
            approx_when: ex.approx_when,
            area: ex.area,
            observable_consequence: ex.observable_consequence,
            epistemic_status: D.INTAKE_EPISTEMIC_STATUS.recent_examples
          }
        }, { id: plannedId });
        if (!before) created.evidence++;
        evidence.push(e);
      }

      // 5 — Reconcile the audit trail before declaring the promotion finished.
      //
      // Every creation above writes its own audit entry, but an attempt that died
      // BETWEEN creating an object and auditing it would leave a gap that the
      // resumed attempt cannot see — it correctly skips the creation, and would
      // therefore skip the entry too. So instead of trusting the sequence, read the
      // trail and fill whatever is missing. Idempotent: a run that was never
      // interrupted finds everything already there and writes nothing.
      const trail = await repo.readAudit(out.case.case_id, org.org_id);
      const present = (event, subject_id) => trail.some(a => a.event === event && a.subject_id === subject_id);

      if (!present('case.created', out.case.case_id)) {
        await repo.audit('case.created', {
          organization_id: org.org_id, case_id: out.case.case_id, actor,
          subject_type: 'case', subject_id: out.case.case_id,
          summary: `Case opened: ${out.case.title}`,
          details: { case_type: out.case.case_type, primary_claim_id: out.primary_claim.claim_id, backfilled: true }
        });
      }
      if (!present('claim.created', out.primary_claim.claim_id)) {
        await repo.audit('claim.created', {
          organization_id: org.org_id, case_id: out.case.case_id, actor,
          subject_type: 'claim', subject_id: out.primary_claim.claim_id,
          summary: 'Primary sponsor claim recorded as UNVERIFIED',
          details: { origin: 'sponsor', backfilled: true }
        });
      }
      if (beliefClaim && !present('claim.created', beliefClaim.claim_id)) {
        await repo.audit('claim.created', {
          organization_id: org.org_id, case_id: out.case.case_id, actor,
          subject_type: 'claim', subject_id: beliefClaim.claim_id,
          summary: 'Client belief recorded as a secondary claim, UNVERIFIED',
          details: { origin: 'sponsor', is_primary: false, source: 'diagnostic_intake_v2', backfilled: true }
        });
      }
      for (const e of evidence) {
        if (present('evidence.attached', e.evidence_id)) continue;
        await repo.audit('evidence.attached', {
          organization_id: org.org_id, case_id: out.case.case_id, actor,
          subject_type: 'evidence', subject_id: e.evidence_id,
          summary: `Evidence attached from ${e.source_type}: ${e.source_name}`,
          details: { source_type: e.source_type, self_report: D.isSelfReport(e.source_type), backfilled: true }
        });
      }
      // The provenance entry inside the new tenant's own trail, so the Case can
      // explain where it came from without anyone reading the holding area.
      if (!present('intake.accepted', out.case.case_id)) {
        await repo.audit('intake.accepted', {
          organization_id: org.org_id, case_id: out.case.case_id, actor,
          subject_type: 'case', subject_id: out.case.case_id,
          summary: `Case opened from diagnostic intake submission ${seed.submission_reference}`,
          details: {
            intakeseed_id: seed.intakeseed_id,
            intakereview_id: review.intakereview_id,
            case_intent: seed.case_intent,
            evidence_attached: evidence.length,
            belief_claim_id: beliefClaim ? beliefClaim.claim_id : null
          }
        });
      }

      // 6 — Only now is the promotion COMPLETE, and only now do the `resulting_*`
      // fields point at anything. Until this write they were null on purpose: a
      // half-built promotion must not look like a finished one.
      const next = await intakeRepo.updateReview(review.intakereview_id, review.version, async draft => {
        draft.promotion_state = 'COMPLETE';
        draft.promotion_attempts = (draft.promotion_attempts || 0) + 1;
        draft.promotion_completed_at = Date.now();
        draft.promotion_last_error = null;
        draft.resulting_organization_id = org.org_id;
        draft.resulting_case_id = out.case.case_id;
        return draft;
      });

      await intakeRepo.auditIntake('intake.promotion_completed', {
        actor,
        subject_type: 'intakeseed',
        subject_id: seed.intakeseed_id,
        summary: resumed
          ? `Promotion completed on resume; case ${out.case.case_id}`
          : `Promotion completed; case ${out.case.case_id}`,
        details: {
          submission_reference: seed.submission_reference,
          organization_id: org.org_id,
          case_id: out.case.case_id,
          resumed,
          created
        }
      });
      return {
        review: next,
        organization: org,
        case: out.case,
        primary_claim: out.primary_claim,
        belief_claim: beliefClaim,
        evidence,
        created
      };

    } catch (err) {
      // Record why it stopped, on a best-effort basis: this must never replace the
      // real error with a failure to write about the real error.
      try {
        await intakeRepo.updateReview(review.intakereview_id, review.version, async draft => {
          draft.promotion_attempts = (draft.promotion_attempts || 0) + 1;
          draft.promotion_last_error = String(err && err.message || err).slice(0, 300);
          return draft;
        });
      } catch { /* the decision and the plan are already durable; that is what matters */ }
      throw err;
    }
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
    createOrganization, getOrganization, grantOrganizationAccess, listMyOrganizations,
    createCase, getCase, transitionCase,
    addHypothesis, setHypothesisState,
    addEvidence, updateEvidence, recordContradiction,
    proposeEvidenceRequest, decideEvidenceRequest,
    draftFinding, reviseFinding,
    runChallengeReview, recordApproval,
    getReviewerView, getClientView,
    // Diagnostic Intake V2 — the holding area and its human gate.
    receiveIntake, listIntakeSubmissions, getIntakeSubmission, decideIntake,
    resumeIntakePromotion, neutralCaseTitle
  };
}

module.exports = { createService };
