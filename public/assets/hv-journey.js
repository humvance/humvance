/* ===========================================================================
   Humvance — the journey explorer.
   ---------------------------------------------------------------------------
   The one place on the public site where a visitor can interrogate the service
   instead of reading a brochure about it. Five stages; select one and it says
   three things that a marketing page normally leaves out:

       what YOU contribute · what WE do · what the stage PRODUCES

   and a fourth that most companies would rather not print: whether that stage
   is actually built. "Available in the internal beta" is the strongest thing it
   claims, and it is deliberately not "running today" — the software exists and
   can be tried; it is not a verified service being delivered to customers.

   BECAUSE THAT LAST ONE IS THE POINT. Two of these five stages are designed and
   not built. Drawing all five identically would be a claim that all five work.
   So the unbuilt stages are marked on the rail itself, before anything is
   selected, and the panel repeats it in words. `AVAILABILITY` below is the
   single source of that, and it is set from what the software can do today —
   not from what the site would like to say.

   INTERACTION RULES IT KEEPS (BETA-01 Rev 2 §4):
     · click, tap and keyboard all select; hover only enriches
     · the selected stage is obvious without relying on colour alone — it
       carries a filled node, a heavier label and a rule beneath it
     · it is understandable with no animation at all, and respects
       prefers-reduced-motion
     · it never hijacks scrolling, loops on its own, or moves under the cursor
     · every stage's content is also plain text on /how-we-work, so nothing here
       is the only way to read it

   Copy lives in this file rather than hv-copy.js because it is one feature and
   the words are half of it; the register is the same one every other page uses.
   =========================================================================== */
(function (global) {
  'use strict';

  var I = global.HV.i18n;

  /* Stage → is it running today? Read from the implementation, not the pitch:
     intake, the human decision, evidence, contradictions, findings, the
     adversarial review and the version-bound approval all exist. A plan entity,
     a place to record the client's approval of one, and any measurement of what
     changed afterwards do not. */
  var AVAILABILITY = {
    1: 'now', 2: 'now', 3: 'now',
    4: 'designed', 5: 'designed'
  };
  var ICONS = { 1: 'understand', 2: 'investigate', 3: 'humanReview', 4: 'agreedAction', 5: 'followup' };
  var STAGES = [1, 2, 3, 4, 5];

  I.register({
    ar: {
      'jr.eyebrow': 'الرحلة',
      'jr.title': 'خمس مراحل — اختر واحدة لتعرف ما يحدث فيها بالضبط',
      'jr.sub': 'عند كل مرحلة: ما الذي تقدّمه أنت، وما الذي نفعله نحن، وما الذي تُنتجه المرحلة. ونقول أيضاً أي المراحل مبنيّة ومتاحة للتجربة الداخلية، وأيها لم تُبنَ بعد.',
      'jr.you': 'ما تقدّمه أنت',
      'jr.we': 'ما نفعله نحن',
      'jr.out': 'ما تُنتجه المرحلة',
      'jr.av.now': 'متاحة في النسخة الداخلية',
      'jr.av.designed': 'مصمَّمة — لم تُفعَّل بعد',
      'jr.av.nowNote': 'هذه المرحلة منفَّذة في المنتج ويمكن تجربتها في النسخة التجريبية الداخلية. هذا ليس إقراراً بأنها خدمة مُتحقَّق منها ومقدَّمة للعملاء اليوم.',
      'jr.av.designedNote': 'هذه المرحلة جزء من تصميم الخدمة، ولم تُبنَ بعد: لا يوجد في المنتج اليوم كيان خطة، ولا مكان يُسجَّل فيه اعتمادكم لها، ولا قياس لما تغيّر. لا نقدّمها كخدمة قائمة.',
      'jr.readAll': 'اقرأ الرحلة كاملة في صفحة «كيف نعمل»',
      'jr.a11y.rail': 'مراحل رحلة الخدمة',
      'jr.a11y.hint': 'استخدم السهمين لتنقّل بين المراحل.',

      'jr.1.t': 'نفهم الوضع',
      'jr.1.you': 'تصف ما تلاحظه بكلماتك، دون ترتيب مسبق ودون بيانات موظفين.',
      'jr.1.we': 'نحوّل الوصف إلى سؤال واحد محدّد وقابل للفحص، ونفصل ما نعرفه عمّا نفترضه. ما ترسله يُحفظ كما كتبته ولا يُعدَّل.',
      'jr.1.out': 'سؤال محدّد يملكه شخص بعينه، وقائمة صريحة بما لا نعرفه بعد.',

      'jr.2.t': 'نفحص بالأدلة',
      'jr.2.you': 'تتيح ما نطلبه تحديداً، أو تخبرنا أنه غير متاح — وهذه أيضاً معلومة.',
      'jr.2.we': 'نضع التفسيرات المتنافسة جنباً إلى جنب، ونجمع ما يرجّح أحدها أو ينفيه. كل طلب معلومة يمرّ على خمسة أسئلة تمنع إرهاقكم بلا داعٍ، ونسجّل التناقضات بطرفيها بدل تنعيمها.',
      'jr.2.out': 'أدلة موثّقة المصدر ومذكورة الحدود، وتناقضات مسجَّلة، وتفسيرات بعضها تعزّز وبعضها سقط.',

      'jr.3.t': 'نصل إلى نتيجة يعتمدها إنسان',
      'jr.3.you': 'تصحّح ما فهمناه خطأً. أنت الأدرى بشركتك.',
      'jr.3.we': 'نصوغ نتيجة بنطاق محدّد تستند إلى أدلة بعينها، ثم نمرّرها على مراجعة نقدية آلية تبحث عن ثغراتها. بعدها يقرأها مراجع بشري ويعتمد نسخة بعينها منها، أو يردّها.',
      'jr.3.out': 'نتيجة معتمدة مربوطة برقم نسختها، ومعها حدودها والتفسيرات البديلة التي بقيت قائمة.',

      'jr.4.t': 'ندعم تحسيناً متفقاً عليه',
      'jr.4.you': 'القرار. نحن نوصي، وأنتم تقررون ما يُنفَّذ وبأي موارد.',
      'jr.4.we': 'نرتّب خطوات بالأولوية بحجم يستطيع فريقكم حمله، ولا تصبح خطة إلا باعتمادكم أنتم.',
      'jr.4.out': 'خطوات متفق عليها، ومالك لكل خطوة، وحدود صريحة لما لا نستطيع الالتزام به.',

      'jr.5.t': 'نقيس ما تغيّر',
      'jr.5.you': 'إتاحة القياس المتفق عليه مسبقاً.',
      'jr.5.we': 'نرصد ما تحرّك فعلاً مقابل ما كان متوقعاً، ونقول ما تستطيع الأدلة إثباته وما لا تستطيع.',
      'jr.5.out': 'قراءة لما تغيّر، مع تمييز صريح بين الأثر والتزامن: «تحسّن بعدها» ليس «تحسّن بسببها».'
    },
    en: {
      'jr.eyebrow': 'The journey',
      'jr.title': 'Five stages — choose one to see exactly what happens in it',
      'jr.sub': 'For each stage: what you contribute, what we do, and what the stage produces. We also say which stages are built and available to try in the internal beta, and which are not built yet.',
      'jr.you': 'What you contribute',
      'jr.we': 'What we do',
      'jr.out': 'What the stage produces',
      'jr.av.now': 'Available in the internal beta',
      'jr.av.designed': 'Designed — not in operation yet',
      'jr.av.nowNote': 'This stage is implemented in the product and can be tried in the internal beta. That is not a claim that it is a verified service being delivered to customers today.',
      'jr.av.designedNote': 'This stage is part of the designed service and has not been built: there is no plan in the product today, nowhere to record your approval of one, and no measurement of what changed. We do not offer it as a service that exists.',
      'jr.readAll': 'Read the whole journey as plain text on “How we work”',
      'jr.a11y.rail': 'Stages of the service journey',
      'jr.a11y.hint': 'Use the arrow keys to move between stages.',

      'jr.1.t': 'Understand the situation',
      'jr.1.you': 'You describe what you are seeing, in your own words — untidy is fine, and no employee data at this stage.',
      'jr.1.we': 'We turn the description into one specific, examinable question, and separate what is known from what is assumed. What you send is stored exactly as you wrote it and never edited.',
      'jr.1.out': 'A bounded question with a named owner, and an explicit list of what we do not know yet.',

      'jr.2.t': 'Investigate with evidence',
      'jr.2.you': 'You provide the specific things we ask for — or tell us they do not exist, which is itself information.',
      'jr.2.we': 'We set out the competing explanations side by side and gather what supports or rules out each. Every request to you passes five questions designed to stop us wasting your people’s time, and contradictions are recorded with both sides rather than smoothed over.',
      'jr.2.out': 'Evidence carrying its source and its limits, contradictions on record, and explanations that have been strengthened — or dropped.',

      'jr.3.t': 'Reach a finding a person signs',
      'jr.3.you': 'You correct us where we have misread something. You know your company.',
      'jr.3.we': 'We draft a finding with a stated scope, citing specific evidence, then run it through a deterministic adversarial review that looks for its holes. A human reviewer then reads it and approves one particular version of it — or sends it back.',
      'jr.3.out': 'An approved finding bound to its version number, carrying its limits and the alternative explanations still standing.',

      'jr.4.t': 'Support an agreed improvement',
      'jr.4.you': 'The decision. We recommend; you decide what is done, and with what resources.',
      'jr.4.we': 'We prioritise steps sized to what your team can actually carry — and nothing becomes a plan until you have approved it.',
      'jr.4.out': 'Agreed steps, an owner for each, and explicit limits on what we cannot commit to.',

      'jr.5.t': 'Evaluate what changed',
      'jr.5.you': 'Access to the measure agreed in advance.',
      'jr.5.we': 'We look at what actually moved against what was expected, and say what the evidence can and cannot establish.',
      'jr.5.out': 'A reading of what changed, with effect held apart from coincidence: “it improved afterwards” is not “it improved because of this”.'
    }
  });

  var t = I.t, esc = I.esc;
  var selected = 1;

  function railNode(n) {
    var on = n === selected;
    var av = AVAILABILITY[n];
    return '<button class="jr-node' + (on ? ' is-on' : '') + ' jr-av-' + av + '" type="button" role="tab" ' +
      'id="jr-tab-' + n + '" aria-controls="jr-panel" aria-selected="' + (on ? 'true' : 'false') + '" ' +
      'tabindex="' + (on ? '0' : '-1') + '" data-jr="' + n + '">' +
      '<span class="jr-dot">' + HVIcons.icon(ICONS[n], { size: 19 }) + '</span>' +
      '<span class="jr-n">' + I.num(n) + '</span>' +
      '<span class="jr-label">' + esc(t('jr.' + n + '.t')) + '</span>' +
      (av === 'designed' ? '<span class="jr-flag">' + esc(t('jr.av.designed')) + '</span>' : '') +
      '</button>';
  }

  function block(iconName, labelKey, textKey) {
    return '<div class="jr-block">' +
      '<div class="jr-block-h">' + HVIcons.icon(iconName, { size: 15 }) +
        '<span>' + esc(t(labelKey)) + '</span></div>' +
      '<p>' + esc(t(textKey)) + '</p></div>';
  }

  function panel() {
    var n = selected, av = AVAILABILITY[n];
    return '<div class="jr-panel-head">' +
        '<h3 class="hv-h3" style="font-size:1.3rem">' + esc(t('jr.' + n + '.t')) + '</h3>' +
        '<span class="jr-av jr-av-' + av + '">' +
          HVIcons.icon(av === 'now' ? 'check' : 'clock', { size: 13 }) +
          esc(t('jr.av.' + av)) + '</span>' +
      '</div>' +
      '<p class="jr-av-note">' + esc(t('jr.av.' + av + 'Note')) + '</p>' +
      '<div class="jr-blocks">' +
        block('people', 'jr.you', 'jr.' + n + '.you') +
        block('role', 'jr.we', 'jr.' + n + '.we') +
        block('evidence', 'jr.out', 'jr.' + n + '.out') +
      '</div>';
  }

  /** The whole section. Returns markup; call wire() after it is in the DOM. */
  function section() {
    return '<section class="hv-section jr-section" id="journey"><div class="hv-container">' +
      '<p class="hv-eyebrow">' + esc(t('jr.eyebrow')) + '</p>' +
      '<h2 class="hv-h2" style="margin-block:14px 14px;max-width:26ch">' + esc(t('jr.title')) + '</h2>' +
      '<p class="hv-prose hv-sm hv-muted" style="max-width:62ch">' + esc(t('jr.sub')) + '</p>' +
      '<div class="jr-rail" role="tablist" aria-label="' + esc(t('jr.a11y.rail')) + '">' +
        STAGES.map(railNode).join('') +
      '</div>' +
      '<p class="hv-xs hv-muted jr-hint">' + esc(t('jr.a11y.hint')) + '</p>' +
      '<div class="jr-panel" id="jr-panel" role="tabpanel" aria-labelledby="jr-tab-' + selected + '" tabindex="0">' +
        panel() +
      '</div>' +
      '<p class="hv-xs" style="margin-block-start:18px">' +
        '<a class="hv-link" href="/how-we-work">' + esc(t('jr.readAll')) + '</a></p>' +
      '</div></section>';
  }

  function select(n) {
    if (!AVAILABILITY[n]) return;
    selected = n;
    var rail = document.querySelector('.jr-rail');
    var pane = document.getElementById('jr-panel');
    if (!rail || !pane) return;
    rail.querySelectorAll('[data-jr]').forEach(function (b) {
      var on = Number(b.getAttribute('data-jr')) === n;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    pane.setAttribute('aria-labelledby', 'jr-tab-' + n);
    pane.innerHTML = panel();
  }

  function wire() {
    var rail = document.querySelector('.jr-rail');
    if (!rail) return;
    rail.querySelectorAll('[data-jr]').forEach(function (b) {
      b.addEventListener('click', function () { select(Number(b.getAttribute('data-jr'))); });
    });
    /* Arrow keys follow the writing direction, so "next" is next on screen. */
    rail.addEventListener('keydown', function (e) {
      var rtl = document.documentElement.getAttribute('dir') === 'rtl';
      var step = 0;
      if (e.key === 'ArrowRight') step = rtl ? -1 : 1;
      else if (e.key === 'ArrowLeft') step = rtl ? 1 : -1;
      else if (e.key === 'ArrowDown') step = 1;
      else if (e.key === 'ArrowUp') step = -1;
      else if (e.key === 'Home') step = -99;
      else if (e.key === 'End') step = 99;
      else return;
      e.preventDefault();
      var n = step === -99 ? 1 : step === 99 ? STAGES.length
            : Math.min(STAGES.length, Math.max(1, selected + step));
      select(n);
      var el = rail.querySelector('[data-jr="' + n + '"]');
      if (el) el.focus();
    });
  }

  /** Reset to the first stage — used when the language changes and the page
      re-renders, so the explorer does not re-open on a half-replaced panel. */
  function reset() { selected = 1; }

  global.HV.journey = { section: section, wire: wire, select: select, reset: reset, AVAILABILITY: AVAILABILITY };
})(window);
