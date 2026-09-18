'use strict';
// V1 auth consolidation — behavioural equivalence against the Production baseline.
//
// The claim this file has to earn: packaging the five handlers into one deployed
// function changed nothing a caller or the database can observe. So every case
// runs the FROZEN Production handler and the consolidated one on identical input
// in identical isolated worlds, and compares status, body, headers, and the exact
// sequence of KV operations including expiry options and ordering.
//
// What this does NOT establish: that the baseline is secure, or that Vercel routes
// the five URLs to this function. The first is a separate question (see the
// "pre-existing observations" suite); the second cannot be answered without a
// deployment and is recorded as unverified.

const { suite, test, assert } = require('../v2/harness');
const H = require('./harness-v1');

const ADMIN_PW = 'correct-horse';
const { hashPassword, signJWT } = require('../../api/_utils');

// A stable secret for the test process only. Not a credential: nothing signed
// here ever leaves the process, and no real secret is read.
process.env.JWT_SECRET = 'test-only-signing-secret-for-equivalence-2026';

const ADMIN_HASH = hashPassword(ADMIN_PW);
const adminToken = () => signJWT({ role: 'admin' });
const clientToken = () => signJWT({ role: 'client', ref: 'HUM-2026-1234' });

/** Assert the two runs are indistinguishable, and return the shared result. */
function identical(pair, label) {
  assert.equal(pair.after.status, pair.before.status, `${label}: HTTP status`);
  assert.deepEqual(pair.after.body, pair.before.body, `${label}: response body`);
  assert.deepEqual(pair.after.headers, pair.before.headers, `${label}: response headers`);
  assert.deepEqual(pair.after.kv, pair.before.kv, `${label}: KV operations, in order`);
  assert.deepEqual(pair.after.store, pair.before.store, `${label}: resulting stored state`);
  assert.deepEqual(pair.after.fetchCalls, pair.before.fetchCalls, `${label}: outbound calls`);
  return pair.after;
}

// ─────────────────────────────────────────────────────────────────────────────

suite('v1 auth — status', () => {

  test('setup not done, no token', async () => {
    const r = identical(await H.comparePair('status', { method: 'GET', url: '/api/auth/status' }), 'status/fresh');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { setupDone: false, authenticated: false });
    assert.equal(r.headers['Content-Type'], 'application/json');
    assert.equal(r.headers['Cache-Control'], 'no-store');
  });

  test('setup done, no token', async () => {
    const r = identical(await H.comparePair('status', { method: 'GET', url: '/api/auth/status' },
      { seed: { 'admin:password_hash': ADMIN_HASH } }), 'status/setup-done');
    assert.deepEqual(r.body, { setupDone: true, authenticated: false });
  });

  test('an admin token reads as authenticated', async () => {
    const r = identical(await H.comparePair('status',
      { method: 'GET', url: '/api/auth/status', headers: { authorization: `Bearer ${adminToken()}` } },
      { seed: { 'admin:password_hash': ADMIN_HASH } }), 'status/admin');
    assert.deepEqual(r.body, { setupDone: true, authenticated: true });
  });

  // Hotfix 00. A portal token is a validly signed JWT; it must never make the
  // Admin SPA believe it is logged in.
  test('a portal client token does NOT read as authenticated', async () => {
    const r = identical(await H.comparePair('status',
      { method: 'GET', url: '/api/auth/status', headers: { authorization: `Bearer ${clientToken()}` } },
      { seed: { 'admin:password_hash': ADMIN_HASH } }), 'status/client-token');
    assert.equal(r.body.authenticated, false, 'a role:client token is not admin-authenticated');
    assert.equal(r.body.setupDone, true);
  });

  test('a malformed token is simply not authenticated', async () => {
    const r = identical(await H.comparePair('status',
      { method: 'GET', url: '/api/auth/status', headers: { authorization: 'Bearer not.a.jwt' } },
      { seed: { 'admin:password_hash': ADMIN_HASH } }), 'status/malformed');
    assert.equal(r.body.authenticated, false);
  });

  test('POST is refused', async () => {
    const r = identical(await H.comparePair('status', { method: 'POST', url: '/api/auth/status' }), 'status/POST');
    assert.equal(r.status, 405);
    assert.deepEqual(r.body, { error: 'Method not allowed' });
  });

  test('a KV failure answers 200 with both flags false, not 500', async () => {
    const r = identical(await H.comparePair('status', { method: 'GET', url: '/api/auth/status' },
      { failOn: 'get' }), 'status/kv-down');
    assert.equal(r.status, 200, 'the admin page must still load when storage is down');
    assert.deepEqual(r.body, { setupDone: false, authenticated: false });
  });
});

suite('v1 auth — setup', () => {

  test('a fresh setup stores the hash and returns an admin token', async () => {
    const r = identical(await H.comparePair('setup',
      { method: 'POST', url: '/api/auth/setup', body: { password: ADMIN_PW } }), 'setup/fresh');
    assert.equal(r.status, 200);
    assert.ok(r.body.token, 'a token is returned');
    assert.equal(r.store['admin:password_hash'], ADMIN_HASH, 'the hash is what hashPassword produces');
    assert.deepEqual(r.kv.map(c => c.op), ['get', 'set']);
  });

  test('setup is refused once a hash exists', async () => {
    const r = identical(await H.comparePair('setup',
      { method: 'POST', url: '/api/auth/setup', body: { password: ADMIN_PW } },
      { seed: { 'admin:password_hash': ADMIN_HASH } }), 'setup/already');
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'الإعداد مكتمل بالفعل. الرجاء تسجيل الدخول.');
    assert.deepEqual(r.kv.map(c => c.op), ['get'], 'nothing is written');
  });

  test('a short password is refused', async () => {
    const r = identical(await H.comparePair('setup',
      { method: 'POST', url: '/api/auth/setup', body: { password: 'abc' } }), 'setup/short');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
  });

  test('a missing body is refused', async () => {
    const r = identical(await H.comparePair('setup', { method: 'POST', url: '/api/auth/setup' }), 'setup/no-body');
    assert.equal(r.status, 400);
  });

  test('GET is refused', async () => {
    const r = identical(await H.comparePair('setup', { method: 'GET', url: '/api/auth/setup' }), 'setup/GET');
    assert.equal(r.status, 405);
  });

  test('a KV failure is a 500 with the original message', async () => {
    const r = identical(await H.comparePair('setup',
      { method: 'POST', url: '/api/auth/setup', body: { password: ADMIN_PW } },
      { failOn: 'get' }), 'setup/kv-down');
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'فشل الإعداد. تحقق من إعداد قاعدة البيانات.');
  });
});

suite('v1 auth — login', () => {

  test('the correct password returns a token', async () => {
    const r = identical(await H.comparePair('login',
      { method: 'POST', url: '/api/auth/login', body: { password: ADMIN_PW } },
      { seed: { 'admin:password_hash': ADMIN_HASH } }), 'login/ok');
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
  });

  test('a wrong password is 401', async () => {
    const r = identical(await H.comparePair('login',
      { method: 'POST', url: '/api/auth/login', body: { password: 'wrong' } },
      { seed: { 'admin:password_hash': ADMIN_HASH } }), 'login/wrong');
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'كلمة المرور غير صحيحة');
  });

  test('a missing password is 400', async () => {
    const r = identical(await H.comparePair('login',
      { method: 'POST', url: '/api/auth/login', body: {} },
      { seed: { 'admin:password_hash': ADMIN_HASH } }), 'login/missing');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'كلمة المرور مطلوبة');
  });

  // Unconfigured is distinct from wrong: 400 with its own message, not 401.
  test('no configured hash is 400, distinct from a wrong password', async () => {
    const r = identical(await H.comparePair('login',
      { method: 'POST', url: '/api/auth/login', body: { password: ADMIN_PW } }), 'login/unconfigured');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'لم يتم إعداد حساب الإدارة بعد');
  });

  test('GET is refused', async () => {
    const r = identical(await H.comparePair('login', { method: 'GET', url: '/api/auth/login' }), 'login/GET');
    assert.equal(r.status, 405);
  });

  test('a KV failure is a 500', async () => {
    const r = identical(await H.comparePair('login',
      { method: 'POST', url: '/api/auth/login', body: { password: ADMIN_PW } },
      { failOn: 'get' }), 'login/kv-down');
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'خطأ في تسجيل الدخول');
  });
});

suite('v1 auth — forgot (anti-enumeration)', () => {

  const ADMIN_EMAIL = 'info@humvance.com';

  test('a non-matching address answers 200 and touches nothing', async () => {
    const r = identical(await H.comparePair('forgot',
      { method: 'POST', url: '/api/auth/forgot', body: { email: 'stranger@example.com' } },
      { env: { RESEND_API_KEY: undefined, ADMIN_EMAIL: undefined } }), 'forgot/stranger');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { sent: true });
    assert.equal(r.kv.length, 0, 'no storage access at all — that is the anti-enumeration property');
    assert.equal(r.fetchCalls.length, 0, 'and no email');
  });

  test('a missing address answers the same way', async () => {
    const r = identical(await H.comparePair('forgot',
      { method: 'POST', url: '/api/auth/forgot', body: {} },
      { env: { RESEND_API_KEY: undefined } }), 'forgot/no-email');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { sent: true });
    assert.equal(r.kv.length, 0);
  });

  test('the admin address stores a six-digit OTP with a 15-minute expiry', async () => {
    const r = identical(await H.comparePair('forgot',
      { method: 'POST', url: '/api/auth/forgot', body: { email: ADMIN_EMAIL } },
      { env: { RESEND_API_KEY: undefined } }), 'forgot/admin');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { sent: true });
    assert.equal(r.kv.length, 1);
    assert.equal(r.kv[0].op, 'set');
    assert.equal(r.kv[0].args[0], 'admin:reset_otp');
    assert.ok(/^[0-9]{6}$/.test(r.kv[0].args[1]), `OTP is six digits (${r.kv[0].args[1]})`);
    assert.deepEqual(r.kv[0].args[2], { ex: 900 }, 'expiry is carried through unchanged');
  });

  test('the address is matched case-insensitively and trimmed', async () => {
    const r = identical(await H.comparePair('forgot',
      { method: 'POST', url: '/api/auth/forgot', body: { email: '  INFO@Humvance.COM  ' } },
      { env: { RESEND_API_KEY: undefined } }), 'forgot/case');
    assert.equal(r.kv.length, 1, 'it is recognised as the admin address');
  });

  test('with an email key configured, exactly one outbound call is made', async () => {
    const r = identical(await H.comparePair('forgot',
      { method: 'POST', url: '/api/auth/forgot', body: { email: ADMIN_EMAIL } },
      { env: { RESEND_API_KEY: 'test-only-not-a-real-key' } }), 'forgot/email');
    assert.equal(r.status, 200);
    assert.equal(r.fetchCalls.length, 1, 'one call, to the stub');
    assert.equal(r.fetchCalls[0].url, 'https://api.resend.com/emails');
    assert.equal(r.fetchCalls[0].method, 'POST');
  });

  test('GET is refused', async () => {
    const r = identical(await H.comparePair('forgot', { method: 'GET', url: '/api/auth/forgot' }), 'forgot/GET');
    assert.equal(r.status, 405);
  });

  test('a KV failure is a 500', async () => {
    const r = identical(await H.comparePair('forgot',
      { method: 'POST', url: '/api/auth/forgot', body: { email: ADMIN_EMAIL } },
      { failOn: 'set', env: { RESEND_API_KEY: undefined } }), 'forgot/kv-down');
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'فشل إرسال رمز إعادة الضبط');
  });
});

suite('v1 auth — reset (OTP consumption)', () => {

  const OTP = '424242';

  test('a correct OTP is consumed before the new hash is written', async () => {
    const r = identical(await H.comparePair('reset',
      { method: 'POST', url: '/api/auth/reset', body: { otp: OTP, newPassword: 'new-password' } },
      { seed: { 'admin:reset_otp': OTP, 'admin:password_hash': 'old' } }), 'reset/ok');
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.ok(r.body.token);
    assert.deepEqual(r.kv.map(c => c.op), ['get', 'del', 'set'], 'delete precedes the write');
    assert.equal(r.store['admin:reset_otp'], undefined, 'the code is gone');
    assert.equal(r.store['admin:password_hash'], hashPassword('new-password'));
  });

  test('a wrong OTP is 401 and the stored code survives', async () => {
    const r = identical(await H.comparePair('reset',
      { method: 'POST', url: '/api/auth/reset', body: { otp: '999999', newPassword: 'new-password' } },
      { seed: { 'admin:reset_otp': OTP } }), 'reset/wrong');
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'الرمز غير صحيح أو منتهي الصلاحية');
    assert.equal(r.store['admin:reset_otp'], OTP, 'a wrong guess does not burn the real code');
    assert.deepEqual(r.kv.map(c => c.op), ['get']);
  });

  test('no stored OTP is 401', async () => {
    const r = identical(await H.comparePair('reset',
      { method: 'POST', url: '/api/auth/reset', body: { otp: OTP, newPassword: 'new-password' } }), 'reset/expired');
    assert.equal(r.status, 401);
  });

  test('missing fields are 400', async () => {
    const r = identical(await H.comparePair('reset',
      { method: 'POST', url: '/api/auth/reset', body: { otp: OTP } }), 'reset/missing');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'الرمز وكلمة المرور مطلوبان');
  });

  test('a short new password is 400', async () => {
    const r = identical(await H.comparePair('reset',
      { method: 'POST', url: '/api/auth/reset', body: { otp: OTP, newPassword: 'abc' } }), 'reset/short');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
  });

  test('GET is refused', async () => {
    const r = identical(await H.comparePair('reset', { method: 'GET', url: '/api/auth/reset' }), 'reset/GET');
    assert.equal(r.status, 405);
  });

  test('a KV failure is a 500', async () => {
    const r = identical(await H.comparePair('reset',
      { method: 'POST', url: '/api/auth/reset', body: { otp: OTP, newPassword: 'new-password' } },
      { failOn: 'get' }), 'reset/kv-down');
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'فشل إعادة تعيين كلمة المرور');
  });

  // Sequential replay: the same code, used twice in a row against a store that
  // carries state forward from the first call.
  test('a used OTP cannot be replayed', async () => {
    for (const handler of [H.baselineHandlers.reset, H.consolidatedHandlers.reset]) {
      const first = await H.invoke(handler,
        H.mockReq({ method: 'POST', url: '/api/auth/reset', body: { otp: OTP, newPassword: 'new-password' } }),
        { seed: { 'admin:reset_otp': OTP } });
      assert.equal(first.status, 200, 'the first use succeeds');

      const second = await H.invoke(handler,
        H.mockReq({ method: 'POST', url: '/api/auth/reset', body: { otp: OTP, newPassword: 'another-password' } }),
        { seed: first.store });
      assert.equal(second.status, 401, 'the second use is refused');
      assert.equal(second.store['admin:password_hash'], hashPassword('new-password'),
        'and the password from the first reset still stands');
    }
  });
});

suite('v1 auth — the test rig itself', () => {

  test('the module-loading hook was removed after loading the handlers', () => {
    assert.ok(H.kvHookIsRemoved(), '@vercel/kv is no longer intercepted, so no later require is affected');
  });

  test('no real dependency, network or secret is reachable from these tests', () => {
    let resolved = true;
    try { require.resolve('@vercel/kv'); } catch { resolved = false; }
    assert.notOk(resolved, '@vercel/kv is not installed in this checkout — nothing could have reached a real store');
  });
});
