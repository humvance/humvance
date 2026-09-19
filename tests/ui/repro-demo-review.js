'use strict';
/**
 * /v2-intake-review?demo=1 — the fixture detail, driven in a real browser.
 *
 * The brief: "clicking a fixture calls demoGuard and cannot open details — add
 * backend-shaped read-only fixture details for pending, declined,
 * accepted-complete and accepted-promotion-pending; keep real writes blocked."
 *
 * So this opens each of those four states, asserts the review screen renders
 * from backend field names, and then asserts that ACCEPT, REJECT and resume
 * still refuse — no network call, no state change.
 *
 *     node tests/ui/repro-demo-review.js            (server must be running)
 */
const { chromium } = require('playwright');

const BASE = process.env.HV_BASE || 'http://localhost:4173';
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + String(detail).slice(0, 300) : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hv_lang', 'en'); } catch (e) {} });

  /* Any request to /api/* while in demo mode is a failure of the guard. */
  const apiCalls = [];
  page.on('request', r => { if (/\/api\//.test(r.url())) apiCalls.push(r.method() + ' ' + r.url()); });
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.type() + ': ' + d.message()); await d.dismiss(); });

  await page.goto(BASE + '/v2-intake-review?demo=1', { waitUntil: 'networkidle' });

  check('demo bar is present', !!(await page.$('.hv-demo-bar, [data-hv-demo-bar], .hv-demobar')) ||
    /demo/i.test(await page.evaluate(() => document.body.innerText)));

  await page.click('[data-hv-filter="all"]');
  await page.waitForTimeout(120);
  const rows = await page.$$eval('[data-hv-open]', ns => ns.map(n => n.getAttribute('data-hv-open')));
  check('all five fixtures are listed', rows.length === 5, JSON.stringify(rows));

  async function open(id) {
    await page.click('[data-hv-open="' + id + '"]');
    await page.waitForTimeout(150);
    return page.evaluate(() => document.querySelector('main').innerText);
  }
  async function back() {
    await page.click('[data-hv-back]');
    await page.waitForTimeout(120);
    await page.click('[data-hv-filter="all"]');
    await page.waitForTimeout(100);
  }

  /* ── pending ── */
  let txt = await open('seed_demo_a');
  check('pending: detail opens at all', /HVS-DEMO-AAAA-0001/.test(txt), txt.slice(0, 120));
  check('pending: client situation is rendered', /purchase request/i.test(txt));
  check('pending: epistemic label from the record is shown', /CLIENT_REPORTED_OBSERVATION/.test(txt));
  check('pending: decision and promotion are two separate states',
    (await page.$$('.rv-state')).length === 2);
  check('pending: the decision panel is offered', !!(await page.$('[data-hv-accept]')) && !!(await page.$('[data-hv-reject]')));
  check('pending: examples render from recent_examples', /spare-parts/i.test(txt));
  check('pending: impact renders readable labels, not raw enums',
    /Delays/i.test(txt) && !/management_time/.test(txt), txt);
  /* Escaped markup showing through as text — the examples heading used to read
     `Examples (<bdi class="hv-num">1</bdi>)` on screen. */
  check('pending: no escaped markup is visible as text',
    !/<bdi|<span|&lt;|&gt;|&amp;/.test(txt), (txt.match(/.{0,60}<bdi.{0,60}/) || [''])[0]);
  check('pending: the example count is a readable number',
    /\(\s*1\s*\)|١/.test(txt), txt);

  /* writes must still refuse */
  const before = apiCalls.length;
  await page.click('[data-hv-accept]');
  await page.waitForTimeout(150);
  await page.click('[data-hv-reject]');
  await page.waitForTimeout(150);
  check('ACCEPT and REJECT make no API call in demo mode', apiCalls.length === before,
    JSON.stringify(apiCalls.slice(before)));
  check('the demo guard spoke up', dialogs.length >= 1 || /demo/i.test(
    await page.evaluate(() => document.body.innerText)), JSON.stringify(dialogs));
  check('the fixture is unchanged after a refused write',
    /HVS-DEMO-AAAA-0001/.test(await page.evaluate(() => document.querySelector('main').innerText)));

  await back();

  /* ── declined ── */
  txt = await open('seed_demo_d');
  check('declined: shows the REJECTED decision', /reject|declin/i.test(txt), txt.slice(0, 200));
  check('declined: shows the reviewer reason from decision_reason',
    /legal dispute/i.test(txt), txt);
  check('declined: offers no decision buttons', !(await page.$('[data-hv-accept]')));
  await back();

  /* ── accepted, promotion COMPLETE ── */
  txt = await open('seed_demo_c');
  check('accepted-complete: promotion shows as complete', /complete/i.test(txt), txt.slice(0, 200));
  check('accepted-complete: the resulting case id is shown', /case_demo0000000000000000000/.test(txt));
  check('accepted-complete: offers a link to the case', !!(await page.$('a[href*="/v2-workspace?case="]')));
  check('accepted-complete: no resume action', !(await page.$('[data-hv-resume]')));
  await back();

  /* ── accepted, promotion PENDING ── */
  txt = await open('seed_demo_e');
  check('accepted-pending: promotion shows as incomplete', /Promotion incomplete/i.test(txt), txt.slice(0, 200));
  check('accepted-pending: the last promotion error is shown', /store_write_timeout/.test(txt), txt);
  check('accepted-pending: the resume action is offered', !!(await page.$('[data-hv-resume]')));

  const before2 = apiCalls.length;
  await page.click('[data-hv-resume]');
  await page.waitForTimeout(200);
  check('resume makes no API call in demo mode', apiCalls.length === before2,
    JSON.stringify(apiCalls.slice(before2)));

  /* ── language switch, with a detail open ── */
  await page.click('[data-hv-lang-toggle]');
  await page.waitForTimeout(250);
  const arTxt = await page.evaluate(() => document.querySelector('main').innerText);
  check('the open detail survives a language switch', /HVS-DEMO-EEEE-0005/.test(arTxt), arTxt.slice(0, 160));
  check('demo fixture text is refreshed into Arabic', /فريق التسليم/.test(arTxt), arTxt.slice(0, 400));
  check('no stale English fixture text remains', !/The delivery team keeps changing/.test(arTxt));
  check('the skip link is translated too',
    (await page.$eval('.hv-skip', n => n.textContent)).indexOf('تخطَّ') === 0,
    await page.$eval('.hv-skip', n => n.textContent));

  /* and in English again */
  await page.click('[data-hv-lang-toggle]');
  await page.waitForTimeout(250);
  check('skip link switches back to English',
    /Skip to content/.test(await page.$eval('.hv-skip', n => n.textContent)),
    await page.$eval('.hv-skip', n => n.textContent));

  check('no /api/ request was made anywhere in this run', apiCalls.length === 0, JSON.stringify(apiCalls));

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
