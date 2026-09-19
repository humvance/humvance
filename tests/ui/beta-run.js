'use strict';
/**
 * The checks that need the REAL handlers, in one command.
 *
 *     npm run test:beta
 *
 * These are deliberately separate from `npm run test:browser`, which runs
 * against `npm run dev` — a static review server that answers every `/api/*`
 * with 501. A 501 cannot establish that a journey works, so anything that makes
 * a real write lives here instead, where `scripts/beta-server.js` dispatches to
 * `api/v2/*` over an isolated in-memory store.
 *
 * ── IT BRINGS ITS OWN SERVER ────────────────────────────────────────────────
 *
 * This runner starts a PRIVATE beta server FOR EACH SCRIPT, on its own port,
 * and stops it again. Three reasons, all learned the hard way:
 *
 *   1. It must not touch the instance somebody is trying the product on. These
 *      scripts create organizations, accept requests and record approvals, and
 *      doing that inside the window a person is exploring would rewrite what
 *      they are looking at. A `npm run beta` on 4178 is left alone.
 *   2. The intake endpoint rate-limits five submissions per client per ten
 *      minutes, and the suite as a whole sends more than that. That limit is a
 *      real protection and is NOT relaxed, worked around or given a test-only
 *      exemption; each script simply runs against a process of its own, which
 *      is what a separate client actually is.
 *   3. No script can then see another's records, so an assertion about "every
 *      request in the list" means what it says rather than whatever the
 *      previous script happened to leave behind.
 *
 * Set HV_BASE to point everything at a server you started yourself; the runner
 * then starts nothing. Either way each script's own guard still refuses any
 * target that is not a verified local harness.
 *
 * What a green run proves: the application logic, its gates and its refusals,
 * end to end, through the screens. What it does not prove: anything at all
 * about Preview, routing or Redis.
 */
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const path = require('path');

const SCRIPTS = [
  ['the local-only guard refuses what it must', 'repro-beta-guard.js'],
  ['the administration entrance and management landing', 'repro-admin-entrance.js'],
  ['the management round trip, clicked', 'repro-management-roundtrip.js'],
  ['a request becomes a case, through the screens', 'repro-public-journey.js'],
  ['the practitioner write surface', 'repro-practitioner-ops.js'],
  ['one case, INTAKE to APPROVED, through the screens', 'repro-case-walkthrough.js'],
  ['drafts survive, and a confirmation sends what it showed', 'repro-drafts-and-decisions.js']
];

function freePort() {
  return new Promise(function (resolve, reject) {
    var s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', function () {
      var p = s.address().port;
      s.close(function () { resolve(p); });
    });
  });
}

async function waitUntilUp(base, ms) {
  var until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      var r = await fetch(base + '/__beta/env');
      if (r.ok) return true;
    } catch (e) { /* not up yet */ }
    await new Promise(function (r) { setTimeout(r, 200); });
  }
  return false;
}

async function startPrivateServer() {
  var port = await freePort();
  var base = 'http://127.0.0.1:' + port;
  var proc = spawn(process.execPath,
    [path.join(__dirname, '..', '..', 'scripts', 'beta-server.js')],
    { env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'ignore' });
  if (!(await waitUntilUp(base, 15000))) {
    proc.kill();
    throw new Error('the private beta server did not come up on ' + base);
  }
  return { base: base, stop: function () { proc.kill(); } };
}

(async function () {
  var fixed = process.env.HV_BASE || null;
  if (fixed) console.log('  using HV_BASE=' + fixed + ' for every script');
  else console.log('  each script gets a private beta server of its own\n' +
                   '  (any instance you are using yourself is left untouched)');

  var bad = 0;
  for (var i = 0; i < SCRIPTS.length; i++) {
    var name = SCRIPTS[i][0], file = SCRIPTS[i][1];
    console.log('\n\x1b[1m' + name + '\x1b[0m  (' + file + ')');

    var server = null, base = fixed;
    if (!base) {
      try { server = await startPrivateServer(); base = server.base; }
      catch (e) { console.error('  ' + e.message); bad++; continue; }
    }
    var r = spawnSync(process.execPath, [path.join(__dirname, file)], {
      stdio: 'inherit',
      env: Object.assign({}, process.env, { HV_BASE: base })
    });
    if (server) server.stop();
    if (r.status !== 0) bad++;
  }

  console.log(bad ? '\n' + bad + ' beta script(s) FAILED' : '\nall internal-beta checks passed');
  process.exit(bad ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
