/* ===========================================================================
   Humvance — language, direction and mixed-direction text
   ---------------------------------------------------------------------------
   Arabic is the default. English is a first-class equivalent, not a fallback,
   and the English strings are written as English rather than translated word
   for word from the Arabic.

   THE RULE THAT MATTERS: switching language must never cost the visitor their
   answers or their place. That is achieved structurally — every screen renders
   from JavaScript state, so setLang() re-renders from the same state and the
   only thing that changes is the words. Anything typed but not yet in state is
   harvested into state first (see captureLiveFields).

   WHAT IS REMEMBERED: the language choice, in localStorage. Nothing else is
   persisted by this module. A page that wants to keep a draft does so itself,
   deliberately, and says so to the visitor.
   =========================================================================== */

(function (global) {
  'use strict';

  var KEY = 'hv_lang';
  var LANGS = ['ar', 'en'];
  var dict = { ar: {}, en: {} };
  var listeners = [];

  function readStored() {
    try {
      var v = localStorage.getItem(KEY);
      return LANGS.indexOf(v) !== -1 ? v : null;
    } catch (e) { return null; }
  }

  /* Honour an explicit choice; otherwise the browser's preference; otherwise
     Arabic, because this is a Saudi product and Arabic is the default. */
  function initialLang() {
    var stored = readStored();
    if (stored) return stored;
    try {
      var nav = (navigator.languages || [navigator.language || 'ar']).join(',').toLowerCase();
      if (/\ben\b|^en/.test(nav) && !/\bar\b/.test(nav)) return 'en';
    } catch (e) { /* ignore */ }
    return 'ar';
  }

  var lang = initialLang();

  function register(more) {
    if (more.ar) Object.assign(dict.ar, more.ar);
    if (more.en) Object.assign(dict.en, more.en);
    /* A copy bundle loads AFTER this module, so the shell elements translated
       by applyDocument have to be revisited once their keys exist. */
    if (document.body) applyDocument();
  }

  /** t('key') → string. Interpolates {name} from vars. A missing key returns the
      key itself and warns in the console: silent blanks hide real gaps. */
  function t(key, vars) {
    var s = dict[lang][key];
    if (s === undefined) {
      s = dict.ar[key] !== undefined ? dict.ar[key] : null;
      if (s === null) {
        if (global.console && console.warn) console.warn('[hv-i18n] missing key:', key, '(' + lang + ')');
        return key;
      }
    }
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return vars[k] !== undefined ? vars[k] : m;
      });
    }
    return s;
  }

  /** The other language — for the switch label. */
  /** Does a key exist in the current language? Lets a caller ask for optional
      copy (a choice description, say) without logging a missing-key warning. */
  function has(key) { return dict[lang][key] !== undefined || dict.ar[key] !== undefined; }

  /* ADDED 2026-09-18. `has()` answers "will `t(key)` produce something", and it
     says yes when only Arabic has the key, because Arabic is the source
     language and `t()` falls back to it. That is right for "is this string
     translated yet" and WRONG for "does THIS language use this variant": a
     caller choosing between plural forms asked `has('…few')`, got true from the
     Arabic dictionary, and rendered an Arabic sentence on an English screen.
     `hasOwn()` asks the narrower question and never falls back. */
  function hasOwn(key) { return dict[lang][key] !== undefined; }

  function other() { return lang === 'ar' ? 'en' : 'ar'; }
  function otherLabel() { return lang === 'ar' ? 'English' : 'العربية'; }

  function isAr() { return lang === 'ar'; }

  /**
   * Fields the visitor has typed into but whose values have not yet reached
   * state. Called before a re-render so a language switch never eats an answer.
   * Any element carrying data-hv-keep="<stateKey>" is harvested.
   */
  function captureLiveFields(target) {
    var out = {};
    var nodes = (target || document).querySelectorAll('[data-hv-keep]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var k = n.getAttribute('data-hv-keep');
      if (n.type === 'checkbox') out[k] = n.checked;
      else if (n.type === 'radio') { if (n.checked) out[k] = n.value; }
      else out[k] = n.value;
    }
    return out;
  }

  /**
   * applyDocument — the parts of the page that live OUTSIDE any screen's own
   * render: the document language and direction, and the handful of elements
   * that sit in the static HTML shell rather than in a rendered view.
   *
   * ADDED 2026-09-18. The skip link is in the shell of every page, so it was
   * written once, in Arabic, and stayed Arabic after a switch to English — the
   * first thing a keyboard or screen-reader user meets on the page, in the
   * wrong language. Anything carrying data-hv-t (text) or data-hv-t-aria
   * (accessible name) is now translated here, on load and on every switch.
   */
  function applyDocument() {
    var html = document.documentElement;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    if (document.body) document.body.setAttribute('data-lang', lang);

    var i, nodes = document.querySelectorAll('[data-hv-t]');
    for (i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-hv-t');
      if (has(k)) nodes[i].textContent = t(k);
    }
    nodes = document.querySelectorAll('[data-hv-t-aria]');
    for (i = 0; i < nodes.length; i++) {
      var ak = nodes[i].getAttribute('data-hv-t-aria');
      if (has(ak)) nodes[i].setAttribute('aria-label', t(ak));
    }
  }

  /**
   * setLang(next) — switch language, keep the screen and the answers.
   * Listeners registered with onChange() are responsible for re-rendering their
   * own screen from their own state; this module never touches page state.
   */
  function setLang(next) {
    if (LANGS.indexOf(next) === -1 || next === lang) return;
    lang = next;
    try { localStorage.setItem(KEY, lang); } catch (e) { /* private mode: fine */ }
    applyDocument();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lang); } catch (e) { if (console && console.error) console.error(e); }
    }
  }

  function onChange(fn) { listeners.push(fn); }

  /* ── Mixed-direction formatting ─────────────────────────────────────────────
     An Arabic sentence carrying a Latin reference, a count, a date or an email
     will reorder it unless the run is isolated. These helpers do the isolating,
     and they are the only correct way to put such a value on an Arabic page. */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** A Latin identifier (HVS-…, org_…, case_…) inside Arabic text. */
  function code(v) { return '<bdi class="hv-code">' + esc(v) + '</bdi>'; }
  /** A number, with the digits the current language actually reads best. */
  function num(v) {
    if (v === null || v === undefined || v === '') return '';
    var n = Number(v);
    if (!isFinite(n)) return '<bdi class="hv-num">' + esc(v) + '</bdi>';
    return '<bdi class="hv-num">' + n.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US') + '</bdi>';
  }
  /** A range such as 51–200 — the case that used to render backwards. */
  function range(a, b) { return '<bdi class="hv-num">' + esc(a) + '–' + esc(b) + '</bdi>'; }
  function mail(v) { return '<bdi class="hv-mail">' + esc(v) + '</bdi>'; }

  /** A date. Gregorian, spelled out, because numeric dates are ambiguous. */
  function date(value, opts) {
    if (!value) return '';
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '<bdi class="hv-ltr">' + esc(value) + '</bdi>';
    var o = Object.assign({ year: 'numeric', month: 'long', day: 'numeric' }, opts || {});
    try {
      return '<bdi>' + esc(d.toLocaleDateString(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', o)) + '</bdi>';
    } catch (e) {
      return '<bdi class="hv-ltr">' + esc(d.toISOString().slice(0, 10)) + '</bdi>';
    }
  }
  function dateTime(value) { return date(value, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

  /* ── Errors ────────────────────────────────────────────────────────────────
     The visitor gets a sentence they can act on. The technical fact is kept —
     on the object and in the console — because throwing it away is how a
     support conversation becomes guesswork. */

  function friendlyError(err, fallbackKey) {
    var technical = (err && (err.code || err.message)) || 'unknown_error';
    var known = {
      unknown_field:     'err.unknownField',
      field_too_long:    'err.tooLong',
      consent_required:  'err.consentRequired',
      malformed_body:    'err.malformed',
      rate_limited:      'err.rateLimited',
      payload_too_large: 'err.tooLarge',
      invalid_state:     'err.invalidState',
      store_misconfigured: 'err.serviceNotReady',
      unauthorized:      'err.unauthorized'
    };
    var key = known[err && err.code] || fallbackKey || 'err.generic';
    if (global.console && console.warn) console.warn('[humvance]', technical, err);
    return { message: t(key), technical: technical, raw: err };
  }

  applyDocumentWhenReady();
  function applyDocumentWhenReady() {
    if (document.body) applyDocument();
    else document.addEventListener('DOMContentLoaded', applyDocument);
  }

  global.HV = global.HV || {};
  global.HV.i18n = {
    get lang() { return lang; },
    LANGS: LANGS,
    register: register, t: t, has: has, hasOwn: hasOwn, setLang: setLang, onChange: onChange,
    other: other, otherLabel: otherLabel, isAr: isAr,
    captureLiveFields: captureLiveFields,
    esc: esc, code: code, num: num, range: range, mail: mail,
    date: date, dateTime: dateTime, friendlyError: friendlyError
  };
  /* Convenience aliases used throughout the pages. */
  global.t = t;
  global.esc = esc;
})(window);
