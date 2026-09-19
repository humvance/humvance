'use strict';
/**
 * The browser checks, in one command.
 *
 *     npm run dev            # in one shell — the local review server
 *     npm run test:browser   # in another
 *
 * These are deliberately SEPARATE from `npm run test:ui`, which is pure Node
 * and has no dependencies at all. These need a running server and a Chromium,
 * so they must never become a precondition for the zero-dependency suite.
 *
 * Each script exits non-zero on the first failing check; this runner reports
 * them all and exits non-zero if any did.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPTS = [
  ['validation survives a language switch', 'repro-lang-validation.js'],
  ['the review shows every answer',          'repro-review-complete.js'],
  ['demo fixtures open, and writes refuse',  'repro-demo-review.js'],
  ['navigation, keyboard, drafts, failure',  'repro-site-checks.js'],
  ['the workspace header status label',      'repro-workspace-header.js'],
  ['the workspace audit trail labels',       'repro-audit-labels.js'],
  ['bilingual coverage, measured at run time','repro-i18n-coverage.js'],
  ['the demo boundary, and the request deep link','repro-demo-boundary.js']
];

let bad = 0;
for (const [name, file] of SCRIPTS) {
  console.log('\n\x1b[1m' + name + '\x1b[0m  (' + file + ')');
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? '\n' + bad + ' browser script(s) FAILED' : '\nall browser checks passed');
process.exit(bad ? 1 : 0);
