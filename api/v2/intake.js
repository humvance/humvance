'use strict';
// Humvance V2 — the anonymous Diagnostic Intake endpoint.
//
// ─────────────────────────────────────────────────────────────────────────────
// This is the ONLY unauthenticated surface in api/v2, and it is deliberately a
// separate file from api/v2/case.js.
//
// case.js runs every request through four gates — authenticate → reviewer role →
// server-side organization membership → operation — and the whole value of that
// file is that there is no way past them. Adding an anonymous branch inside it
// would put a hole in the one place designed not to have one. So this endpoint
// does not import it, does not share a dispatcher with it, and cannot reach any
// of its operations.
//
// WHAT THIS ENDPOINT CAN DO:  create one immutable Pending Intake Seed.
// WHAT IT CANNOT DO:          everything else.
//
//   * POST only. There is no anonymous read: a GET is 405, not a lookup, so a
//     stranger holding a submission reference still cannot retrieve anything.
//   * Create-only. No update path, no delete path, no id accepted from the caller.
//   * No Organization, no Case, no Claim, no Evidence, no Hypothesis, no Finding,
//     no Approval, no membership, no diagnosis.
//   * The response carries success, an opaque reference and a received status.
//     Nothing is echoed back, so the endpoint cannot be used as an oracle.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { setJSON } = require('../_utils');
const { createStore, StoreConfigError } = require('./_store');
const { createService } = require('./_service');
const { assertSigningSecret } = require('./_authz');
const { LIMITS } = require('./_intake');

let cached = null;
function boot() {
  if (cached) return cached;

  // The same posture as case.js, for a reason that is not obvious: this endpoint
  // verifies no token, but a deployment that cannot verify tokens has no working
  // reviewer surface — so accepting a client's submission there would be
  // collecting personal data that nobody is able to act on. Fail closed.
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

// ── Abuse controls ───────────────────────────────────────────────────────────
//
// HONEST LIMITATION, STATED RATHER THAN HIDDEN:
// this limiter is per serverless instance. The V2 store driver exposes no TTL
// primitive (no EXPIRE), so a durable cross-instance counter would accumulate
// keys forever, and hashed-IP counters would be personal data at rest for no
// operational gain. What is here raises the cost of casual automation against a
// warm instance; it is NOT a substitute for platform-level protection. See
// docs/ENGINEERING-STATE.md — durable rate limiting is recorded as open debt.
//
// The client IP is hashed with a per-process salt, held in memory only, and is
// never written to the store, the seed, the audit trail or a log.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_CLIENT = 5;
const MAX_PER_INSTANCE = 60;
const IP_SALT = crypto.randomBytes(16);

const hits = new Map();       // hashed client → number[] (timestamps)
let instanceHits = [];        // timestamps

function clientKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : String(fwd || '')).split(',')[0].trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
  return crypto.createHash('sha256').update(IP_SALT).update(String(ip)).digest('hex').slice(0, 24);
}

function prune(list, now) { return list.filter(t => now - t < WINDOW_MS); }

function checkRate(req) {
  const now = Date.now();
  instanceHits = prune(instanceHits, now);
  if (instanceHits.length >= MAX_PER_INSTANCE) {
    return { ok: false, retryAfter: Math.ceil(WINDOW_MS / 1000) };
  }
  const key = clientKey(req);
  const list = prune(hits.get(key) || [], now);
  if (list.length >= MAX_PER_CLIENT) {
    hits.set(key, list);
    return { ok: false, retryAfter: Math.ceil((WINDOW_MS - (now - list[0])) / 1000) };
  }
  list.push(now);
  hits.set(key, list);
  instanceHits.push(now);
  // Bound the map so a long-lived instance cannot be made to grow without limit.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!prune(v, now).length) hits.delete(k);
      if (hits.size <= 2500) break;
    }
  }
  return { ok: true };
}

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

  // No anonymous read. Not a 404 that hints at a resource, not a redirect — a
  // flat refusal of the method, for every verb that is not POST.
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'method not allowed', code: 'method_not_allowed' }, isolationHeaders);
  }

  const rate = checkRate(req);
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return send(res, 429, {
      error: 'too many submissions from this client; please try again later',
      code: 'rate_limited'
    }, isolationHeaders);
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) {
    return send(res, 400, { error: 'a JSON object body is required', code: 'malformed_body' }, isolationHeaders);
  }

  let size;
  try { size = Buffer.byteLength(JSON.stringify(body), 'utf8'); }
  catch { return send(res, 400, { error: 'body is not serialisable JSON', code: 'malformed_body' }, isolationHeaders); }
  if (size > LIMITS.body_bytes) {
    return send(res, 413, {
      error: `submission exceeds ${LIMITS.body_bytes} bytes`,
      code: 'body_too_large'
    }, isolationHeaders);
  }

  try {
    const out = await service.receiveIntake(body);
    return send(res, 201, out, isolationHeaders);
  } catch (err) {
    const status = typeof err?.status === 'number' ? err.status : 500;
    if (status >= 500) {
      console.error('[v2/intake]', err);
      return send(res, status, { error: 'internal error', code: err.code || 'internal_error' }, isolationHeaders);
    }
    // Validation errors name the field, because a form that says only "invalid"
    // is a form people abandon. They reveal nothing about stored data.
    return send(res, status, {
      error: err.message,
      code: err.code || 'bad_request',
      field: err.field || null
    }, isolationHeaders);
  }
};
