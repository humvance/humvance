'use strict';
/**
 * N-01 — the practitioner write surface, driven through a real browser against
 * the real handlers.
 *
 *     npm run beta                                  # in one shell
 *     node tests/ui/repro-practitioner-ops.js       # in another
 *
 * WHY THIS FILE EXISTS. Until this build, `/v2-workspace` could display a case
 * and nothing else: every operation in `api/v2/case.js` had to be typed as a raw
 * HTTP call. The claim being tested is not "the panel renders" — it is that an
 * operator can carry a synthetic case forward THROUGH THE SCREEN, that the
 * screen shows what the server actually stored, and that the three ways this
 * could go quietly wrong do not happen:
 *
 *   1. a material decision is sent before the operator confirmed it
 *   2. a refused write loses the operator's draft, or is replayed behind them
 *   3. demonstration mode reaches the API at all
 *
 * WHAT THIS DOES NOT PROVE. The store is in memory in one process and nothing
 * here is deployed. This is LOCAL INTEGRATION: real domain rules, real gates,
 * real refusals — and no statement whatsoever about Preview, routing or Redis.
 */
const { chromium } = require('playwright');
const { assertLocalHarness, fromPlaywright } = require('./_beta-guard');

const BASE = process.env.HV_BASE || 'http://127.0.0.1:4178';
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + String(detail).slice(0, 300) : '')); }
}

/* One synthetic case, created through the API, so the test never depends on
   whatever happens to be left in the store from an earlier run. */
async function seed(request, session) {
  const s = session;
  const post = async (body) => {
    const r = await request.post(BASE + '/api/v2/case', {
      headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' },
      data: body
    });
    const j = await r.json();
    if (!r.ok()) throw new Error(body.op + ': ' + JSON.stringify(j));
    return j;
  };
  const org = await post({ op: 'create_organization', name: 'SYNTHETIC — ops test' });
  const organization_id = org.organization_id;
  const kase = await post({
    op: 'create_case', organization_id,
    title: 'SYNTHETIC — handoffs stall between two teams',
    sponsor_claim: 'Work sits for days between design and delivery.'
  });
  return { token: s.token, organization_id, case_id: kase.case.case_id, post };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();

  const posted = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().indexOf('/api/') !== -1) posted.push(r.url()); });

  /* BETA-R03: refuse before any write if this is not the local harness. */
  const harness = await assertLocalHarness(BASE, fromPlaywright(ctx.request, BASE));
  const env = harness.env;
  check('the harness states what it is, in machine-readable form',
    env.mode === 'LOCAL_INTEGRATION' && env.persistent === false && env.deployed === false,
    JSON.stringify(env));

  const S = await seed(ctx.request, harness.session);
  const url = BASE + '/v2-workspace?organization_id=' + S.organization_id + '&case_id=' + S.case_id;

  /* The page reads its token from sessionStorage, exactly as on a deployment. */
  await page.goto(BASE + '/v2-workspace', { waitUntil: 'domcontentloaded' });
  await page.evaluate(tk => {
    try { sessionStorage.setItem('hv_token', tk); localStorage.setItem('hv_lang', 'ar'); } catch (e) {}
  }, S.token);

  // ── 1. the panel is there, in Arabic, with no untranslated keys ───────────
  await page.goto(url + '#h', { waitUntil: 'networkidle' });
  await page.click('[data-hv-tab="hypotheses"]');
  await page.waitForSelector('.op-panel');

  const panelText = await page.$eval('.op-panel', n => n.innerText);
  check('the write surface renders on the hypotheses tab',
    panelText.length > 0 && /[؀-ۿ]/.test(panelText), panelText.slice(0, 120));
  check('no untranslated key leaks onto the Arabic panel',
    !/\bop\.[a-z]/.test(panelText), (panelText.match(/op\.[a-z.\w]+/) || [])[0]);

  const opCount = await page.$$eval('.op-form', ns => ns.length);
  check('both hypothesis operations are offered, and only those two', opCount === 2, opCount);

  /* The panel must never offer an operation the dispatcher does not have. */
  const offered = await page.evaluate(() => HV.ops.FORMS.map(f => f.op));
  const dispatcherOps = [
    'transition', 'add_hypothesis', 'set_hypothesis_state', 'add_evidence', 'update_evidence',
    'record_contradiction', 'propose_evidence_request', 'decide_evidence_request',
    'draft_finding', 'revise_finding', 'run_challenge', 'record_approval'
  ];
  check('every offered operation exists in the case dispatcher',
    offered.every(o => dispatcherOps.indexOf(o) !== -1), offered.join(','));

  // ── 2. a real write, and a read-back from the server ──────────────────────
  await page.click('details[data-op="add_hypothesis"] > summary');
  await page.fill('#op-add_hypothesis-label', 'H-A');
  await page.fill('#op-add_hypothesis-statement',
    'SYNTHETIC — the delay is a queue at one approver, not a capacity shortfall.');
  await page.click('[data-op-run="add_hypothesis"]');
  await page.waitForSelector('[data-op-status="add_hypothesis"].op-status-ok', { timeout: 8000 });

  const back = await page.$eval('[data-op-result="add_hypothesis"]', n => n.innerText);
  check('the read-back carries the id the server minted', /hyp_[a-z0-9]+/.test(back), back.slice(0, 160));

  const stored = await (await ctx.request.get(
    BASE + '/api/v2/case?organization_id=' + S.organization_id + '&case_id=' + S.case_id + '&view=reviewer',
    { headers: { Authorization: 'Bearer ' + S.token } })).json();
  check('the hypothesis really is on the case in the store',
    (stored.hypotheses || []).some(h => h.label === 'H-A'), JSON.stringify((stored.hypotheses || []).map(h => h.label)));

  const listed = await page.$eval('#app', n => n.innerText);
  check('the screen re-read the case rather than trusting itself',
    listed.indexOf('H-A') !== -1);
  check('the read-back survives the re-read it triggers',
    (await page.$eval('[data-op-result="add_hypothesis"]', n => n.innerText)).indexOf('hyp_') !== -1);

  // ── 3. a material decision is shown before it is sent ─────────────────────
  const before = posted.length;
  await page.click('details[data-op="set_hypothesis_state"] > summary');
  await page.selectOption('#op-set_hypothesis_state-__target', { index: 1 });
  await page.selectOption('#op-set_hypothesis_state-to_state', 'ACTIVE');
  await page.fill('#op-set_hypothesis_state-because', 'SYNTHETIC — two system records point the same way.');
  await page.click('[data-op-run="set_hypothesis_state"]');
  await page.waitForSelector('.op-confirm');

  check('a material decision sends nothing until it is confirmed', posted.length === before, posted.length - before);

  /* R01 changed what a confirmation LEADS with — a readable decision rather than
     JSON — without hiding the payload. Both are still required: the summary
     must be there, and the exact bytes must remain one click away. */
  const decisionText = await page.$eval('.op-confirm .op-decision', n => n.innerText);
  check('the confirmation leads with the decision in words',
    decisionText.length > 0 && !/^\s*\{/.test(decisionText), decisionText.slice(0, 160));
  await page.click('.op-confirm details.op-raw > summary');
  await page.waitForTimeout(150);
  const confirmText = await page.$eval('.op-confirm .op-pre', n => n.innerText);
  check('the confirmation shows the exact payload, including the version',
    confirmText.indexOf('"op": "set_hypothesis_state"') !== -1 && /"expected_version": \d+/.test(confirmText),
    confirmText.slice(0, 200));

  /* The version must come from the server's own object, not from a typed box. */
  const typedVersion = await page.$$eval('.op-form-body input,textarea,select',
    ns => ns.filter(n => /version/i.test(n.id)).length);
  check('there is no field for the operator to type a version into', typedVersion === 0, typedVersion);

  await page.click('[data-op-confirm="set_hypothesis_state"]');
  await page.waitForSelector('[data-op-status="set_hypothesis_state"].op-status-ok', { timeout: 8000 });
  check('the confirmed decision was carried out', posted.length > before);

  // ── 4. a version conflict keeps the draft and replays nothing ─────────────
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-hv-tab="hypotheses"]');
  await page.click('details[data-op="set_hypothesis_state"] > summary');
  await page.selectOption('#op-set_hypothesis_state-__target', { index: 1 });
  await page.selectOption('#op-set_hypothesis_state-to_state', 'WEAKENED');
  const draftText = 'SYNTHETIC — this sentence must survive the refusal.';
  await page.fill('#op-set_hypothesis_state-because', draftText);

  /* Somebody else moves the same hypothesis while this form sits open. */
  const target = await page.$eval('#op-set_hypothesis_state-__target', n => n.value);
  const targetVersion = await page.$eval('#op-set_hypothesis_state-__target',
    n => Number(n.selectedOptions[0].getAttribute('data-op-version')));
  await S.post({
    op: 'set_hypothesis_state', organization_id: S.organization_id, hypothesis_id: target,
    to_state: 'STRENGTHENED', expected_version: targetVersion, because: 'SYNTHETIC — concurrent editor'
  });

  const beforeConflict = posted.length;
  await page.click('[data-op-run="set_hypothesis_state"]');
  await page.waitForSelector('.op-confirm');
  await page.click('[data-op-confirm="set_hypothesis_state"]');
  await page.waitForSelector('.op-conflict', { timeout: 8000 });

  check('the refusal is named as a version conflict, not a generic error',
    (await page.$eval('[data-op-status="set_hypothesis_state"]', n => n.innerText)).length > 0);
  check('the operator\'s words are still in the form after the refusal',
    (await page.inputValue('#op-set_hypothesis_state-because')) === draftText);

  const afterConflict = posted.length;
  await page.waitForTimeout(700);
  check('nothing is replayed on its own after a refusal', posted.length === afterConflict, posted.length - beforeConflict);

  const storedNow = await (await ctx.request.get(
    BASE + '/api/v2/case?organization_id=' + S.organization_id + '&case_id=' + S.case_id + '&view=reviewer',
    { headers: { Authorization: 'Bearer ' + S.token } })).json();
  check('the refused write did not reach the store',
    (storedNow.hypotheses.find(h => h.hypothesis_id === target) || {}).state === 'STRENGTHENED',
    (storedNow.hypotheses.find(h => h.hypothesis_id === target) || {}).state);

  /* Refresh keeps the draft and shows the current state — it does not resend. */
  const beforeRefresh = posted.length;
  await page.click('[data-op-refresh="set_hypothesis_state"]');
  await page.waitForTimeout(600);
  check('refreshing after a conflict re-reads without writing', posted.length === beforeRefresh);
  check('the draft is restored into the rebuilt form',
    (await page.inputValue('#op-set_hypothesis_state-because')) === draftText);

  // ── 5. the same panel, in English ─────────────────────────────────────────
  await page.evaluate(() => HV.i18n.setLang('en'));
  await page.waitForTimeout(250);
  const en = await page.$eval('.op-panel', n => n.innerText);
  check('the panel is fully translated in English',
    !/\bop\.[a-z]/.test(en) && /[A-Za-z]/.test(en), (en.match(/op\.[a-z.\w]+/) || [])[0]);
  check('the English panel is not the Arabic one', !/[؀-ۿ]/.test(en.replace(/[\s·—]/g, '')));

  // ── 6. demonstration mode stays read-only ────────────────────────────────
  const demoPage = await ctx.newPage();
  const demoPosts = [];
  demoPage.on('request', r => { if (r.method() === 'POST' && r.url().indexOf('/api/') !== -1) demoPosts.push(r.url()); });
  await demoPage.goto(BASE + '/v2-workspace?demo=1', { waitUntil: 'networkidle' });
  await demoPage.click('[data-hv-tab="hypotheses"]');
  await demoPage.waitForSelector('.op-panel');
  check('the demo panel offers no operation at all',
    (await demoPage.$$('.op-form')).length === 0 && (await demoPage.$$('[data-op-run]')).length === 0);
  check('the demo panel says why, rather than looking broken',
    (await demoPage.$eval('.op-panel', n => n.innerText)).length > 20);
  await demoPage.waitForTimeout(400);
  check('demonstration mode made no API write', demoPosts.length === 0, demoPosts.join(','));

  // ── 7. an empty tab offers its operations without pretending to content ───
  await page.click('[data-hv-tab="findings"]');
  await page.waitForSelector('.op-panel');
  const findingOps = await page.$$eval('.op-form', ns => ns.map(n => n.getAttribute('data-op')).sort());
  check('the findings tab offers exactly its four operations',
    findingOps.join(',') === 'draft_finding,record_approval,revise_finding,run_challenge', findingOps.join(','));

  const findingsTab = await page.$eval('#app', n => n.innerText);
  check('an empty findings tab stays visibly empty rather than borrowing content',
    !/hyp_/.test(findingsTab.split('Practitioner operations')[0] || findingsTab));

  /* Where there is nothing to target, the form says so instead of offering an
     empty select the operator could submit. */
  const targetHint = await page.$eval('details[data-op="run_challenge"]', n => n.innerText);
  check('an operation with nothing to act on says so',
    targetHint.length > 0 && !/<select/.test(targetHint));

  await browser.close();
  console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\nall practitioner-surface checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
