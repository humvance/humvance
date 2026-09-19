'use strict';
/**
 * The management round trip, clicked.
 *
 *     node tests/ui/repro-management-roundtrip.js        (HV_BASE from beta-run)
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The administration entrance built on 2026-09-18 worked in one direction. It
 * put a visible way IN to `/manage`, and `/manage` linked out to request review
 * and to the workspace — and neither of those screens could get back. The review
 * header's only link went to `/admin`, the LEGACY V1 password screen, under a
 * label that read like the new management home. So the journey ended on exactly
 * the page the entrance was built to replace.
 *
 * The whole suite passed while that was true, which is the more useful lesson:
 * every check asserted that a link EXISTED and pointed somewhere plausible, and
 * not one of them followed a link and came back. These checks navigate. Each
 * round trip is clicked end to end, in both languages and at both sizes, and it
 * is the URL after the click that is asserted — never the href before it.
 *
 * It also holds the line that made the fix non-trivial: the workspace keeps
 * unsaved work in page memory on purpose, so a header link that leaves the page
 * throws it away. Leaving must ASK. The checks below prove it asks, that saying
 * no stays put, and that the question is not asked when there is nothing to lose.
 */
const { chromium } = require('playwright');
const { assertLocalHarness, fromPlaywright } = require('./_beta-guard');

const BASE = process.env.HV_BASE || 'http://127.0.0.1:4178';
const DESKTOP = { width: 1400, height: 950 };
const PHONE = { width: 390, height: 844 };

let bad = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); return true; }
  bad++;
  console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + String(detail).slice(0, 220) : ''));
  return false;
}
function head(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }

(async () => {
  const browser = await chromium.launch();

  /* ── Set up through the real handlers ── */
  const seedCtx = await browser.newContext();
  const harness = await assertLocalHarness(BASE, fromPlaywright(seedCtx.request, BASE));
  const auth = { Authorization: 'Bearer ' + harness.session.token };

  const r = await seedCtx.request.post(BASE + '/api/v2/intake', {
    data: {
      organization_context: { company_name: 'SYNTHETIC — Northline Logistics', sector: 'Logistics',
        employee_count_band: '51-200', growth_stage: 'growing' },
      respondent_context: { name: 'SYNTHETIC — Operations Director', role_title: 'Operations Director',
        email: 'ops@example.invalid', preferred_contact: 'email' },
      case_intent: 'DYSFUNCTION',
      reported_situation: 'SYNTHETIC — hiring decisions sit for weeks between the manager and HR.',
      scope: { kind: 'process', labels: ['Hiring', 'HR'] },
      timeline: { first_noticed_approx: 'Since March', pattern: 'increasing' },
      recent_examples: [{ what_happened: 'SYNTHETIC — the last three roles took 6, 7 and 9 weeks.' }],
      observed_impact: [{ kind: 'delays' }],
      desired_outcome: 'SYNTHETIC — whether to hire into HR or change the handoff.',
      consent: { data_use: true, ai_transparency_ack: true, sensitive_data_ack: true },
      locale: 'en'
    }
  });
  const submitted = await r.json();
  if (!r.ok()) {
    if (submitted && submitted.code === 'rate_limited') {
      console.error('\nBLOCKED: the intake rate limiter refused the setup submission.\n' +
        'This script needs a beta server of its own; `npm run test:beta` gives each script one.\n' +
        'Reporting this as blocked rather than relaxing a real protection to get a green run.');
      process.exit(3);
    }
    throw new Error('intake: ' + JSON.stringify(submitted));
  }

  const queue = await (await seedCtx.request.get(
    BASE + '/api/v2/intake-review?status=all&limit=50', { headers: auth })).json();
  const row = (queue.submissions || [])
    .filter(x => x.submission_reference === submitted.submission_reference)[0];
  const one = await (await seedCtx.request.get(
    BASE + '/api/v2/intake-review?intakeseed_id=' + row.intakeseed_id, { headers: auth })).json();
  const decided = await (await seedCtx.request.post(BASE + '/api/v2/intake-review', {
    headers: auth,
    data: { op: 'decide_intake', intakeseed_id: row.intakeseed_id, decision: 'ACCEPTED',
            expected_version: one.review.version,
            reason: 'SYNTHETIC — a bounded HR/OD question with a named decision behind it.',
            title: 'SYNTHETIC — hiring decisions stall between the manager and HR' }
  })).json();
  await seedCtx.close();

  const CASE_ID = decided.review.resulting_case_id;
  const ORG_ID = decided.review.resulting_organization_id;

  for (const [device, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    const ctx = await browser.newContext({
      viewport, hasTouch: device === 'phone', isMobile: device === 'phone'
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(BASE + '/manage', { waitUntil: 'domcontentloaded' });
    await page.evaluate(tk => { try { sessionStorage.setItem('hv_token', tk); } catch (e) {} },
      harness.session.token);

    const setLang = async (lang) => {
      await page.evaluate(l => { try { localStorage.setItem('hv_lang', l); } catch (e) {} }, lang);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
    };
    /* A click that must navigate. Waiting on the URL rather than on a timeout is
       the difference between proving the trip and hoping it happened.
       It acts through the SELECTOR, never through a handle captured earlier:
       these screens re-render after their second fetch (the queue first, then
       the request the deep link names), and a handle grabbed before that render
       is detached by it. Tapping a detached node does nothing at all and looks
       exactly like a broken link — which cost an hour of chasing a product bug
       that was really a test holding a stale reference. */
    const goTo = async (selector, urlGlob) => {
      if (!(await page.$(selector))) return false;
      try {
        await Promise.all([
          page.waitForURL(urlGlob, { timeout: 8000 }),
          device === 'phone' ? page.tap(selector) : page.click(selector)
        ]);
        return true;
      } catch (e) { return false; }
    };

    for (const lang of ['ar', 'en']) {
      const where = lang.toUpperCase() + ' · ' + device;

      /* ── Round trip 1: management → request → management ─────────────── */
      head('management → request → management  (' + where + ')');
      await page.goto(BASE + '/manage', { waitUntil: 'networkidle' });
      await setLang(lang);

      await page.click('[data-mg-tab="requests"]');
      await page.waitForSelector('a.mg-row', { timeout: 8000 });
      check('a request row is there to click',
        (await page.$$('a.mg-row')).length >= 1);

      check('clicking it opens that request',
        await goTo('a.mg-row', '**/v2-intake-review?*intakeseed_id=*'), page.url());
      await page.waitForTimeout(400);
      check('and the detail really opened, not the queue',
        (await page.$$('[data-hv-back]')).length === 1, await page.url());

      /* The finding this file exists for. */
      const crumbs = await page.$$eval('.hv-ops-nav a',
        ns => ns.map(n => ({ href: n.getAttribute('href'), text: n.innerText.trim(),
                             aria: n.getAttribute('aria-label') })));
      check('the review header offers a management return',
        crumbs.some(c => c.href === '/manage'), JSON.stringify(crumbs));
      check('it is not the legacy /admin screen wearing that label',
        crumbs.filter(c => c.href === '/manage').every(c => c.text && !/^\/?admin$/i.test(c.text)),
        JSON.stringify(crumbs));
      check('the legacy panel is still reachable',
        crumbs.some(c => c.href === '/admin'), JSON.stringify(crumbs));
      check('and is labelled as the legacy screen, not as management',
        crumbs.filter(c => c.href === '/admin')
              .every(c => /legacy|القديمة/i.test(c.text + ' ' + (c.aria || ''))),
        JSON.stringify(crumbs));
      if (device === 'phone') {
        check('the returns are comfortable touch targets',
          await page.$$eval('.hv-ops-nav a',
            ns => ns.every(n => n.getBoundingClientRect().height >= 44)),
          await page.$$eval('.hv-ops-nav a',
            ns => ns.map(n => Math.round(n.getBoundingClientRect().height)).join(',')));
        /* Comparing scrollWidth against innerWidth is NOT enough, and this is
           the check that taught it. When content refuses to fit, a mobile
           browser widens the LAYOUT viewport and renders the page zoomed out
           instead of producing a scrollbar: scrollWidth and innerWidth then
           agree with each other at 488px inside a 390px phone, the check passes,
           and every tap lands off target because the page is scaled. So the
           layout viewport is measured against the device width the context was
           actually created with. */
        check('the page still lays out at the real device width, not zoomed out',
          await page.evaluate(w => window.innerWidth <= w + 1, PHONE.width),
          await page.evaluate(() => 'layout viewport ' + window.innerWidth + 'px'));
        check('and nothing overflows sideways',
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          await page.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));
      }

      check('clicking the management return lands back on /manage',
        await goTo('.hv-ops-nav a[href="/manage"]', '**/manage'), page.url());
      await page.waitForTimeout(400);
      check('and management rendered its own navigation, not an error',
        (await page.$$('[data-mg-tab]')).length >= 3, await page.url());

      /* ── Round trip 2: management → case → management ────────────────── */
      head('management → case → management  (' + where + ')');
      await page.click('[data-mg-tab="cases"]');
      await page.waitForSelector('a.mg-row', { timeout: 8000 });
      check('the case from the accepted request is listed',
        (await page.$eval('a.mg-row', n => n.getAttribute('href'))).indexOf(ORG_ID) !== -1,
        await page.$eval('a.mg-row', n => n.getAttribute('href')));

      check('clicking it opens the workspace on that case',
        await goTo('a.mg-row', '**/v2-workspace?*case_id=*'), page.url());
      await page.waitForTimeout(600);
      check('the workspace opened THAT case, not another',
        (await page.$eval('#app', n => n.innerText)).indexOf(CASE_ID) !== -1);
      check('the organization scope came from the backend, not the page',
        page.url().indexOf(ORG_ID) !== -1, page.url());

      const wsCrumbs = await page.$$eval('.hv-ops-nav a',
        ns => ns.map(n => n.getAttribute('href')));
      check('the workspace offers a management return', wsCrumbs.indexOf('/manage') !== -1,
        JSON.stringify(wsCrumbs));
      check('and still offers the return to request review',
        wsCrumbs.indexOf('/v2-intake-review') !== -1, JSON.stringify(wsCrumbs));

      check('with nothing typed, leaving asks nothing',
        await goTo('.hv-ops-nav a[href="/manage"]', '**/manage'), page.url());
      await page.waitForTimeout(300);
      check('and management is on screen again',
        (await page.$$('[data-mg-tab]')).length >= 3, await page.url());

      check('no page threw during the round trips', errors.length === 0, errors.join(' | '));
      errors.length = 0;
    }

    /* ── The draft guard, once per device ─────────────────────────────────
       Typed work is held in page memory and nowhere else, so a header link
       destroys it. This is the check that it is not destroyed silently. */
    head('leaving the workspace with unsaved work  (' + device + ')');
    await page.goto(BASE + '/v2-workspace?organization_id=' + encodeURIComponent(ORG_ID) +
      '&case_id=' + encodeURIComponent(CASE_ID), { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    await page.click('[data-hv-tab="evidence"]').catch(() => {});
    await page.waitForTimeout(300);
    const form = await page.$('details[data-op="add_evidence"]');
    if (!check('the evidence form is on screen to type into', !!form)) {
      await ctx.close();
      continue;
    }
    if (!(await page.$eval('details[data-op="add_evidence"]', n => n.open))) {
      await page.click('details[data-op="add_evidence"] > summary');
      await page.waitForTimeout(200);
    }
    await page.fill('#op-add_evidence-original_content',
      'SYNTHETIC — half-typed note that must not vanish without a word.');
    await page.waitForTimeout(250);
    check('the page knows there is now something to lose',
      await page.evaluate(() => HV.ops.hasDrafts({
        org: new URLSearchParams(location.search).get('organization_id'),
        caseId: new URLSearchParams(location.search).get('case_id')
      })));

    let asked = 0;
    page.on('dialog', async d => { asked++; await d.dismiss(); });
    await page.click('.hv-ops-nav a[href="/manage"]');
    await page.waitForTimeout(700);
    check('leaving asked first', asked === 1, asked);
    check('and saying no stayed on the case',
      page.url().indexOf('/v2-workspace') !== -1, page.url());
    check('the typed work is still in the field',
      (await page.$eval('#op-add_evidence-original_content', n => n.value)).indexOf('half-typed') !== -1);

    page.removeAllListeners('dialog');
    page.on('dialog', async d => { asked++; await d.accept(); });
    await Promise.all([
      page.waitForURL('**/manage', { timeout: 8000 }),
      page.click('.hv-ops-nav a[href="/manage"]')
    ]).then(() => check('and saying yes does leave', true))
      .catch(e => check('and saying yes does leave', false, e.message));
    check('the warning was shown both times, not remembered as answered', asked === 2, asked);
    check('nothing was written to browser storage to rescue the draft',
      await page.evaluate(() => {
        try {
          const all = Object.keys(localStorage).concat(Object.keys(sessionStorage))
            .map(k => { try { return (localStorage.getItem(k) || '') + (sessionStorage.getItem(k) || ''); }
                        catch (e) { return ''; } }).join(' ');
          return all.indexOf('half-typed') === -1;
        } catch (e) { return true; }
      }));

    await ctx.close();
  }

  await browser.close();
  console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nthe management round trip closes, in both directions');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
