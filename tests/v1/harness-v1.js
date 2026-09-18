'use strict';
// Test rig for the V1 auth consolidation.
//
// It gives the frozen Production handlers and the consolidated one the same
// isolated world — the same fake KV, the same clock, the same random source, the
// same outbound-email stub — so that any difference in what they return or in
// what they do to storage is a real difference and not test noise.
//
// NOTHING REAL IS TOUCHED. There is no database, no network, no secret and no
// customer data anywhere in this file. `@vercel/kv` is not even installed in this
// checkout; it is intercepted at require time and never resolved.

const path = require('path');
const Module = require('module');

const REPO = path.join(__dirname, '..', '..');

// ── The fake KV ──────────────────────────────────────────────────────────────
//
// One stable object, captured once by every handler at require time, whose
// behaviour is reset between runs. Every operation is recorded in order, because
// "did it delete the OTP before writing the hash?" is part of the behaviour under
// test, not an implementation detail.

const state = { store: new Map(), calls: [], failOn: null };

function record(op, args) {
  state.calls.push({ op, args: JSON.parse(JSON.stringify(args === undefined ? null : args)) });
}

const kv = {
  async get(key) {
    record('get', [key]);
    if (state.failOn === 'get' || state.failOn === 'all') throw new Error('kv unavailable (injected)');
    return state.store.has(key) ? state.store.get(key) : null;
  },
  async set(key, value, opts) {
    record('set', opts === undefined ? [key, value] : [key, value, opts]);
    if (state.failOn === 'set' || state.failOn === 'all') throw new Error('kv unavailable (injected)');
    state.store.set(key, value);
    return 'OK';
  },
  async del(key) {
    record('del', [key]);
    if (state.failOn === 'del' || state.failOn === 'all') throw new Error('kv unavailable (injected)');
    state.store.delete(key);
    return 1;
  }
};

function resetKv({ seed = {}, failOn = null } = {}) {
  state.store = new Map(Object.entries(seed));
  state.calls = [];
  state.failOn = failOn;
}
function kvCalls() { return state.calls.slice(); }
function kvDump() { return Object.fromEntries(state.store); }

// ── Module loading ───────────────────────────────────────────────────────────
//
// `@vercel/kv` is a real dependency of the deployed app and is absent from this
// checkout, so it is intercepted rather than resolved. The hook is installed for
// exactly as long as it takes to load the handlers and is then removed, so no
// later require in any test can be affected by it.

function withKvHook(fn) {
  const original = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === '@vercel/kv') return { kv };
    return original.apply(this, arguments);
  };
  try { return fn(); } finally { Module.prototype.require = original; }
}

const ACTIONS = ['login', 'setup', 'status', 'forgot', 'reset'];

const loaded = withKvHook(() => {
  const baseline = {};
  for (const a of ACTIONS) baseline[a] = require(path.join(REPO, 'tests/fixtures/v1-auth-baseline', a + '.js'));
  const consolidatedModule = require(path.join(REPO, 'api/auth/[action].js'));
  return { baseline, consolidatedModule };
});

const baselineHandlers = loaded.baseline;
const consolidatedModule = loaded.consolidatedModule;
const consolidatedHandlers = consolidatedModule.__actions;

// Proof that the hook is gone: a later `require('@vercel/kv')` would now throw.
// Asserted in the test suite rather than here, so a failure is reported not hidden.
function kvHookIsRemoved() {
  try { require('@vercel/kv'); return false; } catch { return true; }
}

// ── Request and response doubles ─────────────────────────────────────────────

function mockReq({ method = 'POST', url = '/api/auth/login', query = null, body = undefined, headers = {} } = {}) {
  const req = { method, url, headers: Object.assign({}, headers) };
  if (query !== null) req.query = query;
  if (body !== undefined) req.body = body;
  return req;
}

function mockRes() {
  const out = { statusCode: null, body: undefined, headers: {} };
  const res = {
    setHeader(k, v) { out.headers[k] = v; return res; },
    status(c) { out.statusCode = c; return res; },
    json(b) { out.body = b; return res; }
  };
  res.__out = out;
  return res;
}

// ── Controlled nondeterminism ────────────────────────────────────────────────
//
// signJWT stamps Date.now(), and the OTP comes from Math.random(). Pinning both
// is what turns "the two handlers behave similarly" into "the two handlers return
// the same bytes". Every global is restored in the finally, so one case can never
// contaminate the next.

const FIXED_NOW = 1789700000000;
const FIXED_RANDOM = 0.4242424242;

async function invoke(handler, request, { seed = {}, failOn = null, env = {}, fetchImpl = null } = {}) {
  const realNow = Date.now;
  const realRandom = Math.random;
  const realFetch = global.fetch;
  const realEnv = {};
  for (const k of Object.keys(env)) realEnv[k] = process.env[k];

  const fetchCalls = [];
  try {
    Date.now = () => FIXED_NOW;
    Math.random = () => FIXED_RANDOM;
    global.fetch = fetchImpl || (async (url, opts) => {
      fetchCalls.push({ url, method: opts && opts.method });
      return { ok: true, status: 200, async text() { return ''; }, async json() { return {}; } };
    });
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }

    resetKv({ seed, failOn });
    const res = mockRes();
    await handler(request, res);
    return {
      status: res.__out.statusCode,
      body: res.__out.body,
      headers: res.__out.headers,
      kv: kvCalls(),
      store: kvDump(),
      fetchCalls
    };
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
    if (realFetch === undefined) delete global.fetch; else global.fetch = realFetch;
    for (const k of Object.keys(env)) {
      if (realEnv[k] === undefined) delete process.env[k]; else process.env[k] = realEnv[k];
    }
  }
}

/** Run the frozen Production handler and the consolidated one on identical input. */
async function comparePair(action, request, opts = {}) {
  const before = await invoke(baselineHandlers[action], mockReq(request), opts);
  const after = await invoke(consolidatedHandlers[action], mockReq(request), opts);
  return { before, after };
}

module.exports = {
  ACTIONS, REPO,
  baselineHandlers, consolidatedHandlers, consolidatedModule,
  mockReq, mockRes, invoke, comparePair,
  resetKv, kvCalls, kvDump, kvHookIsRemoved,
  FIXED_NOW, FIXED_RANDOM
};
