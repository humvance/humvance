'use strict';
/**
 * The diagnostic workspace header, in a real browser.
 *
 * The follow-up review: `public/v2-workspace.html` rendered `b.case.status`
 * raw, so a live Arabic page showed `AWAITING_EVIDENCE` as its only status text
 * — an English enum value sitting alone in an Arabic sentence. The `ws.cs.*`
 * labels already existed for every value of CASE_STATES and were used elsewhere
 * on the page; the header was simply never wired to them.
 *
 * This checks the readable label in both languages, that the stored value is
 * still available as secondary detail (a reviewer does want to know it), and
 * that a language switch actually re-renders it rather than leaving the old
 * language on screen.
 *
 *     node tests/ui/repro-workspace-header.js        (server must be running)
 */
const { chromium } = require('playwright');

const BASE = process.env.HV_BASE || 'http://localhost:4173';
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + String(detail).slice(0, 220) : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();

  await page.goto(BASE + '/v2-workspace?demo=1', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.setItem('hv_lang', 'ar'); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const status = await page.evaluate(() => HV.demo.CASE.status);
  check('the fixture case carries a real CASE_STATES value',
    /^[A-Z_]+$/.test(status), status);

  const arLabel = await page.evaluate(() => HV.i18n.t('ws.cs.' + HV.demo.CASE.status));
  const headAr = await page.$eval('.ws-meta', n => n.innerText);

  check('the Arabic header shows the readable label',
    headAr.indexOf(arLabel) !== -1, arLabel + ' | ' + headAr);
  check('the Arabic header is not just the raw enum',
    headAr.trim() !== status && /[؀-ۿ]/.test(headAr), headAr);
  check('the stored value is still available beside it',
    headAr.indexOf(status) !== -1, headAr);

  /* ── the same header, after a language switch ── */
  await page.click('[data-hv-lang-toggle]');
  await page.waitForTimeout(300);

  check('the page is now English', await page.evaluate(() => document.documentElement.lang) === 'en');
  const enLabel = await page.evaluate(() => HV.i18n.t('ws.cs.' + HV.demo.CASE.status));
  const headEn = await page.$eval('.ws-meta', n => n.innerText);

  check('the English header shows the readable label',
    headEn.indexOf(enLabel) !== -1, enLabel + ' | ' + headEn);
  check('the switch actually changed the status text',
    headEn.indexOf(arLabel) === -1, headEn);
  check('the label and the raw value are different strings',
    enLabel !== status, enLabel + ' vs ' + status);
  check('the stored value survives the switch', headEn.indexOf(status) !== -1, headEn);

  /* ── and every state the backend can produce has a label, in both languages ──
     A header that renders one state readably and the next ten raw would be no
     better than what it replaced. */
  const missing = await page.evaluate(() => {
    const STATES = ['INTAKE', 'STRUCTURING', 'INVESTIGATION_PLANNING', 'HUMAN_REVIEW',
                    'AWAITING_EVIDENCE', 'ANALYZING_EVIDENCE', 'CLARIFICATION_REQUIRED',
                    'FINDING_DRAFT', 'CHALLENGE_REVIEW', 'HUMAN_APPROVAL', 'APPROVED'];
    const out = [];
    ['ar', 'en'].forEach(l => {
      HV.i18n.setLang(l);
      STATES.forEach(s => {
        const v = HV.i18n.t('ws.cs.' + s);
        if (!v || v === 'ws.cs.' + s || v === s) out.push(l + ':' + s);
      });
    });
    return out;
  });
  check('every CASE_STATES value has a label in both languages',
    missing.length === 0, JSON.stringify(missing));

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
