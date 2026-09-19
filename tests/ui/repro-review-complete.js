'use strict';
/**
 * The review step, driven in a real browser.
 *
 * The brief: "The final review currently displays only seven values. Include
 * every nonempty submitted answer in concise grouped sections … Add direct edit
 * actions back to the relevant step without losing progress or acknowledgements."
 *
 * So this fills EVERY field the form offers — including the optional ones — and
 * then asserts that each value it typed is visible on the review. It also ticks
 * the three acknowledgements, jumps back to an earlier step with an edit action,
 * returns, and asserts the acknowledgements and every other answer survived.
 *
 *     node tests/ui/repro-review-complete.js        (server must be running)
 */
const { chromium } = require('playwright');

const BASE = process.env.HV_BASE || 'http://localhost:4173';
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}

/* Distinct strings, so "is it on the review?" cannot pass by accident. */
const V = {
  situation: 'SITUATION_TEXT decisions stall for weeks',
  labels: 'LABEL_ONE, LABEL_TWO',
  firstNoticed: 'FIRSTNOTICED_JANUARY',
  assoc: 'ASSOC_CHANGE_NOTE new head of ops',
  exWhat: 'EXAMPLE_WHAT the release was signed off twice',
  exWhen: 'EXAMPLE_WHEN last month',
  exArea: 'EXAMPLE_AREA operations',
  exCons: 'EXAMPLE_CONSEQUENCE shipment missed',
  outcome: 'OUTCOME_TEXT who decides what, and when',
  belief: 'BELIEF_TEXT I suspect the approval chain',
  company: 'COMPANY_NAME Falcon Industrial',
  sector: 'SECTOR_TEXT logistics',
  name: 'NAME_TEXT Sara Al-Otaibi',
  role: 'ROLE_TEXT Head of People',
  email: 'reviewcheck@example.com',
  phone: '0500000000'
};

/* A label wraps each input, so a direct click is forwarded and toggles twice.
   Set the state and fire the event the page listens for. */
async function tick(page, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('no element for ' + s);
    if (!el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, sel);
}

async function fillAll(page) {
  /* step 0 */
  await page.fill('#f-reported_situation', V.situation);
  await tick(page, 'input[name="case_intent"][value="DYSFUNCTION"]');
  await page.click('[data-hv-next]');

  /* step 1 */
  await tick(page, 'input[name="scope_kind"][value="process"]');
  await page.fill('#f-scope_labels', V.labels);
  await tick(page, 'input[name="pattern"][value="increasing"]');
  await page.fill('#f-first_noticed_approx', V.firstNoticed);
  await page.fill('#f-associated_change_note', V.assoc);
  await page.click('[data-hv-next]');

  /* step 2 — optional, filled anyway */
  await page.fill('#ex-w-0', V.exWhat);
  await page.fill('#ex-t-0', V.exWhen);
  await page.fill('#ex-a-0', V.exArea);
  await page.fill('#ex-c-0', V.exCons);
  await tick(page, '[data-hv-bag="impact"][value="delays"]');
  await tick(page, '[data-hv-bag="impact"][value="quality_rework"]');
  await page.click('[data-hv-next]');

  /* step 3 */
  await page.fill('#f-desired_outcome', V.outcome);
  await page.fill('#f-client_belief', V.belief);
  await tick(page, '[data-hv-bag="changes"][value="leadership_change"]');
  await tick(page, '[data-hv-bag="availability"][value="org_chart"]');
  await page.click('[data-hv-next]');

  /* step 4 */
  await page.fill('#f-company_name', V.company);
  await page.fill('#f-sector', V.sector);
  await page.selectOption('#f-employee_count_band', '51-200');
  await page.selectOption('#f-growth_stage', 'scaling');
  await page.fill('#f-name', V.name);
  await page.fill('#f-role_title', V.role);
  await page.fill('#f-email', V.email);
  await page.fill('#f-phone', V.phone);
  await page.selectOption('#f-preferred_contact', 'phone');
  await page.click('[data-hv-next]');
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hv_lang', 'en'); } catch (e) {} });
  await page.goto(BASE + '/intake', { waitUntil: 'networkidle' });

  await fillAll(page);

  const review = await page.$eval('.ik-rev', n => n.innerText);

  /* ── every value typed must be on the review ── */
  Object.keys(V).forEach(function (k) {
    if (k === 'labels') {          // rendered as one chip per label, so the comma is gone
      check('review shows labels', review.indexOf('LABEL_ONE') !== -1 && review.indexOf('LABEL_TWO') !== -1);
      return;
    }
    check('review shows ' + k, review.indexOf(V[k]) !== -1);
  });

  /* ── enumerations must appear as READABLE LABELS, not raw enum values ── */
  const labelChecks = [
    ['intent label', /Something isn.t working as it should/i],
    ['scope label', /process|workflow/i],
    ['pattern label', /Getting worse/i],
    ['impact selections', /Delays/i],
    ['impact second selection', /rework/i],
    ['change selection', /leadership/i],
    ['availability selection', /chart/i],
    ['employee band', /51/],
    ['growth stage', /scaling|Scaling/],
    ['contact preference', /[Pp]hone/]
  ];
  labelChecks.forEach(([n, re]) => check('review shows ' + n, re.test(review)));
  check('no raw enum leaks into the review',
    !/DYSFUNCTION|quality_rework|leadership_change|org_chart/.test(review),
    review.slice(0, 200));

  /* ── the old bug: only seven values ── */
  const rowCount = await page.$$eval('.ik-rev .ik-summary-row', n => n.length);
  check('review has far more than the old seven rows (' + rowCount + ')', rowCount >= 18, String(rowCount));

  const groups = await page.$$eval('.ik-rev-g', ns => ns.length);
  check('review is grouped into the five answered sections', groups === 5, String(groups));

  /* ── acknowledgements, then an edit jump ── */
  await tick(page, '[data-hv-keep="consent_data_use"]');
  await tick(page, '[data-hv-keep="consent_ai"]');
  await tick(page, '[data-hv-keep="consent_sensitive"]');

  await page.click('.ik-rev-g:nth-of-type(2) [data-hv-edit]');
  await page.waitForTimeout(150);

  const onStep1 = await page.$('#f-scope_labels');
  check('edit action lands on the right step', !!onStep1);
  check('that step still holds its answers', await page.$eval('#f-scope_labels', n => n.value) === V.labels);
  check('a direct way back to the review is offered', !!(await page.$('[data-hv-to-review]')));

  await page.fill('#f-first_noticed_approx', 'EDITED_FIRSTNOTICED');
  await page.click('[data-hv-to-review]');
  await page.waitForTimeout(200);

  const back = await page.$eval('.ik-rev', n => n.innerText);
  check('the edit is reflected on the review', back.indexOf('EDITED_FIRSTNOTICED') !== -1);
  check('untouched answers survived the round trip', back.indexOf(V.exWhat) !== -1 && back.indexOf(V.outcome) !== -1);

  const consents = await page.$$eval('[data-hv-keep^="consent_"]', ns => ns.map(n => n.checked));
  check('acknowledgements survived the edit round trip', consents.length === 3 && consents.every(Boolean),
    JSON.stringify(consents));

  /* ── the review must survive a language switch, in Arabic ── */
  await page.click('[data-hv-lang-toggle]');
  await page.waitForTimeout(250);
  const ar = await page.$eval('.ik-rev', n => n.innerText);
  check('review still shows the answers in Arabic', ar.indexOf(V.situation) !== -1 && ar.indexOf(V.exWhat) !== -1);
  check('review labels are Arabic', /[؀-ۿ]/.test(ar));
  const consentsAr = await page.$$eval('[data-hv-keep^="consent_"]', ns => ns.map(n => n.checked));
  check('acknowledgements survived the language switch',
    consentsAr.length === 3 && consentsAr.every(Boolean), JSON.stringify(consentsAr));

  /* ── an empty optional section is still listed, with its edit action ── */
  await page.evaluate(() => { try { localStorage.clear(); localStorage.setItem('hv_lang', 'en'); } catch (e) {} });
  await page.goto(BASE + '/intake', { waitUntil: 'networkidle' });
  await page.fill('#f-reported_situation', V.situation);
  await tick(page, 'input[name="case_intent"][value="RISK"]');
  await page.click('[data-hv-next]');
  await tick(page, 'input[name="scope_kind"][value="team"]');
  await tick(page, 'input[name="pattern"][value="unclear"]');
  await page.click('[data-hv-next]');
  await page.click('[data-hv-skip]');                       // skip the optional step
  await page.fill('#f-desired_outcome', V.outcome);
  await page.click('[data-hv-next]');
  await page.fill('#f-company_name', V.company);
  await page.fill('#f-name', V.name);
  await page.fill('#f-role_title', V.role);
  await page.fill('#f-email', V.email);
  await page.click('[data-hv-next]');

  const thin = await page.$eval('.ik-rev', n => n.innerText);
  check('skipped optional section is still listed', /optional/i.test(thin), thin);
  check('skipped section does not invent values', thin.indexOf(V.exWhat) === -1);
  const placeholders = await page.$$eval('.ik-rev .ik-summary-row',
    ns => ns.map(n => (n.children[1] || {}).innerText || '').filter(v => v.trim() === '—'));
  check('empty fields are simply absent, not shown as dash placeholders',
    placeholders.length === 0, JSON.stringify(placeholders));
  const thinGroups = await page.$$eval('.ik-rev-g [data-hv-edit]', ns => ns.length);
  check('every listed section has an edit action', thinGroups === 5, String(thinGroups));

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
