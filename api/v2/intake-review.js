'use strict';
// Humvance V2 — the authenticated reviewer surface for the intake holding area.
//
// This is where a submission stops being something a stranger said and becomes
// something Humvance has decided to work on. It is the human gate, and it is the
// only door out of the holding area.
//
// Gates, in this order, without exception:
//   GET  — authenticate → reviewer role
//   POST — authenticate → reviewer role → approval authority (human + role)
//
// Why approval authority for a POST: accepting a submission creates a tenant and
// commits Humvance to investigating a real company. That is a material decision,
// so it is refused for `ai` and `system` actors in exactly the way an approval is
// (_authz.requireApprovalAuthority, and again in _service.decideIntake).
//
// Organization scope is deliberately NOT applied here: a pending submission has no
// organization yet, so there is nothing to scope it to. That is why these two
// object types live outside _repo.readScoped() and why this endpoint is separate
// from api/v2/case.js, which must keep its scope check unconditional.

const { setJSON } = require('../_utils');
const { createStore, StoreConfigError } = require('./_store');
const { createService } = require('./_service');
const { authenticate, requireReviewer, requireApprovalAuthority, assertSigningSecret } = require('./_authz');

let cached = null;
function boot() {
  if (cached) return cached;
  const secret = assertSigningSecret(process.env);
  if (!secret.ok) {
    const err = new Error(secret.error);
    err.code = secret.code;
    throw err;
  }
  const store = createStore(process.env);
  store.assertIsolated({
    allowSharedProductionHost: process.env.V2_ACKNOWLEDGE_SHARED_PRODUCTION_DB === 'yes'
  });
  cached = { store, service: createService(store) };
  return cached;
}

const OPS = new Set(['decide_intake']);

function send(res, status, body, extraHeaders = {}) {
  setJSON(res);
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  return res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  let ctx;
  try {
    ctx = boot();
  } catch (err) {
    const isSecret = String(err.code || '').startsWith('signing_secret');
    return send(res, 503, {
      error: isSecret ? 'V2 is not configured to verify tokens safely' : 'V2 storage is not configured',
      code: err.code || 'store_misconfigured'
    });
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

    if (req.method === 'GET') {
      const intakeseed_id = req.query?.intakeseed_id;
      if (intakeseed_id) {
        const out = await service.getIntakeSubmission(principal, intakeseed_id);
        return out ? send(res, 200, out, isolationHeaders)
                   : send(res, 404, { error: 'not found', code: 'not_found' }, isolationHeaders);
      }
      const status = req.query?.status === 'all' ? null : (req.query?.status || 'PENDING_REVIEW');
      const out = await service.listIntakeSubmissions(principal, { status, limit: req.query?.limit });
      return send(res, 200, out, isolationHeaders);
    }

    if (req.method !== 'POST') {
      return send(res, 405, { error: 'method not allowed', code: 'method_not_allowed' }, isolationHeaders);
    }

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
    if (!body) return send(res, 400, { error: 'a JSON object body is required', code: 'malformed_body' }, isolationHeaders);

    if (typeof body.op !== 'string' || !OPS.has(body.op)) {
      return send(res, 400, { error: 'unknown operation', code: 'unknown_op' }, isolationHeaders);
    }

    const ap = requireApprovalAuthority(principal);
    if (!ap.ok) return send(res, ap.status, { error: ap.error, code: ap.code }, isolationHeaders);

    const out = await service.decideIntake(principal, {
      intakeseed_id: body.intakeseed_id,
      decision: body.decision,
      expected_version: body.expected_version,
      reason: body.reason || '',
      title: body.title === undefined ? null : body.title,
      organization_id: body.organization_id || null
    });
    return send(res, 200, out, isolationHeaders);

  } catch (err) {
    const status = err instanceof StoreConfigError ? 503 : (typeof err?.status === 'number' ? err.status : 500);
    if (status >= 500) {
      console.error('[v2/intake-review]', err);
      return send(res, status, { error: 'internal error', code: err.code || 'internal_error' }, isolationHeaders);
    }
    return send(res, status, { error: err.message, code: err.code || 'bad_request' }, isolationHeaders);
  }
};
