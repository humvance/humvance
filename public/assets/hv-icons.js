/* ===========================================================================
   Humvance — icon family
   ---------------------------------------------------------------------------
   One family, drawn to one specification, so the interface never looks like it
   was assembled from three icon sets:

     24×24 box · 1.6 stroke · round caps and joins · no fills · currentColor

   No emoji anywhere in the interface. Emoji are a different typeface with a
   different voice, they render differently on every platform, and they read as
   informal in a document a client may forward to their board.

   DIRECTIONALITY. Arrows and chevrons point somewhere, so they must flip when
   the writing direction flips. Everything else — a clock, a person, a document —
   must not, because a mirrored clock is simply a wrong clock. Icons listed in
   DIRECTIONAL below are flipped by CSS through the [data-hv-dir-icon] hook.
   =========================================================================== */

(function (global) {
  'use strict';

  var P = {
    /* navigation and direction (mirrored in RTL) */
    arrow:      '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    arrowBack:  '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
    chevron:    '<path d="m9 6 6 6-6 6"/>',
    external:   '<path d="M14 5h5v5"/><path d="M19 5 10 14"/><path d="M19 14v4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18V7a1.5 1.5 0 0 1 1.5-1.5H10"/>',

    /* generic UI */
    chevronDown:'<path d="m6 9 6 6 6-6"/>',
    close:      '<path d="M6 6 18 18"/><path d="M18 6 6 18"/>',
    menu:       '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    check:      '<path d="m4.5 12.5 5 5 10-11"/>',
    plus:       '<path d="M12 5v14"/><path d="M5 12h14"/>',
    minus:      '<path d="M5 12h14"/>',
    edit:       '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14.5 6.5 3 3"/>',
    globe:      '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.2 2.4 3.3 5.4 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.4-3.3-8.5S9.8 5.9 12 3.5Z"/>',
    search:     '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    filter:     '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',

    /* status and meaning */
    info:       '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    alert:      '<path d="M12 4.5 21 19.5H3Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    shield:     '<path d="M12 3.5 19 6v5.5c0 4-2.9 7.4-7 8.9-4.1-1.5-7-4.9-7-8.9V6Z"/><path d="m9 12 2 2 4-4"/>',
    lock:       '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    eye:        '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    clock:      '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    calendar:   '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16"/><path d="M8.5 3.5V7"/><path d="M15.5 3.5V7"/>',

    /* the work */
    people:     '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1"/><path d="M17.5 14.9c1.9.6 3.2 2.3 3.2 4.6"/>',
    structure:  '<rect x="9" y="3.5" width="6" height="5" rx="1.2"/><rect x="3" y="15.5" width="6" height="5" rx="1.2"/><rect x="15" y="15.5" width="6" height="5" rx="1.2"/><path d="M12 8.5v3.5"/><path d="M6 15.5V12h12v3.5"/>',
    role:       '<circle cx="12" cy="7.5" r="3.3"/><path d="M6 20.5c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M15.5 3.5h5"/><path d="M18 1v5"/>',
    handoff:    '<path d="M4 9h9.5a3.5 3.5 0 0 1 0 7H8"/><path d="m10.5 13-2.5 3 2.5 3"/><path d="M4 5.5h6"/>',
    process:    '<circle cx="6" cy="6.5" r="2.5"/><circle cx="18" cy="17.5" r="2.5"/><path d="M6 9v5a3.5 3.5 0 0 0 3.5 3.5h6"/>',
    growth:     '<path d="M4 19.5h16"/><path d="M4 16l4.5-5 3.5 3 7-8"/><path d="M14 6.5h5v5"/>',
    compass:    '<circle cx="12" cy="12" r="8.5"/><path d="m15 9-1.8 4.2L9 15l1.8-4.2Z"/>',
    target:     '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6"/>',

    /* evidence and record-keeping */
    document:   '<path d="M6 3.5h7l5 5v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20.5v-15A1.5 1.5 0 0 1 6.5 3.5Z"/><path d="M13 3.5v5h5"/>',
    evidence:   '<path d="M6 3.5h7l5 5v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20.5v-15A1.5 1.5 0 0 1 6.5 3.5Z"/><path d="M13 3.5v5h5"/><path d="m8.5 15 2 2 4.5-4.5"/>',
    quote:      '<path d="M9.5 6.5C7 8 5.5 10.2 5.5 13v4.5h5V13H8c0-2 .6-3.6 2.4-4.8Z"/><path d="M18 6.5c-2.5 1.5-4 3.7-4 6.5v4.5h5V13h-2.5c0-2 .6-3.6 2.4-4.8Z"/>',
    scale:      '<path d="M12 4v16"/><path d="M6 8h12"/><path d="m6 8-2.5 5.5h5Z"/><path d="m18 8-2.5 5.5h5Z"/><path d="M8 20.5h8"/>',
    layers:     '<path d="m12 3.5 8.5 4.5L12 12.5 3.5 8Z"/><path d="m3.5 13 8.5 4.5 8.5-4.5"/>',
    branch:     '<circle cx="7" cy="6" r="2.2"/><circle cx="7" cy="18" r="2.2"/><circle cx="17" cy="12" r="2.2"/><path d="M7 8.2v7.6"/><path d="M9.2 6.6c3.5.6 5.3 2.3 5.7 5"/>',
    history:    '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V9h4.5"/><path d="M12 8v4.3l3 1.7"/>',

    /* ── The Humvance journey, drawn to the same specification ──────────────
       One icon per stage of the work, because the stages are the product and a
       borrowed icon set has no word for any of them. Nothing here is medical:
       the subjects are people, accounts, sources and decisions.

         understand    someone describes a situation and is listened to
         investigate   a source is examined rather than accepted
         alternatives  one observation, several explanations still standing
         conflict      two accounts that cannot both be right
         humanReview   a person, not a process, signs
         approved      a decision on the record, bound to what was read
         agreedAction  two parties holding the same commitment
         followup      what actually moved, measured afterwards          */
    understand:   '<circle cx="9.5" cy="9" r="3.2"/><path d="M4 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>' +
                  '<path d="M17.2 6.8a6.5 6.5 0 0 1 0 8.4"/><path d="M19.8 4.2a10 10 0 0 1 0 13.6"/>',
    investigate:  '<path d="M5 3.5h7l4 4v2.6"/><path d="M12 3.5v4h4"/>' +
                  '<path d="M13.5 20.5h-7A1.5 1.5 0 0 1 5 19V3.5"/>' +
                  '<circle cx="16.5" cy="15" r="4"/><path d="m19.4 17.9 2.1 2.1"/>',
    alternatives: '<circle cx="12" cy="19" r="2.2"/><path d="M12 16.8v-3.4"/>' +
                  '<path d="M12 13.4 7.6 8.8"/><path d="m12 13.4 4.4-4.6"/>' +
                  '<circle cx="6" cy="6.8" r="2.2"/><circle cx="18" cy="6.8" r="2.2"/>',
    conflict:     '<path d="M12 3.5v17"/><path d="M8.5 8 5 12l3.5 4"/><path d="M15.5 8 19 12l-3.5 4"/>',
    humanReview:  '<circle cx="9.5" cy="7.5" r="3.3"/><path d="M3.5 20.5c0-3.3 2.7-6 6-6 .9 0 1.8.2 2.6.5"/>' +
                  '<path d="m13.8 17.4 2.3 2.3 4.4-4.9"/>',
    approved:     '<circle cx="12" cy="9.5" r="6"/><path d="m9.4 9.5 1.9 1.9 3.3-3.6"/>' +
                  '<path d="M8.2 14.9 6.8 20.5 12 18.6l5.2 1.9-1.4-5.6"/>',
    agreedAction: '<circle cx="9" cy="12" r="4.8"/><circle cx="15" cy="12" r="4.8"/>' +
                  '<path d="M12 8.4a4.8 4.8 0 0 0 0 7.2"/>',
    followup:     '<path d="M4 4v16h16"/><path d="m7.5 15 3-3.6 2.6 2.6"/><path d="m14.6 13 1.6-2.2"/>' +
                  '<circle cx="18" cy="8.2" r="2.3"/>',

    /* ── Management, drawn to the same specification ────────────────────────
       The administration entrance and the screens behind it. `adminEntry` is
       the one a visitor sees in the public header, so it has to read as "the
       people who run this" at 18px and not as a cog, a shield or a padlock —
       none of which say administration, and two of which say "blocked".

         adminEntry   a person at a desk: the entrance to where the work is run
         overview     the three areas of the management screen, at a glance
         requests     an envelope in a tray: what arrived and awaits a decision
         caseFile     a case folder with its spine marked
         signOut      leaving, drawn as a door rather than a power symbol      */
    adminEntry:  '<circle cx="12" cy="7" r="3.2"/><path d="M6.5 13.5h11"/>' +
                 '<path d="M8 13.5V11a4 4 0 0 1 8 0v2.5"/>' +
                 '<path d="M5 20.5v-4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4"/>',
    overview:    '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6"/>' +
                 '<rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6"/>' +
                 '<rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6"/>' +
                 '<path d="M13 16.75h7.5"/><path d="M16.75 13v7.5"/>',
    requests:    '<path d="M3.5 12.5 6 5.7A2 2 0 0 1 7.9 4.5h8.2a2 2 0 0 1 1.9 1.2l2.5 6.8"/>' +
                 '<path d="M3.5 12.5H9l1 2.2h4l1-2.2h5.5v5.2a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8Z"/>' +
                 '<path d="M12 3.5v4"/><path d="m10 6 2 2 2-2"/>',
    caseFile:    '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l1.8 2.2h7.6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>' +
                 '<path d="M8.5 9.7v11"/><path d="M12 14h5"/><path d="M12 17.2h3"/>',
    signOut:     '<path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14"/>' +
                 '<path d="M17.5 8.5 21 12l-3.5 3.5"/><path d="M21 12h-9"/>',

    /* client-facing */
    inbox:      '<path d="M3.5 13.5 6 6.2A2 2 0 0 1 7.9 5h8.2a2 2 0 0 1 1.9 1.2l2.5 7.3"/><path d="M3.5 13.5H9l1 2.5h4l1-2.5h5.5v4.3A1.7 1.7 0 0 1 18.8 20H5.2a1.7 1.7 0 0 1-1.7-1.7Z"/>',
    mail:       '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.6 7 7.4 5.5a1.7 1.7 0 0 0 2 0L20.4 7"/>',
    upload:     '<path d="M12 16V5"/><path d="m8 8.5 4-3.5 4 3.5"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
    help:       '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.2 2.9c-.6.2-.8.7-.8 1.3v.4"/><path d="M12 17h.01"/>',
    logout:     '<path d="M9 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4h3"/><path d="M14 8.5 17.5 12 14 15.5"/><path d="M17.5 12H9"/>'
  };

  /* Only these flip with the writing direction. */
  var DIRECTIONAL = ['arrow', 'arrowBack', 'chevron', 'external', 'handoff', 'logout', 'signOut'];

  /**
   * icon(name, opts) → SVG markup string.
   * opts.size   — px, default 20
   * opts.cls    — extra class on the <svg>
   * opts.label  — accessible name; without it the icon is aria-hidden, which is
   *               correct for an icon sitting beside its own text label.
   */
  function icon(name, opts) {
    opts = opts || {};
    var body = P[name];
    if (!body) return '';
    var size = opts.size || 20;
    var dir = DIRECTIONAL.indexOf(name) !== -1 ? ' data-hv-dir-icon' : '';
    var a11y = opts.label
      ? ' role="img" aria-label="' + String(opts.label).replace(/"/g, '&quot;') + '"'
      : ' aria-hidden="true"';
    return '<span class="hv-ico"' + dir + ' style="display:inline-flex;line-height:0">' +
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"' +
      (opts.cls ? ' class="' + opts.cls + '"' : '') + a11y + '>' + body + '</svg></span>';
  }

  /* The Humvance mark: three figures. Unchanged from the existing brand —
     this is the one asset that must not be redesigned. */
  var LOGO_MARK = '<svg viewBox="0 0 100 76" fill="currentColor" aria-hidden="true">' +
    '<circle cx="18" cy="17" r="7.5"/>' +
    '<path d="M6 30 Q6 26 18 26 Q30 26 30 30 L27 72 L9 72 Z" opacity=".85"/>' +
    '<circle cx="50" cy="10" r="8.5"/>' +
    '<path d="M36 25 Q36 20 50 20 Q64 20 64 25 L61 72 L39 72 Z"/>' +
    '<circle cx="82" cy="17" r="7.5"/>' +
    '<path d="M70 30 Q70 26 82 26 Q94 26 94 30 L91 72 L73 72 Z" opacity=".85"/>' +
    '</svg>';

  global.HVIcons = { icon: icon, names: Object.keys(P), DIRECTIONAL: DIRECTIONAL, LOGO_MARK: LOGO_MARK };
})(window);
