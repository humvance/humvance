'use strict';
// Humvance V2 — authentication, authorization and the AI governance boundary.
//
// V1's lesson, learned the expensive way: a valid signature is not authorization.
// Client portal tokens and admin tokens are signed with the same secret, so any
// endpoint that checked only "is this token valid?" was open to every client. V2
// therefore separates three questions and answers all three, every time:
//
//   WHO is this?            → authenticate()
//   WHAT may they do?       → requireReviewer() / requireApprovalAuthority()
//   WHOSE data is this?     → resolveOrgScope()
//
// And a fourth that V1 never had to ask:
//
//   IS THIS A HUMAN?        → actor_type
//
// The AI governance rules in §0 are enforced here and in _domain.canTransition(),
// in code. A prompt that says "never approve" is a hope; a server that refuses an
// approval from a non-human actor is a control.

const { verifyJWT, getToken } = require('../_utils');

const REVIEWER_ROLES = Object.freeze(['admin', 'reviewer', 'principal_reviewer']);
const APPROVAL_ROLES = Object.freeze(['admin', 'principal_reviewer', 'reviewer']);

function deny(code, status, error) { return { ok: false, code, status, error }; }

/**
 * Build a principal from the request. Fails closed on anything unexpected.
 *
 * Recognised claims:
 *   sub / uid       – actor identity
 *   role            – 'admin' | 'reviewer' | 'principal_reviewer' | 'client'
 *   actor_type      – 'human' | 'ai' | 'system'   (absent ⇒ 'human')
 *   org             – a single organization id the token is scoped to
 *   orgs            – several organization ids
 */
function authenticate(req) {
  const payload = verifyJWT(getToken(req));
  if (!payload) return deny('unauthenticated', 401, 'Unauthorized');

  const actor_type = payload.actor_type || 'human';
  if (!['human', 'ai', 'system'].includes(actor_type)) {
    return deny('invalid_actor_type', 401, 'Unauthorized');
  }

  const allowed = [];
  if (typeof payload.org === 'string') allowed.push(payload.org);
  if (Array.isArray(payload.orgs)) for (const o of payload.orgs) if (typeof o === 'string') allowed.push(o);

  return {
    ok: true,
    principal: {
      actor_id: String(payload.sub || payload.uid || payload.ref || 'unknown'),
      actor_type,
      role: payload.role || null,
      allowed_orgs: Array.from(new Set(allowed)),
      token_issued_at: payload.iat || null
    }
  };
}

/** Humvance-internal reviewer surface. Client portal tokens never qualify. */
function requireReviewer(principal) {
  if (!principal) return deny('unauthenticated', 401, 'Unauthorized');
  if (!REVIEWER_ROLES.includes(principal.role)) {
    return deny('forbidden_role', 403, 'غير مصرح');
  }
  return { ok: true };
}

/**
 * Tenant scope. A reviewer may work across several client organisations, but the
 * token must say which — an unscoped token is refused rather than treated as
 * "all organisations". Fail closed.
 *
 * Returns 404, not 403, on a mismatch: confirming that a Case exists in another
 * organisation is already a disclosure.
 */
function resolveOrgScope(principal, requestedOrgId) {
  if (!principal) return deny('unauthenticated', 401, 'Unauthorized');
  if (typeof requestedOrgId !== 'string' || !requestedOrgId) {
    return deny('organization_required', 400, 'organization_id is required');
  }
  if (!principal.allowed_orgs.length) {
    return deny('unscoped_token', 403, 'token is not scoped to any organization');
  }
  if (!principal.allowed_orgs.includes(requestedOrgId)) {
    return deny('not_found', 404, 'not found');
  }
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

/** Convenience for handlers: authenticate + reviewer + org scope in one step. */
function authorizeReviewer(req, requestedOrgId) {
  const a = authenticate(req);
  if (!a.ok) return a;
  const r = requireReviewer(a.principal);
  if (!r.ok) return r;
  const s = resolveOrgScope(a.principal, requestedOrgId);
  if (!s.ok) return s;
  return { ok: true, principal: a.principal, organization_id: s.organization_id };
}

module.exports = {
  REVIEWER_ROLES, APPROVAL_ROLES,
  authenticate, requireReviewer, resolveOrgScope, requireApprovalAuthority, authorizeReviewer
};
