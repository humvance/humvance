/* ===========================================================================
   Humvance — client workspace copy, Arabic and English
   ---------------------------------------------------------------------------
   Written to answer the four questions a client actually has, in that order,
   and to be honest about the three things this screen must never fake: a
   scheduled meeting, a delivery date, and a finding.
   =========================================================================== */

(function () {
  'use strict';

  window.HV.i18n.register({
    ar: {
      'cw.title': 'مساحة العميل',
      'cw.ref': 'المرجع',
      'cw.opened': 'فُتح في',

      'cw.tab.overview': 'نظرة عامة',
      'cw.tab.requests': 'المعلومات المطلوبة',
      'cw.tab.reports': 'التقارير',
      'cw.tab.plan': 'خطة العمل',
      'cw.tab.followup': 'المتابعة',

      'cw.q.where': 'أين نحن الآن؟',
      'cw.q.happened': 'ما الذي حدث حتى الآن؟',
      'cw.q.fromMe': 'ما المطلوب مني؟',
      'cw.q.next': 'ما الخطوة التالية؟',
      'cw.where.note': 'نجمع ما نحتاجه قبل أن نبدأ التشخيص.',
      'cw.happened.a': 'قُبل طلبكم بعد مراجعة بشرية',
      'cw.happened.note': 'سُجّل ما كتبتموه كما هو، ولم يُستخلص منه استنتاج بعد.',
      'cw.fromMe.open': 'طلبات معلومات مفتوحة: {n}',
      'cw.fromMe.none': 'لا شيء مطلوب منكم حالياً',
      'cw.fromMe.note': 'كل طلب مذكور معه سببه. يمكنكم الاعتذار عن أي منها.',
      'cw.fromMe.noneNote': 'سنبلغكم فور احتياجنا شيئاً.',
      'cw.next.a': 'مراجعة ما وصلنا، ثم وضع التفسيرات المحتملة',
      'cw.next.note': 'لا نلتزم بتاريخ قبل أن نعرف ما لدينا.',

      'cw.progressTitle': 'أين وصلنا',
      'cw.humanStep': 'قرار بشري',
      'cw.yourWords': 'ما شاركتموه معنا',
      'cw.yourWords.note': 'محفوظ بكلماتكم كما أرسلتموه. لا نعيد صياغته ولا نترجمه، ولا نعامله كنتيجة قبل أن تسنده الأدلة.',
      'cw.claimPill': 'ما شاركتموه — قيد المراجعة',

      'cw.findings': 'النتائج',
      'cw.findings.emptyT': 'لا توجد نتائج بعد',
      'cw.findings.emptyB': 'لن تظهر هنا نتيجة قبل أن تُسند بالأدلة ويعتمدها مختص بشري باسمه. الفراغ هنا مقصود، وليس عطلاً.',
      'cw.meetings': 'الاجتماعات والمخرجات',
      'cw.meetings.emptyT': 'لا اجتماعات مجدولة',
      'cw.meetings.emptyB': 'سيظهر هنا أي اجتماع متفق عليه. لا نعرض مواعيد مقترحة لم تُتفق عليها معكم.',

      'cw.req.intro': 'نطلب أقل ما يكفي للإجابة على السؤال المطروح، ونذكر سبب كل طلب. لا نطلب رسائل الموظفين ولا بياناتهم الشخصية الحساسة، ولكم أن تعتذروا عن أي طلب.',
      'cw.req.openTitle': 'مطلوب منكم',
      'cw.req.doneTitle': 'مكتمل',
      'cw.req.open': 'بانتظاركم',
      'cw.req.answered': 'تم الاستلام',
      'cw.req.asked': 'طُلب في',
      'cw.req.why': 'لماذا نطلبه:',
      'cw.req.respond': 'الرد على الطلب',
      'cw.req.noneT': 'لا شيء مطلوب منكم الآن',
      'cw.req.noneB': 'سنبلغكم هنا فور احتياجنا معلومة، مع ذكر سببها.',

      'cw.notReady': 'هذا القسم لم يُبنَ بعد.',
      'cw.notReady.detail': 'الشاشة موجودة لمراجعة الشكل فقط. لا يوجد خلفها بعد مصدر بيانات ولا صلاحية وصول، ولن تُعرض بيانات حقيقية فيها قبل بناء ذلك.',

      'cw.gate.title': 'هذه الصفحة غير متاحة بعد',
      'cw.gate.body': 'نعمل على مساحة يتابع فيها العميل حالة طلبه. حتى ذلك الحين، يتواصل معكم فريقنا مباشرة.',
      'cw.gate.home': 'العودة للرئيسية',
      'cw.gate.status': 'ماذا يحدث بعد إرسال الطلب؟'
    },

    en: {
      'cw.title': 'Client workspace',
      'cw.ref': 'Reference',
      'cw.opened': 'Opened',

      'cw.tab.overview': 'Overview',
      'cw.tab.requests': 'Requested information',
      'cw.tab.reports': 'Reports',
      'cw.tab.plan': 'Action plan',
      'cw.tab.followup': 'Follow-up',

      'cw.q.where': 'Where are we now?',
      'cw.q.happened': 'What has happened so far?',
      'cw.q.fromMe': 'What is needed from me?',
      'cw.q.next': 'What is the next step?',
      'cw.where.note': 'We are gathering what we need before diagnosis begins.',
      'cw.happened.a': 'Your request was accepted after human review',
      'cw.happened.note': 'What you wrote is stored as written. Nothing has been concluded from it yet.',
      'cw.fromMe.open': '{n} open information requests',
      'cw.fromMe.none': 'Nothing is needed from you right now',
      'cw.fromMe.note': 'Each request comes with its reason. You can decline any of them.',
      'cw.fromMe.noneNote': 'We will tell you the moment we need something.',
      'cw.next.a': 'Review what has arrived, then set out the possible explanations',
      'cw.next.note': 'We do not commit to a date before we know what we have.',

      'cw.progressTitle': 'Where things stand',
      'cw.humanStep': 'Human decision',
      'cw.yourWords': 'What you shared with us',
      'cw.yourWords.note': 'Kept in your own words, exactly as you sent it. We do not rephrase or translate it, and we do not treat it as a conclusion until evidence supports it.',
      'cw.claimPill': 'What you shared — under review',

      'cw.findings': 'Findings',
      'cw.findings.emptyT': 'No findings yet',
      'cw.findings.emptyB': 'Nothing appears here until it is supported by evidence and approved by a named human specialist. This emptiness is deliberate, not a fault.',
      'cw.meetings': 'Meetings and outputs',
      'cw.meetings.emptyT': 'No meetings scheduled',
      'cw.meetings.emptyB': 'Any agreed meeting will appear here. We do not display proposed times that have not been agreed with you.',

      'cw.req.intro': 'We ask for the least that answers the question in front of us, and we say why each time. We do not ask for employee messages or sensitive personal data, and you may decline any request.',
      'cw.req.openTitle': 'Needed from you',
      'cw.req.doneTitle': 'Completed',
      'cw.req.open': 'Waiting on you',
      'cw.req.answered': 'Received',
      'cw.req.asked': 'Asked',
      'cw.req.why': 'Why we need it:',
      'cw.req.respond': 'Respond to this',
      'cw.req.noneT': 'Nothing is needed from you right now',
      'cw.req.noneB': 'We will post here the moment we need something, with the reason.',

      'cw.notReady': 'This section has not been built yet.',
      'cw.notReady.detail': 'The screen exists so the shape can be reviewed. There is no data source and no access control behind it yet, and no real data will appear here until there is.',

      'cw.gate.title': 'This page isn\u2019t available yet',
      'cw.gate.body': 'We are building a space where you can follow your request. Until then, our team contacts you directly.',
      'cw.gate.home': 'Back to home',
      'cw.gate.status': 'What happens after you send a request?'
    }
  });
})();
