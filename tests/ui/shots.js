'use strict';
/**
 * Evidence screenshots for the redesign review.
 *
 *     node tests/ui/shots.js [outDir]        (server must be running)
 *
 * Captures are VIEWPORT-SIZED, not full-page: a full-page capture of these
 * screens runs to ~10,000px and is rejected on upload. Where a section further
 * down the page is the point, the shot scrolls to it first.
 *
 * Every demo screen is captured WITH its demo bar in frame, so no fixture
 * screenshot can be mistaken for real data.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.HV_BASE || 'http://localhost:4173';
const OUT = process.argv[2] || path.join(__dirname, '..', '..', '.shots');
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1400, height: 950 };
const PHONE = { width: 390, height: 844 };

async function shot(page, name) {
  const f = path.join(OUT, name + '.png');
  await page.screenshot({ path: f });
  console.log('  ' + name + '.png');
}

/* Screenshots are evidence, so each one is asserted before it is taken, and a
   shot that cannot be vouched for is NOT WRITTEN.

   CORRECTED 2026-09-18 (C-01, PB-2026-09-18.1, D11). The first version of this
   guard counted failures and failed the run at the end — but still called
   shot(), so a capture that had just failed its own assertions was written to
   disk under the filename that claimed it was something else. Detecting the
   problem while still producing the artefact is most of the problem. The write
   is now conditional, and a pre-existing file of that name is reported rather
   than left to pass as current evidence. */
const fsx = fs;
let shotFailures = 0;
const failedCaptures = new Map();          // name -> [reasons]
function assertShot(name, what, cond, detail) {
  if (cond) return;
  shotFailures++;
  if (!failedCaptures.has(name)) failedCaptures.set(name, []);
  failedCaptures.get(name).push(what + (detail ? ' → ' + String(detail).slice(0, 200) : ''));
  console.log('  FAIL ' + name + ' — ' + what + (detail ? '  → ' + String(detail).slice(0, 200) : ''));
}

/** Write the capture only if nothing about it failed. */
async function shotIfVouched(page, name) {
  const reasons = failedCaptures.get(name);
  if (!reasons) { await shot(page, name); return true; }
  const f = path.join(OUT, name + '.png');
  const existed = fsx.existsSync(f);
  console.log('  SKIPPED ' + name + '.png — not written; ' + reasons.length +
    ' assertion(s) failed' + (existed ? '. A FILE OF THIS NAME ALREADY EXISTS AND IS NOW STALE.' : '.'));
  return false;
}

async function setLang(page, lang) {
  await page.evaluate(l => { try { localStorage.setItem('hv_lang', l); } catch (e) {} }, lang);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
}

/** Fill the intake up to the review step, leaving a rich answer set behind. */
async function fillToReview(page) {
  const tick = (sel) => page.evaluate(s => {
    const el = document.querySelector(s);
    if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, sel);

  await page.fill('#f-reported_situation',
    'كل طلب شراء صغير يحتاج توقيع الرئيس التنفيذي، والطلبات تتكدّس أياماً قبل أن تُعتمد.');
  await tick('input[name="case_intent"][value="DYSFUNCTION"]');
  await page.click('[data-hv-next]');

  await tick('input[name="scope_kind"][value="process"]');
  await page.fill('#f-scope_labels', 'المشتريات، المالية');
  await tick('input[name="pattern"][value="increasing"]');
  await page.fill('#f-first_noticed_approx', 'بعد التوسّع في الربع الأول');
  await page.fill('#f-associated_change_note', 'افتُتح فرعان جديدان.');
  await page.click('[data-hv-next]');

  await page.fill('#ex-w-0', 'طلب قطع غيار بقيمة بسيطة انتظر أربعة أيام قبل الاعتماد.');
  await page.fill('#ex-t-0', 'الأسبوع الماضي');
  await page.fill('#ex-a-0', 'الصيانة');
  await page.fill('#ex-c-0', 'توقفت شاحنة عن العمل يومين.');
  await tick('[data-hv-bag="impact"][value="delays"]');
  await tick('[data-hv-bag="impact"][value="management_time"]');
  await page.click('[data-hv-next]');

  await page.fill('#f-desired_outcome', 'نريد أن نعرف أين تتوقف الطلبات فعلاً، ومن يملك قرار الصرف.');
  await page.fill('#f-client_belief', 'أعتقد أن صلاحيات الصرف غير واضحة.');
  await tick('[data-hv-bag="changes"][value="rapid_growth"]');
  await tick('[data-hv-bag="availability"][value="delegation_matrix"]');
  await page.click('[data-hv-next]');

  await page.fill('#f-company_name', 'شركة المثال للتجارة');
  await page.fill('#f-sector', 'تجارة الجملة');
  await page.selectOption('#f-employee_count_band', '51-200');
  await page.selectOption('#f-growth_stage', 'growing');
  await page.fill('#f-name', 'نورة الحربي');
  await page.fill('#f-role_title', 'مديرة الموارد البشرية');
  await page.fill('#f-email', 'noura@example.com');
  await page.fill('#f-phone', '0500000000');
  await page.selectOption('#f-preferred_contact', 'email');
  await page.click('[data-hv-next]');
  await page.waitForTimeout(200);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  console.log('writing to ' + OUT);

  /* ── public pages ── */
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await setLang(page, 'ar');
  await shot(page, '01-home-ar-desktop');
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(300);
  await shot(page, '02-home-ar-situations');

  await setLang(page, 'en');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await shot(page, '03-home-en-desktop');
  await page.evaluate(() => window.scrollTo(0, 2400));
  await page.waitForTimeout(300);
  await shot(page, '04-home-en-why-evidence');

  await page.goto(BASE + '/services', { waitUntil: 'networkidle' });
  await setLang(page, 'ar');
  await shot(page, '05-services-ar-desktop');

  await page.goto(BASE + '/how-we-work', { waitUntil: 'networkidle' });
  await setLang(page, 'en');
  await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('h2')).find(n => /paid work/i.test(n.textContent));
    if (h) h.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(300);
  await shot(page, '06-how-we-work-en-commercial-boundary');
  await setLang(page, 'ar');
  await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('h2')).find(n => /العمل المدفوع/.test(n.textContent));
    if (h) h.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(300);
  await shot(page, '07-how-we-work-ar-commercial-boundary');

  await page.goto(BASE + '/request-status', { waitUntil: 'networkidle' });
  await setLang(page, 'ar');
  await shot(page, '08-request-status-ar');

  /* ── intake: validation across a language switch ── */
  await page.goto(BASE + '/intake', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.removeItem('hv_intake_draft'); localStorage.setItem('hv_lang', 'en'); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-hv-next]');
  await page.waitForTimeout(200);
  await shot(page, '09-intake-en-validation-errors');
  await page.fill('#f-reported_situation', 'Decisions stall for weeks and nobody can say who owns them.');
  await page.waitForTimeout(150);
  await page.click('[data-hv-lang-toggle]');
  await page.waitForTimeout(350);
  await shot(page, '10-intake-ar-after-switch-errors-follow-language');

  /* ── intake: the complete review ── */
  await page.goto(BASE + '/intake', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.removeItem('hv_intake_draft'); localStorage.setItem('hv_lang', 'ar'); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await fillToReview(page);
  await shot(page, '11-intake-ar-review-complete-top');
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(250);
  await shot(page, '12-intake-ar-review-complete-lower');
  await page.click('[data-hv-lang-toggle]');
  await page.waitForTimeout(350);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await shot(page, '13-intake-en-review-complete');

  /* ── demo screens: every one framed with its demo bar ── */
  await page.goto(BASE + '/v2-intake-review?demo=1', { waitUntil: 'networkidle' });
  await setLang(page, 'ar');
  await shot(page, '14-reviewer-queue-ar-DEMO-FIXTURES');
  await page.click('[data-hv-filter="all"]');
  await page.waitForTimeout(200);
  await page.click('[data-hv-open="seed_demo_e"]');
  await page.waitForTimeout(300);
  await shot(page, '15-reviewer-detail-ar-accepted-promotion-pending-DEMO-FIXTURES');
  await setLang(page, 'en');
  await page.click('[data-hv-filter="all"]');
  await page.waitForTimeout(150);
  await page.click('[data-hv-open="seed_demo_a"]');
  await page.waitForTimeout(300);
  await shot(page, '16-reviewer-detail-en-pending-DEMO-FIXTURES');
  await page.click('[data-hv-back]');
  await page.waitForTimeout(150);
  await page.click('[data-hv-filter="all"]');
  await page.waitForTimeout(150);
  await page.click('[data-hv-open="seed_demo_d"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('.rv-block-title')).find(n => /declin|reject|قرار/i.test(n.textContent));
    if (h) h.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(250);
  await shot(page, '17-reviewer-detail-en-declined-reason-DEMO-FIXTURES');

  await page.goto(BASE + '/v2-workspace?demo=1', { waitUntil: 'networkidle' });
  await setLang(page, 'ar');
  await shot(page, '18-workspace-ar-overview-DEMO-FIXTURES');
  /* findings and contradictions live behind their own tabs */
  for (const [tab, name] of [['findings', '19-workspace-ar-findings-DEMO-FIXTURES'],
                             ['gaps', '20-workspace-ar-contradictions-DEMO-FIXTURES']]) {
    const ok = await page.evaluate(k => {
      const b = document.querySelector('[data-hv-tab="' + k + '"]');
      if (b) { b.click(); return true; }
      return false;
    }, tab);
    await page.waitForTimeout(300);
    if (ok) await shot(page, name);
    else console.log('  (no tab "' + tab + '" — skipped ' + name + ')');
  }
  /* C-02 evidence: the audit trail with readable AR labels beside raw ids. */
  await page.evaluate(() => { const b = document.querySelector('[data-hv-tab="audit"]'); if (b) b.click(); });
  await page.waitForTimeout(300);
  await shot(page, '33-workspace-ar-audit-labels-DEMO-FIXTURES');

  await setLang(page, 'en');
  await page.evaluate(() => {
    const b = document.querySelector('[data-hv-tab="findings"]');
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  await shot(page, '21-workspace-en-findings-DEMO-FIXTURES');
  await page.evaluate(() => { const b = document.querySelector('[data-hv-tab="audit"]'); if (b) b.click(); });
  await page.waitForTimeout(300);
  await shot(page, '34-workspace-en-audit-labels-DEMO-FIXTURES');

  await page.goto(BASE + '/client?demo=1', { waitUntil: 'networkidle' });
  await setLang(page, 'ar');
  await shot(page, '22-client-ar-DEMO-FIXTURES');
  await setLang(page, 'en');
  await shot(page, '23-client-en-DEMO-FIXTURES');

  /* ── The unavailable-client gate ─────────────────────────────────────────────
     CORRECTED 2026-09-18 (follow-up review). This used to navigate straight from
     /client?demo=1 to /client in the SAME context. Demo mode is remembered in
     sessionStorage, so it stayed on and the capture showed the fixture workspace
     under a filename claiming to be the gate.

     A fresh browser context carries no sessionStorage, so this is the gate a
     first-time visitor actually meets. The capture is asserted before it is
     taken, and the old `24-…` file is left alone — these are new names. */
  {
    const clean = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
    const g = await clean.newPage();
    for (const [lang, name] of [['ar', '31-client-ar-unavailable-gate'],
                                ['en', '32-client-en-unavailable-gate']]) {
      await g.goto(BASE + '/client', { waitUntil: 'networkidle' });
      await g.evaluate(l => {
        try { sessionStorage.removeItem('hv_demo'); localStorage.setItem('hv_lang', l); } catch (e) {}
      }, lang);
      await g.reload({ waitUntil: 'networkidle' });
      await g.waitForTimeout(250);

      const state = await g.evaluate(() => ({
        demo: HV.ui.isDemo(),
        session: (() => { try { return sessionStorage.getItem('hv_demo'); } catch (e) { return 'ERR'; } })(),
        bar: !!document.querySelector('[data-hv-demo-off]'),
        text: document.querySelector('main').innerText,
        home: (document.querySelector('main a[href="/"]') || {}).href || null,
        status: (document.querySelector('main a[href="/request-status"]') || {}).href || null
      }));
      const want = lang === 'ar' ? 'هذه الصفحة غير متاحة بعد' : 'isn’t available yet';

      assertShot(name, 'demo mode is off', state.demo === false && !state.session, JSON.stringify(state.session));
      assertShot(name, 'no demo bar is on screen', state.bar === false);
      assertShot(name, 'the unavailable heading is shown', state.text.indexOf(want) !== -1, state.text.slice(0, 120));
      assertShot(name, 'no fixture workspace is shown', !/HVS-DEMO|DEMO-XMPL/.test(state.text), state.text.slice(0, 120));
      assertShot(name, 'no raw translation key leaks', !/done\.home|cw\.gate\./.test(state.text), state.text);
      assertShot(name, 'a home link is offered', !!state.home);
      assertShot(name, 'a next-step link is offered', !!state.status);

      /* And the links actually resolve, rather than merely existing. */
      for (const [label, href] of [['home', '/'], ['next step', '/request-status']]) {
        const r = await g.request.get(BASE + href);
        assertShot(name, 'the ' + label + ' link resolves', r.ok(), href + ' → ' + r.status());
      }

      await shotIfVouched(g, name);
    }
    await clean.close();
  }

  /* ── mobile ── */
  const m = await ctx.newPage();
  await m.setViewportSize(PHONE);
  await m.goto(BASE + '/', { waitUntil: 'networkidle' });
  await setLang(m, 'ar');
  await shot(m, '25-home-ar-mobile');
  await m.click('[data-hv-burger]');
  await m.waitForTimeout(300);
  await shot(m, '26-home-ar-mobile-menu-open');
  await setLang(m, 'en');
  await shot(m, '27-home-en-mobile');

  await m.goto(BASE + '/intake', { waitUntil: 'networkidle' });
  await m.evaluate(() => { try { localStorage.removeItem('hv_intake_draft'); localStorage.setItem('hv_lang', 'ar'); } catch (e) {} });
  await m.reload({ waitUntil: 'networkidle' });
  await shot(m, '28-intake-ar-mobile-step1');
  await fillToReview(m);
  await shot(m, '29-intake-ar-mobile-review-complete');

  await m.goto(BASE + '/v2-intake-review?demo=1', { waitUntil: 'networkidle' });
  await setLang(m, 'ar');
  await shot(m, '30-reviewer-queue-ar-mobile-DEMO-FIXTURES');

  await browser.close();
  if (shotFailures) {
    console.log('\n' + shotFailures + ' screenshot assertion(s) FAILED across ' +
      failedCaptures.size + ' capture(s); those files were not written:');
    for (const [n, rs] of failedCaptures) console.log('  · ' + n + '.png — ' + rs.join('; '));
    process.exit(1);
  }
  console.log('done — every asserted capture matched what its filename claims');
})().catch(e => { console.error(e); process.exit(1); });
