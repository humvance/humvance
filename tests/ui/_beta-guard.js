'use strict';
/**
 * The gate every beta script passes through before it touches anything.
 *
 * BETA-R03. These scripts create organizations, cases, findings and approvals.
 * They were written for `scripts/beta-server.js` and they are safe there because
 * that server is loopback-only, in-memory and throwaway. Nothing in the scripts
 * said so. `HV_BASE` is an ordinary environment variable, and pointing it at a
 * deployment would have sent a synthetic case walkthrough — including recorded
 * approvals — into a real store, discovering the mistake only afterwards.
 *
 * WHAT THIS REFUSES, in order, BEFORE ANY REQUEST IS SENT:
 *
 *   1. a target that is not loopback. Checked on the parsed hostname alone, with
 *      no network call, so a hostname that resolves to 127.0.0.1 somewhere else
 *      never gets the chance to look local.
 *   2. a target that does not answer `/__beta/env` as the local harness. The
 *      answer must say LOCAL_INTEGRATION, memory store, not persistent and not
 *      deployed — all four. A deployment cannot produce that answer, because
 *      the endpoint only exists in `scripts/beta-server.js`, which is never
 *      deployed.
 *   3. a target that cannot issue the synthetic operator session, or issues one
 *      under a different principal than this harness mints.
 *
 * It is a HARD FAILURE, not a warning: the process exits before the first
 * mutation. Refusing late is not refusing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not make these scripts Preview-safe,
 * and it must never be extended to. Preview needs its own authentication and its
 * own isolation verification, neither of which exists yet, and both of which are
 * a separate authorized piece of work.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const EXPECTED_PRINCIPAL = 'sub:beta-operator';

function refuse(lines) {
  console.error('\n  REFUSED — this script writes, and it will only write to the local beta harness.\n');
  lines.forEach(l => console.error('  ' + l));
  console.error('\n  Start it with `npm run beta` and leave HV_BASE unset, or set it to');
  console.error('  http://127.0.0.1:4178. HV_BASE cannot point these scripts at Preview:');
  console.error('  Preview has no /__beta/session, and it must not.\n');
  process.exit(3);
}

/** Hostname check only. Synchronous, no network, safe to call before anything. */
function assertLoopbackTarget(base) {
  let url;
  try { url = new URL(base); }
  catch (e) { refuse(['HV_BASE is not a URL: ' + String(base)]); }
  if (url.protocol !== 'http:') {
    refuse(['the target is ' + url.protocol + '//, and the local harness serves plain http on loopback']);
  }
  if (!LOOPBACK.has(url.hostname)) {
    refuse(['the target host is "' + url.hostname + '", which is not loopback',
            'target: ' + base]);
  }
  return url;
}

/**
 * The full check. `fetchJson(path)` is supplied by the caller so this file needs
 * no HTTP client of its own and works from Playwright's request context or from
 * plain node. Returns the harness's own description of itself.
 */
async function assertLocalHarness(base, fetchJson) {
  assertLoopbackTarget(base);

  let env;
  try { env = await fetchJson('/__beta/env'); }
  catch (e) {
    refuse(['nothing answered ' + base + '/__beta/env',
            String((e && e.message) || e)]);
  }
  const wrong = [];
  if (!env || env.mode !== 'LOCAL_INTEGRATION') wrong.push('mode is ' + (env && env.mode) + ', not LOCAL_INTEGRATION');
  if (!env || env.store !== 'memory') wrong.push('store is ' + (env && env.store) + ', not memory');
  if (!env || env.persistent !== false) wrong.push('the store reports itself as persistent');
  if (!env || env.deployed !== false) wrong.push('the target reports itself as deployed');
  if (wrong.length) refuse(['the target answered /__beta/env, but not as the local harness:'].concat(wrong));

  let session;
  try { session = await fetchJson('/__beta/session'); }
  catch (e) {
    refuse(['the target would not issue a synthetic operator session', String((e && e.message) || e)]);
  }
  if (!session || !session.token) refuse(['/__beta/session returned no token']);
  if (session.principal !== EXPECTED_PRINCIPAL) {
    refuse(['the session principal is "' + session.principal + '", not "' + EXPECTED_PRINCIPAL + '"',
            'this is not the harness these scripts were written for']);
  }
  return { env, session };
}

/** For Playwright: wraps an APIRequestContext into the fetchJson this expects. */
function fromPlaywright(request, base) {
  return async function (path) {
    const r = await request.get(base + path);
    if (!r.ok()) throw new Error(path + ' → HTTP ' + r.status());
    return r.json();
  };
}

module.exports = { assertLocalHarness, assertLoopbackTarget, fromPlaywright, LOOPBACK, EXPECTED_PRINCIPAL };
