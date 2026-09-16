'use strict';
// Humvance V2 — HTTP surface for the Case spine.
//
// This file parses, authorises, dispatches and maps errors. It contains no domain
// rules: every decision it appears to make is made in _domain.js, _authz.js or
// _service.js, which are testable without a server. If you are looking for "why
// was this refused", it is not here.
//
// Every request goes through the same four gates, in this order and without
// exception: authenticate → reviewer role → organization scope → operation.

const { setJSON } = require('../_utils');
const { createStore, StoreConfigError } = require('./_store');
const { createService } = require('./_service');
const { authenticate, requireReviewer, requireApprovalAuthority, resolveOrgScope } = require('./_authz');

// Built once per warm serverless instance. A misconfigured store throws here, so a
// deployment with no V2 storage configuration fails on its first request rather
// than quietly writing somewhere it should not.
let cached = null;
function boot() {
  if (cached) return cached;
  const store = createStore(process.env);
  store.assertIsolated({
    // Deliberately explicit: the only way V2 runs against the production database
    // is an operator setting this, and the value is recorded in the response header
    // below so it is visible in every Preview request.
    allowSharedProductionHost: process.env.V2_ACKNOWLEDGE_SHARED_PRODUCTION_DB === 'yes'
  });
  cached = { store, service: createService(store) };
  return cached;
}

const OPS = new Set([
  'create_organization', 'create_case', 'transition',
  'add_hypothesis', 'set_hypothesis_state',
  'add_evidence', 'update_evidence', 'record_contradiction',
  'propose_evidence_request', 'decide_evidence_request',
  'draft_finding', 'revise_finding',
  'run_challenge', 'record_approval'
]);

// Operations that commit Humvance to something material and therefore require a
// human actor with approval authority. Checked here AND again in the service.
const APPROVAL_OPS = new Set(['record_approval', 'decide_evidence_request']);

function send(res, status, body, extraHeaders = {}) {
  setJSON(res);
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  return res.status(status).json(body);
}

function errorStatus(err) {
  if (err instanceof StoreConfigError) return 503;
  if (typeof err?.status === 'number') return err.status;
  return 500;
}

module.exports = async function handler(req, res) {
  let ctx;
  try {
    ctx = boot();
  } catch (err) {
    // Fail closed and say why, without leaking any credential material.
    return send(res, 503, { error: 'V2 storage is not configured', code: err.code || 'store_misconfigured', detail: err.message });
  }
  const { store, service } = ctx;
  const isolationHeaders = {
    'X-Humvance-V2-Store': store.driverKind,
    'X-Humvance-V2-Isolation': store.isolation,
    'X-Humvance-V2-Namespace': store.namespace
  };

  try {
    const auth = authenticate(req);
    if (!auth.ok) return send(res, auth.status, { error: auth.error, code: auth.code }, isolationHeaders);
    const principal = auth.principal;

    const rv = requireReviewer(principal);
    if (!rv.ok) return send(res, rv.status, { error: rv.error, code: rv.code }, isolationHeaders);

    // ── reads ───────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const organization_id = req.query?.organization_id;
      const case_id = req.query?.case_id;
      const view = req.query?.view || 'reviewer';

      const scope = resolveOrgScope(principal, organization_id);
      if (!scope.ok) return send(res, scope.status, { error: scope.error, code: scope.code }, isolationHeaders);
      if (typeof case_id !== 'string' || !case_id) {
        return send(res, 400, { error: 'case_id is required', code: 'case_id_required' }, isolationHeaders);
      }

      if (view === 'client') {
        const v = await service.getClientView(principal, organization_id, case_id);
        return v ? send(res, 200, v, isolationHeaders)
                 : send(res, 404, { error: 'not found', code: 'not_found' }, isolationHeaders);
      }
      if (view === 'audit') {
        const bundle = await service.getReviewerView(principal, organization_id, case_id);
        return bundle ? send(res, 200, { audit: bundle.audit }, isolationHeaders)
                      : send(res, 404, { error: 'not found', code: 'not_found' }, isolationHeaders);
      }
      const bundle = await service.getReviewerView(principal, organization_id, case_id);
      return bundle ? send(res, 200, bundle, isolationHeaders)
                    : send(res, 404, { error: 'not found', code: 'not_found' }, isolationHeaders);
    }

    if (req.method !== 'POST') {
      return send(res, 405, { error: 'method not allowed', code: 'method_not_allowed' }, isolationHeaders);
    }

    // ── writes ──────────────────────────────────────────────────────────────
    const body = req.body && typeof req.body === 'object' ? req.body : null;
    if (!body) return send(res, 400, { error: 'a JSON object body is required', code: 'malformed_body' }, isolationHeaders);

    const op = body.op;
    if (typeof op !== 'string' || !OPS.has(op)) {
      return send(res, 400, { error: 'unknown operation', code: 'unknown_op' }, isolationHeaders);
    }

    if (APPROVAL_OPS.has(op)) {
      const ap = requireApprovalAuthority(principal);
      if (!ap.ok) return send(res, ap.status, { error: ap.error, code: ap.code }, isolationHeaders);
    }

    if (op === 'create_organization') {
      if (principal.actor_type !== 'human' || principal.role !== 'admin') {
        return send(res, 403, { error: 'creating an organization requires a human admin', code: 'forbidden_role' }, isolationHeaders);
      }
      const org = await service.createOrganization(principal, body);
      return send(res, 201, org, isolationHeaders);
    }

    // Everything else is organisation-scoped.
    const scope = resolveOrgScope(principal, body.organization_id);
    if (!scope.ok) return send(res, scope.status, { error: scope.error, code: scope.code }, isolationHeaders);
    const org = scope.organization_id;

    let out;
    switch (op) {
      case 'create_case':
        out = await service.createCase(principal, org, body); break;
      case 'transition':
        out = await service.transitionCase(principal, org, body.case_id, body.to_state, body.expected_version); break;
      case 'add_hypothesis':
        out = await service.addHypothesis(principal, org, body.case_id, body); break;
      case 'set_hypothesis_state':
        out = await service.setHypothesisState(principal, org, body.hypothesis_id, body.to_state, body.expected_version, body); break;
      case 'add_evidence':
        out = await service.addEvidence(principal, org, body.case_id, body); break;
      case 'update_evidence':
        out = await service.updateEvidence(principal, org, body.evidence_id, body.patch || {}, body.expected_version); break;
      case 'record_contradiction':
        out = await service.recordContradiction(principal, org, body.case_id, body); break;
      case 'propose_evidence_request':
        out = await service.proposeEvidenceRequest(principal, org, body.case_id, body); break;
      case 'decide_evidence_request':
        out = await service.decideEvidenceRequest(principal, org, body.evidence_request_id, body.decision, body.expected_version, body); break;
      case 'draft_finding':
        out = await service.draftFinding(principal, org, body.case_id, body); break;
      case 'revise_finding':
        out = await service.reviseFinding(principal, org, body.finding_id, body.patch || {}, body.expected_version); break;
      case 'run_challenge':
        out = await service.runChallengeReview(principal, org, body.case_id, body.finding_id); break;
      case 'record_approval':
        out = await service.recordApproval(principal, org, body); break;
      default:
        return send(res, 400, { error: 'unknown operation', code: 'unknown_op' }, isolationHeaders);
    }
    return send(res, 200, out, isolationHeaders);

  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) {
      // Never surface internals to the caller.
      console.error('[v2/case]', err);
      return send(res, status, { error: 'internal error', code: err.code || 'internal_error' }, isolationHeaders);
    }
    return send(res, status, { error: err.message, code: err.code || 'bad_request' }, isolationHeaders);
  }
};
