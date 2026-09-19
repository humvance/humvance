'use strict';
/**
 * The site-level checks the brief asks for, in a real browser:
 * navigation, the mobile menu, keyboard reach, language persistence across
 * pages, the optional-step skip, draft restoration, and a failed submission.
 *
 *     node tests/ui/repro-site-checks.js            (server must be running)
 */
const { chromium } = require('playwright');

const BASE = process.env.HV_BASE || 'http://localhost:4173';
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + String(detail).slice(0, 240) : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  /* Clear ONCE. An addInitScript that clears on every load would wipe the very
     persistence these checks are here to prove. */
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); localStorage.setItem('hv_lang', 'ar'); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  const hrefs = await page.$$eval('header a[href^="/"], footer a[href^="/"]',
    ns => Array.from(new Set(ns.map(n => n.getAttribute('href')))));
  check('the shell offers links at all', hrefs.length >= 4, JSON.stringify(hrefs));
  const broken = [];
  for (const h of hrefs) {
    const r = await page.request.get(BASE + h);
    if (!r.ok()) broken.push(h + ' → ' + r.status());
  }
  check('every header and footer link resolves', broken.length === 0, JSON.stringify(broken));

  /* the track link must be the truthful next-step page, not the legacy portal */
  check('"after you send a request" points at /request-status',
    hrefs.indexOf('/request-status') !== -1, JSON.stringify(hrefs));
  check('the legacy portal is still linked, once, from the footer',
    (await page.$$eval('footer a[href="/portal"]', ns => ns.length)) === 1);

  /* ── keyboard: the very first stop is the skip link, and it works ── */
  await page.keyboard.press('Tab');
  const firstStop = await page.evaluate(() => {
    const a = document.activeElement;
    return { cls: a && a.className, href: a && a.getAttribute && a.getAttribute('href'), text: a && a.textContent };
  });
  check('the first tab stop is the skip link', /hv-skip/.test(firstStop.cls || ''), JSON.stringify(firstStop));
  check('the skip link targets the main landmark', firstStop.href === '#main');
  check('a main landmark exists to skip to', !!(await page.$('#main')));

  /* ── language persists across a navigation ── */
  check('home starts in Arabic', await page.evaluate(() => document.documentElement.lang) === 'ar');
  check('home is RTL', await page.evaluate(() => document.documentElement.dir) === 'rtl');
  await page.click('[data-hv-lang-toggle]');
  await page.waitForTimeout(200);
  check('home switched to English', await page.evaluate(() => document.documentElement.lang) === 'en');
  await page.goto(BASE + '/services', { waitUntil: 'networkidle' });
  check('services remembers English', await page.evaluate(() => document.documentElement.lang) === 'en');
  check('services is LTR', await page.evaluate(() => document.documentElement.dir) === 'ltr');
  await page.goto(BASE + '/how-we-work', { waitUntil: 'networkidle' });
  check('how-we-work remembers English', await page.evaluate(() => document.documentElement.lang) === 'en');
  check('the commercial boundary is on how-we-work',
    /paid work/i.test(await page.evaluate(() => document.body.innerText)));
  check('no price, duration or meeting count is stated',
    !/\b(SAR|USD|\$|per hour|per day|weeks? engagement)\b/i.test(
      await page.evaluate(() => document.body.innerText)));

  /* ── the claim the brief asked to be removed must be gone ── */
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const homeEn = await page.evaluate(() => document.body.innerText);
  check('the "well-phrased impression" claim is gone', !/well-phrased impression/i.test(homeEn), homeEn.slice(0, 200));
  check('"situations we hear often" is gone', !/situations we hear often/i.test(homeEn));
  check('"most clients" is gone from services',
    !/most clients/i.test(await (async () => { await page.goto(BASE + '/services', { waitUntil: 'networkidle' }); return page.evaluate(() => document.body.innerText); })()));

  /* ── mobile: the burger opens the nav ── */
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(BASE + '/', { waitUntil: 'networkidle' });
  const burger = await mob.$('[data-hv-burger]');
  check('mobile shows a menu button', !!burger);
  check('the menu starts closed', await mob.$eval('[data-hv-burger]', n => n.getAttribute('aria-expanded')) === 'false');
  await mob.click('[data-hv-burger]');
  await mob.waitForTimeout(200);
  check('the menu opens', await mob.$eval('[data-hv-burger]', n => n.getAttribute('aria-expanded')) === 'true');
  check('the opened menu is actually visible',
    await mob.$eval('#hv-mobile-nav', n => n.getBoundingClientRect().height > 40));
  check('no horizontal scroll at phone width',
    await mob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await mob.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));
  await mob.close();

  /* ── the optional step can be skipped, and the draft comes back ── */
  await page.goto(BASE + '/intake', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.removeItem('hv_intake_draft'); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('#f-reported_situation', 'DRAFT_SITUATION kept across a reload');
  await page.evaluate(() => {
    const el = document.querySelector('input[name="case_intent"][value="DYSFUNCTION"]');
    el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.click('[data-hv-next]');
  await page.evaluate(() => {
    ['scope_kind|team', 'pattern|persistent'].forEach(s => {
      const [n, v] = s.split('|');
      const el = document.querySelector('input[name="' + n + '"][value="' + v + '"]');
      el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await page.click('[data-hv-next]');
  check('the optional step announces itself as optional',
    /optional/i.test(await page.evaluate(() => document.querySelector('main').innerText)));
  check('the optional step offers a skip', !!(await page.$('[data-hv-skip]')));
  await page.click('[data-hv-skip]');
  await page.waitForTimeout(120);
  check('skipping lands on the next step', !!(await page.$('#f-desired_outcome')));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  const restored = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hv_intake_draft') || '{}');
    return { step: raw.step, situation: raw.d && raw.d.reported_situation, intent: raw.d && raw.d.case_intent };
  });
  check('the draft survives a reload', /DRAFT_SITUATION/.test(restored.situation || ''), JSON.stringify(restored));
  check('the step survives a reload', restored.step === 3, String(restored.step));
  check('the selection survives a reload', restored.intent === 'DYSFUNCTION');

  /* ── a failed submission says so, and keeps the draft ── */
  await page.fill('#f-desired_outcome', 'OUTCOME for the failure path');
  await page.click('[data-hv-next]');
  await page.fill('#f-company_name', 'Failure Path Co.');
  await page.fill('#f-name', 'Tester');
  await page.fill('#f-role_title', 'Tester');
  await page.fill('#f-email', 'fail@example.com');
  await page.click('[data-hv-next]');
  await page.evaluate(() => {
    ['consent_data_use', 'consent_ai', 'consent_sensitive'].forEach(k => {
      const el = document.querySelector('[data-hv-keep="' + k + '"]');
      el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await page.click('[data-hv-submit]');
  await page.waitForTimeout(900);

  const afterFail = await page.evaluate(() => document.body.innerText);
  check('a failed submission shows no receipt', !/HVS-/.test(afterFail), afterFail.slice(0, 200));
  check('a failed submission says something went wrong',
    /(again|wrong|could not|error|later)/i.test(afterFail), afterFail.slice(-300));
  const keptDraft = await page.evaluate(() => localStorage.getItem('hv_intake_draft'));
  check('a failed submission keeps the draft', !!keptDraft && /OUTCOME for the failure path/.test(keptDraft));
  check('the send button is usable again', await page.$eval('[data-hv-submit]', n => !n.disabled));

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
