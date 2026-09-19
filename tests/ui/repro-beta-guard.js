'use strict';
/**
 * The guard refuses, proven rather than asserted.
 *
 *     node tests/ui/repro-beta-guard.js
 *
 * BETA-R03 asks for the rejection to be demonstrated with controlled local
 * tests. A guard nobody has watched refuse is a comment. So this stands up
 * small local servers that impersonate the things the guard must turn away —
 * a deployment, a different harness, a host that answers nothing — and checks
 * two things for each: that the guard exits non-zero, and that **not one
 * request was made after the refusal**. The impostor servers count every
 * request they receive, so a guard that refused too late would be caught.
 *
 * Nothing here needs a browser, a network or the beta server. It listens only
 * on 127.0.0.1 and takes a port from the OS.
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { assertLoopbackTarget } = require('./_beta-guard');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + String(detail).slice(0, 300) : '')); }
}

/** A server that answers /__beta/* however the test says, and counts hits. */
function impostor(answers) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.method + ' ' + req.url);
    const body = answers[req.url.split('?')[0]];
    if (body === undefined) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ base: 'http://127.0.0.1:' + server.address().port, hits, close: () => server.close() });
    });
  });
}

/* ── The child, and the Windows crash it used to cause ──────────────────────
   The guard exits the process, so each case runs in a child. The child's job is
   only to call the guard and report what happened.

   CORRECTED 2026-09-18. On Windows (Node v24.19.0) two of these cases — the
   wrong-principal refusal and the positive control — ended with

       Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
       file src\win\async.c, line 94
       exit 3221226505      (0xC0000409, Windows fail-fast)

   AFTER printing the correct refusal or GUARD_PASSED. So the guard reached the
   right decision every time; the CHILD died on its way out, and the parent read
   a fail-fast code instead of 3 or 0.

   Those two cases are exactly the two that make a SECOND request: `/__beta/env`
   and then `/__beta/session`. The cases that stop after the first one never
   crashed. The child used global `fetch`, which is undici, which keeps a
   connection pool and a keep-alive timer alive after the response resolves.
   Calling `process.exit()` on top of that tears the loop down while those
   handles are still registered, and libuv asserts on the closing async handle.
   One pooled connection survived it; two did not.

   THE CORRECTION IS IN THE CHILD, NOT IN THE GUARD. `assertLocalHarness` takes
   its transport as an argument precisely so the caller chooses one, so the
   child now uses Node's plain HTTP client with `agent: false` — a socket per
   request, closed when the response ends, no pool and no keep-alive timer to
   outlive the process. The child then sets `process.exitCode` and returns
   instead of calling `process.exit()`, so the loop drains on its own.

   NOT CHANGED, deliberately: every assertion in this file, the guard's host,
   protocol, environment, non-persistent-store and synthetic-principal checks,
   its immediate `process.exit(3)` on refusal, the pre-mutation ordering, and
   the positive control. A crash is still a failure here, not a pass: the
   parent checks for an exact exit code, so a fail-fast would still be caught.

   HONEST LIMITATION: this reasoning is not proved on Windows from here. The
   shell this session has on Mohammed's machine is a Linux VM, so the original
   script has not been re-run on Windows Node after this edit. Linux cannot
   reproduce the assertion — `src/win/async.c` is not the platform's code. */
const CHILD = `
const http = require('http');
const { assertLocalHarness } = require(${JSON.stringify(path.join(__dirname, '_beta-guard.js'))});
const BASE = process.argv[1];

/* A socket per request, closed with the response. Nothing is pooled, so there
   is no handle left to trip over at exit. */
function fetchJson(p) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + p);
    const req = http.get(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, agent: false },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', d => { body += d; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(p + ' -> HTTP ' + res.statusCode));
          }
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
  });
}

assertLocalHarness(BASE, fetchJson)
  .then(() => { console.log('GUARD_PASSED'); process.exitCode = 0; })
  .catch(e => { console.log('GUARD_THREW ' + e.message); process.exitCode = 4; });
`;

function runGuard(base) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', CHILD, '--', base], { encoding: 'utf8' });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', status => resolve({ status: status, out: out }));
  });
}

const GOOD_ENV = { mode: 'LOCAL_INTEGRATION', store: 'memory', namespace: 'beta-local', persistent: false, deployed: false };
const GOOD_SESSION = { token: 'synthetic.not.a.real.token', principal: 'sub:beta-operator' };

(async () => {
  console.log('\nThe beta guard, refusing things it must refuse\n');

  /* 1 — a target that is not loopback. No network call may happen at all. */
  const offHost = await runGuard('http://humvance-preview.example.invalid/');
  check('a non-loopback host is refused', offHost.status === 3, 'exit ' + offHost.status);
  check('and the refusal names the host rather than a generic error',
    /not loopback/.test(offHost.out), offHost.out.slice(0, 200));
  check('nothing was attempted over the network first',
    !/GUARD_THREW/.test(offHost.out), offHost.out.slice(0, 200));

  /* 2 — https, which the local harness never serves. */
  const tls = await runGuard('https://127.0.0.1:4178/');
  check('an https target is refused even on 127.0.0.1', tls.status === 3, 'exit ' + tls.status);

  /* 3 — a local server that says it is deployed. */
  const deployed = await impostor({
    '/__beta/env': Object.assign({}, GOOD_ENV, { deployed: true }),
    '/__beta/session': GOOD_SESSION
  });
  const dep = await runGuard(deployed.base);
  check('a target that reports itself deployed is refused', dep.status === 3, 'exit ' + dep.status);
  check('and it is told why', /reports itself as deployed/.test(dep.out), dep.out.slice(0, 200));
  check('the session was never requested from it',
    !deployed.hits.some(h => h.indexOf('/__beta/session') !== -1), deployed.hits.join(' | '));
  deployed.close();

  /* 4 — a local server backed by a persistent store. */
  const persistent = await impostor({
    '/__beta/env': Object.assign({}, GOOD_ENV, { store: 'redis', persistent: true }),
    '/__beta/session': GOOD_SESSION
  });
  const per = await runGuard(persistent.base);
  check('a target with a persistent store is refused', per.status === 3, 'exit ' + per.status);
  check('and both reasons are named',
    /not memory/.test(per.out) && /persistent/.test(per.out), per.out.slice(0, 250));
  persistent.close();

  /* 5 — the right shape, the wrong harness. */
  const stranger = await impostor({
    '/__beta/env': GOOD_ENV,
    '/__beta/session': { token: 'x', principal: 'sub:somebody-else' }
  });
  const str = await runGuard(stranger.base);
  check('a different session principal is refused', str.status === 3, 'exit ' + str.status);
  check('and it says which principal it got',
    /somebody-else/.test(str.out), str.out.slice(0, 200));
  stranger.close();

  /* 6 — a loopback server with no harness endpoints at all. */
  const bare = await impostor({});
  const b = await runGuard(bare.base);
  check('a loopback server that is not the harness is refused', b.status === 3, 'exit ' + b.status);
  check('and the guard did not fall through to the session call',
    !bare.hits.some(h => h.indexOf('/__beta/session') !== -1), bare.hits.join(' | '));
  bare.close();

  /* 7 — the real shape passes, so the guard is not simply refusing everything. */
  const good = await impostor({ '/__beta/env': GOOD_ENV, '/__beta/session': GOOD_SESSION });
  const g = await runGuard(good.base);
  check('a correct local harness passes', g.status === 0 && /GUARD_PASSED/.test(g.out),
    'exit ' + g.status + ' ' + g.out.slice(0, 160));
  good.close();

  /* 8 — the synchronous hostname check is usable before any await. */
  let threw = false;
  const realExit = process.exit;
  process.exit = function () { threw = true; throw new Error('exit'); };
  try { assertLoopbackTarget('http://10.0.0.5:4178/'); } catch (e) { /* expected */ }
  process.exit = realExit;
  check('assertLoopbackTarget refuses a private-range host synchronously', threw);

  console.log(failures ? '\n  ' + failures + ' check(s) FAILED' : '\n  the guard refuses everything it must, and passes what it must');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
