'use strict';
// Humvance V1 — the five auth endpoints, in one deployed Serverless Function.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
//
// This project is on the Vercel Hobby plan, which allows at most 12 Serverless
// Functions per deployment. Every non-underscore file under `api/` becomes one:
// the READY `v2-case-spine` deployment at 88a866c reports exactly 12, from a tree
// of 22 files, which is how we know the ten `api/v2/_*.js` modules are excluded
// and the twelve handlers are not.
//
// Sprint 1 adds two handlers (`api/v2/intake.js`, `api/v2/intake-review.js`),
// taking the count to 14, and the deployment for 295635b failed on exactly that.
//
// Packaging the five `api/auth/*` handlers as one function takes the count to 10.
// It is a PACKAGING change, not a behaviour change: the five public URLs are
// unchanged, and each handler body below is the Production code verbatim —
// same method gate, same status codes, same Arabic strings, same catch
// semantics. Nothing is refactored, unified or tidied, because every difference
// would be a behaviour risk bought for no benefit. `tests/v1/` proves the
// equivalence against frozen copies of the Production files.
//
// WHAT THIS CHANGES ABOUT OUR GUARANTEES
//
// Until now every V1 file was byte-identical to Production. That is no longer
// true of `api/auth/*`, deliberately. The weaker claim that replaces it:
// auth packaging differs from the Production baseline; local behavioural
// equivalence is tested; real Preview routing remains unverified until deployed.
// ─────────────────────────────────────────────────────────────────────────────

const { hashPassword, signJWT, verifyJWT, getToken, setJSON } = require('../_utils');
const { kv } = require('@vercel/kv');

// ── The five handlers, lifted verbatim from Production ───────────────────────

/** api/auth/login.js — Production baseline sha256 411e9834…502e */
async function login(req, res) {
  setJSON(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'كلمة المرور مطلوبة' });
    }

    const storedHash = await kv.get('admin:password_hash');
    if (!storedHash) {
      return res.status(400).json({ error: 'لم يتم إعداد حساب الإدارة بعد' });
    }

    const inputHash = hashPassword(password);
    if (inputHash !== storedHash) {
      return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    }

    const token = signJWT({ role: 'admin' });
    return res.status(200).json({ token });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ error: 'خطأ في تسجيل الدخول' });
  }
}

/** api/auth/setup.js — Production baseline sha256 0ab8e2a3…c176c */
async function setup(req, res) {
  setJSON(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const existing = await kv.get('admin:password_hash');
    if (existing) {
      return res.status(409).json({ error: 'الإعداد مكتمل بالفعل. الرجاء تسجيل الدخول.' });
    }

    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const hash = hashPassword(password);
    await kv.set('admin:password_hash', hash);

    const token = signJWT({ role: 'admin' });
    return res.status(200).json({ token });
  } catch (err) {
    console.error('[auth/setup]', err.message);
    return res.status(500).json({ error: 'فشل الإعداد. تحقق من إعداد قاعدة البيانات.' });
  }
}

/**
 * api/auth/status.js — Production baseline sha256 d99d12ca…d15c
 *
 * Two behaviours here are load-bearing and easy to lose in a rewrite:
 * a portal token (role:'client') is a validly signed JWT and must still read as
 * NOT authenticated (Hotfix 00), and a KV failure returns 200 with both flags
 * false — not 500.
 */
async function status(req, res) {
  setJSON(res);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const hash = await kv.get('admin:password_hash');
    const setupDone = Boolean(hash);

    // Is the caller authenticated FOR THE ADMIN APPLICATION?
    // A portal token (role:'client') is a validly signed JWT but must never
    // make the Admin SPA believe it is logged in.
    const token = getToken(req);
    const payload = token ? verifyJWT(token) : null;
    const authenticated = Boolean(payload) && payload.role === 'admin';

    return res.status(200).json({ setupDone, authenticated });
  } catch (err) {
    console.error('[auth/status]', err.message);
    return res.status(200).json({ setupDone: false, authenticated: false });
  }
}

/**
 * api/auth/forgot.js — Production baseline sha256 54bef215…b97c
 *
 * The early `return` on a non-matching address is anti-enumeration: it answers
 * 200 { sent: true } without touching storage, so a stranger cannot learn which
 * address is the admin one by watching for a difference.
 */
async function forgot(req, res) {
  setJSON(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminEmail = process.env.ADMIN_EMAIL || 'info@humvance.com';
  const resendKey = process.env.RESEND_API_KEY;

  const { email } = req.body || {};
  if (!email || email.trim().toLowerCase() !== adminEmail.toLowerCase()) {
    // Always return success to avoid email enumeration
    return res.status(200).json({ sent: true });
  }

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));

  try {
    // Store OTP in KV with 15 min expiry
    await kv.set('admin:reset_otp', otp, { ex: 900 });

    if (resendKey) {
      // Send email via Resend
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `Humvance <noreply@humvance.com>`,
          to: [adminEmail],
          subject: 'رمز إعادة تعيين كلمة المرور — Humvance',
          html: `
            <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #e5e7eb">
              <h2 style="margin:0 0 16px;font-size:20px">إعادة تعيين كلمة المرور</h2>
              <p style="color:#6b7280;margin:0 0 24px">استخدم الرمز التالي لإعادة تعيين كلمة مرور لوحة الإدارة:</p>
              <div style="background:#f9fafb;border:2px solid #111;border-radius:8px;padding:24px;text-align:center;font-size:36px;font-weight:900;letter-spacing:8px;font-family:monospace">${otp}</div>
              <p style="color:#9ca3af;font-size:13px;margin:20px 0 0;text-align:center">صالح لمدة 15 دقيقة فقط. إذا لم تطلب هذا، تجاهل الرسالة.</p>
            </div>
          `
        })
      });

      if (!emailRes.ok) {
        const err = await emailRes.text();
        console.error('[forgot] Resend error:', err);
      }
    } else {
      console.log('[forgot] OTP (no email service configured):', otp);
    }

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('[forgot]', err.message);
    return res.status(500).json({ error: 'فشل إرسال رمز إعادة الضبط' });
  }
}

/**
 * api/auth/reset.js — Production baseline sha256 96f6535c…cdeb
 *
 * The OTP is deleted before the new hash is written, so a code cannot be
 * replayed even if the write that follows it fails.
 */
async function reset(req, res) {
  setJSON(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { otp, newPassword } = req.body || {};

  if (!otp || !newPassword) {
    return res.status(400).json({ error: 'الرمز وكلمة المرور مطلوبان' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }

  try {
    const storedOtp = await kv.get('admin:reset_otp');

    if (!storedOtp || storedOtp !== otp) {
      return res.status(401).json({ error: 'الرمز غير صحيح أو منتهي الصلاحية' });
    }

    // Delete OTP so it can't be reused
    await kv.del('admin:reset_otp');

    const hash = hashPassword(newPassword);
    await kv.set('admin:password_hash', hash);

    const token = signJWT({ role: 'admin' });
    return res.status(200).json({ success: true, token });
  } catch (err) {
    console.error('[reset]', err.message);
    return res.status(500).json({ error: 'فشل إعادة تعيين كلمة المرور' });
  }
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
//
// THE PUBLIC URL IS THE ONLY SOURCE OF THE ACTION.
//
// There are exactly five reachable spellings:
//
//     /api/auth/login   /api/auth/setup   /api/auth/status
//     /api/auth/forgot  /api/auth/reset
//
// Everything else is 404, including the bare endpoint. `/api/auth?action=login`
// and `/api/auth/?action=login` do NOT reach login: the action comes from the
// path and only from the path, and when the path names no action there is
// nothing to fall back to.
//
// "The path" means the WHOLE path, matched against `/api/auth/<action>` with at
// most one trailing slash — not merely its last segment. `/other/login`,
// `/login`, `/api/other/status`, `/api/auth/v2/login` and `//api/auth/login` are
// all refused, because each of them is a different URL that happens to end in an
// action name.
//
// An earlier draft of this file also accepted `?action=` on the bare path, so
// that a rewrite-based routing fallback would work without a code change. That
// was removed deliberately (2026-09-18). It bought a contingency that may never
// be needed, and paid for it with a sixth reachable spelling of the auth surface
// that no WAF rule, rate limit, log filter or allow-list keyed on the five
// canonical paths would ever see. A caller-controlled query parameter is not a
// routing signal, and inventing one to keep a hypothetical option open is the
// wrong trade.
//
// The query string is still READ, but only ever to refuse: if it carries an
// `action` that disagrees with the path, or one that is repeated (an array) or
// otherwise not a string, the request is refused rather than resolved. A
// dynamic-segment runtime that mirrors the path parameter into `req.query` is
// the one case where it agrees, and that is the only case that passes.
//
// ── What could not be established locally ────────────────────────────────────
//
// We have no Vercel runtime here, so the following is UNVERIFIED and is not
// assumed anywhere in this file:
//
//   * how Vercel represents a dynamic path parameter versus a caller-supplied
//     query parameter of the same name, and which wins if they differ;
//   * whether `req.url` inside the function is the original request path
//     (`/api/auth/login`) or something else — the unresolved template
//     (`/api/auth/[action]`), or a rewrite destination.
//
// This dispatcher requires the first of those: that `req.url` carries the
// resolved path. If a deployment shows all five URLs returning 404, that
// assumption is what failed, and the fix is a deliberate code change made with
// the real representation in hand — NOT a fallback invented in advance from
// caller-controlled input. The literal `[action]` template is therefore refused
// like any other unknown segment, which is the fail-closed answer.
//
// Consequence, recorded honestly: the rewrite alternative sketched in
// ENGINEERING-STATE §13 (`dest: "/api/auth/[action]?action=$1"`) will NOT work
// against this dispatcher, because the rewritten path names no action. Routing
// is no longer a configuration-only escape hatch. That is the cost of closing
// the query-only path, and it was accepted knowingly.

const ACTIONS = Object.assign(Object.create(null), { login, setup, status, forgot, reset });
const ACTION_NAMES = Object.freeze(['login', 'setup', 'status', 'forgot', 'reset']);

function isKnownAction(v) {
  return typeof v === 'string' && ACTION_NAMES.indexOf(v) !== -1;
}

/**
 * The one canonical shape a Humvance auth URL may have:
 *
 *     /api/auth/<action>          with at most a single trailing slash
 *
 * CORRECTED 2026-09-18. The first version of this took the LAST path segment,
 * which is not the same thing at all: it accepted `/other/login`, `/login`,
 * `/api/other/status`, `/api/auth/v2/login` and `//api/auth/login`, because each
 * of those ends in an action name. Vercel should never route those here, but
 * "the platform probably will not send that" is a hope, not a check, and the
 * whole point of this dispatcher is that the URL is the authority. It now
 * matches the full path or refuses.
 *
 * Percent-encoding is deliberately NOT decoded: `/api/auth/%6Cogin` is not
 * `/api/auth/login`, and treating it as such would add a spelling nobody wrote.
 */
const CANONICAL_AUTH_PATH = /^\/api\/auth\/([^/]+)\/?$/;

/** The path portion of the request, with query and fragment removed. */
function requestPath(req) {
  const raw = typeof req.url === 'string' ? req.url : '';
  return raw.split('?')[0].split('#')[0];
}

/**
 * Returns { action } when the PATH is one of the five canonical URLs, or
 * { refuse } with a reason. Never throws, and never reads a property off a
 * caller-controlled prototype.
 *
 * ASSUMPTION, recorded because it is not verifiable here: that `req.url` inside
 * the function is the original request path including the `/api` prefix. That is
 * what a Vercel Node function is expected to receive. If a deployment shows the
 * five URLs 404ing, this is ONE candidate cause among several — a routing
 * failure, a build that did not produce the function, and a platform-level
 * rewrite would all look identical from outside. Investigate before concluding.
 */
function resolveAction(req) {
  const m = CANONICAL_AUTH_PATH.exec(requestPath(req));

  // Not a Humvance auth URL at all: a bare `/api/auth`, a nested or prefixed
  // path, a double slash, anything outside `/api/auth/`.
  if (!m) return { refuse: 'unknown_path' };

  const seg = m[1];

  // Inside the right path, but not one of the five: an unknown name, a prototype
  // name, the unresolved `[action]` template, a percent-encoded or
  // differently-cased spelling.
  if (!isKnownAction(seg)) return { refuse: 'unknown_action' };

  const q = req.query ? req.query.action : undefined;
  if (q !== undefined) {
    // A repeated `?action=` yields an array, and an object is never a valid
    // action. Either means something upstream is not what we think it is.
    if (typeof q !== 'string') return { refuse: 'ambiguous_action' };
    if (q !== seg) return { refuse: 'action_mismatch' };
  }

  return { action: seg };
}

module.exports = async function handler(req, res) {
  const resolved = resolveAction(req);
  if (!resolved.action) {
    setJSON(res);
    return res.status(404).json({ error: 'Not found' });
  }
  return ACTIONS[resolved.action](req, res);
};

// Exported for the equivalence and dispatch tests. Not part of the HTTP surface.
module.exports.__actions = { login, setup, status, forgot, reset };
module.exports.__resolveAction = resolveAction;
module.exports.__ACTION_NAMES = ACTION_NAMES;
