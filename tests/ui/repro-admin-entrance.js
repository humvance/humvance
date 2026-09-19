'use strict';
/**
 * The administration entrance and the one management landing.
 *
 *     npm run beta                                  # in one shell
 *     node tests/ui/repro-admin-entrance.js         # in another
 *
 * NEWLY AUTHORIZED 2026-09-18. Until now the internal screens could only be
 * reached by typing a URL somebody had memorised. The checks below are about
 * the three ways that can go wrong once a link exists:
 *
 *   1. it is not actually reachable — present in the desktop header but not in
 *      the mobile menu, or not operable by keyboard or by touch;
 *   2. it leaks — a public header that quietly reports how many requests are
 *      waiting, or a page that shows records to someone with no session;
 *   3. it lies — a count with no stated scope, an empty list where the server
 *      actually refused, or a sign-in that can be pointed at another site.
 *
 * Everything here runs against the local harness with synthetic records.
 */
const { chromium } = require('playwright');
const { assertLocalHarness, fromPlaywright } = require('./_beta-guard');

const BASE = process.env.HV_BASE || 'http://127.0.0.1:4178';
const DESKTOP = { width: 1400, height: 1000 };
const PHONE = { width: 390, height: 844 };

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + String(detail).slice(0, 300) : '')); }
}
function head(s) { console.log('\n' + s); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const harness = await assertLocalHarness(BASE, fromPlaywright(ctx.request, BASE));
  const auth = { Authorization: 'Bearer ' + harness.session.token };

  const page = await ctx.newPage();
  const setLang = async (lang) => {
    await page.evaluate(l => { try { localStorage.setItem('hv_lang', l); } catch (e) {} }, lang);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
  };

  /* ══ 1. The entrance exists on the public pages, in both languages ═══════ */
  for (const lang of ['ar', 'en']) {
    head('The public entrance · ' + lang.toUpperCase());
    await page.goto(BASE + '/home', { waitUntil: 'networkidle' });
    await setLang(lang);

    const entries = await page.$$('.hv-admin-entry');
    check('the administration entrance is in the header and the mobile menu',
      entries.length === 2, entries.length);

    const first = await page.$('.hv-admin-entry');
    check('it carries a text label, not an icon alone',
      (await first.innerText()).trim().length > 3, await first.innerText());
    check('it carries an SVG icon of its own',
      (await page.$$('.hv-admin-entry svg')).length >= 1);
    check('it has an accessible name that says who it is for',
      ((await first.getAttribute('aria-label')) || '').length > 10,
      await first.getAttribute('aria-label'));
    check('it points at the management entrance',
      (await first.getAttribute('href')) === '/manage');

    /* It must not be confused with the client's own tracking link. */
    const trackHref = await page.$$eval('.hv-nav-link',
      ns => (ns.filter(n => n.getAttribute('href') === '/request-status')[0] || {}).href || '');
    check('it is a different link from "track my request"', /request-status/.test(trackHref), trackHref);
    const label = (await first.innerText()).trim();
    const trackLabel = await page.$$eval('.hv-nav-link',
      ns => (ns.filter(n => n.getAttribute('href') === '/request-status')[0] || {}).innerText || '');
    check('and a different label', label !== trackLabel.trim(), label + ' / ' + trackLabel.trim());

    /* No private information in a header served to strangers. */
    const headerText = await page.$eval('header', n => n.innerText);
    check('the public header carries no counts or references',
      !/\d{2,}/.test(headerText) && !/HVS-/.test(headerText), headerText.replace(/\n/g, ' | ').slice(0, 160));

    /* Keyboard: it can be focused and shows a visible focus ring. */
    await first.focus();
    const focused = await page.evaluate(() =>
      document.activeElement && document.activeElement.classList.contains('hv-admin-entry'));
    check('it can be focused by keyboard', focused);
    const outline = await page.evaluate(() => {
      const el = document.querySelector('.hv-admin-entry');
      el.focus();
      const s = getComputedStyle(el);
      return s.outlineStyle + ' ' + s.outlineWidth;
    });
    check('and a focus ring is drawn', outline.indexOf('none') === -1, outline);
  }

  /* ══ 2. The mobile menu really works by touch ════════════════════════════ */
  head('The mobile menu');
  const mob = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });
  const mp = await mob.newPage();
  await mp.goto(BASE + '/home', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(300);

  const burger = await mp.$('[data-hv-burger]');
  check('a menu button is present at phone width', !!burger);
  const box = await burger.boundingBox();
  check('the menu button is a comfortable touch target',
    box && box.width >= 40 && box.height >= 40, box && (box.width + '×' + box.height));

  check('the drawer is closed to begin with',
    (await mp.$eval('[data-hv-burger]', n => n.getAttribute('aria-expanded'))) === 'false');
  await burger.tap();
  await mp.waitForTimeout(350);
  check('tapping opens it',
    (await mp.$eval('[data-hv-burger]', n => n.getAttribute('aria-expanded'))) === 'true');

  const mobileEntry = await mp.$('.hv-mobile-nav .hv-admin-entry');
  check('the administration entrance is inside the open drawer', !!mobileEntry);
  const mbox = await mobileEntry.boundingBox();
  check('and is a comfortable touch target', mbox && mbox.height >= 44, mbox && mbox.height);
  check('it is visible, not merely present in the DOM', await mobileEntry.isVisible());

  /* A synthesised click follows a touch, so the navigation is awaited rather
     than assumed to have happened by the time the next line runs. */
  var reachedManage = true;
  await Promise.all([
    mp.waitForURL('**/manage', { timeout: 8000 }).catch(function () { reachedManage = false; }),
    mobileEntry.tap()
  ]);
  check('tapping it reaches the management entrance', reachedManage && /\/manage$/.test(mp.url()), mp.url());
  await mp.waitForLoadState('networkidle');

  /* No horizontal overflow at phone width, on the page it just landed on. */
  for (const [w, label] of [[390, '390px'], [768, '768px'], [1400, 'desktop']]) {
    await mp.setViewportSize({ width: w, height: 900 });
    await mp.waitForTimeout(250);
    const over = await mp.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('no horizontal overflow at ' + label + ' on /manage', over <= 1, over);
  }
  await mob.close();

  /* ══ 3. Without a session, nothing private is shown ══════════════════════ */
  head('Sessions the server has not approved');
  const anon = await browser.newContext({ viewport: DESKTOP });
  const ap = await anon.newPage();
  await ap.goto(BASE + '/manage', { waitUntil: 'networkidle' });
  await ap.waitForTimeout(400);
  let text = await ap.$eval('#main', n => n.innerText);
  check('an anonymous visitor is asked to sign in', /sign in|تسجيل الدخول/i.test(text), text.slice(0, 160));
  check('and sees no reference, company or case id',
    !/HVS-|org_|case_/.test(text), text.slice(0, 200));
  check('no request rows are rendered', (await ap.$$('.mg-row')).length === 0);

  /* An expired or forged token must not produce a list either. */
  await ap.evaluate(() => { try { sessionStorage.setItem('hv_token', 'not.a.real.token'); } catch (e) {} });
  await ap.reload({ waitUntil: 'networkidle' });
  await ap.waitForTimeout(500);
  text = await ap.$eval('#main', n => n.innerText);
  check('an invalid token shows a gate, not records',
    (await ap.$$('.mg-row')).length === 0 && !/HVS-/.test(text), text.slice(0, 160));
  check('the sign-in route offered is the local one on this harness',
    /__beta|beta/i.test(await ap.$eval('#main', n => n.innerHTML)));

  /* The return destination is a fixed name, never a URL. */
  const adminHtml = await (await anon.request.get(BASE + '/admin')).text();
  check('the admin page allow-lists return destinations by name',
    /RETURN_ALLOWLIST\s*=\s*\{\s*manage:\s*'\/manage'\s*\}/.test(adminHtml));
  check('and never redirects to a caller-supplied URL',
    !/location\.(href|replace)\s*=\s*[^;]*params\.get\(\s*['"]return/.test(adminHtml));
  await anon.close();

  /* ══ 4. With a session, the lists are real and their scope is stated ═════ */
  head('The management landing, signed in');

  /* SET UP THROUGH THE API: one request accepted, one declined, one waiting. */
  const submit = async (situation, intent) => {
    const r = await ctx.request.post(BASE + '/api/v2/intake', {
      data: {
        organization_context: { company_name: 'SYNTHETIC — ' + situation.slice(0, 20), sector: 'Logistics',
          employee_count_band: '51-200', growth_stage: 'growing' },
        respondent_context: { name: 'SYNTHETIC — Director', role_title: 'Director',
          email: 'ops@example.invalid', preferred_contact: 'email' },
        case_intent: intent,
        reported_situation: 'SYNTHETIC — ' + situation,
        scope: { kind: 'process', labels: ['Hiring'] },
        timeline: { first_noticed_approx: 'Since March', pattern: 'increasing' },
        recent_examples: [{ what_happened: 'SYNTHETIC — three roles took 6, 7 and 9 weeks.' }],
        observed_impact: [{ kind: 'delays' }],
        desired_outcome: 'SYNTHETIC — whether to hire or change the handoff.',
        consent: { data_use: true, ai_transparency_ack: true, sensitive_data_ack: true },
        locale: 'en'
      }
    });
    const j = await r.json();
    if (!r.ok()) {
      /* The intake endpoint rate-limits five submissions per client per ten
         minutes. That is the real protection working, but it means this run
         cannot prove what it set out to prove, so it says so and stops rather
         than passing quietly. */
      if (j.code === 'rate_limited') {
        console.log('\n  BLOCKED — the intake rate limiter refused this run (5 per client per 10 minutes).');
        console.log('  Restart `npm run beta` for a fresh process and run this again;');
        console.log('  nothing below this point was checked.');
        await browser.close();
        process.exit(1);
      }
      throw new Error('intake: ' + JSON.stringify(j));
    }
    return j;
  };
  const accepted = await submit('hiring decisions stall between the manager and HR', 'DYSFUNCTION');
  const declined = await submit('we would like a valuation before a funding round', 'OPPORTUNITY');
  const waiting  = await submit('handoffs between operations and finance keep returning', 'DYSFUNCTION');

  const queue = await (await ctx.request.get(BASE + '/api/v2/intake-review?status=all&limit=50',
    { headers: auth })).json();
  const byRef = {};
  (queue.submissions || []).forEach(x => { byRef[x.submission_reference] = x; });
  const decide = async (ref, decision, reason, title) => {
    const one = await (await ctx.request.get(
      BASE + '/api/v2/intake-review?intakeseed_id=' + byRef[ref].intakeseed_id, { headers: auth })).json();
    const r = await ctx.request.post(BASE + '/api/v2/intake-review', {
      headers: auth,
      data: { op: 'decide_intake', intakeseed_id: byRef[ref].intakeseed_id, decision,
              expected_version: one.review.version, reason, title }
    });
    const j = await r.json();
    if (!r.ok()) throw new Error('decide: ' + JSON.stringify(j));
    return j.review;
  };
  const acceptedReview = await decide(accepted.submission_reference, 'ACCEPTED',
    'SYNTHETIC — a bounded HR/OD question.', 'SYNTHETIC — hiring decisions stall');
  await decide(declined.submission_reference, 'REJECTED',
    'SYNTHETIC — a valuation is outside HR and organizational development.');

  await page.goto(BASE + '/manage', { waitUntil: 'domcontentloaded' });
  await page.evaluate(tk => { try { sessionStorage.setItem('hv_token', tk); } catch (e) {} }, harness.session.token);
  await setLang('en');

  check('the management navigation appears once signed in',
    (await page.$$('[data-mg-tab]')).length >= 3);
  const overview = await page.$eval('#main', n => n.innerText);
  check('the overview states what its counts actually cover',
    /within the page that was read|accepted requests on this page/i.test(overview),
    overview.slice(0, 250));
  check('it does not claim a total it cannot know',
    !/all requests|total requests/i.test(overview));
  check('request, organization and case are named as different things',
    /three different things/i.test(overview));

  /* Requests */
  await page.click('[data-mg-tab="requests"]');
  await page.waitForTimeout(300);
  const rows = await page.$$('.mg-row');
  check('every submitted request is listed', rows.length === 3, rows.length);
  const reqText = await page.$eval('#main', n => n.innerText);
  check('the waiting request is there', reqText.indexOf(waiting.submission_reference) !== -1);
  check('and the scope of the list is stated', /in this list|shown, which is the maximum/i.test(reqText));
  check('each row names its company rather than an em dash',
    await page.$$eval('.mg-row-t', ns => ns.length > 0 && ns.every(n => n.innerText.trim() !== '—')),
    await page.$$eval('.mg-row-t', ns => ns.map(n => n.innerText).join(' | ')));

  await page.click('.mg-row');
  await page.waitForLoadState('networkidle');
  check('a request row opens that request on the review screen',
    /v2-intake-review\?intakeseed_id=/.test(page.url()), page.url());

  /* Cases */
  await page.goto(BASE + '/manage', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('[data-mg-tab="cases"]');
  await page.waitForTimeout(300);
  const caseText = await page.$eval('#main', n => n.innerText);
  check('the cases list says plainly that it is not every case',
    /not a list of all cases/i.test(caseText), caseText.slice(0, 220));
  check('the case created by acceptance is listed',
    caseText.indexOf(acceptedReview.resulting_case_id) !== -1, caseText.slice(0, 250));
  check('the declined request contributes no case',
    (await page.$$('.mg-row')).length === 1, (await page.$$('.mg-row')).length);
  check('the organization id comes from the backend, not from the list summary',
    (await page.$$eval('a.mg-row', ns => ns.map(n => n.getAttribute('href')).join(' ')))
      .indexOf('organization_id=org_') !== -1,
    await page.$$eval('.mg-row', ns => ns.map(n => n.getAttribute('href') || '(not a link)').join(' ')));
  check('opening another authorized case by its identifiers is still offered',
    (await page.$$('#mg-open-form')).length === 1);

  /* The organization is resolved from the backend, so give that read a moment. */
  await page.waitForSelector('a.mg-row', { timeout: 8000 });
  await page.click('a.mg-row');
  await page.waitForLoadState('networkidle');
  check('the case row opens the workspace with the right organization scope',
    page.url().indexOf(acceptedReview.resulting_organization_id) !== -1 &&
    page.url().indexOf(acceptedReview.resulting_case_id) !== -1, page.url());
  const ws = await page.$eval('#app', n => n.innerText);
  check('and the workspace actually loads that case', ws.indexOf(acceptedReview.resulting_case_id) !== -1);

  /* ══ 5. Sign out ════════════════════════════════════════════════════════ */
  head('Signing out');
  await page.goto(BASE + '/manage', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('[data-mg-signout]');
  await page.waitForTimeout(300);
  check('the stored session is cleared',
    (await page.evaluate(() => { try { return sessionStorage.getItem('hv_token'); } catch (e) { return 'x'; } })) === null);
  const afterOut = await page.$eval('#main', n => n.innerText);
  check('the screen returns to the sign-in gate', /sign in|تسجيل الدخول/i.test(afterOut));
  check('and no records remain on screen', !/HVS-|case_/.test(afterOut), afterOut.slice(0, 160));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check('a reload after signing out still shows no records',
    (await page.$$('.mg-row')).length === 0);

  /* ══ 6. The local console: explicit, and separate from seeding ═══════════ */
  head('The local setup console');
  const con = await browser.newContext({ viewport: DESKTOP });
  const cp = await con.newPage();
  const conPosts = [];
  cp.on('request', r => { if (r.method() === 'POST' && r.url().indexOf('/api/') !== -1) conPosts.push(r.url()); });
  await cp.goto(BASE + '/__beta/', { waitUntil: 'networkidle' });
  await cp.waitForTimeout(500);

  check('opening the console creates nothing', conPosts.length === 0, conPosts.join(','));
  check('it offers session setup and seeding as two separate controls',
    (await cp.$$('#signin')).length === 1 && (await cp.$$('#seed')).length === 1);
  check('seeding is disabled until a session exists',
    await cp.$eval('#seed', n => n.disabled));
  check('it offers a return to management in the same tab',
    (await cp.$eval('#tomanage', n => n.getAttribute('href'))) === '/manage' &&
    (await cp.$eval('#tomanage', n => n.getAttribute('target'))) === null);
  check('the environment it reports is the harness, read from the harness',
    (await cp.$eval('#env', n => n.innerText)).indexOf('LOCAL_INTEGRATION') !== -1);

  await cp.click('#signin');
  await cp.waitForTimeout(400);
  check('setting up the session still creates no request', conPosts.length === 0, conPosts.join(','));
  check('and the session is stored',
    (await cp.evaluate(() => sessionStorage.getItem('hv_token'))) !== null);

  await cp.click('#seed');
  await cp.waitForTimeout(700);
  check('seeding is a separate press that posts exactly once',
    conPosts.length === 1, conPosts.join(','));
  check('and the console reports the reference the server minted',
    /HVS-[A-Z0-9]{4}/.test(await cp.$eval('#out2', n => n.innerText)),
    await cp.$eval('#out2', n => n.innerText));

  /* Bilingual, in a page that is otherwise easy to leave in one language. */
  await cp.click('#lang');
  await cp.waitForTimeout(250);
  const en = await cp.$eval('body', n => n.innerText);
  check('the console switches language', /internal beta|Synthetic data only/i.test(en), en.slice(0, 120));
  check('and sets the direction with it',
    (await cp.evaluate(() => document.documentElement.dir)) === 'ltr');
  await con.close();

  await browser.close();
  console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\nthe entrance is reachable, honest and gated');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
