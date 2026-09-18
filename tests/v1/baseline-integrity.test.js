'use strict';
// V1 baseline integrity — what the auth consolidation was NOT allowed to touch.
//
// The consolidation deliberately breaks one long-standing property: `api/auth/*`
// is no longer byte-identical to the Production commit. This file pins down
// everything else, so that the blast radius of the change is a fact on record
// rather than an assurance.
//
// The recorded hashes below were taken from the Production branch with
// `git show production:<path> | sha256sum` before any edit. They are the
// baseline, not a snapshot of the current tree: if a file drifts, the test
// fails and names it.
//
// SCOPE WARNING — read before quoting the budget test.
// The function-budget check counts FILES IN THIS REPOSITORY under the naming
// convention Vercel uses to decide what becomes a Serverless Function. It is a
// guard on source structure. It is NOT a measurement of Vercel's deployed
// artifact count, which only a deployment reports. The convention itself is an
// inference from one observation (the READY v2-case-spine deployment at 88a866c
// reporting 12 functions from a 22-file api/ tree). Until a Preview deployment
// succeeds, the deployed count remains unverified.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { suite, test, assert } = require('../v2/harness');
const H = require('./harness-v1');

const REPO = H.REPO;

const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const at = (...p) => path.join(REPO, ...p);
const exists = p => fs.existsSync(p);

// ── Recorded Production baseline ─────────────────────────────────────────────

// V1 files the sprint is not permitted to modify.
const V1_UNCHANGED = {
  'api/_utils.js':          '3482ab66a686d2f177aa02902c1f01108cbeab9f2fa40631a3f217d27e3e5004',
  'api/agent.js':           '3501d982a5f54ba5dbb3c718bfbab9828a9ced655a9fc6ca0ab1f53f885299d1',
  'api/client.js':          '8c51202c124ea83fc32a2f666cc45f45e40e5397ba5e26b273f196dd5a520111',
  'api/portal.js':          '9f31a82a5be1bbafdf818cb26fd8ea36b106985f150ad1c374c8eb7283d7262b',
  'api/questions.js':       'c9680380620448fe1621b8b504a219cdf2c07b103c0380a0a79f77769c99ce51',
  'api/send-questions.js':  'cd3a6498a6e54d5cdddd36e5e983a99f9a03182c11aa29469102e94d91177fd5',
  'api/submit.js':          'e6278d0244e631f4403d3a729adc2a7200edd638464d1b2b9faa0939079c5bef'
};

// The five Production auth handlers. These hashes are now carried by the frozen
// test fixtures; the originals under api/auth/ are superseded by [action].js.
const AUTH_BASELINE = {
  login:  '411e9834ed9e3b93aea4c0e0be0502144ea62d8e462f48feb9e5d79d1317502e',
  setup:  '0ab8e2a3e1ad7c14867ff85bd2d65de4df3085410bca57e213601ea8fe8c176c',
  status: 'd99d12ca02728d179def3740ae0f1927f22f80067e0d9aa94a1177c85789d15c',
  forgot: '54bef215562977cfdb1372db6f2aba5fdc73769cdbfead87bb57cb6a56e7b97c',
  reset:  '96f6535cbad872ef824a6e81d509550080397c5f488bae1d0ad1fd6bb2c3cdeb'
};

// The V2 Case API, which this sprint's auth work must leave completely alone.
const CASE_API = '8f7a23813a36ff1e8fb1c0a05d3ce322a15e001b1533e5673a479e2a4bf4ca69';

// The Preview HTTP gate, which must keep targeting the preserved public URLs.
const INTAKE_HTTP_GATE = 'f2444565d79496cfb9f7d19213dd5e24dc402b61dd687675850e6ae9f463acef';

// Vercel builds one Serverless Function per non-underscore .js file under api/.
const HOBBY_FUNCTION_LIMIT = 12;

// ── OneDrive conflict artifacts ──────────────────────────────────────────────
//
// The working copy lives in a OneDrive-synced folder, and OneDrive renamed 27
// files to `*-MOHAMMED*` during the 2026-09-17 incident (ENGINEERING-STATE §0,
// blocker 9). Every one was hashed and proven to be a stale duplicate; all are
// UNTRACKED, so git never carries them and Vercel — which deploys from git —
// never sees them. They are excluded from the source inventories below for that
// reason, and only for that reason.
//
// This is not a way of looking away from them. `api/auth/status-MOHAMMED.js`
// would become a publicly reachable eleventh function the moment someone ran
// `git add -A`, so the exclusion is paired with a test that fails if any such
// file is tracked, and with a printed inventory so they stay visible.
const isConflictArtifact = p => /-MOHAMMED/.test(p);

// ─────────────────────────────────────────────────────────────────────────────

suite('v1 baseline — untouched files still match Production', () => {

  for (const [rel, expected] of Object.entries(V1_UNCHANGED)) {
    test(`${rel} is byte-identical to the Production baseline`, () => {
      assert.ok(exists(at(rel)), `${rel} must still exist`);
      assert.equal(sha256(at(rel)), expected, `${rel} content hash`);
    });
  }

  test('api/v2/case.js is untouched by the auth work', () => {
    assert.equal(sha256(at('api/v2/case.js')), CASE_API, 'api/v2/case.js content hash');
  });

  test('scripts/v2-intake-http.js is untouched', () => {
    // The Preview gate targets /api/v2/intake and /api/v2/intake-review, neither
    // of which the auth consolidation moves. It must not have been "adjusted".
    assert.equal(sha256(at('scripts/v2-intake-http.js')), INTAKE_HTTP_GATE);
  });
});

suite('v1 baseline — the frozen auth fixtures are the real Production code', () => {

  for (const [action, expected] of Object.entries(AUTH_BASELINE)) {
    test(`tests/fixtures/v1-auth-baseline/${action}.js matches Production`, () => {
      const p = at('tests/fixtures/v1-auth-baseline', action + '.js');
      assert.ok(exists(p), 'fixture present');
      assert.equal(sha256(p), expected, `${action} fixture hash`);
    });
  }

  test('the fixtures are only reachable from tests', () => {
    // They must never be deployed as endpoints: they live under tests/, not api/.
    assert.notOk(exists(at('api/tests')), 'no fixtures under api/');
    assert.ok(at('tests/fixtures/v1-auth-baseline').indexOf(path.join(REPO, 'tests')) === 0);
  });

  test('the resolution shim re-exports the real _utils, stubbing nothing', () => {
    const shim = fs.readFileSync(at('tests/fixtures/_utils.js'), 'utf8');
    assert.includes(shim, "require('../../api/_utils')", 'shim delegates to the real module');
    assert.equal(require(at('tests/fixtures/_utils.js')), require(at('api/_utils.js')),
      'the shim and the real module are the same object');
  });
});

suite('v1 baseline — the auth surface after consolidation', () => {

  test('the five superseded handler files are gone, replaced by one', () => {
    for (const action of H.ACTIONS) {
      assert.notOk(exists(at('api/auth', action + '.js')),
        `api/auth/${action}.js must be superseded, not left alongside the consolidated handler`);
    }
    assert.ok(exists(at('api/auth/[action].js')), 'the consolidated handler exists');
    const files = fs.readdirSync(at('api/auth')).filter(f => !isConflictArtifact(f)).sort();
    assert.deepEqual(files, ['[action].js'], 'api/auth contains exactly the consolidated handler');
  });

  test('all five public auth URLs still resolve to a handler', () => {
    for (const action of H.ACTIONS) {
      const r = H.consolidatedModule.__resolveAction({ url: `/api/auth/${action}` });
      assert.equal(r.action, action, `/api/auth/${action} must resolve`);
    }
  });

  test('every /api/auth URL the front end calls is one of the five', () => {
    const called = new Set();
    for (const f of fs.readdirSync(at('public'))) {
      if (!f.endsWith('.html') || isConflictArtifact(f)) continue;
      const src = fs.readFileSync(at('public', f), 'utf8');
      for (const m of src.matchAll(/\/api\/auth\/([A-Za-z0-9_-]+)/g)) called.add(m[1]);
    }
    for (const a of called) {
      assert.ok(H.ACTIONS.includes(a), `public/ calls /api/auth/${a}, which the dispatcher does not serve`);
    }
    // And nothing has quietly dropped out of the product.
    for (const a of H.ACTIONS) {
      assert.ok(called.has(a), `no page calls /api/auth/${a} any more — the surface shrank`);
    }
  });

  test('the consolidated handler has the same dependency surface as the originals', () => {
    const deps = src => new Set([...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]));
    const consolidated = deps(fs.readFileSync(at('api/auth/[action].js'), 'utf8'));
    const union = new Set();
    for (const a of H.ACTIONS) {
      for (const d of deps(fs.readFileSync(at('tests/fixtures/v1-auth-baseline', a + '.js'), 'utf8'))) union.add(d);
    }
    assert.deepEqual([...consolidated].sort(), [...union].sort(),
      'consolidation must not have added or dropped a dependency');
  });

  test('no auth logic leaked into an underscore module', () => {
    // A module under api/ that is excluded from the function count must not have
    // become a second home for auth behaviour.
    assert.notOk(exists(at('api/auth/_handlers.js')));
    assert.notOk(exists(at('api/_auth.js')));
  });
});

suite('v1 baseline — source-level function budget (NOT a deployed count)', () => {

  function apiJsFiles() {
    const out = [];
    (function walk(dir, rel) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(abs, r);
        else if (e.name.endsWith('.js') && !isConflictArtifact(e.name)) out.push(r);
      }
    })(at('api'), '');
    return out.sort();
  }

  function conflictArtifactsUnderApi() {
    const out = [];
    (function walk(dir, rel) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else if (isConflictArtifact(e.name)) out.push(r);
      }
    })(at('api'), '');
    return out.sort();
  }

  const isModule = rel => path.basename(rel).startsWith('_');

  test('the count of would-be functions is within the Hobby limit', () => {
    const all = apiJsFiles();
    const handlers = all.filter(f => !isModule(f));
    const modules = all.filter(isModule);
    console.log(`      api/*.js: ${all.length} total = ${handlers.length} would-be functions + ${modules.length} excluded modules`);
    console.log(`      would-be functions: ${handlers.join(', ')}`);
    assert.ok(handlers.length <= HOBBY_FUNCTION_LIMIT,
      `source-level function count ${handlers.length} exceeds the Hobby limit of ${HOBBY_FUNCTION_LIMIT}`);
  });

  test('the two Sprint 1 endpoints are still present and counted', () => {
    // The budget must not have been bought by quietly dropping the new work.
    assert.ok(exists(at('api/v2/intake.js')), 'anonymous intake endpoint');
    assert.ok(exists(at('api/v2/intake-review.js')), 'reviewer endpoint');
    assert.ok(exists(at('api/send-questions.js')), 'email endpoint retained, as instructed');
  });

  test('anonymous intake and reviewer operations remain separate files', () => {
    // Explicitly out of bounds for this consolidation: they must not be merged
    // to save a function slot.
    const intake = fs.readFileSync(at('api/v2/intake.js'), 'utf8');
    const review = fs.readFileSync(at('api/v2/intake-review.js'), 'utf8');
    assert.ok(intake !== review, 'two distinct endpoints');
    assert.notOk(/decide_intake/.test(intake), 'the anonymous endpoint must expose no reviewer operation');
  });

  test('no OneDrive conflict artifact is tracked by git', () => {
    // The budget count above excludes `*-MOHAMMED*` files on the grounds that
    // git never carries them. This test is what makes that reasoning sound.
    const found = conflictArtifactsUnderApi();
    if (found.length) console.log(`      untracked OneDrive artifacts under api/ (blocker 9): ${found.join(', ')}`);

    if (!exists(at('.git'))) {
      console.log('      no .git here — tracked-ness not checked in this working copy');
      return;
    }
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
      .split('\n').filter(Boolean).filter(isConflictArtifact);
    assert.deepEqual(tracked, [],
      'a OneDrive conflict artifact is tracked — it would deploy as a real endpoint');
  });

  test('every excluded module really is a module, not an endpoint', () => {
    for (const rel of apiJsFiles().filter(isModule)) {
      const m = require(at('api', rel.split('/').join(path.sep)));
      assert.notOk(typeof m === 'function', `api/${rel} is underscore-named but exports a bare handler`);
    }
  });
});

suite('v1 baseline — routing configuration', () => {

  const vercel = JSON.parse(fs.readFileSync(at('vercel.json'), 'utf8'));

  test('no route rewrites or intercepts /api/auth', () => {
    for (const r of vercel.routes || []) {
      assert.notOk(/\/api\/auth/.test(r.src || ''), `a route intercepts auth: ${JSON.stringify(r)}`);
      assert.notOk(/\/api\/auth/.test(r.dest || ''), `a route rewrites into auth: ${JSON.stringify(r)}`);
    }
  });

  test('the Sprint 1 page routes are intact', () => {
    const srcs = (vercel.routes || []).map(r => r.src);
    for (const s of ['/admin', '/questions', '/portal', '/intake', '/v2-intake-review']) {
      assert.ok(srcs.includes(s), `route ${s} must still be configured`);
    }
  });

  test('RECORDED UNCERTAINTY: auth routing is unverified until deployment', () => {
    // vercel.json uses the legacy top-level `routes` key. Whether Vercel's
    // filesystem handler still resolves the dynamic segment api/auth/[action].js
    // under that legacy configuration could not be established locally — there is
    // no local Vercel runtime here, and the question is about the platform, not
    // this code. This test does not assert routing works; it asserts that the
    // configuration is still the one whose behaviour is pending verification, so
    // that a silent change to it cannot slip past the handoff.
    assert.ok(Array.isArray(vercel.routes), 'legacy `routes` key still in use');
    assert.notOk(vercel.rewrites, 'no `rewrites` key (it cannot be combined with `routes`)');
    // The prepared fallback, NOT implemented: add an explicit route
    //   { "src": "/api/auth/(login|setup|status|forgot|reset)",
    //     "dest": "/api/auth/[action]?action=$1" }
    // The dispatcher already resolves correctly under that shape, so the fallback
    // is a configuration change with no code change. It is deliberately left
    // unapplied pending Mohammed's decision.
  });
});
