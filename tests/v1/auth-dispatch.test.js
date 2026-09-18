'use strict';
// V1 auth consolidation — the dispatcher.
//
// Equivalence (auth-equivalence.test.js) proves each handler still behaves like
// its Production original. This file proves the thing that did not exist before
// the consolidation and is therefore the new risk surface: the code that decides
// WHICH handler a request reaches.
//
// The property under test, tightened on 2026-09-18:
//
//     the action comes from the WHOLE public URL and from nowhere else. There
//     are exactly five reachable paths — `/api/auth/<action>`, matched in full,
//     not merely by their last segment. A query parameter can only ever refuse a
//     request, never produce one. Everything else is 404, touching nothing.
//
// An earlier draft accepted `/api/auth?action=login` so that a rewrite-based
// routing fallback would need no code change. That created a sixth reachable
// spelling of the auth surface, invisible to anything keyed on the five
// canonical paths, and it is now rejected. The suite below is the proof: the
// tests that once asserted bare-path dispatch now assert its refusal.
//
// Every refusal case asserts three things, not one: the status, that no handler
// ran (no KV operation, no outbound call), and that stored state is unchanged.
// A dispatcher that answered 404 *after* running `reset` would pass a
// status-only test and would be a serious defect.
//
// NOT ESTABLISHED HERE, and not assumed: how Vercel represents a dynamic path
// parameter versus a caller-supplied query parameter, and whether `req.url`
// inside the function is the original request path including the `/api` prefix.
// This dispatcher requires that reading. A 404 on Preview would be consistent
// with it being wrong — but equally with the route never reaching the function,
// with the function not being built, or with a platform rewrite. A Preview 404
// is a signal to investigate, not a diagnosis. Whatever the finding, the answer
// is a deliberate change with the real representation in hand, never a fallback
// invented from caller-controlled input.

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

suite('v1 auth dispatch — the five canonical URLs, and only those', () => {

  for (const action of H.ACTIONS) {
    test(`/api/auth/${action} — path alone, no query object at all`, async () => {
      await reaches(action, { url: `/api/auth/${action}` }, `path:${action}`);
    });
  }

  for (const action of H.ACTIONS) {
    test(`/api/auth/${action} — path with the action mirrored into req.query`, async () => {
      // What a dynamic-segment runtime is expected to produce. The query agrees
      // with the path, so it neither adds nor removes anything.
      await reaches(action, { url: `/api/auth/${action}`, query: { action } }, `mirrored:${action}`);
    });
  }

  test('a trailing slash still resolves', async () => {
    await reaches('status', { url: '/api/auth/status/' }, 'trailing-slash');
  });

  test('an unrelated query string on the URL is ignored', async () => {
    await reaches('status', { url: '/api/auth/status?t=1758153600000', query: { t: '1758153600000' } }, 'cache-buster');
  });

  test('the method gate still belongs to the handler, not the dispatcher', async () => {
    // GET /api/auth/login must be the handler's 405, not the dispatcher's 404 —
    // otherwise consolidation would have changed an observable response.
    const r = await H.invoke(dispatch, H.mockReq({ method: 'GET', url: '/api/auth/login', query: { action: 'login' } }));
    assert.equal(r.status, 405);
    assert.deepEqual(r.body, { error: 'Method not allowed' });
  });

  test('the surface is exactly five whole paths, enumerated', async () => {
    const CANDIDATES = [
      // the five canonical paths, and their trailing-slash forms
      ...H.ACTIONS.map(a => `/api/auth/${a}`),
      ...H.ACTIONS.map(a => `/api/auth/${a}/`),
      // everything that merely ENDS in an action name
      '/login', '/auth/login', '/other/login', '/x/y/z/reset',
      '/api/login', '/api/other/status', '/api/auth/v2/login', '/api/v2/auth/login',
      '//api/auth/login', '/api//auth/login', '/api/auth//login',
      '/api/auth/login/extra', '/api/auth/login/.', '/API/AUTH/login',
      // and the non-actions inside the right path
      '/api/auth', '/api/auth/', '/api/auth/[action]', '/api/auth/logon', '/api/auth/constructor'
    ];
    const reachable = CANDIDATES.filter(u => dispatch.__resolveAction({ url: u }).action);
    const expected = [
      ...H.ACTIONS.map(a => `/api/auth/${a}`),
      ...H.ACTIONS.map(a => `/api/auth/${a}/`)
    ];
    assert.deepEqual(reachable.sort(), expected.sort(), 'no path outside /api/auth/<action> resolves');
  });
});

suite('v1 auth dispatch — the whole path must be canonical, not just its tail', () => {

  // CORRECTED 2026-09-18. The first version read the last path segment, so every
  // URL below resolved to a real action. Vercel should never route them here —
  // but "the platform probably will not send that" is a hope, not a check.

  test('a different path that ends in an action name is refused', async () => {
    for (const url of ['/login', '/auth/login', '/other/login', '/x/y/z/reset', '/api/login']) {
      await refused({ method: 'POST', url }, `tail:${url}`);
    }
  });

  test('a different path under /api is refused', async () => {
    for (const url of ['/api/other/status', '/api/v2/auth/login', '/api/auth/v2/login']) {
      await refused({ method: 'POST', url }, `under-api:${url}`);
    }
  });

  test('extra or doubled slashes are refused, not normalised', async () => {
    for (const url of ['//api/auth/login', '/api//auth/login', '/api/auth//login', '/api/auth/login//']) {
      await refused({ method: 'POST', url }, `slashes:${url}`);
    }
  });

  test('anything nested below a canonical path is refused', async () => {
    for (const url of ['/api/auth/login/extra', '/api/auth/status/./', '/api/auth/reset/1']) {
      await refused({ method: 'POST', url }, `nested:${url}`);
    }
  });

  test('the path prefix is case-sensitive', async () => {
    for (const url of ['/API/AUTH/login', '/Api/Auth/login', '/api/Auth/login']) {
      await refused({ method: 'POST', url }, `case:${url}`);
    }
  });

  test('exactly one trailing slash is tolerated, and only there', async () => {
    for (const action of H.ACTIONS) {
      await reaches(action, { url: `/api/auth/${action}/` }, `trailing:${action}`);
    }
    await refused({ method: 'GET', url: '/api/auth/status//' }, 'double-trailing');
  });

  test('a non-canonical path is refused even when the query names a real action', async () => {
    await refused({ method: 'POST', url: '/other/login', query: { action: 'login' } }, 'tail-plus-query');
    await refused({ method: 'POST', url: '/api/auth/v2/login', query: { action: 'login' } }, 'nested-plus-query');
  });
});

suite('v1 auth dispatch — the bare endpoint dispatches nothing, ever', () => {

  // These are the tests that replaced the ones permitting bare-path dispatch.

  test('bare /api/auth is refused with no query', async () => {
    await refused({ method: 'GET', url: '/api/auth' }, 'bare-get');
    await refused({ method: 'POST', url: '/api/auth' }, 'bare-post');
    await refused({ method: 'GET', url: '/api/auth/' }, 'bare-slash');
  });

  for (const action of H.ACTIONS) {
    test(`/api/auth?action=${action} is refused — the query is not a routing signal`, async () => {
      await refused({ method: 'POST', url: '/api/auth', query: { action } }, `bare-query:${action}`);
      await refused({ method: 'POST', url: '/api/auth/', query: { action } }, `bare-slash-query:${action}`);
    });
  }

  test('a real GET of the bare endpoint cannot read setup state', async () => {
    // The sharpest version: /api/auth?action=status against a configured store.
    // If the query still dispatched, this would answer 200 {setupDone:true} and
    // leak that an admin account exists.
    const seed = { 'admin:password_hash': ADMIN_HASH };
    const r = await refused({ method: 'GET', url: '/api/auth', query: { action: 'status' } }, 'bare-status-probe', { seed });
    assert.deepEqual(r.kv, [], 'the store was never read');
  });

  test('a real POST of the bare endpoint cannot create an admin password', async () => {
    const r = await H.invoke(dispatch, H.mockReq({
      method: 'POST', url: '/api/auth', query: { action: 'setup' }, body: { password: 'hunter-2026' }
    }));
    assert.equal(r.status, 404, 'must refuse rather than run setup');
    assert.deepEqual(r.store, {}, 'no password may have been written');
    assert.deepEqual(r.kv, [], 'no storage access at all');
  });

  test('a real POST of the bare endpoint cannot consume or overwrite an OTP', async () => {
    const seed = { 'admin:reset_otp': '424242' };
    await refused({ method: 'POST', url: '/api/auth', query: { action: 'reset' },
      body: { otp: '424242', newPassword: 'hunter-2026' } }, 'bare-reset', { seed });
    await refused({ method: 'POST', url: '/api/auth', query: { action: 'forgot' },
      body: { email: 'info@humvance.com' } }, 'bare-forgot', { seed });
  });

  test('the query is not consulted even when the URL is unusable', async () => {
    // A runtime that hands us no URL gives us no action. There is nothing to
    // fall back to, and inventing one from the query is what we removed.
    await refused({ method: 'GET', url: null, query: { action: 'status' } }, 'null-url');
    await refused({ method: 'GET', url: '', query: { action: 'status' } }, 'empty-url');
    await refused({ method: 'GET', url: '/', query: { action: 'status' } }, 'root-url');
  });

  test('the unresolved [action] template is refused, not rescued by the query', async () => {
    // If a runtime ever hands us the template instead of the resolved path, the
    // fail-closed answer is 404 and a deliberate fix — not a guess.
    await refused({ method: 'GET', url: '/api/auth/[action]', query: { action: 'status' } }, 'literal-template');
    await refused({ method: 'GET', url: '/api/auth/%5Baction%5D', query: { action: 'status' } }, 'encoded-template');
  });
});

suite('v1 auth dispatch — unknown actions fail closed', () => {

  test('an unknown path segment is refused', async () => {
    await refused({ method: 'POST', url: '/api/auth/logon' }, 'typo');
    await refused({ method: 'POST', url: '/api/auth/admin' }, 'invented');
    await refused({ method: 'GET', url: '/api/auth/status/extra' }, 'deeper-path');
  });

  test('action names are matched exactly — no case folding, no trimming', async () => {
    await refused({ method: 'GET', url: '/api/auth/STATUS' }, 'upper-path');
    await refused({ method: 'GET', url: '/api/auth/Status' }, 'mixed-path');
    await refused({ method: 'GET', url: '/api/auth/%20status' }, 'padded-path');
  });

  test('percent-encoding does not create a new spelling', async () => {
    // %6C is 'l'. Decoding here would make /api/auth/%6Cogin reach login.
    await refused({ method: 'POST', url: '/api/auth/%6Cogin' }, 'encoded-login');
    await refused({ method: 'POST', url: '/api/auth/log%69n' }, 'encoded-i');
  });

  test('a path segment that merely contains an action name is refused', async () => {
    await refused({ method: 'POST', url: '/api/auth/login2' }, 'suffixed');
    await refused({ method: 'POST', url: '/api/auth/xlogin' }, 'prefixed');
    await refused({ method: 'POST', url: '/api/auth/login.js' }, 'filename');
  });

  test('an unknown path is refused even when the query names a real action', async () => {
    await refused({ method: 'POST', url: '/api/auth/anything', query: { action: 'login' } }, 'smuggle-via-path');
    await refused({ method: 'POST', url: '/api/auth/nonsense', query: { action: 'setup' } }, 'smuggle-setup');
  });
});

suite('v1 auth dispatch — a query may refuse, never resolve', () => {

  test('a query action contradicting the path refuses both', async () => {
    // Neither `status` nor `reset` may run here. The seeded OTP proves reset did
    // not: if it had, the stored code would be gone.
    const seed = { 'admin:reset_otp': '424242' };
    await refused({ method: 'POST', url: '/api/auth/status', query: { action: 'reset' } }, 'status-vs-reset', { seed });
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: 'setup' } }, 'login-vs-setup');
    await refused({ method: 'POST', url: '/api/auth/forgot', query: { action: 'login' } }, 'forgot-vs-login');
  });

  test('a query action cannot escalate a read-only endpoint into a write', async () => {
    const r = await H.invoke(dispatch, H.mockReq({
      method: 'GET', url: '/api/auth/status', query: { action: 'setup' }, body: { password: 'hunter-2026' }
    }));
    assert.equal(r.status, 404, 'must refuse rather than run setup');
    assert.deepEqual(r.store, {}, 'no password may have been written');
    assert.deepEqual(r.kv, [], 'no storage access at all');
  });

  test('the raw query string on req.url does not override the path either', async () => {
    await refused({ method: 'POST', url: '/api/auth/status?action=reset', query: { action: 'reset' } }, 'raw-query-conflict');
    await reaches('status', { url: '/api/auth/status?action=status', query: { action: 'status' } }, 'raw-query-agree');
  });

  test('an absent action property is not an ambiguous one', async () => {
    // `undefined` means "no query action", which is legitimate: the path already
    // decided. It must not be treated as hostile.
    await reaches('status', { url: '/api/auth/status', query: { action: undefined } }, 'undefined-action');
    await refused({ method: 'GET', url: '/api/auth', query: { action: undefined } }, 'undefined-and-no-path');
  });
});

suite('v1 auth dispatch — repeated and malformed actions fail closed', () => {

  test('a repeated ?action= (array) is refused even when the path is valid', async () => {
    // Fail closed beats "the path was fine, ignore the weirdness": an array here
    // means something upstream is not what we think it is.
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: ['login'] } }, 'array-one');
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: ['login', 'login'] } }, 'array-same');
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: ['login', 'reset'] } }, 'array-two');
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: [] } }, 'array-empty');
  });

  test('a non-string action of any other shape is refused on a valid path', async () => {
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: { toString: () => 'login' } } }, 'object');
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: 1 } }, 'number');
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: true } }, 'boolean');
    await refused({ method: 'POST', url: '/api/auth/login', query: { action: null } }, 'null');
  });

  test('the same shapes on the bare path are refused too', async () => {
    await refused({ method: 'POST', url: '/api/auth', query: { action: ['login'] } }, 'bare-array');
    await refused({ method: 'POST', url: '/api/auth', query: { action: 1 } }, 'bare-number');
  });
});

suite('v1 auth dispatch — prototype-shaped input reaches nothing', () => {

  const HOSTILE = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'prototype', '__defineGetter__'];

  test('as a path segment', async () => {
    for (const name of HOSTILE) {
      await refused({ method: 'POST', url: `/api/auth/${name}` }, `path:${name}`);
    }
  });

  test('as a query action on the bare path', async () => {
    for (const name of HOSTILE) {
      await refused({ method: 'POST', url: '/api/auth', query: { action: name } }, `query:${name}`);
    }
  });

  test('as a query action on a valid path', async () => {
    for (const name of HOSTILE) {
      await refused({ method: 'POST', url: '/api/auth/login', query: { action: name } }, `mismatch:${name}`);
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
      [{ url: '/api/auth' }, 'unknown_path'],
      [{ url: '/api/auth/' }, 'unknown_path'],
      [{ url: '/api/auth', query: { action: 'login' } }, 'unknown_path'],
      [{ url: '/other/login' }, 'unknown_path'],
      [{ url: '/api/other/status' }, 'unknown_path'],
      [{ url: '/api/auth/v2/login' }, 'unknown_path'],
      [{ url: '/api/auth/login/extra' }, 'unknown_path'],
      [{ url: '/api/auth/[action]', query: { action: 'login' } }, 'unknown_action'],
      [{ url: '/api/auth/logon' }, 'unknown_action'],
      [{ url: '/api/auth/anything', query: { action: 'login' } }, 'unknown_action'],
      [{ url: '/api/auth/status', query: { action: 'reset' } }, 'action_mismatch'],
      [{ url: '/api/auth/login', query: { action: ['login'] } }, 'ambiguous_action'],
      [{ url: '/api/auth/login', query: { action: 7 } }, 'ambiguous_action']
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

  test('the source carries no query-only fallback', () => {
    // A structural guard against the removed behaviour coming back by accident,
    // and against an environment flag being added to re-enable it.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(H.REPO, 'api/auth/[action].js'), 'utf8');
    const body = src.slice(src.indexOf('function resolveAction'));
    assert.notOk(/isKnownAction\(\s*q\s*\)/.test(body), 'the query must never be tested as a source of the action');
    assert.notOk(/process\.env\.[A-Z_]*AUTH[A-Z_]*/.test(src), 'no environment flag gates dispatch');
    assert.includes(src, '/^\\/api\\/auth\\/', 'the full path is matched, not a bare last segment');
  });
});
