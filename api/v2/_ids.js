'use strict';
// Humvance V2 — server-generated opaque identifiers.
//
// V1 encoded business meaning into identifiers (`HUM-2026-1234`) and then
// interpolated them straight into storage keys (`client:${ref}`). That coupling
// is what made a caller-supplied ref able to address another artifact's key, and
// it is the defect Hotfix 01 had to close in production. V2 does not repeat it:
//
//   * identifiers are minted here, server-side, from crypto.randomBytes;
//   * they carry no business meaning, so nothing is tempted to parse them;
//   * the alphabet is Crockford base32 minus i/l/o/u, so an identifier can never
//     contain '.', ':', '/', '*' or any other character with meaning to the
//     storage layer.
//
// A caller may still SEND an id (to address an existing object) — so every read
// path validates it here before it reaches _store.js.

const crypto = require('crypto');

// Crockford base32 without i, l, o, u: unambiguous when read aloud or typed.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const ID_BODY_LEN = 26;                 // 26 * 5 = 130 bits of alphabet space
const RANDOM_BYTES = 17;                // 136 bits drawn, 130 consumed

const PREFIXES = Object.freeze({
  org:          'org',
  case:         'case',
  claim:        'clm',
  hypothesis:   'hyp',
  evidence:     'evd',
  evidenceReq:  'erq',
  contradiction:'ctr',
  finding:      'fnd',
  challenge:    'chg',
  approval:     'apr',
  audit:        'aud',
  actor:        'act',
  // Diagnostic Intake V2. An intake seed is minted for an ANONYMOUS caller, so it
  // is the one identifier a stranger ever holds. It is opaque for the same reason
  // every other id here is: nothing about it can be guessed, parsed or enumerated,
  // and it carries no meaning that would tempt anything to interpret it.
  intakeSeed:   'seed',
  intakeReview: 'irv'
});

const VALID_PREFIXES = new Set(Object.values(PREFIXES));

function newId(prefix) {
  if (!VALID_PREFIXES.has(prefix)) {
    throw new Error(`newId: unknown prefix "${prefix}"`);
  }
  const bytes = crypto.randomBytes(RANDOM_BYTES);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < ID_BODY_LEN; i++) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return `${prefix}_${out}`;
}

// Anchored, prefix-bound, fixed length. Deliberately NOT a general "safe
// characters" check: Phase 3's `_meeting-core.isValidRef` allowed
// /^[A-Za-z0-9._-]+$/, which permits a '.' and therefore permits
// `HUM-2026-1234.diagnostic` — exactly the namespace escape V2 must not inherit.
function isId(prefix, value) {
  if (!VALID_PREFIXES.has(prefix)) return false;
  if (typeof value !== 'string') return false;
  if (value.length !== prefix.length + 1 + ID_BODY_LEN) return false;
  const re = new RegExp(`^${prefix}_[${ALPHABET}]{${ID_BODY_LEN}}$`);
  return re.test(value);
}

// True for any well-formed V2 id of any known type. Used by the storage layer as
// a last line of defence before a key is composed.
function isAnyId(value) {
  if (typeof value !== 'string') return false;
  const underscore = value.indexOf('_');
  if (underscore < 0) return false;
  return isId(value.slice(0, underscore), value);
}

module.exports = { PREFIXES, newId, isId, isAnyId, ALPHABET, ID_BODY_LEN };
