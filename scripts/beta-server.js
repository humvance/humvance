'use strict';
/**
 * Humvance — INTERNAL BETA server.
 *
 *     npm run beta        →  http://127.0.0.1:4178
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 *
 * `scripts/dev-server.js` serves the pages and answers every `/api/*` with 501,
 * which is honest but means the journey stops at the submit button. This server
 * serves the same pages AND dispatches `/api/v2/*` to THE REAL HANDLERS —
 * `api/v2/intake.js`, `api/v2/intake-review.js`, `api/v2/case.js` — unmodified.
 * The domain rules, the authorization gates, the human-only transitions, the
 * burden gate and the version checks are the ones in these local files, because
 * this server dispatches to those files directly.
 *
 * CORRECTED 2026-09-19. This used to say "the production ones, because they are
 * the production files". That was a claim about the DEPLOYED release, and it was
 * not one this repository can make: humvance.com currently serves the V1 line
 * and answers 404 for /api/v2/intake, so the deployed code is demonstrably not
 * these files. Running the real handlers locally proves what these files do. It
 * proves nothing whatsoever about what is deployed.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 *
 * It is NOT a second backend, and it must never become one.
 *
 *   · Storage is `V2_STORE_DRIVER=memory` in a namespace of its own. It is gone
 *     when this process stops. Nothing persists, nothing is shared, and no
 *     Redis, Upstash or Production store is reachable from here.
 *   · It binds 127.0.0.1 ONLY. It is not reachable from the network.
 *   · It mints its own throwaway signing secret, per run, in memory. It reads no
 *     real secret and writes none. Production authentication is untouched: the
 *     handlers still verify a real HS256 token through the real `verifyJWT`.
 *     Nothing here is a bypass — the harness simply holds the only key to its
 *     own empty room.
 *   · It sends no email, calls no AI, and reaches no external service.
 *   · Every record it creates is synthetic and marked as such.
 *
 * ── HOW THE OPERATOR SIGNS IN ───────────────────────────────────────────────
 *
 * `GET /__beta/session` (loopback only) returns a token for ONE synthetic
 * reviewer principal and the pages store it where they already look for it —
 * `sessionStorage.hv_token`. That is the same mechanism `/admin` uses on a real
 * deployment; only the issuer differs.
 *
 * ── THE THREE LEVELS OF EVIDENCE, KEPT APART ────────────────────────────────
 *
 *   fixture demo        `?demo=1`      — read-only, no API call is made at all
 *   LOCAL INTEGRATION   this server    — real handlers, real rules, memory store
 *   Preview             deployed       — real Redis, real routing. NOT THIS.
 *
 * A green run here proves the application logic end to end. It proves nothing
 * about deployment, routing or durable storage.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4178;
const HOST = '127.0.0.1';

/* ── Never on a deployment ─────────────────────────────────────────────────
   This file mints its own signing secret and hands out a reviewer session to
   anyone who asks on loopback. That is exactly right for a laptop and
   catastrophic anywhere else.

   Vercel only serves `public/` and `api/`, so `scripts/` is not deployed and
   this can't run there by accident. This is the belt to that braces: if a
   platform environment is detected at all, refuse to start rather than reason
   about whether this particular one is safe. */
for (const marker of ['VERCEL', 'VERCEL_ENV', 'AWS_LAMBDA_FUNCTION_NAME', 'KUBERNETES_SERVICE_HOST', 'DYNO']) {
  if (process.env[marker]) {
    console.error('\n  REFUSED: ' + marker + ' is set, so this is not a developer machine.');
    console.error('  scripts/beta-server.js issues synthetic reviewer sessions and must never');
    console.error('  run anywhere a request from outside could reach it.\n');
    process.exit(3);
  }
}

/* ── Environment, set BEFORE the handlers are required ─────────────────────
   The handlers read process.env at module load (boot()), so this must happen
   first. A fresh random secret per run: strong enough for assertSigningSecret,
   worthless to anyone, and never written to disk. */
process.env.JWT_SECRET = 'beta-local-' + crypto.randomBytes(24).toString('hex');
process.env.V2_STORE_DRIVER = 'memory';
process.env.V2_NAMESPACE = 'beta-local';
delete process.env.V2_ACKNOWLEDGE_SHARED_PRODUCTION_DB;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.REDIS_URL;

const { signJWT } = require(path.join(ROOT, 'api', '_utils'));

/* ── One store for the whole process ───────────────────────────────────────
   On Vercel each handler is its own function with its own connection to the
   SAME Redis, so `boot()` caching a store per module is correct there. Here
   all three handlers share one process, and `memoryDriver()` gives each call
   its own `Map` — so intake would write a seed that intake-review could not
   see. That is an artefact of running three functions in one process, not a
   property of the application.

   So the harness memoises `createStore` BY NAMESPACE, before the handlers are
   required. Same namespace ⇒ same store, which is exactly how Redis behaves;
   different namespace ⇒ still separate, so the isolation tests are unaffected.
   No file under `api/` is touched, and this lives and dies with this process. */
const storeModule = require(path.join(ROOT, 'api', 'v2', '_store.js'));
const realCreateStore = storeModule.createStore;
const sharedStores = new Map();
storeModule.createStore = function createStoreShared(env) {
  const key = `${env && env.V2_STORE_DRIVER}:${env && env.V2_NAMESPACE}`;
  if (!sharedStores.has(key)) sharedStores.set(key, realCreateStore(env));
  return sharedStores.get(key);
};

/* The handlers are the real ones. No wrapper, no shim, no edited copy. */
const HANDLERS = {
  '/api/v2/intake':        require(path.join(ROOT, 'api', 'v2', 'intake.js')),
  '/api/v2/intake-review': require(path.join(ROOT, 'api', 'v2', 'intake-review.js')),
  '/api/v2/case':          require(path.join(ROOT, 'api', 'v2', 'case.js'))
};

/* One synthetic operator. `sub` gives a real principal id, so the audit trail
   says who acted instead of falling back to `admin:shared`. */
const OPERATOR = { sub: 'beta-operator', role: 'admin', actor_type: 'human' };

/* ── The operator console ──────────────────────────────────────────────────
   Three jobs, and they are kept apart on purpose:

     1. say what this environment is, and prove it from `/__beta/env` rather
        than from the hostname;
     2. put a synthetic reviewer session where the screens already look for it —
        only after that proof, and only on an explicit press;
     3. create one synthetic request, as a SEPARATE press.

   (2) and (3) used to be one button, which meant a fresh request appeared every
   time somebody signed in. Nobody asked for those requests and nobody could
   tell them apart from the ones they meant to send. Opening this page, or the
   homepage, now creates nothing at all.

   It is a string in this file rather than a page in public/ on purpose: it must
   never be publishable, and the release artifact must not contain it. It calls
   no endpoint the public site does not.                                       */
const CONSOLE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Humvance — النسخة الداخلية</title>
<link rel="stylesheet" href="/assets/hv.css">
<style>
 body{background:var(--hv-paper);padding:clamp(20px,4vw,52px) 16px}
 .w{max-inline-size:860px;margin-inline:auto;display:grid;gap:20px}
 .card{background:var(--hv-surface);border:1px solid var(--hv-line);border-radius:var(--hv-r);padding:20px 22px}
 h1{font-size:1.55rem;font-weight:800;letter-spacing:-.01em}
 h2{font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--hv-ink-3);margin-block-end:12px}
 body[data-lang="ar"] h2{text-transform:none;letter-spacing:0}
 dl{display:grid;grid-template-columns:200px 1fr;gap:7px 16px;font-size:.85rem}
 dt{color:var(--hv-ink-3)} dd{font-family:var(--hv-font-mono);font-size:.78rem;word-break:break-all}
 ol{display:grid;gap:11px;padding-inline-start:20px;font-size:.92rem;line-height:1.7}
 .warn{border-inline-start:3px solid var(--hv-clay);background:var(--hv-clay-soft);color:var(--hv-clay);
       padding:12px 15px;border-radius:var(--hv-r-sm);font-size:.82rem;line-height:1.7}
 .ok{color:var(--hv-verified)} .bad{color:var(--hv-conflict)}
 code{font-family:var(--hv-font-mono);font-size:.78rem;background:var(--hv-paper);padding:1px 5px;border-radius:4px}
 .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
 .out{font-family:var(--hv-font-mono);font-size:.78rem;line-height:1.8;margin-block-start:10px;white-space:pre-wrap}
 .step{display:grid;gap:8px;padding-block:14px}
 .step + .step{border-block-start:1px solid var(--hv-line)}
 .step p{font-size:.88rem;line-height:1.7;color:var(--hv-ink-2);max-inline-size:70ch}
 button[disabled]{opacity:.5;cursor:not-allowed}
 .top{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
</style></head><body data-lang="ar"><div class="w">

<div class="card">
  <div class="top">
    <h1 data-k="title"></h1>
    <button class="hv-btn hv-btn-ghost hv-btn-sm" type="button" id="lang"></button>
  </div>
  <p style="margin-block-start:10px;font-size:.95rem;line-height:1.75;color:var(--hv-ink-2)" data-k="intro"></p>
  <div class="warn" style="margin-block-start:16px"><strong data-k="warnT"></strong> <span data-k="warnB"></span></div>
</div>

<div class="card">
  <h2 data-k="envT"></h2>
  <dl id="env"></dl>
  <p class="hv-xs hv-muted" style="margin-block-start:10px" data-k="envNote"></p>
</div>

<div class="card">
  <h2 data-k="setupT"></h2>

  <div class="step">
    <strong data-k="s1T"></strong>
    <p data-k="s1B"></p>
    <div class="row">
      <button class="hv-btn hv-btn-primary" type="button" id="signin" disabled></button>
      <a class="hv-btn hv-btn-outline" href="/manage" id="tomanage"></a>
    </div>
    <div class="out" id="out1"></div>
  </div>

  <div class="step">
    <strong data-k="s2T"></strong>
    <p data-k="s2B"></p>
    <div class="row"><button class="hv-btn hv-btn-outline" type="button" id="seed" disabled></button></div>
    <div class="out" id="out2"></div>
  </div>
</div>

<div class="card">
  <h2 data-k="walkT"></h2>
  <ol>
    <li data-k="w1"></li><li data-k="w2"></li><li data-k="w3"></li><li data-k="w4"></li><li data-k="w5"></li>
  </ol>
</div>

</div>
<script>
(function(){
 var T={
  ar:{
   title:'Humvance — النسخة الداخلية',
   intro:'الموقع المُعاد تصميمه والشاشات الداخلية، تعمل على معالجات api/v2 المحلية الحقيقية فوق مخزن اصطناعي في الذاكرة يعيش داخل هذه العملية فقط. القواعد والبوابات والرفض التي تقابلها هنا هي قواعد هذه الملفات المحلية كما هي على القرص الآن. المنشور على humvance.com خط شيفرة آخر لم يُتحقق من تطابقه، ولا شيء هنا يثبت ما يفعله الإصدار المنشور.',
   warnT:'بيانات تجريبية فقط.',
   warnB:'هذه ليست Preview وليست Production. المخزن في الذاكرة ويختفي عند إيقاف الخادم. غير مُعتمدة للاستخدام التشخيصي مع عملاء حقيقيين.',
   envT:'ما هي هذه البيئة',
   envNote:'تُقرأ هذه القيم من الخادم نفسه عبر /__beta/env. لا يُفعَّل زر تهيئة الجلسة قبل أن تؤكد أن المخزن في الذاكرة وأن هذه النسخة غير منشورة.',
   setupT:'التهيئة — خطوتان منفصلتان',
   s1T:'١. تهيئة جلسة مراجع تجريبية',
   s1B:'يخزّن رمز جلسة تجريبياً حيث تبحث عنه الشاشات الداخلية أصلاً. لا يُنشئ أي طلب، ولا يحدث شيء دون ضغطك.',
   s2T:'٢. إنشاء طلب تجريبي واحد',
   s2B:'خطوة منفصلة عمداً: يُرسل طلباً واحداً عبر نقطة النهاية العامة نفسها حتى لا تجد قائمة المراجعة فارغة. اضغطه مرة واحدة فقط — كل ضغطة تُنشئ طلباً جديداً.',
   signin:'تهيئة الجلسة التجريبية',
   seed:'إنشاء طلب تجريبي واحد',
   tomanage:'الذهاب إلى الإدارة ←',
   walkT:'جولة في خمس دقائق',
   w1:'افتح الموقع العام على /home وجرّب مستكشف الرحلة، وبدّل اللغة من زر الكرة الأرضية.',
   w2:'أرسل طلباً بنفسك من /intake: راجع إجاباتك، ارجع وعدّل واحدة، ثم أرسل واقرأ الرقم المرجعي الذي يعيده الخادم.',
   w3:'ادخل إلى الإدارة من /manage: اقبل طلباً، واعتذر عن آخر مع ذكر السبب.',
   w4:'افتح القضية التي أنشأها القبول من شاشة الإدارة نفسها.',
   w5:'في /v2-workspace نفّذ خطوات القضية من لوحة الممارس أسفل كل تبويب.',
   sessionOk:'✓ هُيّئت الجلسة للمستخدم ',
   sessionBad:'✗ تعذّرت تهيئة الجلسة: ',
   seedOk:'✓ أُرسل طلب تجريبي — المرجع ',
   seedBad:'✗ رفض الخادم الطلب: ',
   needSession:'هيّئ الجلسة أولاً.',
   envBad:'✗ لم تؤكد هذه البيئة أنها نسخة محلية بمخزن في الذاكرة، فالتهيئة معطّلة.',
   lang:'English'
  },
  en:{
   title:'Humvance — internal beta',
   intro:'The redesigned site and the internal screens, running against the real local api/v2 handlers over a synthetic in-memory store that lives in this process only. The rules, gates and refusals you meet here are the rules in these local files as they stand on disk right now. What is deployed at humvance.com is a different code line whose equivalence has not been established, and nothing here demonstrates what the deployed release does.',
   warnT:'Synthetic data only.',
   warnB:'This is not Preview and not Production. The store is in memory and disappears when the server stops. Not cleared for real customer diagnostic use.',
   envT:'What this environment is',
   envNote:'These values are read from the server itself through /__beta/env. The session button stays disabled until it confirms an in-memory store on a build that is not deployed.',
   setupT:'Setup — two separate steps',
   s1T:'1. Set up a synthetic reviewer session',
   s1B:'Stores a synthetic session token where the internal screens already look for it. It creates no request, and nothing happens without your press.',
   s2T:'2. Create one synthetic request',
   s2B:'Deliberately separate: sends one request through the same public endpoint, so the review queue is not empty. Press it once — every press creates another request.',
   signin:'Set up the synthetic session',
   seed:'Create one synthetic request',
   tomanage:'Go to management →',
   walkT:'The five-minute walkthrough',
   w1:'Open the public site at /home, try the journey explorer, and switch language with the globe button.',
   w2:'Send a request yourself at /intake: review your answers, go back and edit one, then submit and read the reference the server gives back.',
   w3:'Go to management at /manage: accept one request, and decline another with a reason.',
   w4:'Open the case that acceptance created, from the management screen itself.',
   w5:'In /v2-workspace, work the case through the practitioner panel at the foot of each tab.',
   sessionOk:'\\u2713 session stored for ',
   sessionBad:'\\u2717 could not obtain a session: ',
   seedOk:'\\u2713 synthetic request submitted \\u2014 reference ',
   seedBad:'\\u2717 the server refused the request: ',
   needSession:'Set up the session first.',
   envBad:'\\u2717 this environment did not confirm itself as a local in-memory build, so setup is disabled.',
   lang:'العربية'
  }
 };
 var lang = 'ar';
 try { lang = localStorage.getItem('hv_lang') === 'en' ? 'en' : 'ar'; } catch(e){}
 var envOk = false, signedIn = false;

 function paint(){
   var d = T[lang];
   document.documentElement.lang = lang;
   document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
   document.body.setAttribute('data-lang', lang);
   document.title = d.title;
   document.querySelectorAll('[data-k]').forEach(function(el){
     var v = d[el.getAttribute('data-k')]; if (v !== undefined) el.textContent = v;
   });
   document.getElementById('lang').textContent = d.lang;
   document.getElementById('signin').textContent = d.signin;
   document.getElementById('seed').textContent = d.seed;
   document.getElementById('tomanage').textContent = d.tomanage;
   document.getElementById('signin').disabled = !envOk;
   document.getElementById('seed').disabled = !envOk || !signedIn;
 }
 document.getElementById('lang').addEventListener('click', function(){
   lang = lang === 'ar' ? 'en' : 'ar';
   try { localStorage.setItem('hv_lang', lang); } catch(e){}
   paint();
 });

 function say(id, cls, s){ var o=document.getElementById(id); o.innerHTML += '<div class="'+cls+'">'+s+'</div>'; }

 (async function(){
   var env = {};
   try { env = await (await fetch('/__beta/env')).json(); } catch(e){}
   document.getElementById('env').innerHTML =
     [['mode', env.mode], ['store', env.store], ['namespace', env.namespace],
      ['persistent', String(env.persistent)], ['deployed', String(env.deployed)]]
     .map(function(r){ return '<dt>'+r[0]+'</dt><dd>'+(r[1]===undefined?'—':r[1])+'</dd>'; }).join('');
   /* The gate: the session button is enabled only by the harness's own answer. */
   envOk = env.mode === 'LOCAL_INTEGRATION' && env.store === 'memory' &&
           env.persistent === false && env.deployed === false;
   paint();
   if (!envOk) say('out1', 'bad', T[lang].envBad);
 })();

 document.getElementById('signin').addEventListener('click', async function(){
   if (!envOk) return;
   document.getElementById('out1').innerHTML = '';
   try {
     var s = await (await fetch('/__beta/session')).json();
     sessionStorage.setItem('hv_token', s.token);
     signedIn = true; paint();
     say('out1', 'ok', T[lang].sessionOk + s.principal);
   } catch (e) { say('out1', 'bad', T[lang].sessionBad + e.message); }
 });

 document.getElementById('seed').addEventListener('click', async function(){
   if (!envOk) return;
   if (!signedIn) { say('out2', 'bad', T[lang].needSession); return; }
   document.getElementById('out2').innerHTML = '';
   try {
     var r = await fetch('/api/v2/intake', {
       method: 'POST', headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         organization_context: { company_name: 'SYNTHETIC \\u2014 Northline Logistics', sector: 'Logistics',
           employee_count_band: '51-200', growth_stage: 'growing' },
         respondent_context: { name: 'SYNTHETIC \\u2014 Operations Director', role_title: 'Operations Director',
           email: 'ops@example.invalid', preferred_contact: 'email' },
         case_intent: 'DYSFUNCTION',
         reported_situation: 'SYNTHETIC \\u2014 Hiring decisions sit for weeks between the manager and HR, and nobody can say where they are stuck.',
         scope: { kind: 'process', labels: ['Hiring', 'HR'] },
         timeline: { first_noticed_approx: 'Since March', pattern: 'increasing' },
         recent_examples: [{ what_happened: 'SYNTHETIC \\u2014 the last three roles took 6, 7 and 9 weeks from request to offer.' }],
         observed_impact: [{ kind: 'delays' }],
         change_context: [{ kind: 'new_system' }],
         client_belief: 'SYNTHETIC \\u2014 I think HR is short-staffed.',
         evidence_availability: [{ kind: 'workflow_system_data' }],
         desired_outcome: 'SYNTHETIC \\u2014 whether to hire into HR or change the handoff.',
         consent: { data_use: true, ai_transparency_ack: true, sensitive_data_ack: true },
         locale: 'en'
       })
     });
     var j = await r.json();
     if (!r.ok) return say('out2', 'bad', T[lang].seedBad + (j.code || '') + ' ' + (j.error || ''));
     say('out2', 'ok', T[lang].seedOk + j.submission_reference);
   } catch (e) { say('out2', 'bad', T[lang].seedBad + e.message); }
 });

 paint();
})();
</script></body></html>`;

/* ── Static serving, identical route aliases to the review server ───────── */
const ROUTES = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).routes || [];
const ALIAS = Object.create(null);
for (const r of ROUTES) if (r.src && r.dest) ALIAS[r.src] = r.dest;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/home.html';
  if (ALIAS[p]) p = ALIAS[p];
  if (!path.extname(p)) {
    const guess = p + '.html';
    if (fs.existsSync(path.join(PUBLIC, guess))) p = guess;
  }
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 — not found on the beta server');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
}

/* ── A minimal Vercel-shaped req/res, because the handlers expect one ────── */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let over = false;
    req.on('data', c => {
      raw += c;
      /* The handlers enforce their own limits; this only stops the harness
         itself being used to exhaust memory. */
      if (raw.length > 2 * 1024 * 1024) { over = true; req.destroy(); }
    });
    req.on('end', () => resolve(over ? null : raw));
    req.on('error', reject);
  });
}

function shim(req, res, rawBody) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const query = {};
  for (const [k, v] of url.searchParams) query[k] = v;

  let body;
  if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = undefined; } }

  const vreq = Object.assign(Object.create(Object.getPrototypeOf(req)), req, {
    query,
    body,
    /* Handlers that check raw size read this. */
    rawBody
  });
  vreq.headers = req.headers;
  vreq.method = req.method;
  vreq.url = url.pathname + url.search;
  vreq.socket = req.socket;
  vreq.on = req.on.bind(req);

  const vres = {
    _status: 200,
    statusCode: 200,
    setHeader: (k, v) => { res.setHeader(k, v); return vres; },
    getHeader: (k) => res.getHeader(k),
    status(code) { vres._status = code; vres.statusCode = code; return vres; },
    json(obj) {
      if (!res.headersSent) res.writeHead(vres._status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
      return vres;
    },
    send(text) {
      if (!res.headersSent) res.writeHead(vres._status);
      res.end(typeof text === 'string' ? text : JSON.stringify(text));
      return vres;
    },
    end(x) { res.end(x); return vres; }
  };
  return { vreq, vres };
}

/* ── The server ───────────────────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];

  /* Loopback only, enforced per request as well as at bind time. */
  const remote = req.socket.remoteAddress || '';
  const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!isLoopback) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('the beta server answers loopback only');
  }

  /* The operator's synthetic session. */
  if (pathname === '/__beta/session') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({
      token: signJWT(OPERATOR),
      principal: 'sub:beta-operator',
      note: 'Synthetic local beta operator. Memory store, loopback only, nothing persists.'
    }));
  }

  /* The operator's console. Deliberately NOT a file in public/: it exists only
     on this harness, so it can never be published by accident, and it holds the
     one thing that is genuinely awkward otherwise — putting a synthetic session
     token where the pages already look for it. */
  if (pathname === '/__beta/' || pathname === '/__beta') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(CONSOLE_HTML);
  }

  /* A machine-readable statement of what this environment is, so a page can say
     so on screen rather than a human having to remember. */
  if (pathname === '/__beta/env') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({
      mode: 'LOCAL_INTEGRATION',
      store: 'memory',
      namespace: process.env.V2_NAMESPACE,
      persistent: false,
      deployed: false,
      note: 'Real handlers, real rules, in-memory store. Not Preview, not Production.'
    }));
  }

  if (HANDLERS[pathname]) {
    try {
      const raw = (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')
        ? await readBody(req) : null;
      const { vreq, vres } = shim(req, res, raw);
      await HANDLERS[pathname](vreq, vres);
    } catch (err) {
      console.error('[beta]', pathname, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'beta harness error', code: 'harness_error', detail: String(err && err.message) }));
      }
    }
    return;
  }

  /* An unknown /api path must not fall through to the static tree. */
  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      error: 'this endpoint is not mounted on the beta server',
      code: 'not_mounted',
      mounted: Object.keys(HANDLERS)
    }));
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  const line = (a, b) => console.log('  ' + String(a).padEnd(34) + b);
  console.log('');
  console.log('  Humvance — INTERNAL BETA (local integration)');
  console.log('  ' + '─'.repeat(64));
  line('START HERE', `http://${HOST}:${PORT}/__beta/`);
  line('public site', `http://${HOST}:${PORT}/home`);
  line('start a request', `http://${HOST}:${PORT}/intake`);
  line('reviewer queue', `http://${HOST}:${PORT}/v2-intake-review`);
  line('management entrance', `http://${HOST}:${PORT}/manage`);
  line('practitioner workspace', `http://${HOST}:${PORT}/v2-workspace`);
  console.log('  ' + '─'.repeat(64));
  line('API', 'REAL handlers — intake, intake-review, case');
  line('store', 'memory · namespace beta-local · NOT persistent');
  line('auth', 'real HS256 verification, throwaway per-run secret');
  line('bind', HOST + ' only');
  console.log('');
  console.log('  Synthetic data only. Not Preview. Not Production.');
  console.log('  NOT CLEARED FOR REAL CUSTOMER DIAGNOSTIC USE.');
  console.log('');
});
