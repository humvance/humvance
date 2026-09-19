'use strict';
/**
 * The workspace audit trail, in a real browser. Change C-02.
 *
 * PB-2026-09-18.1 · PD-002 · G31 · D10. The audit column rendered the raw event
 * identifier and nothing else, so on an Arabic page a case history read as a
 * list of English identifiers — while the `summary` the backend writes for every
 * entry was fetched by the page and then discarded.
 *
 * Acceptance criteria from CHANGE-BRIEFS.md C-02, one check each.
 *
 *     node tests/ui/repro-audit-labels.js            (server must be running)
 */
const { chromium } = require('playwright');

const BASE = process.env.HV_BASE || 'http://localhost:4173';
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + String(detail).slice(0, 260) : '')); }
}

async function openAudit(page, lang) {
  await page.goto(BASE + '/v2-workspace?demo=1', { waitUntil: 'networkidle' });
  await page.evaluate(l => { try { localStorage.setItem('hv_lang', l); } catch (e) {} }, lang);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  await page.evaluate(() => { const b = document.querySelector('[data-hv-tab="audit"]'); if (b) b.click(); });
  await page.waitForTimeout(250);
  return page.$$eval('.hv-table tbody tr', rows => rows.map(r => ({
    when: r.children[0].innerText.trim(),
    event: r.children[1].innerText.trim(),
    label: (r.querySelector('.ws-ae') || {}).innerText || '',
    raw: (r.querySelector('.hv-code') || {}).innerText || '',
    actor: r.children[2].innerText.trim()
  })));
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();

  /* ── AC1 + AC2: Arabic label, raw identifier still present ─────────────── */
  const ar = await openAudit(page, 'ar');
  check('the audit tab renders rows', ar.length > 0, String(ar.length));
  check('AC1 · every row carries Arabic label text',
    ar.every(r => /[؀-ۿ]/.test(r.label)), JSON.stringify(ar.slice(0, 3)));
  check('AC2 · every row still shows the raw identifier',
    ar.every(r => /^[a-z_]+\.[a-z_]+$/.test(r.raw)), JSON.stringify(ar.map(r => r.raw).slice(0, 4)));
  check('the label is not the raw identifier',
    ar.every(r => r.label !== r.raw));
  check('the actor column is translated, not a bare enum',
    ar.every(r => /[؀-ۿ]/.test(r.actor)), JSON.stringify([...new Set(ar.map(r => r.actor))]));
  check('the stored summary is displayed beneath the label',
    ar.every(r => r.event.replace(r.label, '').replace(r.raw, '').trim().length > 0),
    JSON.stringify(ar[0]));

  /* ── AC4: a language switch re-renders the labels ──────────────────────── */
  await page.click('[data-hv-lang-toggle]');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.querySelector('[data-hv-tab="audit"]'); if (b) b.click(); });
  await page.waitForTimeout(250);
  const en = await page.$$eval('.hv-table tbody tr', rows => rows.map(r => ({
    label: (r.querySelector('.ws-ae') || {}).innerText || '',
    raw: (r.querySelector('.hv-code') || {}).innerText || '',
    actor: r.children[2].innerText.trim()
  })));
  check('AC4 · the switch re-renders into English',
    en.length === ar.length && en.every(r => !/[؀-ۿ]/.test(r.label)),
    JSON.stringify(en.slice(0, 3)));
  check('AC4 · the raw identifiers are unchanged by the switch',
    JSON.stringify(en.map(r => r.raw)) === JSON.stringify(ar.map(r => r.raw)));

  /* ── AC3: EVERY AUDIT_EVENTS value resolves, in both languages ─────────── */
  const EVENTS = require('../../api/v2/_domain').AUDIT_EVENTS;
  const unresolved = await page.evaluate(evs => {
    const out = [];
    ['ar', 'en'].forEach(l => {
      HV.i18n.setLang(l);
      evs.forEach(e => {
        const v = HV.i18n.t('ws.ae.' + e);
        if (!v || v === 'ws.ae.' + e || v === e) out.push(l + ':' + e);
      });
    });
    return out;
  }, EVENTS);
  check(`AC3 · all ${EVENTS.length} AUDIT_EVENTS have a label in both languages`,
    unresolved.length === 0, JSON.stringify(unresolved));

  /* ── AC5: an unknown event falls back to itself, not to a guess ────────── */
  const fallback = await page.evaluate(() => {
    HV.i18n.setLang('ar');
    return HV.i18n.t('ws.ae.some.event.that.does.not.exist');
  });
  check('AC5 · an unlabelled event falls back to its own key',
    fallback === 'ws.ae.some.event.that.does.not.exist', fallback);

  /* ── AC6: the audit vocabulary and the API were not touched ────────────── */
  const fs = require('fs');
  const domain = fs.readFileSync(__dirname + '/../../api/v2/_domain.js', 'utf8');
  check('AC6 · AUDIT_EVENTS still holds exactly 25 values', EVENTS.length === 25, String(EVENTS.length));
  check('AC6 · no ws.ae key was added to the backend',
    domain.indexOf('ws.ae.') === -1);

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
