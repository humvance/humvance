'use strict';
// Humvance V2 — organization membership.
//
// WHY THIS EXISTS
//
// V2's tenant boundary is only as good as the answer to "which organisations may
// this principal touch?". The first implementation read that answer from the JWT
// (`org` / `orgs` claims). That was wrong in kind, not just in degree: a claim is
// something the caller presents, so the boundary was being defined by the party it
// exists to constrain. Anyone able to mint a token — today only the secret holder,
// but that is a property of the secret, not of the design — could name any
// organisation and be believed.
//
// Membership now lives in V2 storage, server-side, and the token is used ONLY to
// establish identity. `org` and `orgs` claims are ignored entirely; there is no
// code path that reads them.
//
// HOW MEMBERSHIP IS ACQUIRED
//
// Two ways, both server-side:
//   1. Creating an organisation makes the creator a member of it.
//   2. An existing member may grant access to another principal.
// There is no third way, and neither can be triggered by the contents of a token.
//
// KNOWN LIMITATION — READ docs/ENGINEERING-STATE.md BEFORE RELYING ON THIS
//
// V1 issues exactly one admin token shape: signJWT({ role:'admin' }) — no `sub`,
// no `uid`, no subject of any kind, minted against a single shared password hash
// at `admin:password_hash`. So every Humvance reviewer authenticating through V1
// today is literally the same principal, and this module represents that honestly
// as `admin:shared` rather than inventing a per-person identity that does not
// exist. Membership therefore separates CLIENT organisations from each other — the
// boundary that matters for client data — but it cannot separate reviewer from
// reviewer, because V1 cannot tell them apart. Fixing that needs a reviewer
// identity model (per-person accounts and per-person credentials), which is a V1
// change and is deliberately not attempted here.

const crypto = require('crypto');

// A principal id is stored, audited and used to compose a storage key, so it is
// bounded and its byte encoding is pinned.
const MAX_PRINCIPAL_BYTES = 56;

/**
 * Derive a stable principal id from a verified token payload.
 * Returns null when no safe identity can be established — the caller must then
 * refuse the request rather than substitute a default.
 */
function principalIdFrom(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const sub = payload.sub || payload.uid;
  if (typeof sub === 'string' && sub.length > 0) {
    // Printable ASCII only, bounded. A subject carrying control characters or
    // multi-byte oddities is refused rather than normalised.
    if (!/^[\x21-\x7e]+$/.test(sub)) return null;
    if (Buffer.byteLength(sub, 'utf8') > MAX_PRINCIPAL_BYTES - 4) return null;
    return `sub:${sub}`;
  }

  // V1's subject-less admin token. Named explicitly so that the audit trail says
  // "the shared admin account" instead of "unknown", and so that the day V1 grows
  // real accounts, the difference is visible in the data rather than silent.
  if (payload.role === 'admin') return 'admin:shared';

  return null;
}

// Storage ids may not contain ':' (see _store.KEY_RE), and a lossy substitution
// would let two distinct principals collide. Hex is injective and in-alphabet.
function membershipId(principalId) {
  if (typeof principalId !== 'string' || !principalId.length) {
    throw new Error('membershipId: principal id is required');
  }
  if (Buffer.byteLength(principalId, 'utf8') > MAX_PRINCIPAL_BYTES) {
    throw new Error('membershipId: principal id exceeds the bound');
  }
  return Buffer.from(principalId, 'utf8').toString('hex');
}

function decodeMembershipId(hex) {
  return Buffer.from(hex, 'hex').toString('utf8');
}

/** Never returns null: an unknown principal is a principal with no organisations. */
async function loadMembership(store, principalId) {
  const rec = await store.get('membership', membershipId(principalId));
  if (!rec) return { principal_id: principalId, orgs: [], exists: false };
  return {
    principal_id: principalId,
    orgs: Array.isArray(rec.orgs) ? rec.orgs.slice() : [],
    exists: true,
    created_at: rec.created_at,
    updated_at: rec.updated_at
  };
}

function hasOrg(membership, organization_id) {
  return !!membership && Array.isArray(membership.orgs) && membership.orgs.includes(organization_id);
}

/**
 * Idempotently add an organisation to a principal's membership.
 * Returns { granted:boolean, orgs:string[] } — `granted:false` means it was
 * already present, which callers treat as success, not as an error.
 */
async function grantOrg(store, principalId, organization_id, { granted_by = null } = {}) {
  const id = membershipId(principalId);
  const now = Date.now();
  const current = await store.get('membership', id);

  if (!current) {
    const rec = {
      membership_id: id,
      principal_id: principalId,
      orgs: [organization_id],
      created_at: now,
      updated_at: now,
      granted_by
    };
    // putIfAbsent, then fall through to the merge path if we lost a race.
    if (await store.putIfAbsent('membership', id, rec)) {
      return { granted: true, orgs: rec.orgs.slice() };
    }
  }

  const rec = (await store.get('membership', id)) || {
    membership_id: id, principal_id: principalId, orgs: [], created_at: now
  };
  if (Array.isArray(rec.orgs) && rec.orgs.includes(organization_id)) {
    return { granted: false, orgs: rec.orgs.slice() };
  }
  rec.orgs = (rec.orgs || []).concat([organization_id]);
  rec.updated_at = now;
  rec.granted_by = granted_by;
  await store.put('membership', id, rec);
  return { granted: true, orgs: rec.orgs.slice() };
}

/**
 * A digest of the principal id, for logs and reports. Membership is not secret,
 * but a stable short handle keeps reviewer identities out of anything shared.
 */
function principalDigest(principalId) {
  return crypto.createHash('sha256').update(String(principalId)).digest('hex').slice(0, 12);
}

module.exports = {
  MAX_PRINCIPAL_BYTES,
  principalIdFrom, membershipId, decodeMembershipId,
  loadMembership, hasOrg, grantOrg, principalDigest
};
