'use strict';
// V1 auth consolidation — the dispatcher.
//
// Equivalence (auth-equivalence.test.js) proves each handler still behaves like
// its Production original. This file proves the thing that did not exist before
// the consolidation and is therefore the new risk surface: the code that decides
// WHICH handler a request reaches.
//
// The property under test is not "the five URLs work". It is:
//
//     the public URL decides the action; a caller-supplied query parameter may
//     agree with it, may never override it, and anything ambiguous or unknown
//     fails closed with 404 and touches nothing.
//
// Every refusal case below asserts three things, not one: the status, that no
// handler ran (no KV operation, no outbound call), and that stored state is
// unchanged. A dispatcher that answered 404 *after* running `reset` would pass a
// status-only test and would be a serious defect.
//
// NOT ESTABLISHED HERE: how Vercel's runtime actually populates `req.query` for a
// dynamic path segment, and whether a caller can inject `?action=` alongside it.
// That is unverifiable without a deployment. The dispatcher is written to be
// correct under every representation we can think of, and this file exercises
// both of the plausible ones — dynamic segment and explicit rewrite — plus the
// hostile mixtures. It does not claim the question is closed.

const { suite, test, assert } = require('../v2/harness');
const H = require('./harness-v1');

const { hashPassword } = require('../../api/_utils');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-signing-secret-for-equivalence-2026';

const dispatch = H.consolidatedModule;
const ADMIN_HASH = hashPassword('correct-horse');

// ── Probes ───────────────────────────────────────────────────────────────────
//
// One request per action whose answer is unique to that action, so a dispatch
// result identifies the handler that ran beyond doubt. None of them writes.

const PROBE = {
  status: {
    method: 'GET',
    expect: { status: 200, body: { setupDone: false, authenticated: false } }
  },
  login: {
    method: 'POST', body: {},
    expect: { status: 400, body: { error: 'كلمة المرور مطلوبة' } }
  },
  setup: {
    method: 'POST', body: {},
    expect: { status: 400, body: { error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' } }
  },
  forgot: {
    method: 'POST', body: { email: 'not-the-admin@example.invalid' },
    expect: { status: 200, body: { sent: true } }
  },
  reset: {
    method: 'POST', body: {},
    expect: { status: 400, body: { error: 'الرمز وكلمة المرور مطلوبان' } }
  }
};

/** Dispatch a request and assert it reached exactly `action`'s handler. */
async function reaches(action, request, label, opts = {}) {
  const p = PROBE[action];
  const r = await H.invoke(dispatch, H.mockReq(Object.assign({ method: p.method, body: p.body }, request)), opts);
  assert.equal(r.status, p.expect.status, `${label}: expected to reach ${action} (status)`);
  assert.deepEqual(r.body, p.expect.body, `${label}: expected to reach ${action} (body)`);
  return r;
}

/**
 * Dispatch a request and assert it was refused: 404, JSON headers, and — the
 * part that matters — no handler side effect of any kind.
 */
async function refused(request, label, opts = {}) {
  const r = await H.invoke(dispatch, H.mockReq(request), opts);
  assert.equal(r.status, 404, `${label}: must be refused with 404`);
  assert.deepEqual(r.body, { error: 'Not found' }, `${label}: refusal body`);
  assert.equal(r.headers['Content-Type'], 'application/json', `${label}: refusal is still JSON`);
  assert.deepEqual(r.kv, [], `${label}: a refused request must not touch storage`);
  assert.deepEqual(r.fetchCalls, [], `${label}: a refused request must not call out`);
  assert.deepEqual(r.store, opts.seed || {}, `${label}: stored state unchanged`);
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────

suite('v1 auth dispatch — the five public URLs', () => {

  // Routing A: a dynamic segment. The action is in the path, and (on Vercel)
  // is also merged into req.query by the runtime.
  for (const action of H.ACTIONS) {
    test(`/api/auth/${action} — dynamic segment, action mirrored into query`, async () => {
      await reaches(action, { url: `/api/auth/${action}`, query: { action } }, `dynamic:${action}`);
    });
  }

  // Routing B: an explicit rewrite, /api/auth/login → /api/auth?action=login.
  // The action exists only in the query. Prepared as the fallback if dynamic
  // segments turn out not to be routed as expected; the handler supports both so
  // that switching is a config change, not a code change.
  for (const action of H.ACTIONS) {
    test(`/api/auth?action=${action} — explicit rewrite, action only in query`, async () => {
      await reaches(action, { url: '/api/auth', query: { action } }, `rewrite:${action}`);
    });
  }

  test('path alone is enough — no query object at all', async () => {
    await reaches('status', { url: '/api/auth/status' }, 'path-only');
  });

  test('a trailing slash still resolves', async () => {
    await reaches('status', { url: '/api/auth/status/' }, 'trailing-slash');
  });

  test('an unrelated query string on the URL is ignored', async () => {
    await reaches('status', { url: '/api/auth/status?t=1758153600000', query: { t: '1758153600000' } }, 'cache-buster');
  });

  test('the literal dynamic-segment filename is treated as no action', async () => {
    // If a runtime ever hands us the template rather than the resolved value,
    // the query must still be consulted rather than the template refused.
    await reaches('status', { url: '/api/auth/[action]', query: { action: 'status' } }, 'literal-template');
    await reaches('status', { url: '/api/auth/%5Baction%5D', query: { action: 'status' } }, 'encoded-template');
  });

  test('an unusable req.url falls back to the query, not to a guess', async () => {
    // `null` and `''` stand for a runtime that does not hand us a URL at all.
    // (`undefined` cannot be used here: it would take the rig's default URL.)
    await reaches('status', { url: null, query: { action: 'status' } }, 'null-url');
    await reaches('status', { url: '', query: { action: 'status' } }, 'empty-url');
    await reaches('status', { url: '/', query: { action: 'status' } }, 'root-url');
  });

  test('the method gate still belongs to the handler, not the dispatcher', async () => {
    // GET /api/auth/login must be the handler's 405, not the dispatcher's 404 —
    // otherwise consolidation would have changed an observable response.
    const r = await H.invoke(dispatch, H.mockReq({ method: 'GET', url: '/api/auth/login', query: { action: 'login' } }));
    assert.equal(r.status, 405);
    assert.deepEqual(r.body, { error: 'Method not allowed' });
  });
});

suite('v1 auth dispatch — unknown and missing actions fail closed', () => {

  test('the bare endpoint resolves to nothing', async () => {
    await refused({ method: 'GET', url: '/api/auth' }, 'bare');
    await refused({ method: 'GET', url: '/api/auth/' }, 'bare-slash');
    await refused({ method: 'POST', url: '/api/auth' }, 'bare-post');
  });

  test('an unknown path segment is refused', async () => {
    await refused({ method: 'POST', url: '/api/auth/logon' }, 'typo');
    await refused({ method: 'POST', url: '/api/auth/admin' }, 'invented');
    await refused({ method: 'GET', url: '/api/auth/status/extra' }, 'deeper-path');
  });

  test('an unknown query action is refused', async () => {
    await refused({ method: 'POST', url: '/api/auth', query: { action: 'logon' } }, 'query-typo');
    await refused({ method: 'POST', url: '/api/auth', query: { action: '' } }, 'query-empty');
  });

  test('action names are matched exactly — no case folding, no trimming', async () => {
    await refused({ method: 'GET', url: '/api/auth/STATUS' }, 'upper-path');
    await refused({ method: 'GET', url: '/api/auth', query: { action: 'Status' } }, 'mixed-query');
    await refused({ method: 'GET', url: '/api/auth', query: { action: ' status' } }, 'padded-query');
    await refused({ method: 'GET', url: '/api/auth', query: { action: 'status ' } }, 'trailing-space');
  });

  test('a path segment that merely contains an action name is refused', async () => {
    await refused({ method: 'POST', url: '/api/auth/login2' }, 'suffixed');
    await refused({ method: 'POST', url: '/api/auth/xlogin' }, 'prefixed');
  });
});

suite('v1 auth dispatch — the query may not override the URL', () => {

  test('a query action contradicting the path is refused, not resolved either way', async () => {
    // Neither `status` nor `reset` may run here. The seeded OTP proves reset did
    // not: if it had, the stored code would be gone.
    const seed = { 'admin:reset_otp': '424242' };
    await refused({ method: 'POST', url: '/api/auth/status', query: { action: 'reset' } }, 'status-vs-reset', { seed });
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: 'setup' } }, 'login-vs-setup', { seed: {} });
    await refused({ method: 'POST', url: '/api/auth/forgot', query: { action: 'login' } }, 'forgot-vs-login', { seed: {} });
  });

  test('an unknown path segment is refused even when the query names a real action', async () => {
    // The whole point: /api/auth/anything?action=login must not reach login.
    await refused({ method: 'POST', url: '/api/auth/anything', query: { action: 'login' } }, 'smuggle-via-path');
    await refused({ method: 'POST', url: '/api/auth/nonsense', query: { action: 'setup' } }, 'smuggle-setup');
  });

  test('a query action cannot escalate a read-only endpoint into a write', async () => {
    // GET /api/auth/status?action=setup with a body, against an unconfigured
    // store. If the query won, an admin password would be created by a GET.
    const r = await H.invoke(dispatch, H.mockReq({
      method: 'GET', url: '/api/auth/status', query: { action: 'setup' }, body: { password: 'hunter-2026' }
    }));
    assert.equal(r.status, 404, 'must refuse rather than run setup');
    assert.deepEqual(r.store, {}, 'no password may have been written');
    assert.deepEqual(r.kv, [], 'no storage access at all');
  });

  test('a query action agreeing with the path is accepted (the dynamic-segment case)', async () => {
    await reaches('setup', { url: '/api/auth/setup', query: { action: 'setup' } }, 'agreeing');
  });

  test('the action in the URL query string does not override the path either', async () => {
    // Some runtimes leave the raw query on req.url. The path segment is read
    // from the path portion only, and a contradicting query is still a refusal.
    await refused({ method: 'POST', url: '/api/auth/status?action=reset', query: { action: 'reset' } }, 'raw-query-conflict');
    await reaches('status', { url: '/api/auth/status?action=status', query: { action: 'status' } }, 'raw-query-agree');
  });
});

suite('v1 auth dispatch — ambiguous input fails closed', () => {

  test('a repeated ?action= parameter (array) is refused, not silently narrowed', async () => {
    await refused({ method: 'POST', url: '/api/auth', query: { action: ['login', 'reset'] } }, 'array-two');
    await refused({ method: 'POST', url: '/api/auth', query: { action: ['login', 'login'] } }, 'array-same');
    await refused({ method: 'POST', url: '/api/auth', query: { action: ['login'] } }, 'array-one');
    await refused({ method: 'POST', url: '/api/auth', query: { action: [] } }, 'array-empty');
  });

  test('an array query is refused even when the path already named the action', async () => {
    // Fail closed beats "the path was fine, ignore the weirdness": an array here
    // means something upstream is not what we think it is.
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: ['login'] } }, 'array-with-good-path');
  });

  test('a non-string action of any other shape is refused', async () => {
    await refused({ method: 'POST', url: '/api/auth', query: { action: { toString: () => 'login' } } }, 'object');
    await refused({ method: 'POST', url: '/api/auth', query: { action: 1 } }, 'number');
    await refused({ method: 'POST', url: '/api/auth', query: { action: true } }, 'boolean');
    await refused({ method: 'POST', url: '/api/auth', query: { action: null } }, 'null');
  });

  test('an absent action property is not an ambiguous one', async () => {
    // `undefined` means "no query action", which is legitimate; it must fall
    // through to the path rather than being treated as hostile.
    await reaches('status', { url: '/api/auth/status', query: { action: undefined } }, 'undefined-action');
    await refused({ method: 'GET', url: '/api/auth', query: { action: undefined } }, 'undefined-and-no-path');
  });
});

suite('v1 auth dispatch — prototype-shaped input reaches nothing', () => {

  const HOSTILE = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'prototype', '__defineGetter__'];

  test('as a path segment', async () => {
    for (const name of HOSTILE) {
      await refused({ method: 'POST', url: `/api/auth/${name}` }, `path:${name}`);
    }
  });

  test('as a query action', async () => {
    for (const name of HOSTILE) {
      await refused({ method: 'POST', url: '/api/auth', query: { action: name } }, `query:${name}`);
    }
  });

  test('as both at once', async () => {
    for (const name of HOSTILE) {
      await refused({ method: 'POST', url: `/api/auth/${name}`, query: { action: name } }, `both:${name}`);
    }
  });

  test('the action table has no prototype to reach', async () => {
    // Belt and braces: even if resolveAction were wrong, ACTIONS is a null-
    // prototype object, so ACTIONS.constructor is undefined rather than Function.
    for (const name of HOSTILE) {
      assert.equal(dispatch.__resolveAction({ url: `/api/auth/${name}` }).action, undefined,
        `${name} must not resolve to an action`);
    }
  });

  test('a poisoned Object.prototype cannot invent an action', async () => {
    // A different module in the same process could pollute Object.prototype.
    // The lookup table must not inherit from it.
    Object.defineProperty(Object.prototype, 'evil', {
      value: async (req, res) => { res.status(200).json({ pwned: true }); },
      configurable: true, writable: true, enumerable: false
    });
    try {
      await refused({ method: 'POST', url: '/api/auth/evil' }, 'polluted-path');
      await refused({ method: 'POST', url: '/api/auth', query: { action: 'evil' } }, 'polluted-query');
    } finally {
      delete Object.prototype.evil;
    }
  });
});

suite('v1 auth dispatch — refusal reasons and table integrity', () => {

  test('every refusal carries a reason, and no refusal carries an action', async () => {
    const cases = [
      [{ url: '/api/auth' }, 'unknown_action'],
      [{ url: '/api/auth/logon' }, 'unknown_action'],
      [{ url: '/api/auth/status', query: { action: 'reset' } }, 'action_mismatch'],
      [{ url: '/api/auth/anything', query: { action: 'login' } }, 'unknown_action'],
      [{ url: '/api/auth', query: { action: ['login'] } }, 'ambiguous_action'],
      [{ url: '/api/auth', query: { action: 7 } }, 'ambiguous_action']
    ];
    for (const [req, reason] of cases) {
      const out = dispatch.__resolveAction(req);
      assert.equal(out.action, undefined, `${req.url}: must not resolve`);
      assert.equal(out.refuse, reason, `${req.url}: refusal reason`);
    }
  });

  test('resolveAction never throws, whatever it is handed', async () => {
    const junk = [
      {}, { url: null }, { url: 123 }, { url: '' }, { url: '/' },
      { query: null }, { query: 'action=login' }, { url: '/api/auth', query: Object.create(null) },
      { url: '/api/auth/login', query: { action: Object.create(null) } }
    ];
    for (const req of junk) {
      const out = dispatch.__resolveAction(req);
      assert.ok(out && typeof out === 'object', 'a result is always returned');
      assert.ok(out.action === undefined || H.ACTIONS.includes(out.action), 'resolves only to a known action');
    }
  });

  test('the dispatch table is exactly the five actions', () => {
    const names = Object.keys(dispatch.__actions).sort();
    assert.deepEqual(names, H.ACTIONS.slice().sort(), 'exported handlers');
    assert.deepEqual(dispatch.__ACTION_NAMES.slice().sort(), H.ACTIONS.slice().sort(), 'allow-list');
    for (const n of H.ACTIONS) assert.equal(typeof dispatch.__actions[n], 'function', `${n} is a function`);
  });

  test('the allow-list is frozen', () => {
    assert.ok(Object.isFrozen(dispatch.__ACTION_NAMES), 'ACTION_NAMES must not be mutable at runtime');
  });

  test('the module default export is the request handler', () => {
    assert.equal(typeof dispatch, 'function');
    assert.equal(dispatch.length, 2, 'handler(req, res)');
  });
});
