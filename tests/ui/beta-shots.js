'use strict';
/**
 * The internal beta, photographed — Arabic and English, desktop and phone.
 *
 *     npm run beta                                              # in one shell
 *     node tests/ui/beta-shots.js docs/beta-2026-09-18/shots     # in another
 *
 * A screenshot is evidence, and a screenshot whose filename says one thing
 * while the pixels say another is worse than no screenshot at all. So every
 * capture is asserted first — the page is interrogated for the thing the
 * filename claims — and a capture that cannot be vouched for is NOT WRITTEN.
 * The same discipline as tests/ui/shots.js, and for the same reason (C-01).
 *
 * These come from the internal beta server, so the workspace shots show a real
 * case that was created through the real handlers, with synthetic content.
 */
const { chromium } = require('playwright');
const { assertLocalHarness, fromPlaywright } = require('./_beta-guard');
const fs = require('fs');
const path = require('path');

const BASE = process.env.HV_BASE || 'http://127.0.0.1:4178';
const OUT = process.argv[2] || path.join(__dirname, '..', '..', '.shots-beta');
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1400, height: 950 };
const PHONE = { width: 390, height: 844 };

let bad = 0;
const failed = new Map();
function must(name, what, cond, detail) {
  if (cond) return;
  bad++;
  if (!failed.has(name)) failed.set(name, []);
  failed.get(name).push(what);
  console.log('  FAIL ' + name + ' — ' + what + (detail ? '  → ' + String(detail).slice(0, 200) : ''));
}
async function vouched(page, name, opts) {
  opts = opts || {};
  if (failed.get(name)) {
    const f = path.join(OUT, name + '.png');
    console.log('  SKIPPED ' + name + '.png — assertions failed' +
      (fs.existsSync(f) ? '. AN OLDER FILE OF THIS NAME IS NOW STALE.' : '.'));
    return false;
  }
  const target = opts.el ? page.locator(opts.el) : page;
  await target.screenshot({ path: path.join(OUT, name + '.png'), fullPage: opts.el ? undefined : !!opts.full });
  console.log('  ' + name + '.png');
  return true;
}
async function setLang(page, lang) {
  await page.evaluate(l => { try { localStorage.setItem('hv_lang', l); } catch (e) {} }, lang);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
}

(async () => {
  const browser = await chromium.launch();

  /* ── one synthetic case, built through the real API ─────────────────────── */
  const seedCtx = await browser.newContext();
  /* BETA-R03. A screenshot run seeds real submissions and decisions, so it is
     held to the same gate as the tests: local harness, or nothing. */
  const harness = await assertLocalHarness(BASE, fromPlaywright(seedCtx.request, BASE));
  const session = harness.session;
  const auth = { Authorization: 'Bearer ' + session.token };
  const api = async (body) => {
    const r = await seedCtx.request.post(BASE + '/api/v2/case', { headers: auth, data: body });
    const j = await r.json();
    if (!r.ok()) throw new Error(body.op + ': ' + JSON.stringify(j));
    return j;
  };

  /* Two requests go in through the public form's own endpoint — one accepted,
     one declined — so the reviewer queue in these shots holds both outcomes,
     and the case behind them is the one acceptance actually created. */
  const submit = async (payload) => {
    const r = await seedCtx.request.post(BASE + '/api/v2/intake', { data: payload });
    const j = await r.json();
    if (!r.ok()) throw new Error('intake: ' + JSON.stringify(j));
    return j;
  };
  const request = (over) => Object.assign({
    organization_context: { company_name: 'SYNTHETIC — Northline Logistics', sector: 'Logistics',
                            employee_count_band: '51-200', growth_stage: 'growing' },
    respondent_context: { name: 'SYNTHETIC — Operations Director', role_title: 'Operations Director',
                          email: 'ops@example.invalid', preferred_contact: 'email' },
    case_intent: 'DYSFUNCTION',
    reported_situation: 'SYNTHETIC — Hiring decisions sit for weeks between the manager and HR, and nobody can say where they are stuck.',
    scope: { kind: 'process', labels: ['Hiring', 'HR'] },
    timeline: { first_noticed_approx: 'Since March', pattern: 'increasing' },
    recent_examples: [{ what_happened: 'SYNTHETIC — the last three roles took 6, 7 and 9 weeks from request to offer.' }],
    observed_impact: [{ kind: 'delays' }],
    change_context: [{ kind: 'new_system' }],
    client_belief: 'SYNTHETIC — I think HR is short-staffed.',
    evidence_availability: [{ kind: 'workflow_system_data' }],
    desired_outcome: 'SYNTHETIC — whether to hire into HR or change the handoff.',
    consent: { data_use: true, ai_transparency_ack: true, sensitive_data_ack: true },
    locale: 'en'
  }, over || {});

  const accepted = await submit(request());
  const declined = await submit(request({
    reported_situation: 'SYNTHETIC — We would like a valuation of the company before a funding round.',
    case_intent: 'OPPORTUNITY',
    desired_outcome: 'SYNTHETIC — a valuation figure.'
  }));

  const queue = await (await seedCtx.request.get(BASE + '/api/v2/intake-review?status=all&limit=50',
    { headers: auth })).json();
  const byRef = {};
  (queue.submissions || []).forEach(x => { byRef[x.submission_reference] = x; });
  must('seed', 'both requests are in the reviewer queue',
    byRef[accepted.submission_reference] && byRef[declined.submission_reference],
    Object.keys(byRef).join(','));

  const decide = async (ref, decision, reason, title) => {
    const one = await (await seedCtx.request.get(
      BASE + '/api/v2/intake-review?intakeseed_id=' + byRef[ref].intakeseed_id, { headers: auth })).json();
    const r = await seedCtx.request.post(BASE + '/api/v2/intake-review', {
      headers: auth,
      data: { op: 'decide_intake', intakeseed_id: byRef[ref].intakeseed_id, decision: decision,
              expected_version: one.review.version, reason: reason, title: title }
    });
    const j = await r.json();
    if (!r.ok()) throw new Error('decide: ' + JSON.stringify(j));
    return j.review;
  };
  const acceptedReview = await decide(accepted.submission_reference, 'ACCEPTED',
    'SYNTHETIC — a bounded HR/OD question with a named decision behind it.',
    'SYNTHETIC — hiring decisions stall between the manager and HR');
  const declinedReview = await decide(declined.submission_reference, 'REJECTED',
    'SYNTHETIC — a company valuation is outside HR and organizational development.');

  must('seed', 'acceptance created exactly one organization and one case',
    acceptedReview.resulting_organization_id && acceptedReview.resulting_case_id,
    JSON.stringify(acceptedReview.promotion_state));
  must('seed', 'the declined request created no case',
    !declinedReview.resulting_case_id, declinedReview.resulting_case_id);

  const ORG = acceptedReview.resulting_organization_id;
  const CASE = acceptedReview.resulting_case_id;
  const intakeBody = accepted;

  await api({ op: 'add_hypothesis', organization_id: ORG, case_id: CASE, label: 'H1',
    statement: 'SYNTHETIC — the wait is concentrated at one approval step, not in overall capacity.' });
  await api({ op: 'add_hypothesis', organization_id: ORG, case_id: CASE, label: 'H2',
    statement: 'SYNTHETIC — requests arrive incomplete and are returned, which looks like an approval delay.' });
  const e1 = await api({ op: 'add_evidence', organization_id: ORG, case_id: CASE,
    source_type: 'system_record', source_name: 'SYNTHETIC — hiring workflow export 2026-Q2',
    original_content: 'Median wait at the approval step: 4.1 days. Median wait at every other step: under 3 hours.',
    limitations: ['Covers one quarter only.', 'Says nothing about why the approver was unavailable.'] });
  const e2 = await api({ op: 'add_evidence', organization_id: ORG, case_id: CASE,
    source_type: 'interview', source_name: 'SYNTHETIC — hiring manager',
    original_content: 'We batch the requests, because sending them one at a time changes nothing.',
    limitations: ['One person’s account.', 'The speaker is affected by the outcome.'] });
  await api({ op: 'record_contradiction', organization_id: ORG, case_id: CASE, kind: 'claim_vs_data',
    summary: 'SYNTHETIC — the sponsor describes a capacity shortfall; the workflow export shows a queue at one step.',
    left_evidence_id: e1.evidence_id, right_evidence_id: e2.evidence_id });

  console.log('  seeded org=' + ORG + ' case=' + CASE +
    ' intake=' + intakeBody.submission_reference);
  await seedCtx.close();

  /* ── public pages ───────────────────────────────────────────────────────── */
  for (const [device, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();

    for (const lang of ['ar', 'en']) {
      // home, with the journey explorer on a stage that WORKS
      let name = 'home-' + lang + '-' + device;
      await page.goto(BASE + '/home', { waitUntil: 'networkidle' });
      await setLang(page, lang);
      const rail = await page.$$('.jr-node');
      must(name, 'the journey explorer has five stages', rail.length === 5, rail.length);
      must(name, 'unbuilt stages are flagged on the rail before anything is selected',
        (await page.$$('.jr-node .jr-flag')).length === 2, (await page.$$('.jr-node .jr-flag')).length);
      must(name, 'the page is in the language it claims',
        lang === 'ar' ? await page.$eval('main', n => /[؀-ۿ]/.test(n.innerText))
                      : await page.$eval('main', n => /[A-Za-z]{5,}/.test(n.innerText)));
      await vouched(page, name);

      // the signature interaction itself, on a stage that is in operation
      name = 'home-journey-' + lang + '-' + device;
      must(name, 'the first stage is selected by default and says so',
        await page.$eval('.jr-node[data-jr="1"]', n => n.getAttribute('aria-selected') === 'true'));
      await vouched(page, name, { el: '.jr-section' });

      // the same explorer, on a stage that is NOT built — the honest moment
      name = 'home-journey-unbuilt-' + lang + '-' + device;
      await page.click('.jr-node[data-jr="5"]');
      await page.waitForTimeout(250);
      const panelText = await page.$eval('#jr-panel', n => n.innerText);
      must(name, 'the panel says the stage is not in operation',
        /لم تُفعَّل|not in operation/.test(panelText), panelText.slice(0, 160));
      must(name, 'the panel answers all three questions',
        (await page.$$('#jr-panel .jr-block')).length === 3);
      await vouched(page, name, { el: '.jr-section' });

      // how we work — the six steps, with the two unbuilt ones flagged
      name = 'how-we-work-' + lang + '-' + device;
      await page.goto(BASE + '/how-we-work', { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      must(name, 'the two unbuilt steps carry their availability',
        (await page.$$('.step-flag')).length === 2, (await page.$$('.step-flag')).length);
      must(name, 'the human-decision gates are still stated', (await page.$$('.gate')).length === 2);
      await vouched(page, name, { full: true });

      // services — the two services with no delivery mechanism, flagged
      name = 'services-' + lang + '-' + device;
      await page.goto(BASE + '/services', { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      must(name, 'the two unbuilt services carry their availability',
        (await page.$$('.svc-flag')).length === 2, (await page.$$('.svc-flag')).length);
      const svcText = await page.$eval('main', n => n.innerText);
      must(name, 'no free-service commitment is stated on the page',
        !/مجاناً|free of charge/i.test(svcText));
      await vouched(page, name, { full: true });

      // the intake form
      name = 'intake-' + lang + '-' + device;
      await page.goto(BASE + '/intake', { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      must(name, 'the form is on screen', (await page.$$('form, [data-hv-step]')).length > 0);
      await vouched(page, name);
    }
    await ctx.close();
  }

  /* ── internal screens ───────────────────────────────────────────────────── */
  for (const [device, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(BASE + '/v2-workspace', { waitUntil: 'domcontentloaded' });
    await page.evaluate(tk => { try { sessionStorage.setItem('hv_token', tk); } catch (e) {} }, session.token);

    for (const lang of ['ar', 'en']) {
      // the reviewer queue, holding the request that was actually submitted
      let name = 'reviewer-queue-' + lang + '-' + device;
      await page.goto(BASE + '/v2-intake-review', { waitUntil: 'networkidle' });
      await setLang(page, lang);
      /* The queue opens on PENDING_REVIEW; these shots are about the decisions,
         so show everything — accepted, declined and still waiting. */
      await page.click('[data-hv-filter="all"]');
      await page.waitForTimeout(250);
      const queueText = await page.$eval('#app', n => n.innerText);
      must(name, 'the queue shows the submitted request',
        queueText.indexOf(intakeBody.submission_reference) !== -1, queueText.slice(0, 200));
      must(name, 'the store and isolation are stated on screen', /memory|process-memory/.test(queueText));
      must(name, 'both a decline and an acceptance are visible',
        queueText.indexOf(declined.submission_reference) !== -1, queueText.slice(0, 260));
      /* Regression: the row read a nested field the service never returns, so
         every real submission showed its company as an em dash. */
      must(name, 'each row names its company rather than an em dash',
        await page.$$eval('.rv-row-t', ns => ns.length > 0 && ns.every(n => n.innerText.trim() !== '\u2014')),
        await page.$$eval('.rv-row-t', ns => ns.map(n => n.innerText).join(' | ')));
      await vouched(page, name);

      // the practitioner surface, open on a real operation
      name = 'workspace-ops-' + lang + '-' + device;
      await page.goto(BASE + '/v2-workspace?organization_id=' + ORG + '&case_id=' + CASE,
        { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      await page.click('[data-hv-tab="evidence"]');
      await page.waitForSelector('.op-panel');
      await page.click('details[data-op="add_evidence"] > summary');
      await page.waitForTimeout(250);
      const opsText = await page.$eval('.op-panel', n => n.innerText);
      must(name, 'the panel is translated', !/\bop\.[a-z]/.test(opsText), (opsText.match(/op\.[\w.]+/) || [])[0]);
      must(name, 'the evidence operations are offered', (await page.$$('.op-form')).length === 4);
      await vouched(page, name, { el: '.op-panel' });

      // the case as a reviewer reads it, with its recorded contradiction
      name = 'workspace-gaps-' + lang + '-' + device;
      await page.click('[data-hv-tab="gaps"]');
      await page.waitForTimeout(300);
      const gapsText = await page.$eval('#app', n => n.innerText);
      must(name, 'the contradiction is shown with both sides',
        gapsText.indexOf('SYNTHETIC') !== -1, gapsText.slice(0, 200));
      await vouched(page, name);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(bad ? '\n' + bad + ' assertion(s) failed; those captures were not written' : '\nevery capture vouched for');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
