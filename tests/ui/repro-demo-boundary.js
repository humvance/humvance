/* /manage must not become a demo surface, and the demo fixtures must stay
   read-only after the intake-review deep-link change. Runs against the static
   dev server, where every /api/* answers 501 — which is exactly the anonymous
   case /manage must render as a gate rather than as an empty list. */
const { chromium } = require('playwright');
const BASE = process.env.HV_BASE || 'http://127.0.0.1:4173';
let bad = 0;
const ok = (n, c, d) => { console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  → ' + String(d).slice(0,160))); if (!c) bad++; };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));

  await p.goto(BASE + '/manage?demo=1', { waitUntil: 'networkidle' });
  const txt = await p.$eval('#app', n => n.innerText);
  ok('/manage?demo=1 does not enter demo mode', !/demo|عرض تجريبي/i.test(txt), txt.slice(0,160));
  ok('it shows a gate rather than records', /sign in|تسجيل الدخول/i.test(txt), txt.slice(0,160));
  ok('no request reference leaks into the gate', !/HVS-/.test(txt));
  ok('the page threw nothing', errs.length === 0, errs.join(' | '));

  await p.goto(BASE + '/v2-intake-review?demo=1', { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const rows = await p.$$('[data-hv-open]');
  ok('the demo queue still lists its fixtures', rows.length > 0, rows.length);
  await rows[0].click();
  await p.waitForTimeout(300);
  ok('opening a fixture still works', /\?demo=1/.test(p.url()) && (await p.$('[data-hv-back]')) !== null, p.url());
  ok('and the deep-link parameter was written for the fixture too',
     /intakeseed_id=/.test(p.url()), p.url());
  ok('demo mode survived the URL rewrite', (await p.$eval('#app', n => n.innerText)).indexOf('HVS-') !== -1);

  const badUrl = BASE + '/v2-intake-review?demo=1&intakeseed_id=' + encodeURIComponent('../../etc/passwd');
  await p.goto(badUrl, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const t2 = await p.$eval('#app', n => n.innerText);
  ok('an unknown id is refused, not rendered', !/passwd/.test(t2), t2.slice(0,160));
  ok('and the queue is still shown', (await p.$$('[data-hv-open]')).length > 0);

  await b.close();
  console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall demo-boundary checks passed');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
