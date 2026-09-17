'use strict';
// Humvance V2 — authentication, authorization and the AI governance boundary.
//
// V1's lesson, learned the expensive way: a valid signature is not authorization.
// Client portal tokens and admin tokens are signed with the same secret, so any
// endpoint that checked only "is this token valid?" was open to every client. V2
// therefore separates four questions and answers all four, every time:
//
//   WHO is this?            → authenticate()          — from the token
//   WHAT may they do?       → requireReviewer() / requireApprovalAuthority()
//   WHOSE data is this?     → resolveOrgScope()       — from SERVER-SIDE membership
//   IS THIS A HUMAN?        → actor_type
//
// The third question is deliberately not answered by the token. An earlier version
// read `org` / `orgs` claims, which let the caller name the organisations it was
// allowed to touch — the boundary being defined by the party it constrains. Those
// claims are now ignored; there is no code path in V2 that reads them. Scope comes
// from a membership record in V2 storage (see _membership.js).

const { verifyJWT, getToken } = require('../_utils');
const { principalIdFrom, loadMembership, hasOrg } = require('./_membership');

const REVIEWER_ROLES = Object.freeze(['admin', 'reviewer', 'principal_reviewer']);
const APPROVAL_ROLES = Object.freeze(['admin', 'principal_reviewer', 'reviewer']);
const ACTOR_TYPES = Object.freeze(['human', 'ai', 'system']);

function deny(code, status, error) { return { ok: false, code, status, error }; }

// ── Signing secret posture ───────────────────────────────────────────────────
//
// api/_utils.js falls back to a hardcoded string when no secret is configured, and
// .env.example publishes a plausible-looking SESSION_SECRET. The repository is
// PUBLIC, so both strings are known to anyone. If either were ever the live value,
// admin tokens could be forged by a stranger.
//
// V1's fallback is left exactly as it is — changing it is a Production code change
// and is out of scope here. V2 instead refuses to serve at all under those
// conditions, which fixes the exposure for everything V2 owns without touching V1.
//
// The value is compared, never logged, never returned, never included in an error.
const PUBLISHED_SECRETS = Object.freeze([
  'hv-change-this-secret',             // api/_utils.js fallback — public in the repo
  'humvance-secret-change-this-2026'   // .env.example — public in the repo
]);
const MIN_SECRET_LENGTH = 24;

function assertSigningSecret(env = process.env) {
  const secret = env.JWT_SECRET || env.SESSION_SECRET || '';
  if (!secret) {
    return deny('signing_secret_missing', 503,
      'no JWT_SECRET or SESSION_SECRET is configured; V2 will not verify tokens against a default');
  }
  if (PUBLISHED_SECRETS.includes(secret)) {
    return deny('signing_secret_published', 503,
      'the configured signing secret is one of the strings published in this public repository; rotate it before serving V2');
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return deny('signing_secret_weak', 503,
      `the configured signing secret is shorter than ${MIN_SECRET_LENGTH} characters`);
  }
  return { ok: true };
}

/**
 * Build a principal from the request. Fails closed on anything unexpected.
 *
 * Recognised claims:
 *   sub / uid       – actor identity, when the issuer provides one
 *   role            – 'admin' | 'reviewer' | 'principal_reviewer' | 'client'
 *   actor_type      – 'human' | 'ai' | 'system'   (absent ⇒ 'human')
 *
 * Deliberately NOT recognised: org, orgs, and any other claim naming what the
 * caller may reach.
 */
function authenticate(req) {
  const payload = verifyJWT(getToken(req));
  if (!payload) return deny('unauthenticated', 401, 'Unauthorized');

  const actor_type = payload.actor_type || 'human';
  if (!ACTOR_TYPES.includes(actor_type)) return deny('invalid_actor_type', 401, 'Unauthorized');

  // No safe identity ⇒ no principal. A request is refused rather than attributed
  // to a placeholder, because an unattributable action cannot be audited.
  const actor_id = principalIdFrom(payload);
  if (!actor_id) return deny('unidentified_principal', 401, 'Unauthorized');

  return {
    ok: true,
    principal: {
      actor_id,
      actor_type,
      role: payload.role || null,
      token_issued_at: payload.iat || null
    }
  };
}

/** Humvance-internal reviewer surface. Client portal tokens never qualify. */
function requireReviewer(principal) {
  if (!principal) return deny('unauthenticated', 401, 'Unauthorized');
  if (!REVIEWER_ROLES.includes(principal.role)) return deny('forbidden_role', 403, 'غير مصرح');
  return { ok: true };
}

/**
 * Tenant scope, decided against a membership record loaded from V2 storage.
 * Pure: the caller loads the record, so this stays testable and so there is
 * exactly one place that fetches it.
 *
 * Returns 404, not 403, on a non-member organisation: confirming that an
 * organisation exists outside the caller's scope is already a disclosure.
 */
function resolveOrgScope(membership, principal, requestedOrgId) {
  if (!principal) return deny('unauthenticated', 401, 'Unauthorized');
  if (typeof requestedOrgId !== 'string' || !requestedOrgId) {
    return deny('organization_required', 400, 'organization_id is required');
  }
  if (!membership || !Array.isArray(membership.orgs) || membership.orgs.length === 0) {
    return deny('no_org_membership', 403,
      'this principal is not a member of any organization; membership is granted server-side, never claimed by the caller');
  }
  if (!hasOrg(membership, requestedOrgId)) return deny('not_found', 404, 'not found');
  return { ok: true, organization_id: requestedOrgId };
}

/**
 * The approval gate. Two independent conditions, both required:
 *   1. a human actor — AI may propose, draft and challenge, never approve;
 *   2. an approval-bearing role.
 */
function requireApprovalAuthority(principal) {
  if (!principal) return deny('unauthenticated', 401, 'Unauthorized');
  if (principal.actor_type !== 'human') {
    return deny('human_required', 403,
      'approval requires a human reviewer; AI actors may propose, draft and challenge but never approve');
  }
  if (!APPROVAL_ROLES.includes(principal.role)) {
    return deny('forbidden_role', 403, 'this role may not approve material findings');
  }
  return { ok: true };
}

/**
 * Convenience for handlers: authenticate → reviewer role → membership → scope.
 * Async because the third step is a storage read, which is the whole point.
 */
async function authorizeReviewer(store, req, requestedOrgId) {
  const a = authenticate(req);
  if (!a.ok) return a;
  const r = requireReviewer(a.principal);
  if (!r.ok) return r;
  const membership = await loadMembership(store, a.principal.actor_id);
  const s = resolveOrgScope(membership, a.principal, requestedOrgId);
  if (!s.ok) return s;
  return { ok: true, principal: a.principal, organization_id: s.organization_id, membership };
}

module.exports = {
  REVIEWER_ROLES, APPROVAL_ROLES, ACTOR_TYPES, PUBLISHED_SECRETS, MIN_SECRET_LENGTH,
  assertSigningSecret,
  authenticate, requireReviewer, resolveOrgScope, requireApprovalAuthority, authorizeReviewer
};
