'use strict';
/**
 * The exact reproduction from the brief, run in a real browser.
 *
 *   1. Open /intake in English and press Next with empty fields.
 *   2. Fill the situation and select an intent.
 *   3. Switch to Arabic.
 *   4. BEFORE THE FIX: the answers survived, but the old English errors
 *      remained and still marked the corrected fields invalid.
 *
 * This is not a unit test with a stubbed DOM. It drives the page the visitor
 * actually gets, off the local review server, and asserts on what is on screen.
 *
 *     node tests/ui/repro-lang-validation.js          (server must be running)
 *
 * ── SETUP, CORRECTED 2026-09-18 (follow-up review) ──────────────────────────
 * This file used to call `page.addInitScript(() => localStorage.clear())`, which
 * runs on EVERY navigation — including the reload that was supposed to apply the
 * English selection written the moment before. So the selection was wiped and
 * the page fell back to `initialLang()`, which reads the BROWSER's language.
 *
 * On a machine whose browser prefers English the script passed anyway, for the
 * wrong reason. On one preferring Arabic, four assertions failed: initial
 * English, English errors, subsequent Arabic, and RTL. The test was measuring
 * the reviewer's browser, not the application.
 *
 * It now clears storage ONCE, then writes the language and reloads — and it runs
 * the whole scenario under BOTH an Arabic and an English browser preference, so
 * a passing run means the same thing on either machine. No assertion was
 * weakened to achieve this; the application code was not touched.
 */
const { chromium } = require('playwright');

const BASE = process.env.HV_BASE || 'http://localhost:4173';

/* One locale, or both. `HV_LOCALE=ar-SA node …` narrows it for debugging. */
const LOCALES = process.env.HV_LOCALE ? [process.env.HV_LOCALE] : ['ar-SA', 'en-US'];

let failures = 0;
let prefix = '';
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + prefix + name); }
  else { failures++; console.log('  FAIL ' + prefix + name + (detail ? '  → ' + detail : '')); }
}

/** Put the page in a known state: storage empty, language chosen, page reloaded. */
async function start(page, lang) {
  await page.goto(BASE + '/intake', { waitUntil: 'networkidle' });
  await page.evaluate(l => {
    try { localStorage.clear(); localStorage.setItem('hv_lang', l); } catch (e) {}
  }, lang);
  await page.reload({ waitUntil: 'networkidle' });
}

async function run(browser, locale) {
  prefix = '[' + locale + '] ';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale });
  const page = await ctx.newPage();

  /* ── 1. English, Next with empty fields ── */
  await start(page, 'en');

  check('page is English', await page.evaluate(() => document.documentElement.lang) === 'en');

  await page.click('[data-hv-next]');
  const errsEn = await page.$$eval('[id^="e-"]', ns => ns.map(n => n.textContent.trim()).filter(Boolean));
  check('empty Next raises errors', errsEn.length >= 2, JSON.stringify(errsEn));
  check('errors are English', errsEn.every(s => !/[؀-ۿ]/.test(s)), JSON.stringify(errsEn));
  const invalidEn = await page.$$eval('[aria-invalid="true"]', ns => ns.map(n => n.id));
  check('fields marked invalid', invalidEn.includes('f-reported_situation'), JSON.stringify(invalidEn));

  /* ── 2. Fill the situation and select an intent ── */
  const SITUATION = 'Decisions stall for weeks and nobody can say who owns them.';

  /* Mark the form node so a re-render can be detected: "clears in place" means
     the error node is emptied without rebuilding the form around it. */
  await page.evaluate(() => { document.getElementById('ik-form').dataset.hvProbe = 'before'; });

  await page.fill('#f-reported_situation', SITUATION);
  /* A real blur, the way a visitor leaves a field. The page revalidates on
     change/blur, deliberately NOT on every keystroke, so this is the moment the
     error is supposed to go. */
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);

  const stillFlagged = await page.$eval('#e-reported_situation', n => n.textContent.trim());
  check('corrected situation clears once the field is left', stillFlagged === '', JSON.stringify(stillFlagged));

  /* STRENGTHENED 2026-09-18. This used to assert only that the active element's
     id was a *string*, which is true of every focusable element on the page and
     therefore proves nothing. Two things are actually being promised here: the
     form is not rebuilt, and the visitor is left wherever they moved to. */
  const probe = await page.$eval('#ik-form', n => n.dataset.hvProbe || '');
  check('the error cleared without re-rendering the form', probe === 'before', JSON.stringify(probe));

  const afterBlur = await page.evaluate(() => {
    const a = document.activeElement;
    return { id: a && a.id, tag: a && a.tagName, body: a === document.body };
  });
  check('revalidation does not steal focus back or drop it to the body',
    afterBlur.body === false && afterBlur.tag !== 'BODY', JSON.stringify(afterBlur));

  /* And the caret is genuinely preserved when a field keeps focus through a
     revalidation: put it mid-text, fire the same change handler, check it. */
  const MID = 9;                                       // inside "Decisions"
  await page.evaluate(n => {
    const el = document.getElementById('f-reported_situation');
    el.focus();
    el.setSelectionRange(n, n);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, MID);
  await page.waitForTimeout(120);
  const afterRevalidate = await page.evaluate(() => {
    const a = document.activeElement;
    return { id: a && a.id, start: a && a.selectionStart, end: a && a.selectionEnd };
  });
  check('a revalidation on a focused field keeps that field focused',
    afterRevalidate.id === 'f-reported_situation', JSON.stringify(afterRevalidate));
  check('a revalidation on a focused field keeps the caret offset',
    afterRevalidate.start === MID && afterRevalidate.end === MID, JSON.stringify(afterRevalidate));

  await page.check('input[type=radio][name="case_intent"]', { force: true });
  await page.waitForTimeout(150);

  const intentPicked = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hv_intake_draft') || '{}');
    return raw && raw.d ? raw.d.case_intent : null;
  });

  /* ── 3. Switch to Arabic ── */
  await page.click('[data-hv-lang-toggle]');
  await page.waitForTimeout(250);

  check('page is Arabic', await page.evaluate(() => document.documentElement.lang) === 'ar');
  check('page is RTL', await page.evaluate(() => document.documentElement.dir) === 'rtl');

  /* ── 4. The assertions the bug used to fail ── */
  const answer = await page.$eval('#f-reported_situation', n => n.value);
  check('answer survived the switch', /Decisions stall/.test(answer), answer);

  const errsAr = await page.$$eval('[id^="e-"]', ns => ns.map(n => n.textContent.trim()).filter(Boolean));
  check('no stale English error text remains',
    errsAr.every(s => !/required|Pick one|Choose/i.test(s)), JSON.stringify(errsAr));
  check('any error still shown is Arabic',
    errsAr.every(s => /[؀-ۿ]/.test(s)), JSON.stringify(errsAr));

  const sitErr = await page.$eval('#e-reported_situation', n => n.textContent.trim());
  check('corrected situation is NOT marked invalid after switch', sitErr === '', JSON.stringify(sitErr));
  const invalidAr = await page.$$eval('[aria-invalid="true"]', ns => ns.map(n => n.id));
  check('aria-invalid cleared on the corrected field',
    !invalidAr.includes('f-reported_situation'), JSON.stringify(invalidAr));

  /* The switch re-renders the whole form, which destroys the element the visitor
     was on — here, the language button they just pressed. A keyboard user must
     not be dumped at the top of the document. */
  const afterSwitch = await page.evaluate(() => {
    const a = document.activeElement;
    return {
      body: a === document.body,
      isLangToggle: !!(a && a.hasAttribute && a.hasAttribute('data-hv-lang-toggle')),
      tag: a && a.tagName
    };
  });
  check('the switch does not dump focus on the body', afterSwitch.body === false, JSON.stringify(afterSwitch));
  check('the switch returns focus to the language button',
    afterSwitch.isLangToggle === true, JSON.stringify(afterSwitch));

  /* The caret-preservation path itself, exercised directly: a switch fired while
     a text field holds the caret must put both back. Driving setLang() is the
     only way to reach this path, because clicking the toggle necessarily moves
     focus to the toggle first. */
  const CARET = 12;
  await page.evaluate(n => {
    const el = document.getElementById('f-reported_situation');
    el.focus();
    el.setSelectionRange(n, n);
    HV.i18n.setLang('en');
  }, CARET);
  await page.waitForTimeout(250);
  const afterProgrammatic = await page.evaluate(() => {
    const a = document.activeElement;
    return { id: a && a.id, start: a && a.selectionStart, end: a && a.selectionEnd,
             lang: document.documentElement.lang };
  });
  check('a switch with the caret in a field restores that field',
    afterProgrammatic.id === 'f-reported_situation', JSON.stringify(afterProgrammatic));
  check('a switch with the caret in a field restores the caret offset',
    afterProgrammatic.start === CARET && afterProgrammatic.end === CARET, JSON.stringify(afterProgrammatic));
  check('and the language really did change', afterProgrammatic.lang === 'en', JSON.stringify(afterProgrammatic));

  /* back to Arabic for the assertions that follow */
  await page.evaluate(() => HV.i18n.setLang('ar'));
  await page.waitForTimeout(200);

  const step = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hv_intake_draft') || '{}');
    return raw.step;
  });
  check('step preserved across the switch', step === 0 || step === undefined, String(step));
  const intentAfter = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hv_intake_draft') || '{}');
    return raw && raw.d ? raw.d.case_intent : null;
  });
  check('selection preserved across the switch', intentAfter === intentPicked,
    intentPicked + ' → ' + intentAfter);

  /* ── 5. Untouched fields must not sprout errors while typing elsewhere ── */
  await start(page, 'en');
  await page.fill('#f-reported_situation', 'A');
  await page.waitForTimeout(120);
  const premature = await page.$$eval('[id^="e-"]', ns => ns.map(n => n.textContent.trim()).filter(Boolean));
  check('typing before Next raises no errors at all', premature.length === 0, JSON.stringify(premature));

  /* ── 6. The mirror image: start in ARABIC, switch to English. The stored
           language must win over the browser's preference in both directions. ── */
  await start(page, 'ar');
  check('an Arabic selection is honoured', await page.evaluate(() => document.documentElement.lang) === 'ar');
  await page.click('[data-hv-next]');
  const errsAr2 = await page.$$eval('[id^="e-"]', ns => ns.map(n => n.textContent.trim()).filter(Boolean));
  check('empty Next raises Arabic errors', errsAr2.length >= 2 && errsAr2.every(s => /[؀-ۿ]/.test(s)),
    JSON.stringify(errsAr2));
  await page.fill('#f-reported_situation', 'قرارات تتأخر أسابيع ولا أحد يعرف من يملكها.');
  await page.waitForTimeout(120);
  await page.click('[data-hv-lang-toggle]');
  await page.waitForTimeout(250);
  const errsEn2 = await page.$$eval('[id^="e-"]', ns => ns.map(n => n.textContent.trim()).filter(Boolean));
  check('after switching to English no Arabic error text remains',
    errsEn2.every(s => !/[؀-ۿ]/.test(s)), JSON.stringify(errsEn2));
  check('the corrected field is still clear in English',
    (await page.$eval('#e-reported_situation', n => n.textContent.trim())) === '');

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const locale of LOCALES) await run(browser, locale);
  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
