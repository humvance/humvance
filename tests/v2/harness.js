'use strict';
// Minimal test harness. No dependencies on purpose: the V2 core must be testable
// with nothing but `node`, in CI, on a laptop, or inside a locked-down VM.

const suites = [];
let current = null;

function suite(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

function test(name, fn) {
  if (!current) throw new Error('test() outside suite()');
  current.tests.push({ name, fn });
}

class AssertionError extends Error {}

const assert = {
  ok(v, msg = 'expected truthy') { if (!v) throw new AssertionError(`${msg} (got ${JSON.stringify(v)})`); },
  notOk(v, msg = 'expected falsy') { if (v) throw new AssertionError(`${msg} (got ${JSON.stringify(v)})`); },
  equal(a, b, msg = 'values differ') {
    if (a !== b) throw new AssertionError(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  },
  deepEqual(a, b, msg = 'objects differ') {
    const A = JSON.stringify(a), B = JSON.stringify(b);
    if (A !== B) throw new AssertionError(`${msg}:\n  ${A}\n  ${B}`);
  },
  includes(hay, needle, msg = 'not found') {
    const s = typeof hay === 'string' ? hay : JSON.stringify(hay);
    if (!s.includes(needle)) throw new AssertionError(`${msg}: ${JSON.stringify(needle)} not in ${s.slice(0, 200)}`);
  },
  /** Asserts the promise rejects, and (optionally) with a specific error code. */
  async rejects(promise, code, msg = 'expected rejection') {
    let threw = null;
    try { await promise; } catch (e) { threw = e; }
    if (!threw) throw new AssertionError(`${msg}: nothing thrown`);
    if (code && threw.code !== code) {
      throw new AssertionError(`${msg}: expected code "${code}", got "${threw.code}" (${threw.message})`);
    }
    return threw;
  },
  throws(fn, code, msg = 'expected throw') {
    let threw = null;
    try { fn(); } catch (e) { threw = e; }
    if (!threw) throw new AssertionError(`${msg}: nothing thrown`);
    if (code && threw.code !== code) {
      throw new AssertionError(`${msg}: expected code "${code}", got "${threw.code}" (${threw.message})`);
    }
    return threw;
  }
};

async function run() {
  let passed = 0, failed = 0;
  const failures = [];
  for (const s of suites) {
    console.log(`\n\x1b[1m${s.name}\x1b[0m`);
    for (const t of s.tests) {
      try {
        await t.fn();
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
      } catch (err) {
        failed++;
        failures.push({ suite: s.name, test: t.name, err });
        console.log(`  \x1b[31m✗\x1b[0m ${t.name}`);
        console.log(`      ${err.message.split('\n').join('\n      ')}`);
      }
    }
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  total ${passed + failed}   \x1b[32mpassed ${passed}\x1b[0m   ${failed ? `\x1b[31mfailed ${failed}\x1b[0m` : 'failed 0'}`);
  if (failed) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  ${f.suite} › ${f.test}\n    ${f.err.stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
  return failed === 0;
}

module.exports = { suite, test, assert, run, AssertionError };
