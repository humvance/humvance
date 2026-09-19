/* ===========================================================================
   Humvance — shared interface parts
   ---------------------------------------------------------------------------
   The header, footer, status pills, notes, toasts and demo indicator that every
   Humvance screen shares. Public site, client workspace and administration all
   draw from here, which is what keeps them recognisably one product rather than
   three applications that happen to share a logo.

   No framework, no build step, no dependency — the same plain-JS approach the
   existing pages already use, so this drops into the application as it stands.
   =========================================================================== */

(function (global) {
  'use strict';

  var I = global.HV.i18n;
  var Icons = global.HVIcons;
  var esc = I.esc;

  /* ── Navigation model ──────────────────────────────────────────────────────
     ONE navigation structure for the whole product. Adding a screen means adding
     it here, not inventing a second menu somewhere else. */

  var PUBLIC_NAV = [
    { href: '/',             key: 'nav.home' },
    { href: '/services',     key: 'nav.services' },
    { href: '/how-we-work',  key: 'nav.how' },
    { href: '/intake',       key: 'nav.start', cta: true }
  ];

  /* CORRECTED 2026-09-18. The navigation used to link "Track your request" to
     /portal for everyone. /portal is the LEGACY V1 client portal: it signs in
     against `client:<ref>` records, and a visitor who just used the new intake
     holds an HVS- reference that it cannot recognise. Sending them there is
     sending them to a login that cannot succeed.

     New applicants now go to /request-status, which tells them the truth about
     what happens next. The legacy portal keeps its route, is reached from the
     footer and from /request-status, and is labelled as the existing-client
     entrance in both places. No client data was migrated. */

  function currentPath() {
    var p = location.pathname.replace(/\/+$/, '');
    return p === '' ? '/' : p;
  }

  function logo(opts) {
    opts = opts || {};
    return '<a class="hv-logo" href="' + (opts.href || '/') + '" aria-label="Humvance">' +
      '<span class="hv-logo-mark">' + Icons.LOGO_MARK + '</span>' +
      '<span style="display:flex;flex-direction:column">' +
        '<span class="hv-logo-name">Humvance</span>' +
        (opts.sub === false ? '' : '<span class="hv-logo-sub">humvance.com</span>') +
      '</span></a>';
  }

  function langButton() {
    return '<button class="hv-lang" data-hv-lang-toggle type="button" ' +
      'aria-label="' + esc(I.t('nav.switchLang')) + '">' +
      Icons.icon('globe', { size: 14 }) + '<span>' + esc(I.otherLabel()) + '</span></button>';
  }

  /* ── The administration entrance ───────────────────────────────────────────
     ADDED 2026-09-18, newly authorized. Until now the only way to reach the
     internal screens was to know and type a URL, which is not a navigation
     design — it is a habit one person has and nobody else can acquire.

     It is deliberately NOT the same thing as "After you send a request":
     that is for a client tracking their own submission, this is for the people
     who run Humvance, and collapsing the two would invite clients into a login
     that is not theirs. Separate link, separate label, separate icon.

     It carries no counts, no references and no record details. A public header
     is served to strangers, and a pending-request number is information about
     the business that a stranger has not been given.

     `/manage` is the management landing. Reaching it without a session shows
     the sign-in route; it never shows records. The server decides that, not
     this link — hiding a link is not a security control. */
  function adminEntry(opts) {
    opts = opts || {};
    return '<a class="hv-admin-entry' + (opts.cls ? ' ' + opts.cls : '') + '" href="/manage"' +
      ' aria-label="' + esc(I.t('nav.adminAria')) + '">' +
      '<span class="hv-admin-entry-ico">' + Icons.icon('adminEntry', { size: 17 }) + '</span>' +
      '<span>' + esc(I.t('nav.admin')) + '</span></a>';
  }

  /** The public site header. Same markup on every marketing page. */
  function siteHeader() {
    var here = currentPath();
    var links = PUBLIC_NAV.map(function (n) {
      var active = (n.href === '/' ? here === '/' : here.indexOf(n.href) === 0);
      if (n.cta) {
        return '<a class="hv-btn hv-btn-primary hv-btn-sm" href="' + n.href + '">' + esc(I.t(n.key)) + '</a>';
      }
      return '<a class="hv-nav-link" href="' + n.href + '"' + (active ? ' aria-current="page"' : '') + '>' +
        esc(I.t(n.key)) + '</a>';
    }).join('');

    var mobileLinks = PUBLIC_NAV.map(function (n) {
      var active = (n.href === '/' ? here === '/' : here.indexOf(n.href) === 0);
      return '<a class="hv-nav-link" href="' + n.href + '"' + (active ? ' aria-current="page"' : '') + '>' +
        esc(I.t(n.key)) + '</a>';
    }).join('');

    return '<header class="hv-header" data-hv-header>' +
      '<div class="hv-container">' +
        '<div class="hv-header-inner">' +
          logo() +
          '<nav class="hv-nav hv-nav-desktop" aria-label="' + esc(I.t('nav.main')) + '">' +
            links +
            '<a class="hv-nav-link" href="/request-status">' + esc(I.t('nav.track')) + '</a>' +
            adminEntry() +
            langButton() +
          '</nav>' +
          '<div class="hv-row" style="gap:6px">' +
            '<span class="hv-nav-desktop hv-hidden"></span>' +
            '<button class="hv-btn hv-btn-ghost hv-burger" type="button" data-hv-burger ' +
              'aria-expanded="false" aria-controls="hv-mobile-nav" aria-label="' + esc(I.t('nav.menu')) + '">' +
              Icons.icon('menu') + '</button>' +
          '</div>' +
        '</div>' +
        '<nav class="hv-mobile-nav" id="hv-mobile-nav" aria-label="' + esc(I.t('nav.main')) + '">' +
          mobileLinks +
          '<a class="hv-nav-link" href="/request-status">' + esc(I.t('nav.track')) + '</a>' +
          /* Below a rule, at the end: it belongs to a different audience from
             everything above it, and the separation should be visible as well
             as described. */
          '<div class="hv-mobile-admin">' + adminEntry({ cls: 'hv-admin-entry-block' }) + '</div>' +
          '<div style="padding-top:8px">' + langButton() + '</div>' +
        '</nav>' +
      '</div></header>';
  }

  /** The shared footer. Honest: no invented offices, numbers or credentials. */
  function siteFooter() {
    var year = new Date().getFullYear();
    return '<footer class="hv-footer"><div class="hv-container">' +
      '<div class="hv-footer-grid">' +
        '<div>' + logo({ sub: false }) +
          '<p class="hv-sm hv-muted" style="margin-top:12px;max-width:38ch">' + esc(I.t('footer.blurb')) + '</p>' +
        '</div>' +
        '<div>' +
          '<div class="hv-footer-title">' + esc(I.t('footer.product')) + '</div>' +
          '<a class="hv-footer-link" href="/services">' + esc(I.t('nav.services')) + '</a>' +
          '<a class="hv-footer-link" href="/how-we-work">' + esc(I.t('nav.how')) + '</a>' +
          '<a class="hv-footer-link" href="/intake">' + esc(I.t('nav.start')) + '</a>' +
          '<a class="hv-footer-link" href="/request-status">' + esc(I.t('nav.track')) + '</a>' +
          '<a class="hv-footer-link" href="/portal">' + esc(I.t('nav.clientLogin')) + '</a>' +
        '</div>' +
        '<div>' +
          '<div class="hv-footer-title">' + esc(I.t('footer.contact')) + '</div>' +
          '<a class="hv-footer-link" href="mailto:info@humvance.com">' + I.mail('info@humvance.com') + '</a>' +
          '<a class="hv-footer-link" href="https://humvance.com">' + I.mail('humvance.com') + '</a>' +
        '</div>' +
      '</div>' +
      '<div class="hv-divider" style="margin:32px 0 20px"></div>' +
      '<div class="hv-row-between hv-xs hv-muted">' +
        /* A year is not a quantity: no thousands separator. */
        '<span>© <bdi class="hv-num">' + year + '</bdi> Humvance. ' + esc(I.t('footer.rights')) + '</span>' +
        '<span>' + esc(I.t('footer.privacyLine')) + '</span>' +
      '</div>' +
      '</div></footer>';
  }

  /* ── Small parts ─────────────────────────────────────────────────────────── */

  /** Epistemic pill. `kind` is one of claim|evidence|finding|approved|conflict|human|neutral. */
  function pill(kind, label, title) {
    return '<span class="hv-pill hv-pill-' + kind + '"' +
      (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + '</span>';
  }

  function note(kind, html, iconName) {
    var ic = iconName || (kind === 'conflict' ? 'alert' : kind === 'caution' ? 'alert' : 'info');
    return '<div class="hv-note hv-note-' + kind + '">' + Icons.icon(ic, { size: 18 }) +
      '<div>' + html + '</div></div>';
  }

  function empty(iconName, title, body) {
    return '<div class="hv-empty">' + Icons.icon(iconName || 'inbox', { size: 34 }) +
      '<div class="hv-empty-title">' + esc(title) + '</div>' +
      (body ? '<p>' + esc(body) + '</p>' : '') + '</div>';
  }

  function fieldError(msg) {
    return '<div class="hv-error" role="alert">' + Icons.icon('alert', { size: 14 }) + '<span>' + esc(msg) + '</span></div>';
  }

  /* Toasts — announced politely, dismissed on their own. */
  function toast(message, ms) {
    var host = document.getElementById('hv-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'hv-toasts';
      host.className = 'hv-toasts';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.className = 'hv-toast';
    el.innerHTML = Icons.icon('check', { size: 16 }) + '<span>' + esc(message) + '</span>';
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, ms || 4200);
  }

  /* ── Demo mode ─────────────────────────────────────────────────────────────
     Off unless the page is being served from a local machine AND the visitor
     asked for it. It never turns itself on for a deployed visitor, and the bar
     below is permanent while it is on, because a fictional screen that looks
     real is worse than no screen at all. */

  function isLocalHost() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '' || /\.local$/.test(h);
  }

  function demoRequested() {
    try {
      if (/(^|[?&])demo=1(&|$)/.test(location.search)) return true;
      return sessionStorage.getItem('hv_demo') === '1';
    } catch (e) { return false; }
  }

  var DEMO = isLocalHost() && demoRequested();
  if (DEMO) { try { sessionStorage.setItem('hv_demo', '1'); } catch (e) {} }

  function demoBar() {
    if (!DEMO) return '';
    return '<div class="hv-demo-bar" role="note">' +
      Icons.icon('alert', { size: 15 }) +
      '<span>' + esc(I.t('demo.bar')) + '</span>' +
      '<a href="?demo=0" data-hv-demo-off>' + esc(I.t('demo.leave')) + '</a>' +
      '</div>';
  }
  function demoTag() {
    return '<span class="hv-demo-tag">' + Icons.icon('alert', { size: 11 }) + esc(I.t('demo.tag')) + '</span>';
  }

  /** Guard every write path in demo mode, so a fixture can never reach a server. */
  function demoGuard(what) {
    global.console && console.info('[humvance demo] blocked write:', what);
    toast(I.t('demo.blocked'));
    return Promise.resolve({ demo: true, blocked: what });
  }

  /* ── Wiring ──────────────────────────────────────────────────────────────── */

  function wire(root) {
    root = root || document;

    root.querySelectorAll('[data-hv-lang-toggle]').forEach(function (b) {
      if (b.__hvWired) return; b.__hvWired = true;
      b.addEventListener('click', function () { I.setLang(I.other()); });
    });

    root.querySelectorAll('[data-hv-burger]').forEach(function (b) {
      if (b.__hvWired) return; b.__hvWired = true;
      b.addEventListener('click', function () {
        var nav = document.getElementById('hv-mobile-nav');
        if (!nav) return;
        var open = nav.getAttribute('data-open') === 'true';
        nav.setAttribute('data-open', open ? 'false' : 'true');
        b.setAttribute('aria-expanded', open ? 'false' : 'true');
        b.innerHTML = Icons.icon(open ? 'menu' : 'close');
        /* The stylesheet makes the header opaque while the menu is open, via
           :has(). This mirrors the same state onto the header itself so the
           rule also applies where :has() is unsupported — a translucent open
           menu is a legibility problem, not a decoration. */
        var hd = document.querySelector('[data-hv-header]');
        if (hd) hd.setAttribute('data-menu-open', open ? 'false' : 'true');
      });
    });

    root.querySelectorAll('[data-hv-demo-off]').forEach(function (a) {
      if (a.__hvWired) return; a.__hvWired = true;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        try { sessionStorage.removeItem('hv_demo'); } catch (err) {}
        location.href = location.pathname;
      });
    });

    var header = root.querySelector('[data-hv-header]');
    if (header && !header.__hvScroll) {
      header.__hvScroll = true;
      var onScroll = function () { header.setAttribute('data-scrolled', String(window.scrollY > 8)); };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    /* Live character counters, used by the intake form. */
    root.querySelectorAll('[data-hv-count-for]').forEach(function (c) {
      if (c.__hvWired) return; c.__hvWired = true;
      var input = document.getElementById(c.getAttribute('data-hv-count-for'));
      if (!input) return;
      var max = Number(c.getAttribute('data-hv-max')) || 0;
      var upd = function () {
        var n = input.value.length;
        /* "1,200 / 5,000" is a Latin-digit run. Without isolation the bidi
           algorithm renders it as "5,000 / 1,200" on an Arabic page. */
        c.innerHTML = '<bdi class="hv-num">' + n.toLocaleString('en-US') +
          ' / ' + max.toLocaleString('en-US') + '</bdi>';
        c.setAttribute('data-over', String(max > 0 && n > max));
      };
      input.addEventListener('input', upd);
      upd();
    });
  }

  /* ── Return links for the internal screens ────────────────────────────────
     ADDED 2026-09-19. The administration entrance built on 2026-09-18 worked in
     one direction only. `/manage` sent people to request review and to the
     workspace, and neither screen offered a way back: the review header's one
     link went to `/admin` — the LEGACY password screen — and the workspace could
     only return to review. So the round trip ended at the old internal page,
     which is the screen the whole entrance existed to replace. An independent
     probe clicked that link and landed on the legacy password field.

     `crumb()` is the one component both screens now use, so they cannot drift
     apart again. It carries an icon and a text label (never an icon alone), a
     44px hit area, and an accessible name that says where it goes rather than
     repeating the visible word. `data-hv-guard` lets a page intercept the click
     when leaving would discard an unsaved draft — the link still navigates on
     its own if no page wires a guard, because a return path that silently does
     nothing is worse than one that warns late. */
  function crumb(o) {
    return '<a class="hv-crumb' + (o.cls ? ' ' + o.cls : '') + '" href="' + o.href + '"' +
      (o.aria ? ' aria-label="' + esc(o.aria) + '"' : '') +
      (o.guard ? ' data-hv-guard="' + esc(o.guard) + '"' : '') + '>' +
      (o.icon ? '<span class="hv-crumb-ico">' + Icons.icon(o.icon, { size: 16 }) + '</span>' : '') +
      '<span>' + esc(o.label) + '</span></a>';
  }

  /** The management entrance, as reached FROM an internal screen. */
  function manageReturn(o) {
    o = o || {};
    return crumb({
      href: '/manage', icon: 'overview',
      label: I.t('nav.manage'), aria: I.t('nav.manageAria'),
      guard: o.guard, cls: o.cls
    });
  }

  global.HV.ui = {
    PUBLIC_NAV: PUBLIC_NAV,
    logo: logo, siteHeader: siteHeader, siteFooter: siteFooter, langButton: langButton,
    adminEntry: adminEntry, crumb: crumb, manageReturn: manageReturn,
    pill: pill, note: note, empty: empty, fieldError: fieldError, toast: toast,
    demoBar: demoBar, demoTag: demoTag, demoGuard: demoGuard, isDemo: function () { return DEMO; },
    isLocalHost: isLocalHost, wire: wire, currentPath: currentPath
  };
})(window);
