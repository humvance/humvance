/* ===========================================================================
   Humvance — demonstration fixtures
   ---------------------------------------------------------------------------
   INVENTED DATA. Every name, company, number, date and sentence below is made
   up for reviewing screens that have no backend yet. There is no real client,
   no real employee, no real case and no real measurement anywhere in this file,
   and there never may be: a fixture file is not a place for customer records.

   WHY THESE EXIST. The client workspace (overview, requested information) has
   no server behind it — V2 has no client authentication, no client-scoped read
   API, and no upload path. Building those is backend work that this task did
   not do and was not asked to do. Rather than pretend, the screens are built
   once, properly, and filled from here while the demo flag is on.

   HOW THEY STAY SAFE:
     · this file is loaded only by screens that declare themselves demo-capable;
     · HV.ui.isDemo() is false unless the page is on localhost AND ?demo=1;
     · every write path calls HV.ui.demoGuard(), which blocks and says so;
     · the demo bar is visible for the whole session, and cannot be styled away.

   The fixture shape deliberately mirrors the real V2 objects (case, claim,
   evidence, finding, evidence request), so that swapping a fixture for a real
   adapter later is a data-source change, not a redesign.
   =========================================================================== */

(function (global) {
  'use strict';

  var AR = 'ar', EN = 'en';
  function L(ar, en) { return function (lang) { return lang === EN ? en : ar; }; }

  var CASE = {
    case_id: 'case_demo0000000000000000000',
    organization_id: 'org_demo00000000000000000000',
    version: 6,
    reference: 'HVS-DEMO-XMPL-0001',
    status: 'AWAITING_EVIDENCE',
    client_visible_status: L('جمع المعلومات', 'Gathering information'),
    opened_at: '2026-09-02T09:00:00.000Z',
    organization: L('شركة المثال للتجارة', 'Example Trading Co.'),
    intent: 'DYSFUNCTION',
    title: L('تعثّر قرارات الشراء وتركّزها في الإدارة التنفيذية',
            'Purchasing decisions stalling and concentrating at executive level'),
    stage: 2, /* of the four-stage journey */

    /* What the client told us. Unverified, by definition. */
    claims: [
      {
        id: 'claim_demo_1',
        status: 'UNVERIFIED',
        origin: 'sponsor',
        text: L('كل قرار شراء يرجع إليّ حتى لو كان بسيطاً، والفريق يتوقف بانتظار توقيعي.',
                'Every purchasing decision comes back to me, even small ones, and the team waits for my signature.'),
        source: L('من نص الطلب الأولي', 'From the initial request')
      },
      {
        id: 'claim_demo_2',
        status: 'UNVERIFIED',
        origin: 'sponsor',
        text: L('أظن أن السبب عدم وضوح الصلاحيات.', 'I think the cause is unclear authority limits.'),
        source: L('اعتقاد العميل — ليس سبباً مثبتاً', 'Client belief — not an established cause')
      }
    ],

    /* Information we have asked for. This is the client's real job in the
       process, so it gets its own screen. */
    requests: [
      {
        id: 'req_demo_1', status: 'ANSWERED',
        title: L('مصفوفة الصلاحيات الحالية', 'The current delegation matrix'),
        why: L('لنعرف ما هي الحدود المكتوبة فعلاً، قبل أن نقارنها بما يحدث في الواقع.',
               'So we know what the written thresholds actually are, before comparing them with what happens in practice.'),
        asked_at: '2026-09-04T08:20:00.000Z',
        answered_at: '2026-09-05T13:05:00.000Z',
        answer_note: L('أُرسلت نسخة PDF بتاريخ 5 سبتمبر.', 'A PDF copy was sent on 5 September.')
      },
      {
        id: 'req_demo_2', status: 'OPEN',
        title: L('عيّنة من أوامر الشراء في الربع الماضي', 'A sample of purchase orders from last quarter'),
        why: L('لنرى من اعتمد كل أمر فعلياً، ومقارنته بالحد المكتوب في المصفوفة. هذا هو الفرق بين السياسة والممارسة.',
               'To see who actually approved each one, and compare that with the written threshold. This is the difference between policy and practice.'),
        asked_at: '2026-09-08T07:40:00.000Z',
        note: L('لا نحتاج أسماء الموظفين — الأدوار تكفي.', 'We do not need employee names — roles are enough.')
      },
      {
        id: 'req_demo_3', status: 'OPEN',
        title: L('نصف ساعة مع مدير المشتريات', 'Thirty minutes with the procurement manager'),
        why: L('لفهم ما يحدث عملياً عندما يتجاوز الطلب الحد المسموح.',
               'To understand what happens in practice when a request exceeds the threshold.'),
        asked_at: '2026-09-08T07:42:00.000Z'
      }
    ],

    /* The four-stage journey, with honest state. */
    timeline: [
      { key: 'received',  done: true,  at: '2026-09-01T10:12:00.000Z',
        label: L('استلمنا طلبكم', 'We received your request') },
      { key: 'accepted',  done: true,  at: '2026-09-02T09:00:00.000Z',
        label: L('راجعه مختص وقبله', 'A specialist reviewed and accepted it'), human: true },
      { key: 'gathering', done: false, current: true,
        label: L('نجمع المعلومات المطلوبة', 'We are gathering the information we asked for') },
      { key: 'diagnosis', done: false,
        label: L('التشخيص ومراجعته', 'Diagnosis and its review') },
      { key: 'plan',      done: false,
        label: L('خطة متفق عليها', 'An agreed plan'), human: true },
      { key: 'followup',  done: false,
        label: L('المتابعة', 'Follow-up') }
    ],

    /* Deliberately empty in the fixture: there is no finding yet, and inventing
       one would be exactly the thing this product refuses to do. */
    findings: [],
    meetings: []
  };

  /* Reviewer-side fixture: a queue of submissions in three states. */
  var QUEUE = [
    {
      intakeseed_id: 'seed_demo_a', reference: 'HVS-DEMO-AAAA-0001',
      status: 'PENDING_REVIEW', promotion_state: null,
      received_at: '2026-09-17T06:14:00.000Z',
      intent: 'DYSFUNCTION',
      title: L('قرارات تتركّز في الإدارة التنفيذية', 'Decisions concentrating at executive level'),
      scope_kind: 'process', flagged: false
    },
    {
      intakeseed_id: 'seed_demo_b', reference: 'HVS-DEMO-BBBB-0002',
      status: 'PENDING_REVIEW', promotion_state: null,
      received_at: '2026-09-17T11:48:00.000Z',
      intent: 'RISK',
      title: L('قلق من فقدان المعرفة قبل التوسّع', 'Concern about knowledge loss before expansion'),
      scope_kind: 'company_wide', flagged: true
    },
    {
      intakeseed_id: 'seed_demo_c', reference: 'HVS-DEMO-CCCC-0003',
      status: 'ACCEPTED', promotion_state: 'COMPLETE',
      received_at: '2026-09-15T08:02:00.000Z',
      decided_at: '2026-09-15T14:30:00.000Z',
      decided_by: 'admin:shared',
      intent: 'DYSFUNCTION',
      title: L('تعثّر التنسيق بين الإدارات', 'Coordination stalling between departments'),
      scope_kind: 'multiple_areas', flagged: false,
      resulting_case_id: 'case_demo0000000000000000000'
    },
    {
      intakeseed_id: 'seed_demo_d', reference: 'HVS-DEMO-DDDD-0004',
      status: 'REJECTED', promotion_state: null,
      received_at: '2026-09-14T19:20:00.000Z',
      decided_at: '2026-09-16T07:10:00.000Z',
      decided_by: 'admin:shared',
      reason: L('خارج نطاق عملنا — الطلب يتعلق بنزاع قانوني قائم.',
                'Outside our scope — the request concerns an active legal dispute.'),
      intent: 'OPPORTUNITY',
      title: L('طلب خارج النطاق', 'An out-of-scope request'),
      scope_kind: 'unsure', flagged: false
    },
    {
      intakeseed_id: 'seed_demo_e', reference: 'HVS-DEMO-EEEE-0005',
      status: 'ACCEPTED', promotion_state: 'PENDING',
      received_at: '2026-09-16T05:30:00.000Z',
      decided_at: '2026-09-16T09:15:00.000Z',
      decided_by: 'admin:shared',
      intent: 'DYSFUNCTION',
      title: L('ترقية غير مكتملة — تحتاج استئنافاً', 'Incomplete promotion — needs resuming'),
      scope_kind: 'team', flagged: false
    }
  ];

  /* The diagnostic workspace fixture. Competing explanations that are NOT
     findings, one contradiction, and an explicitly empty findings list. */
  /* The diagnostic workspace fixture.
     REBUILT 2026-09-18 to carry the BACKEND's field names, not the renderer's.
     Every key below appears in what `getReviewerView` returns — contradictions
     use `summary`/`state`/`left_evidence_id`/`right_evidence_id`, approvals use
     `artifact_type`/`artifact_id`/`artifact_version`/`decision`, findings carry
     a `version`, and `limitations` are arrays. tests/ui/case-fixture.js builds
     the same objects from the real service and the tests compare the two.

     There is deliberately NO `unknowns` key: the real bundle has none, and a
     fixture that invented one would hide the fact that the screen has no source
     for that section. */
  var WORKSPACE = {
    hypotheses: [
      { id: 'hyp_demo_1', label: 'H1', state: 'ACTIVE',
        statement: L('حدود التفويض المكتوبة أقل من حجم القرارات اليومية، فيضطر الجميع للتصعيد.',
                'Written delegation thresholds sit below the size of everyday decisions, so everything escalates.'),
        supporting_evidence: ['evd_demo_1', 'evd_demo_2'], contradicting_evidence: [] },
      { id: 'hyp_demo_2', label: 'H2', state: 'ACTIVE',
        statement: L('الحدود كافية، لكن الثقة في تطبيقها ضعيفة، فيصعّد المديرون احترازاً.',
                'The thresholds are adequate, but confidence in applying them is low, so managers escalate defensively.'),
        supporting_evidence: ['evd_demo_3'], contradicting_evidence: ['evd_demo_2'] },
      { id: 'hyp_demo_3', label: 'H3', state: 'NOT_SUPPORTED',
        statement: L('النظام التقني لا يسمح باعتماد أقل من مستوى معيّن.',
                'The system does not technically permit approval below a certain level.'),
        supporting_evidence: [], contradicting_evidence: ['evd_demo_1', 'evd_demo_2'] }
    ],
    evidence: [
      { id: 'evd_demo_1', source_type: 'document', verification_status: 'UNVERIFIED',
        source_name: L('مصفوفة الصلاحيات (نسخة 2025)', 'Delegation matrix (2025 version)'),
        limitations: [L('وثيقة معلنة — لا تثبت ما يحدث فعلياً.', 'A published document — it does not establish actual practice.')],
        untrusted_scan: { clean: true, flags: [] } },
      { id: 'evd_demo_2', source_type: 'system_record', verification_status: 'CORROBORATED',
        source_name: L('412 من 480 أمر شراء تحت الحد اعتمدها المالك', '412 of 480 sub-threshold purchase orders approved by the owner'),
        limitations: [L('ربع واحد فقط — قد لا يمثّل بقية السنة.', 'One quarter only — it may not represent the rest of the year.')],
        untrusted_scan: { clean: true, flags: [] } },
      { id: 'evd_demo_3', source_type: 'interview', verification_status: 'UNVERIFIED',
        source_name: L('رواية مدير المشتريات', 'Procurement manager account'),
        limitations: [L('مصدر واحد — ثلاث روايات من شخص واحد تبقى مصدراً واحداً.', 'A single source — three accounts from one person are still one source.')],
        untrusted_scan: { clean: false, flags: ['imperative_instruction'] } }
    ],
    contradictions: [
      { id: 'ctr_demo_1', kind: 'policy_vs_practice', state: 'OPEN',
        summary: L('المصفوفة تمنح صلاحية حتى 20,000 ريال، بينما 412 من 480 أمر شراء تحت هذا الحد تحمل توقيع المالك.',
                'The matrix grants authority up to SAR 20,000, while 412 of 480 purchase orders below that threshold carry the owner’s signature.'),
        left_evidence_id: 'evd_demo_1', right_evidence_id: 'evd_demo_2' },
      { id: 'ctr_demo_2', kind: 'claim_vs_data', state: 'RESOLVED',
        summary: L('قال الراعي إن التأخير بدأ هذا العام، بينما تظهر البيانات النمط نفسه في العام الماضي.',
                'The sponsor said the delays began this year, while the data shows the same pattern last year.'),
        left_evidence_id: 'evd_demo_3', right_evidence_id: 'evd_demo_2' }
    ],

    /* Three findings, one in each of the states the screen must tell apart. */
    findings: [
      { id: 'fnd_demo_ok', version: 1, state: 'APPROVED', evidence_strength: 'MODERATE',
        statement: L('تُصعَّد قرارات الشراء تحت الحد إلى المالك عملياً، رغم وجود صلاحية موثّقة باعتمادها.',
                'Sub-threshold purchasing decisions are escalated to the owner in practice, despite documented authority to approve them.'),
        scope: L('اعتمادات الشراء تحت 20,000 ريال، الربع الأول إلى الثالث 2026.',
                'Purchase approvals under SAR 20,000, Q1–Q3 2026.'),
        limitations: [
          L('ثلاثة أرباع من نظام واحد.', 'Three quarters of data from one system.'),
          L('مقابلة مدير واحد، دون وجهة نظر الصف الأول.', 'One manager interview; no line-staff perspective.')
        ],
        alternative_explanations: [
          L('H3: ضابط تقني يفرض التصعيد — ضعُف؛ لم يوجد ضابط كهذا تحت الحد.',
            'H3: a system control forces escalation — weakened; no such control was found below the threshold.')
        ] },
      { id: 'fnd_demo_stale', version: 2, state: 'DRAFT', evidence_strength: 'LIMITED',
        statement: L('التنسيق بين المشتريات والمالية يضيف خطوة اعتماد لا تتطلبها مصفوفة الصلاحيات، ولا تُسجَّل في أي مكان.',
                'Coordination between procurement and finance adds an approval step that the delegation matrix does not require, and the step is not recorded anywhere.'),
        scope: L('مسار اعتماد المشتريات.', 'The purchasing approval path.'),
        limitations: [L('لم تُفحص سجلات المالية بعد.', 'Finance records have not been examined yet.')],
        alternative_explanations: [] },
      { id: 'fnd_demo_rej', version: 1, state: 'REJECTED', evidence_strength: 'LIMITED',
        statement: L('المديرون يفتقرون إلى القدرة على ممارسة الصلاحية التي يملكونها.',
                'Managers lack the capability to exercise the authority they hold.'),
        scope: L('إدارة المشتريات.', 'The procurement function.'),
        limitations: [], alternative_explanations: [] }
    ],

    /* An approval is bound to ONE artifact version. `fnd_demo_stale` was approved
       at v1 and then materially revised to v2 — so the approval no longer covers
       it and the screen must not show it as approved. */
    approvals: [
      { id: 'apr_demo_1', artifact_type: 'finding', artifact_id: 'fnd_demo_ok',
        artifact_version: 1, decision: 'APPROVED', created_at: 1789600000000, created_by: 'admin:shared',
        comment: L('التناقض القائم هو النتيجة نفسها، لا عائقاً أمامها.',
                'The open contradiction is the finding itself, not an obstacle to it.') },
      { id: 'apr_demo_2', artifact_type: 'finding', artifact_id: 'fnd_demo_stale',
        artifact_version: 1, decision: 'APPROVED', created_at: 1789500000000, created_by: 'admin:shared',
        comment: L('اعتُمدت الصياغة السابقة.', 'The earlier wording was approved.') },
      { id: 'apr_demo_3', artifact_type: 'finding', artifact_id: 'fnd_demo_rej',
        artifact_version: 1, decision: 'REJECTED', created_at: 1789610000000, created_by: 'admin:shared',
        comment: L('القدرة مُدّعاة لا مُثبتة؛ لا شيء في السجل يختبرها.',
                'Capability is asserted, not evidenced. Nothing in the record tests it.') }
    ],
    challenges: [
      { id: 'chl_demo_1', finding_id: 'fnd_demo_ok', finding_version: 1, verdict: 'BLOCKED',
        summary: L('تناقض مفتوح قائم على هذه القضية.', 'An open contradiction stands on this case.') },
      { id: 'chl_demo_2', finding_id: 'fnd_demo_stale', finding_version: 2, verdict: 'PASSED',
        summary: L('لا اعتراض آلي.', 'No automated objection.') }
    ],
    audit: [
      { id: 'aud_1', at: 1789400000000, event: 'intake.accepted', actor_type: 'human', summary: L('قُبل الطلب.', 'The request was accepted.') },
      { id: 'aud_2', at: 1789400001000, event: 'case.created', actor_type: 'human', summary: L('فُتحت القضية.', 'The case was opened.') },
      { id: 'aud_3', at: 1789450000000, event: 'evidence.attached', actor_type: 'human', summary: L('أُرفق دليل.', 'Evidence was attached.') },
      { id: 'aud_4', at: 1789480000000, event: 'contradiction.recorded', actor_type: 'human', summary: L('سُجّل تناقض.', 'A contradiction was recorded.') },
      { id: 'aud_5', at: 1789500000000, event: 'approval.recorded', actor_type: 'human', summary: L('سُجّل اعتماد.', 'An approval was recorded.') },
      { id: 'aud_6', at: 1789550000000, event: 'finding.revised', actor_type: 'human', summary: L('نُقّحت نتيجة تنقيحاً جوهرياً؛ لم يعد الاعتماد السابق سارياً.', 'A finding was materially revised; the prior approval no longer applies.') }
    ]
  };

  /* ── Reviewer detail fixtures ───────────────────────────────────────────────
     ADDED 2026-09-18. In demo mode the queue listed five submissions and every
     one of them was a dead end: clicking a row called demoGuard() and nothing
     opened. The screen that matters most on this page — the two-column review,
     where client-reported content sits beside the Humvance decision — could not
     be seen at all.

     These are read-only fixtures for four states named in the brief, plus the
     flagged pending one. Their field names are the BACKEND's: `seed` carries
     what buildIntakeSeed() writes (including `epistemic_status`, `record_kind`,
     `untrusted_scan`), `review` carries what buildIntakeReview() writes
     (`decision_reason`, not `reason`; `promotion_state`; `resulting_case_id`),
     and the response shape is the `{ seed, review, audit }` that
     getIntakeReviewDetail() returns. A fixture that agreed with the renderer
     instead of the record would hide exactly the bug it is here to prevent.

     WRITES STAY BLOCKED. Nothing here makes ACCEPT, REJECT or resume work in
     demo mode; those still go through demoGuard().
     ───────────────────────────────────────────────────────────────────────── */

  var EPISTEMIC = {
    reported_situation:    'CLIENT_REPORTED_OBSERVATION',
    recent_examples:       'CLIENT_REPORTED_SELF_REPORT',
    observed_impact:       'CLIENT_STATED_NOT_MEASURED',
    change_context:        'TEMPORAL_ASSOCIATION_ONLY_NOT_CAUSAL',
    client_belief:         'CLIENT_CLAIM_UNVERIFIED',
    evidence_availability: 'AVAILABILITY_ONLY_NOT_EVIDENCE',
    desired_outcome:       'CLIENT_STATED_GOAL_NOT_AN_INTERVENTION'
  };

  function seedOf(row, body) {
    return Object.assign({
      intakeseed_id: row.intakeseed_id,
      submission_reference: row.reference,
      submitted_at: Date.parse(row.received_at),
      case_intent: row.intent,
      scope: { kind: row.scope_kind, labels: [] },
      timeline: { first_noticed_approx: '', pattern: 'unclear', associated_change_note: '' },
      recent_examples: [], observed_impact: [], change_context: [],
      client_belief: '', evidence_availability: [],
      consent: { data_use: true, ai_transparency_ack: true, sensitive_data_ack: true },
      locale: 'ar',
      untrusted_scan: row.flagged
        ? { clean: false, flagged_fields: ['reported_situation'] }
        : { clean: true, flagged_fields: [] },
      epistemic_status: EPISTEMIC,
      record_kind: 'PENDING_INTAKE_SEED',
      immutable: true,
      note: 'Client-reported submission. Not a Case, not Evidence, not a finding. Nothing here has been verified.'
    }, body);
  }

  function reviewOf(row, extra) {
    return Object.assign({
      intakereview_id: 'irv_demo_' + row.intakeseed_id.slice(-1),
      intakeseed_id: row.intakeseed_id,
      submission_reference: row.reference,
      status: row.status,
      decided_at: row.decided_at ? Date.parse(row.decided_at) : null,
      decided_by: row.decided_by || null,
      decided_by_type: row.decided_by ? 'human' : null,
      decision_reason: row.reason || null,
      promotion_state: row.promotion_state,
      promotion_plan: null,
      promotion_attempts: 0,
      promotion_started_at: null,
      promotion_completed_at: null,
      promotion_last_error: null,
      created_at: Date.parse(row.received_at),
      updated_at: Date.parse(row.decided_at || row.received_at),
      version: row.status === 'PENDING_REVIEW' ? 1 : 2,
      resulting_organization_id: null,
      resulting_case_id: row.resulting_case_id || null
    }, extra);
  }

  function auditRow(id, at, event, actor_type) {
    return { id: id, at: Date.parse(at), event: event, actor_type: actor_type };
  }

  var Q = {};
  QUEUE.forEach(function (r) { Q[r.intakeseed_id] = r; });

  var DETAIL = {
    /* a — pending, clean. The decision panel is shown; pressing it is guarded. */
    seed_demo_a: {
      seed: seedOf(Q.seed_demo_a, {
        organization_context: { company_name: L('شركة المثال للتجارة', 'Example Trading Co.'),
                                sector: L('تجارة الجملة', 'Wholesale trade'), employee_count_band: '51-200',
                                growth_stage: 'growing' },
        respondent_context: { name: L('نورة الحربي', 'Noura Al-Harbi'), role_title: L('مديرة الموارد البشرية', 'HR Manager'),
                              email: 'noura@example.com', preferred_contact: 'email' },
        scope: { kind: 'process', labels: [L('المشتريات', 'Purchasing'), L('المالية', 'Finance')] },
        timeline: { first_noticed_approx: L('بعد التوسّع في الربع الأول', 'After the Q1 expansion'),
                    pattern: 'increasing', associated_change_note: L('افتُتح فرعان جديدان.', 'Two new branches opened.') },
        reported_situation: L(
          'كل طلب شراء — حتى الصغير — يحتاج توقيع الرئيس التنفيذي. الطلبات تتكدّس أياماً، والموردون بدأوا يشتكون من التأخير.',
          'Every purchase request, even a small one, needs the chief executive’s signature. Requests pile up for days, and suppliers have started complaining about the delay.'),
        recent_examples: [
          { what_happened: L('طلب قطع غيار بقيمة بسيطة انتظر أربعة أيام.', 'A low-value spare-parts order waited four days.'),
            approx_when: L('الأسبوع الماضي', 'Last week'), area: L('الصيانة', 'Maintenance'),
            observable_consequence: L('توقفت شاحنة عن العمل يومين.', 'A truck was off the road for two days.') }
        ],
        observed_impact: [
          { kind: 'delays', description: L('تأخر الطلبات التشغيلية.', 'Operational orders are delayed.') },
          { kind: 'management_time', description: L('وقت طويل من الرئيس التنفيذي في التوقيعات.', 'A lot of executive time spent signing.') }
        ],
        change_context: [{ kind: 'rapid_growth', note: L('فرعان جديدان في ستة أشهر.', 'Two new branches in six months.') }],
        client_belief: L('أعتقد أن صلاحيات الصرف غير واضحة.', 'I think the spending authority limits are unclear.'),
        evidence_availability: [
          { kind: 'delegation_matrix', note: L('موجودة لكنها قديمة.', 'It exists but is out of date.') },
          { kind: 'workflow_system_data', note: '' }
        ],
        desired_outcome: L('نريد أن نعرف أين تتوقف الطلبات فعلاً، ومن يملك قرار الصرف.',
                           'We want to know where requests actually stop, and who owns the spending decision.')
      }),
      review: reviewOf(Q.seed_demo_a),
      audit: [auditRow('aud_a1', '2026-09-17T06:14:00.000Z', 'intake.submitted', 'client')]
    },

    /* b — pending, and the untrusted scan flagged a field. */
    seed_demo_b: {
      seed: seedOf(Q.seed_demo_b, {
        organization_context: { company_name: L('مجموعة الأفق الصناعية', 'Ufuq Industrial Group'),
                                sector: L('التصنيع', 'Manufacturing'), employee_count_band: '201-500',
                                growth_stage: 'scaling' },
        respondent_context: { name: L('خالد العتيبي', 'Khalid Al-Otaibi'), role_title: L('مدير العمليات', 'Operations Director'),
                              email: 'khalid@example.com', preferred_contact: 'phone' },
        scope: { kind: 'company_wide', labels: [] },
        timeline: { first_noticed_approx: L('منذ بداية العام', 'Since the start of the year'),
                    pattern: 'persistent', associated_change_note: '' },
        reported_situation: L(
          'ثلاثة من كبار المشغّلين قاربوا التقاعد، ولا توجد وثائق للعمليات التي يديرونها. نخشى أن تختفي المعرفة قبل التوسّع.',
          'Three of our senior operators are close to retirement, and the processes they run are undocumented. We are afraid the knowledge disappears before the expansion.'),
        recent_examples: [],
        observed_impact: [{ kind: 'growth_constraint', description: L('تأجيل خط إنتاج جديد.', 'A new production line was postponed.') }],
        change_context: [{ kind: 'headcount_change', note: '' }],
        client_belief: '',
        evidence_availability: [{ kind: 'unsure', note: '' }],
        desired_outcome: L('نريد معرفة ما الذي نخسره فعلاً إذا تقاعدوا، وما الذي يمكن توثيقه أولاً.',
                           'We want to know what we actually lose if they retire, and what can be documented first.')
      }),
      review: reviewOf(Q.seed_demo_b),
      audit: [
        auditRow('aud_b1', '2026-09-17T11:48:00.000Z', 'intake.submitted', 'client'),
        auditRow('aud_b2', '2026-09-17T11:48:01.000Z', 'intake.flagged', 'system')
      ]
    },

    /* c — accepted, promotion COMPLETE, with a case to open. */
    seed_demo_c: {
      seed: seedOf(Q.seed_demo_c, {
        organization_context: { company_name: L('شركة المثال للتجارة', 'Example Trading Co.'),
                                sector: L('تجارة التجزئة', 'Retail'), employee_count_band: '51-200', growth_stage: 'growing' },
        respondent_context: { name: L('سارة القحطاني', 'Sara Al-Qahtani'), role_title: L('مديرة التطوير التنظيمي', 'OD Manager'),
                              email: 'sara@example.com', preferred_contact: 'email' },
        scope: { kind: 'multiple_areas', labels: [L('المبيعات', 'Sales'), L('التشغيل', 'Operations')] },
        timeline: { first_noticed_approx: L('منذ ستة أشهر', 'About six months ago'), pattern: 'persistent', associated_change_note: '' },
        reported_situation: L(
          'المبيعات تعد العملاء بمواعيد لا يستطيع التشغيل الوفاء بها، والاثنان يلومان بعضهما في كل اجتماع.',
          'Sales promises customers dates operations cannot meet, and the two blame each other in every meeting.'),
        recent_examples: [
          { what_happened: L('طلب كبير تأخر أسبوعين عن الموعد الموعود.', 'A large order shipped two weeks after the promised date.'),
            approx_when: L('الشهر الماضي', 'Last month'), area: L('التشغيل', 'Operations'),
            observable_consequence: L('خصم تعويضي للعميل.', 'A compensating discount for the customer.') }
        ],
        observed_impact: [{ kind: 'customer_impact', description: '' }, { kind: 'quality_rework', description: '' }],
        change_context: [{ kind: 'new_system', note: L('نظام طلبات جديد قبل عام.', 'A new order system a year ago.') }],
        client_belief: L('أظن أن المشكلة في التخطيط لا في الأشخاص.', 'I think the problem is planning, not people.'),
        evidence_availability: [{ kind: 'kpi_reports', note: '' }, { kind: 'meeting_decision_records', note: '' }],
        desired_outcome: L('نريد أن نفهم أين ينكسر الوعد بالموعد بالضبط.',
                           'We want to understand exactly where the delivery promise breaks.')
      }),
      review: reviewOf(Q.seed_demo_c, {
        promotion_started_at: Date.parse('2026-09-15T14:30:05.000Z'),
        promotion_completed_at: Date.parse('2026-09-15T14:30:09.000Z'),
        promotion_attempts: 1,
        resulting_organization_id: 'org_demo00000000000000000000',
        resulting_case_id: 'case_demo0000000000000000000'
      }),
      audit: [
        auditRow('aud_c1', '2026-09-15T08:02:00.000Z', 'intake.submitted', 'client'),
        auditRow('aud_c2', '2026-09-15T14:30:00.000Z', 'intake.decided', 'human'),
        auditRow('aud_c3', '2026-09-15T14:30:09.000Z', 'intake.promoted', 'system')
      ]
    },

    /* d — declined, with the reviewer's reason on the record. */
    seed_demo_d: {
      seed: seedOf(Q.seed_demo_d, {
        organization_context: { company_name: L('مؤسسة النخبة', 'Nukhba Establishment'),
                                sector: L('خدمات', 'Services'), employee_count_band: '11-50', growth_stage: 'stable' },
        respondent_context: { name: L('فهد السالم', 'Fahad Al-Salem'), role_title: L('الشريك المؤسس', 'Founding Partner'),
                              email: 'fahad@example.com', preferred_contact: 'email' },
        scope: { kind: 'unsure', labels: [] },
        timeline: { first_noticed_approx: '', pattern: 'unclear', associated_change_note: '' },
        reported_situation: L(
          'لدينا نزاع قائم مع شريك سابق ونريد رأياً يدعم موقفنا أمام المحكمة.',
          'We have an active dispute with a former partner and want an opinion that supports our position in court.'),
        recent_examples: [],
        observed_impact: [],
        change_context: [],
        client_belief: '',
        evidence_availability: [],
        desired_outcome: L('نريد تقريراً نستخدمه في القضية.', 'We want a report to use in the case.')
      }),
      review: reviewOf(Q.seed_demo_d),
      audit: [
        auditRow('aud_d1', '2026-09-14T19:20:00.000Z', 'intake.submitted', 'client'),
        auditRow('aud_d2', '2026-09-16T07:10:00.000Z', 'intake.decided', 'human')
      ]
    },

    /* e — accepted, promotion PENDING. The resume action is offered, and
           guarded: in demo mode pressing it changes nothing. */
    seed_demo_e: {
      seed: seedOf(Q.seed_demo_e, {
        organization_context: { company_name: L('شركة بناء الحديثة', 'Modern Build Co.'),
                                sector: L('المقاولات', 'Construction'), employee_count_band: '201-500', growth_stage: 'scaling' },
        respondent_context: { name: L('منى الزهراني', 'Muna Al-Zahrani'), role_title: L('مديرة المشاريع', 'Projects Manager'),
                              email: 'muna@example.com', preferred_contact: 'whatsapp' },
        scope: { kind: 'team', labels: [L('فريق التسليم', 'Delivery team')] },
        timeline: { first_noticed_approx: L('منذ ثلاثة أشهر', 'Three months ago'), pattern: 'intermittent', associated_change_note: '' },
        reported_situation: L(
          'فريق التسليم يتغيّر أفراده باستمرار، وكل مشروع يبدأ من الصفر في الشرح.',
          'The delivery team keeps changing members, and every project starts from scratch in explanation.'),
        recent_examples: [],
        observed_impact: [{ kind: 'turnover', description: '' }, { kind: 'workload', description: '' }],
        change_context: [{ kind: 'leadership_change', note: '' }],
        client_belief: '',
        evidence_availability: [{ kind: 'workforce_data', note: '' }],
        desired_outcome: L('نريد أن نعرف سبب دوران الفريق قبل الموسم القادم.',
                           'We want to know why the team turns over, before the next season.')
      }),
      review: reviewOf(Q.seed_demo_e, {
        promotion_started_at: Date.parse('2026-09-16T09:15:02.000Z'),
        promotion_attempts: 2,
        promotion_last_error: 'store_write_timeout'
      }),
      audit: [
        auditRow('aud_e1', '2026-09-16T05:30:00.000Z', 'intake.submitted', 'client'),
        auditRow('aud_e2', '2026-09-16T09:15:00.000Z', 'intake.decided', 'human'),
        auditRow('aud_e3', '2026-09-16T09:15:02.000Z', 'intake.promotion_failed', 'system')
      ]
    }
  };

  global.HV = global.HV || {};
  global.HV.demo = {
    CASE: CASE, QUEUE: QUEUE, WORKSPACE: WORKSPACE, DETAIL: DETAIL,
    /** Resolve a localised fixture value for the current language. */
    L: function (v, lang) { return typeof v === 'function' ? v(lang) : v; },

    /**
     * Resolve a whole fixture tree for one language.
     *
     * ADDED 2026-09-18. Fixture metadata was resolved once, at load, and the
     * resulting strings were then kept in page state — so switching language
     * re-rendered the screen around demo text that was still in the language
     * the page had opened in. Screens now resolve from the raw fixture on every
     * render, which costs nothing and cannot go stale.
     */
    resolve: function resolve(v, lang) {
      if (typeof v === 'function') return v(lang);
      if (Array.isArray(v)) return v.map(function (x) { return resolve(x, lang); });
      if (v && typeof v === 'object') {
        var out = {};
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = resolve(v[k], lang);
        return out;
      }
      return v;
    }
  };
})(window);
