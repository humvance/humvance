'use strict';
/**
 * Bilingual coverage, measured at runtime rather than by grepping for keys.
 *
 * Product Brain PB-2026-09-18.1 · PD-002 (one product, Arabic and English) ·
 * G31 · D10. The register holds 572 keys in each language, but key parity is
 * not the requirement — the requirement is that a visitor never meets a raw key
 * or an untranslated string on a page.
 *
 * A static scan cannot prove that, because most keys are built at run time
 * (`t('o.impact.' + kind)`). So this walks every redesigned page in BOTH
 * languages with `HV.i18n.t` instrumented: every lookup is recorded, and a miss
 * is one where `t()` returned the key itself. It then reads the rendered text
 * back and looks for anything that still looks like a key or a raw enum.
 *
 *     node tests/ui/repro-i18n-coverage.js          (server must be running)
 */
const { chromium } = require('playwright');

const BASE = process.env.HV_BASE || 'http://localhost:4173';

/* The real vocabulary, from the backend, so the check cannot drift from it. */
const D = require('../../api/v2/_domain');
const ENUMS = new Set([].concat(
  D.CASE_STATES, D.FINDING_STATES, D.CONTRADICTION_STATES, D.CONTRADICTION_KINDS,
  D.EVIDENCE_STRENGTH, D.EVIDENCE_SOURCE_TYPES, D.EVIDENCE_VERIFICATION,
  D.HYPOTHESIS_STATES, D.APPROVAL_DECISIONS, D.CLAIM_VERIFICATION, D.CLAIM_ORIGINS,
  D.CASE_INTENTS, D.EVIDENCE_REQUEST_STATES
).filter(Boolean).map(String));
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + String(detail).slice(0, 300) : '')); }
}

/* Every page the redesign owns, with the interactions that reveal more keys. */
const PAGES = [
  { path: '/',                        name: 'home' },
  { path: '/services',                name: 'services' },
  { path: '/how-we-work',             name: 'how-we-work' },
  { path: '/request-status',          name: 'request-status' },
  { path: '/intake',                  name: 'intake' },
  { path: '/client?demo=1',           name: 'client (demo)' },
  { path: '/client',                  name: 'client (gate)', fresh: true },
  { path: '/v2-intake-review?demo=1', name: 'reviewer queue', after: 'reviewTabs' },
  { path: '/v2-workspace?demo=1',     name: 'workspace',      after: 'allTabs' }
];

/**
 * Instrument t() before the page's own script runs.
 *
 * A polling interval is too late: each page does `var I = HV.i18n, t = I.t` at
 * the top of its script, capturing the ORIGINAL function, so a later patch is
 * never seen. So intercept the assignment itself — `hv-i18n.js` does
 * `global.HV = global.HV || {}` and then `global.HV.i18n = {...}`, and a setter
 * on each of those lets the wrapper be installed before any page code reads it.
 */
const INSTRUMENT = () => {
  window.__hvMiss = [];
  window.__hvSeen = 0;
  const wrap = (i18n) => {
    if (!i18n || i18n.__hvWrapped) return;
    const real = i18n.t;
    i18n.t = function (key, vars) {
      const v = real.call(i18n, key, vars);
      window.__hvSeen++;
      if (v === key && String(key).indexOf('.') !== -1) window.__hvMiss.push(key);
      return v;
    };
    i18n.__hvWrapped = true;
  };
  /* `hv-i18n.js`, `hv-ui.js` and `hv-demo.js` each open with
     `global.HV = global.HV || {}`, so the outer setter fires three times. The
     captured i18n object must live OUTSIDE it — re-installing the accessor with
     a fresh inner variable would blank `HV.i18n` on the second assignment. */
  let _i18n;
  const installI18n = (obj) => {
    Object.defineProperty(obj, 'i18n', {
      configurable: true,
      get() { return _i18n; },
      set(x) { _i18n = x; wrap(x); }
    });
  };
  let _hv;
  Object.defineProperty(window, 'HV', {
    configurable: true,
    get() { return _hv; },
    set(v) { _hv = v; installI18n(_hv); }
  });
};

async function sweep(page, p, lang) {
  await page.addInitScript(INSTRUMENT);
  await page.goto(BASE + p.path, { waitUntil: 'networkidle' });
  await page.evaluate(l => { try { localStorage.setItem('hv_lang', l); } catch (e) {} }, lang);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  if (p.after === 'allTabs') {
    const tabs = await page.$$eval('[data-hv-tab]', ns => ns.map(n => n.getAttribute('data-hv-tab')));
    for (const t of [...new Set(tabs)]) {
      await page.evaluate(k => { const b = document.querySelector('[data-hv-tab="' + k + '"]'); if (b) b.click(); }, t);
      await page.waitForTimeout(120);
    }
  }
  if (p.after === 'reviewTabs') {
    for (const f of ['all', 'PENDING_REVIEW', 'ACCEPTED', 'REJECTED']) {
      await page.evaluate(k => { const b = document.querySelector('[data-hv-filter="' + k + '"]'); if (b) b.click(); }, f);
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => { const b = document.querySelector('[data-hv-filter="all"]'); if (b) b.click(); });
    await page.waitForTimeout(100);
    for (const id of ['seed_demo_a', 'seed_demo_c', 'seed_demo_d', 'seed_demo_e']) {
      await page.evaluate(i => { const r = document.querySelector('[data-hv-open="' + i + '"]'); if (r) r.click(); }, id);
      await page.waitForTimeout(150);
      await page.evaluate(() => { const b = document.querySelector('[data-hv-back]'); if (b) b.click(); });
      await page.waitForTimeout(100);
      await page.evaluate(() => { const b = document.querySelector('[data-hv-filter="all"]'); if (b) b.click(); });
      await page.waitForTimeout(80);
    }
  }

  const r = await page.evaluate(() => ({
    seen: window.__hvSeen || 0,
    miss: Array.from(new Set(window.__hvMiss || [])),
    text: (document.querySelector('main') || document.body).innerText
  }));
  return r;
}

(async () => {
  const browser = await chromium.launch();

  for (const lang of ['ar', 'en']) {
    console.log('\n[' + lang + ']');
    for (const p of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
      const page = await ctx.newPage();
      page.on('dialog', d => d.dismiss().catch(() => {}));
      const r = await sweep(page, p, lang);

      check(`${p.name} · t() was instrumented and used`, r.seen > 0, String(r.seen));
      check(`${p.name} · no key resolved to itself`, r.miss.length === 0, JSON.stringify(r.miss));

      /* A key that leaked into the DOM: a dotted lowercase token standing on its
         own. A stored identifier shown BESIDE a readable label is allowed on the
         reviewer screens and is what `raw()` exists for, so only a line that is
         nothing but the identifier counts as a leak. */
      const leaked = r.text.split('\n').map(s => s.trim()).filter(Boolean)
        .filter(s => /^[a-z][a-z0-9]{1,12}(\.[a-z][a-zA-Z0-9_]{1,20}){1,3}$/.test(s))
        .filter(s => !/\.(com|sa|org|net|pdf|html|js)$/i.test(s));
      check(`${p.name} · no translation key stands alone as visible text`,
        leaked.length === 0, JSON.stringify([...new Set(leaked)].slice(0, 6)));

      /* On an Arabic page, a BACKEND ENUM VALUE standing alone with no Arabic
         next to it is the defect class the workspace header had. The vocabulary
         comes from _domain.js rather than from a shape like /[A-Z_]+/, which
         would also flag the deliberate bilingual pairs on the home page
         ("\u0646\u0641\u0647\u0645" over "Understand"). A raw value shown BESIDE a readable label
         is allowed on reviewer screens, so a neighbouring Arabic line clears it. */
      if (lang === 'ar') {
        const lines = r.text.split('\n').map(s => s.trim()).filter(Boolean);
        const AR = /[\u0600-\u06FF]/;
        const hasAr = (i) => [i - 1, i, i + 1].some(j => lines[j] && AR.test(lines[j]));
        const bare = lines.filter((l, i) => ENUMS.has(l) && !hasAr(i));
        check(`${p.name} \u00b7 no backend enum stands alone without Arabic`, bare.length === 0,
          JSON.stringify([...new Set(bare)].slice(0, 6)));
      }

      await ctx.close();
    }
  }

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
