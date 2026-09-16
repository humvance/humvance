'use strict';
const { suite, test, assert } = require('./harness');
const { createStore, StoreConfigError, assertSafeKey, LEGACY_PREFIXES } = require('../../api/v2/_store');
const { newId } = require('../../api/v2/_ids');

const memEnv = { V2_STORE_DRIVER: 'memory', V2_NAMESPACE: 'v2test' };

suite('storage configuration fails closed', () => {
  test('no driver configured throws rather than defaulting', () => {
    const e = assert.throws(() => createStore({ V2_NAMESPACE: 'v2test' }), 'store_misconfigured');
    assert.includes(e.message, 'never falls back to the production KV');
  });

  test('an unknown driver is refused', () => {
    assert.throws(() => createStore({ V2_STORE_DRIVER: 'postgres', V2_NAMESPACE: 'v2test' }), 'store_misconfigured');
  });

  test('a missing or malformed namespace is refused', () => {
    assert.throws(() => createStore({ V2_STORE_DRIVER: 'memory' }), 'store_misconfigured');
    for (const ns of ['x', 'AB', 'has space', 'has_underscore', '1leading', 'a'.repeat(40)]) {
      assert.throws(() => createStore({ V2_STORE_DRIVER: 'memory', V2_NAMESPACE: ns }), 'store_misconfigured', `namespace "${ns}" should be refused`);
    }
  });

  test('a production-looking namespace needs an explicit acknowledgement', () => {
    assert.throws(() => createStore({ V2_STORE_DRIVER: 'memory', V2_NAMESPACE: 'production' }), 'store_misconfigured');
    const ok = createStore({ V2_STORE_DRIVER: 'memory', V2_NAMESPACE: 'production', V2_ALLOW_PRODUCTION_NAMESPACE: 'yes' });
    assert.equal(ok.namespace, 'production');
  });
});

suite('V2 never reads the V1 production credentials', () => {
  test('the redis driver refuses to start from KV_* alone', () => {
    const e = assert.throws(() => createStore({
      V2_STORE_DRIVER: 'redis',
      V2_NAMESPACE: 'v2preview',
      // The production variables, present exactly as they are in the real project:
      KV_REST_API_URL: 'https://prod.upstash.io',
      KV_REST_API_TOKEN: 'prod-token',
      KV_URL: 'rediss://prod',
      REDIS_URL: 'rediss://prod'
    }), 'store_misconfigured');
    assert.includes(e.message, 'V2_KV_REST_API_URL');
    assert.includes(e.message, 'deliberately does NOT read');
  });

  test('pointing V2 at the production host is detected and refused by assertIsolated', () => {
    const s = createStore({
      V2_STORE_DRIVER: 'redis',
      V2_NAMESPACE: 'v2preview',
      V2_KV_REST_API_URL: 'https://prod.upstash.io',
      V2_KV_REST_API_TOKEN: 'copied-prod-token',
      KV_REST_API_URL: 'https://prod.upstash.io'
    });
    assert.equal(s.isolation, 'SHARED-WITH-PRODUCTION');
    assert.ok(s.sharesProductionHost);
    const e = assert.throws(() => s.assertIsolated(), 'store_misconfigured');
    assert.includes(e.message, 'Refusing to start');
  });

  test('a genuinely separate host reports separate isolation', () => {
    const s = createStore({
      V2_STORE_DRIVER: 'redis',
      V2_NAMESPACE: 'v2preview',
      V2_KV_REST_API_URL: 'https://preview.upstash.io',
      V2_KV_REST_API_TOKEN: 'preview-token',
      KV_REST_API_URL: 'https://prod.upstash.io'
    });
    assert.equal(s.isolation, 'separate-database');
    assert.ok(s.assertIsolated().ok);
  });

  test('the memory driver is always isolated', () => {
    const s = createStore(memEnv);
    assert.equal(s.isolation, 'process-memory');
    assert.ok(s.assertIsolated().ok);
  });
});

suite('key namespace cannot be escaped', () => {
  const store = createStore(memEnv);

  test('keys are composed from the namespace, type and a minted id', () => {
    const id = newId('case');
    assert.equal(store._keyFor('case', id), `v2:v2test:case:${id}`);
  });

  test('a caller-supplied key shape is rejected', () => {
    for (const bad of ['client:HUM-2026-1234', 'HUM-2026-1234', 'case_x.diagnostic', '../x', 'v2:other:case:case_x']) {
      assert.throws(() => store._keyFor('case', bad), 'store_misconfigured', `should refuse id "${bad}"`);
    }
  });

  test('an unknown object type is refused', () => {
    assert.throws(() => store._keyFor('secrets', newId('case')), 'store_misconfigured');
  });

  test('every V1 prefix is explicitly denied', () => {
    for (const p of LEGACY_PREFIXES) {
      assert.throws(() => assertSafeKey(`${p}anything`), 'store_misconfigured', `should deny "${p}"`);
    }
  });

  test('index names are constrained too', () => {
    assert.ok(store._keyFor('index', 'org-org_x-cases').startsWith('v2:v2test:index:'));
    assert.throws(() => store._keyFor('index', 'org:org_x:cases'), 'store_misconfigured');
  });

  test('no V2 key can ever collide with a V1 key', async () => {
    const id = newId('evidence' === 'evidence' ? 'evd' : 'evd');
    await store.put('evidence', id, { organization_id: 'org_x' });
    for (const [k] of store._dump()) {
      assert.ok(k.startsWith('v2:v2test:'), `key "${k}" escaped the V2 namespace`);
      for (const p of LEGACY_PREFIXES) assert.notOk(k.startsWith(p), `key "${k}" collides with V1`);
    }
  });
});

suite('memory driver semantics', () => {
  test('putIfAbsent does not overwrite', async () => {
    const store = createStore({ ...memEnv, V2_NAMESPACE: 'v2nx' });
    const id = newId('case');
    assert.ok(await store.putIfAbsent('case', id, { organization_id: 'o', v: 1 }));
    assert.notOk(await store.putIfAbsent('case', id, { organization_id: 'o', v: 2 }));
    assert.equal((await store.get('case', id)).v, 1);
  });

  test('stored values are copies, not live references', async () => {
    const store = createStore({ ...memEnv, V2_NAMESPACE: 'v2copy' });
    const id = newId('case');
    const obj = { organization_id: 'o', nested: { a: 1 } };
    await store.put('case', id, obj);
    obj.nested.a = 99;
    assert.equal((await store.get('case', id)).nested.a, 1, 'the store must not alias caller objects');
  });

  test('a missing key reads as null, not undefined', async () => {
    const store = createStore({ ...memEnv, V2_NAMESPACE: 'v2null' });
    assert.equal(await store.get('case', newId('case')), null);
  });
});
