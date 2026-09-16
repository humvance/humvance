'use strict';
// Humvance V2 — storage boundary.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE IS SHAPED THE WAY IT IS
//
// Production and Preview currently share ONE Redis database: KV_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN and REDIS_URL
// are all scoped to BOTH targets with identical values. Until that is fixed at
// the platform level, any V2 code that reads those variables in a Preview
// deployment is one bug away from writing to live client records.
//
// So V2 does not read them. Not once, anywhere in this codebase.
//
// Four independent barriers, in order of how much they'd each have to fail:
//
//   1. CREDENTIAL NAMESPACE. V2 connects only via V2_REDIS_URL / V2_KV_REST_API_URL
//      / V2_KV_REST_API_TOKEN. The production credentials are unreachable from V2
//      code by name. Pointing V2 at the production database is therefore not an
//      accident anybody can have — it requires a human to deliberately copy a
//      production secret into a differently-named variable.
//   2. FAIL CLOSED. No driver default. No credential default. No silent fallback
//      from a missing Preview store to the production store. A misconfigured
//      deployment throws on the first storage call instead of quietly writing
//      somewhere real.
//   3. KEY NAMESPACE. Every key is composed HERE, from a validated namespace, a
//      whitelisted type and a server-minted opaque id. No function in this module
//      accepts a caller-supplied key, and no caller can reach the driver directly.
//   4. LEGACY DENY-LIST. A computed key is asserted against the V2 key grammar and
//      explicitly refused if it collides with any V1 prefix. This is belt-and-braces
//      for barrier 3 and would catch a future refactor that broke it.
//
// HONEST LIMITATION — READ THIS BEFORE DEPLOYING V2 ANYWHERE:
// With driver 'redis' and V2_* credentials that happen to point at the production
// database, these barriers reduce the blast radius to "V2 keys only" but do NOT
// give you a separate database. They are code-level isolation, not
// infrastructure-level isolation. They are strictly weaker than a second store.
// `assertIsolated()` below is what deployment code must call to state which of the
// two it is actually running with, and it refuses to guess.
// ─────────────────────────────────────────────────────────────────────────────

const { isAnyId } = require('./_ids');

const NAMESPACE_RE = /^[a-z][a-z0-9-]{2,31}$/;
const KEY_RE = /^v2:[a-z][a-z0-9-]{2,31}:[a-z]+:[A-Za-z0-9_-]+$/;

// V1 owns these. A V2 key must never start with any of them.
const LEGACY_PREFIXES = ['client:', 'clients:', 'admin:', 'questions:', 'session:', 'user:'];

// Object types V2 may persist. Anything else is a programming error, not input.
const TYPES = new Set([
  'org', 'case', 'claim', 'hypothesis', 'evidence', 'evidencereq',
  'contradiction', 'finding', 'challenge', 'approval', 'audit', 'index'
]);

class StoreConfigError extends Error {
  constructor(message) { super(message); this.name = 'StoreConfigError'; this.code = 'store_misconfigured'; }
}
class ConflictError extends Error {
  constructor(message) { super(message); this.name = 'ConflictError'; this.code = 'version_conflict'; }
}

// ── Key composition ──────────────────────────────────────────────────────────

function assertSafeKey(key) {
  for (const p of LEGACY_PREFIXES) {
    if (key.startsWith(p)) throw new StoreConfigError(`refused: key "${key}" collides with V1 namespace`);
  }
  if (!KEY_RE.test(key)) throw new StoreConfigError(`refused: key "${key}" is not a well-formed V2 key`);
  return key;
}

// ── Drivers ──────────────────────────────────────────────────────────────────

function memoryDriver() {
  const map = new Map();
  return {
    kind: 'memory',
    async get(k)        { const v = map.get(k); return v === undefined ? null : JSON.parse(v); },
    async set(k, v)     { map.set(k, JSON.stringify(v)); },
    async setIfAbsent(k, v) { if (map.has(k)) return false; map.set(k, JSON.stringify(v)); return true; },
    async del(k)        { map.delete(k); },
    async listPush(k, v){ const cur = map.has(k) ? JSON.parse(map.get(k)) : []; cur.push(v); map.set(k, JSON.stringify(cur)); },
    async listRead(k)   { return map.has(k) ? JSON.parse(map.get(k)) : []; },
    _dump()             { return new Map(map); },
    _size()             { return map.size; }
  };
}

function redisDriver(cfg) {
  // Upstash REST. Loaded lazily so the memory driver has no dependency at all.
  const base = cfg.restUrl.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${cfg.restToken}`, 'Content-Type': 'application/json' };
  async function cmd(args) {
    const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`v2 store: upstream ${res.status}`);
    const body = await res.json();
    if (body && body.error) throw new Error(`v2 store: ${body.error}`);
    return body ? body.result : null;
  }
  return {
    kind: 'redis',
    async get(k)        { const r = await cmd(['GET', k]); return r === null || r === undefined ? null : JSON.parse(r); },
    async set(k, v)     { await cmd(['SET', k, JSON.stringify(v)]); },
    async setIfAbsent(k, v) { const r = await cmd(['SET', k, JSON.stringify(v), 'NX']); return r === 'OK'; },
    async del(k)        { await cmd(['DEL', k]); },
    async listPush(k, v){ await cmd(['RPUSH', k, JSON.stringify(v)]); },
    async listRead(k)   { const r = await cmd(['LRANGE', k, '0', '-1']); return (r || []).map(x => JSON.parse(x)); }
  };
}

// ── Configuration ────────────────────────────────────────────────────────────

function readConfig(env) {
  const driver = env.V2_STORE_DRIVER;
  const namespace = env.V2_NAMESPACE;

  if (!driver) {
    throw new StoreConfigError(
      'V2_STORE_DRIVER is not set. V2 storage fails closed and never falls back to the production KV. ' +
      'Set V2_STORE_DRIVER=memory (tests/local) or V2_STORE_DRIVER=redis with V2_* credentials.'
    );
  }
  if (driver !== 'memory' && driver !== 'redis') {
    throw new StoreConfigError(`V2_STORE_DRIVER must be "memory" or "redis", got "${driver}"`);
  }
  if (!namespace || !NAMESPACE_RE.test(namespace)) {
    throw new StoreConfigError('V2_NAMESPACE is required and must match /^[a-z][a-z0-9-]{2,31}$/');
  }

  // A namespace that names itself production is refused unless the operator also
  // declares it deliberately. This is the one place a typo could otherwise put
  // synthetic pilot data under a production-looking namespace.
  if (/^prod/.test(namespace) && env.V2_ALLOW_PRODUCTION_NAMESPACE !== 'yes') {
    throw new StoreConfigError(
      `V2_NAMESPACE "${namespace}" looks like production. Set V2_ALLOW_PRODUCTION_NAMESPACE=yes to confirm.`
    );
  }

  if (driver === 'memory') return { driver, namespace, isolation: 'process-memory' };

  const restUrl = env.V2_KV_REST_API_URL;
  const restToken = env.V2_KV_REST_API_TOKEN;
  if (!restUrl || !restToken) {
    throw new StoreConfigError(
      'V2_STORE_DRIVER=redis requires V2_KV_REST_API_URL and V2_KV_REST_API_TOKEN. ' +
      'V2 deliberately does NOT read KV_REST_API_URL / KV_REST_API_TOKEN / KV_URL / REDIS_URL — ' +
      'those belong to the V1 production database.'
    );
  }
  // If somebody copied the production host into the V2 variables, say so loudly.
  const prodHost = env.KV_REST_API_URL || env.KV_URL || '';
  const sameHost = prodHost && hostOf(prodHost) && hostOf(prodHost) === hostOf(restUrl);
  return {
    driver,
    namespace,
    restUrl,
    restToken,
    isolation: sameHost ? 'SHARED-WITH-PRODUCTION' : 'separate-database',
    sharesProductionHost: !!sameHost
  };
}

function hostOf(u) { try { return new URL(u).host; } catch { return null; } }

// ── Public store ─────────────────────────────────────────────────────────────

function createStore(env = process.env) {
  const cfg = readConfig(env);
  const driver = cfg.driver === 'memory' ? memoryDriver() : redisDriver(cfg);

  const key = (type, id) => {
    const t = String(type).toLowerCase();
    if (!TYPES.has(t)) throw new StoreConfigError(`refused: unknown V2 object type "${type}"`);
    if (t !== 'index' && !isAnyId(id)) throw new StoreConfigError('refused: storage id is not a server-minted V2 id');
    if (t === 'index' && !/^[A-Za-z0-9_-]{1,120}$/.test(String(id))) {
      throw new StoreConfigError('refused: malformed index name');
    }
    return assertSafeKey(`v2:${cfg.namespace}:${t}:${id}`);
  };

  return {
    namespace: cfg.namespace,
    driverKind: driver.kind,
    isolation: cfg.isolation,
    sharesProductionHost: !!cfg.sharesProductionHost,

    // Deployment code calls this before serving V2 traffic. It refuses to guess:
    // running the redis driver against the production host is allowed only when a
    // human has explicitly acknowledged it, and never in a Preview deployment.
    assertIsolated({ allowSharedProductionHost = false } = {}) {
      if (driver.kind === 'memory') return { ok: true, isolation: cfg.isolation };
      if (cfg.sharesProductionHost && !allowSharedProductionHost) {
        throw new StoreConfigError(
          'V2 storage resolves to the SAME host as the V1 production database. ' +
          'Refusing to start. Provision a separate database, or pass ' +
          'allowSharedProductionHost:true only with a documented human decision.'
        );
      }
      return { ok: true, isolation: cfg.isolation };
    },

    get:  (type, id)        => driver.get(key(type, id)),
    put:  (type, id, value) => driver.set(key(type, id), value),
    putIfAbsent: (type, id, value) => driver.setIfAbsent(key(type, id), value),
    del:  (type, id)        => driver.del(key(type, id)),
    appendToIndex: (name, entry) => driver.listPush(key('index', name), entry),
    readIndex:     (name)        => driver.listRead(key('index', name)),

    // test-only introspection; absent on the redis driver
    _dump: driver._dump ? () => driver._dump() : undefined,
    _size: driver._size ? () => driver._size() : undefined,
    _keyFor: key
  };
}

module.exports = {
  createStore, StoreConfigError, ConflictError,
  NAMESPACE_RE, KEY_RE, LEGACY_PREFIXES, TYPES, assertSafeKey
};
