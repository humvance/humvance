'use strict';
/**
 * The administration entrance and the management screens, photographed.
 *
 *     node tests/ui/manage-shots.js docs/release-2026-09-18/shots
 *
 * Runs against a private beta server of its own, so it never touches the
 * instance somebody is trying the product on. Every capture is asserted before
 * it is written, and a capture that cannot be vouched for is NOT written — the
 * same rule the other screenshot scripts follow, because a filename that claims
 * more than the pixels show is worse than no screenshot.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { assertLocalHarness, fromPlaywright } = require('./_beta-guard');

const OUT = process.argv[2] || path.join(__dirname, '..', '..', '.shots-manage');
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
  if (failed.get(name)) { console.log('  SKIPPED ' + name + '.png — assertions failed.'); return false; }
  fs.mkdirSync(OUT, { recursive: true });
  const target = opts.el ? page.locator(opts.el) : page;
  await target.screenshot({ path: path.join(OUT, name + '.png'), fullPage: opts.el ? undefined : !!opts.full });
  console.log('  ' + name + '.png');
  return true;
}

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
async function up(base, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(base + '/__beta/env')).ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

(async () => {
  const port = await freePort();
  const BASE = process.env.HV_BASE || ('http://127.0.0.1:' + port);
  let server = null;
  if (!process.env.HV_BASE) {
    server = spawn(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'beta-server.js')],
      { env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'ignore' });
    if (!(await up(BASE, 15000))) { console.error('private server did not start'); process.exit(2); }
  }

  const browser = await chromium.launch();
  const seedCtx = await browser.newContext();
  const harness = await assertLocalHarness(BASE, fromPlaywright(seedCtx.request, BASE));
  const auth = { Authorization: 'Bearer ' + harness.session.token };

  /* SET UP THROUGH THE API: one accepted, one declined, one waiting. */
  const submit = async (situation, intent) => {
    const r = await seedCtx.request.post(BASE + '/api/v2/intake', {
      data: {
        organization_context: { company_name: 'SYNTHETIC — Northline Logistics', sector: 'Logistics',
          employee_count_band: '51-200', growth_stage: 'growing' },
        respondent_context: { name: 'SYNTHETIC — Operations Director', role_title: 'Operations Director',
          email: 'ops@example.invalid', preferred_contact: 'email' },
        case_intent: intent,
        reported_situation: 'SYNTHETIC — ' + situation,
        scope: { kind: 'process', labels: ['Hiring', 'HR'] },
        timeline: { first_noticed_approx: 'Since March', pattern: 'increasing' },
        recent_examples: [{ what_happened: 'SYNTHETIC — the last three roles took 6, 7 and 9 weeks.' }],
        observed_impact: [{ kind: 'delays' }],
        desired_outcome: 'SYNTHETIC — whether to hire into HR or change the handoff.',
        consent: { data_use: true, ai_transparency_ack: true, sensitive_data_ack: true },
        locale: 'en'
      }
    });
    const j = await r.json();
    if (!r.ok()) throw new Error('intake: ' + JSON.stringify(j));
    return j;
  };
  const a = await submit('hiring decisions sit for weeks between the manager and HR', 'DYSFUNCTION');
  const b = await submit('we would like a valuation before a funding round', 'OPPORTUNITY');
  await submit('handoffs between operations and finance keep coming back', 'DYSFUNCTION');

  const queue = await (await seedCtx.request.get(BASE + '/api/v2/intake-review?status=all&limit=50',
    { headers: auth })).json();
  const byRef = {};
  (queue.submissions || []).forEach(x => { byRef[x.submission_reference] = x; });
  const decide = async (ref, decision, reason, title) => {
    const one = await (await seedCtx.request.get(
      BASE + '/api/v2/intake-review?intakeseed_id=' + byRef[ref].intakeseed_id, { headers: auth })).json();
    const r = await seedCtx.request.post(BASE + '/api/v2/intake-review', {
      headers: auth,
      data: { op: 'decide_intake', intakeseed_id: byRef[ref].intakeseed_id, decision,
              expected_version: one.review.version, reason, title }
    });
    const j = await r.json();
    if (!r.ok()) throw new Error('decide: ' + JSON.stringify(j));
    return j.review;
  };
  const acc = await decide(a.submission_reference, 'ACCEPTED',
    'SYNTHETIC — a bounded HR/OD question with a named decision behind it.',
    'SYNTHETIC — hiring decisions stall between the manager and HR');
  await decide(b.submission_reference, 'REJECTED',
    'SYNTHETIC — a company valuation is outside HR and organizational development.');
  await seedCtx.close();

  const setLang = async (page, lang) => {
    await page.evaluate(l => { try { localStorage.setItem('hv_lang', l); } catch (e) {} }, lang);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(350);
  };

  for (const [device, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    const ctx = await browser.newContext({ viewport, hasTouch: device === 'phone', isMobile: device === 'phone' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/manage', { waitUntil: 'domcontentloaded' });
    await page.evaluate(tk => { try { sessionStorage.setItem('hv_token', tk); } catch (e) {} }, harness.session.token);

    for (const lang of ['ar', 'en']) {
      /* 1 — the public entrance, in the header it now lives in */
      let name = 'public-entrance-' + lang + '-' + device;
      await page.goto(BASE + '/home', { waitUntil: 'networkidle' });
      await setLang(page, lang);
      must(name, 'the administration entrance is present',
        (await page.$$('.hv-admin-entry')).length === 2);
      if (device === 'phone') {
        await page.tap('[data-hv-burger]');
        await page.waitForTimeout(350);
        must(name, 'the drawer is open with the entrance inside',
          await page.$eval('.hv-mobile-nav .hv-admin-entry', n => n.offsetHeight > 0));
        await vouched(page, name, { el: 'header' });
      } else {
        await vouched(page, name, { el: 'header' });
      }

      /* 2 — management overview */
      name = 'manage-overview-' + lang + '-' + device;
      await page.goto(BASE + '/manage', { waitUntil: 'networkidle' });
      await setLang(page, lang);
      must(name, 'the overview rendered with its navigation',
        (await page.$$('[data-mg-tab]')).length >= 3);
      must(name, 'and states the scope of its counts',
        /page|صفحة/i.test(await page.$eval('#main', n => n.innerText)));
      await vouched(page, name, { full: true });

      /* 3 — requests */
      name = 'manage-requests-' + lang + '-' + device;
      await page.click('[data-mg-tab="requests"]');
      await page.waitForTimeout(350);
      must(name, 'three requests are listed', (await page.$$('.mg-row')).length === 3,
        (await page.$$('.mg-row')).length);
      await vouched(page, name, { full: true });

      /* 4 — cases, with the scope stated */
      name = 'manage-cases-' + lang + '-' + device;
      await page.click('[data-mg-tab="cases"]');
      await page.waitForSelector('a.mg-row', { timeout: 8000 });
      await page.waitForTimeout(250);
      must(name, 'the case from the accepted request is listed and openable',
        (await page.$eval('a.mg-row', n => n.getAttribute('href'))).indexOf('organization_id=org_') !== -1,
        await page.$eval('a.mg-row', n => n.getAttribute('href')));
      await vouched(page, name, { full: true });

      /* 5 — the request detail a decision was recorded on */
      name = 'request-detail-' + lang + '-' + device;
      await page.goto(BASE + '/v2-intake-review?intakeseed_id=' +
        encodeURIComponent(byRef[a.submission_reference].intakeseed_id), { waitUntil: 'networkidle' });
      await setLang(page, lang);
      await page.waitForTimeout(400);
      const detail = await page.$eval('#app', n => n.innerText);
      must(name, 'the page lays out at the real device width, not zoomed out',
        await page.evaluate(w => window.innerWidth <= w + 1, viewport.width),
        await page.evaluate(() => 'layout viewport ' + window.innerWidth + 'px'));
      /* Content inside a box that was BUILT to scroll sideways — the audit
         table — is allowed to be wider than the screen; that is the point of
         the box. What must never happen is the page itself widening. So the
         check skips anything with a scrollable ancestor and holds everything
         else to the viewport. */
      must(name, 'and nothing outside a scroll container overflows it',
        await page.evaluate(() => {
          var W = window.innerWidth;
          function inScroller(n) {
            for (var p = n.parentElement; p; p = p.parentElement) {
              var ox = getComputedStyle(p).overflowX;
              if (ox === 'auto' || ox === 'scroll') return true;
            }
            return false;
          }
          return !Array.prototype.some.call(document.querySelectorAll('*'),
            function (n) {
              return n.getBoundingClientRect().right > W + 1 && !inScroller(n);
            });
        }));
      must(name, 'and the document itself does not scroll sideways',
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      must(name, 'the detail shows the decision and its reason',
        detail.indexOf('SYNTHETIC — a bounded HR/OD question') !== -1, detail.slice(0, 200));
      await vouched(page, name, { full: true });

      /* 5b — the review header's return links, which are the 2026-09-19 fix */
      name = 'review-returns-' + lang + '-' + device;
      must(name, 'the header offers a management return',
        (await page.$$('.hv-ops-nav a[href="/manage"]')).length === 1);
      must(name, 'and the legacy panel, labelled as legacy',
        /legacy|القديمة/i.test(await page.$eval('.hv-ops-nav a[href="/admin"]',
          n => n.innerText + ' ' + (n.getAttribute('aria-label') || ''))));
      await vouched(page, name, { el: 'header' });

      /* 6 — the case that acceptance created, reached from management */
      name = 'case-from-management-' + lang + '-' + device;
      await page.goto(BASE + '/v2-workspace?organization_id=' + acc.resulting_organization_id +
        '&case_id=' + acc.resulting_case_id, { waitUntil: 'networkidle' });
      await setLang(page, lang);
      await page.waitForTimeout(400);
      must(name, 'the workspace opened that exact case',
        (await page.$eval('#app', n => n.innerText)).indexOf(acc.resulting_case_id) !== -1);
      must(name, 'and its header can get back to management and to review',
        (await page.$$('.hv-ops-nav a[href="/manage"]')).length === 1 &&
        (await page.$$('.hv-ops-nav a[href="/v2-intake-review"]')).length === 1);
      await vouched(page, name);

      /* 7 — the workspace header, close up: both returns */
      name = 'workspace-returns-' + lang + '-' + device;
      must(name, 'the page still lays out at the real device width',
        await page.evaluate(w => window.innerWidth <= w + 1, viewport.width),
        await page.evaluate(() => 'layout viewport ' + window.innerWidth + 'px'));
      await vouched(page, name, { el: 'header' });
    }
    await ctx.close();
  }

  await browser.close();
  if (server) server.kill();
  console.log(bad ? '\n' + bad + ' assertion(s) failed; those captures were not written'
                  : '\nevery capture vouched for');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
