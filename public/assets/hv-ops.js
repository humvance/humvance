/* ===========================================================================
   Humvance — N-01: the practitioner write surface.
   ---------------------------------------------------------------------------
   PB-2026-09-18.1 · BETA-01 Rev 2 §5 · internal single-operator beta, synthetic
   records only.

   WHY THIS FILE EXISTS. The case API has had every operation a practitioner
   needs since Sprint 1, and no screen reached any of them. A walkthrough of one
   real case (tests/probes/case-journey.js) had to perform every write as a raw
   API call. This module is the missing surface — and nothing more than that.

   WHAT IT DOES NOT DO, deliberately:

     · It invents no operation. Every entry in FORMS maps to an `op` already in
       the dispatcher's OPS set in api/v2/case.js. There is no general
       hypothesis edit, no contradiction resolution, no membership grant and no
       client delivery, because the API has none.
     · It sends no request in demo mode. `?demo=1` stays read-only; the panel
       renders disabled with an explanation.
     · It never retries a refused write by itself, and never replays a write the
       server rejected on a version conflict.
     · It escapes everything. Evidence is a client's words — content, never
       markup and never an instruction.

   THE CONTRACT THIS FILE LEANS ON. Read api/v2/case.js before changing a spec
   here: the body shape, the required fields and the `expected_version`
   placement are the handler's, not this file's. When they disagree the handler
   wins and this file is wrong.
   =========================================================================== */
(function (global) {
  'use strict';

  var I = global.HV.i18n;
  var t = I.t, esc = I.esc;

  /* ── Vocabularies, taken from the backend's own enumerations ────────────
     Duplicated here as display lists only. If _domain.js gains a value, the
     select is short by one — which a test catches — rather than the page
     inventing one the server would refuse. */
  var V = {
    hypothesis_state: ['PROPOSED', 'ACTIVE', 'STRENGTHENED', 'WEAKENED', 'NOT_SUPPORTED', 'UNRESOLVED'],
    source_type: ['interview', 'survey', 'document', 'system_record', 'observation', 'sponsor_statement', 'legacy_unverified'],
    verification: ['UNVERIFIED', 'CORROBORATED', 'DISPUTED', 'SUPERSEDED'],
    contradiction_kind: ['person_vs_person', 'policy_vs_practice', 'claim_vs_data', 'current_vs_historical', 'finding_vs_counterexample'],
    request_decision: ['APPROVED', 'REJECTED'],
    approval_decision: ['APPROVED', 'MODIFIED', 'MORE_EVIDENCE_REQUIRED', 'REJECTED'],
    case_state: ['INTAKE', 'STRUCTURING', 'INVESTIGATION_PLANNING', 'HUMAN_REVIEW', 'AWAITING_EVIDENCE',
                 'ANALYZING_EVIDENCE', 'CLARIFICATION_REQUIRED', 'FINDING_DRAFT', 'CHALLENGE_REVIEW',
                 'HUMAN_APPROVAL', 'APPROVED'],
    burden: ['already_held', 'answerable_from_existing', 'materially_changes', 'lower_burden_source', 'necessary_now']
  };

  /* ── The operations, one spec each ──────────────────────────────────────
     `material: true` means the operator is asked to confirm in a second step.
     `target` names the object a version must be read from. */
  var FORMS = [
    /* ── hypotheses ───────────────────────────────────────────────────── */
    {
      op: 'add_hypothesis', tab: 'hypotheses', icon: 'branch',
      fields: [
        { k: 'label', kind: 'text', max: 40, required: true },
        { k: 'statement', kind: 'textarea', max: 2000, required: true }
      ],
      build: function (v, c) {
        return { op: 'add_hypothesis', organization_id: c.org, case_id: c.caseId, label: v.label, statement: v.statement };
      }
    },
    {
      op: 'set_hypothesis_state', tab: 'hypotheses', icon: 'compass', material: true,
      target: { list: 'hypotheses', id: 'hypothesis_id', labelOf: function (h) { return (h.label ? h.label + ' — ' : '') + h.statement; } },
      fields: [
        { k: 'to_state', kind: 'select', options: V.hypothesis_state, ns: 'ws.hyp', required: true },
        { k: 'because', kind: 'textarea', max: 1000, required: true, hint: 'op.hint.because' }
      ],
      build: function (v, c) {
        return { op: 'set_hypothesis_state', organization_id: c.org, hypothesis_id: v.__target,
                 to_state: v.to_state, expected_version: v.__version, because: v.because };
      }
    },

    /* ── evidence ─────────────────────────────────────────────────────── */
    {
      op: 'add_evidence', tab: 'evidence', icon: 'evidence',
      fields: [
        { k: 'source_type', kind: 'select', options: V.source_type, ns: 'ws.src', required: true },
        { k: 'source_name', kind: 'text', max: 200, required: true, hint: 'op.hint.source_name' },
        { k: 'source_date', kind: 'date' },
        { k: 'original_content', kind: 'textarea', max: 20000, required: true, hint: 'op.hint.original_content' },
        { k: 'limitations', kind: 'lines', hint: 'op.hint.limitations' }
      ],
      build: function (v, c) {
        return { op: 'add_evidence', organization_id: c.org, case_id: c.caseId,
                 source_type: v.source_type, source_name: v.source_name,
                 source_date: v.source_date || null, original_content: v.original_content,
                 limitations: v.limitations };
      }
    },
    {
      op: 'update_evidence', tab: 'evidence', icon: 'layers', material: true,
      target: { list: 'evidence', id: 'evidence_id', labelOf: function (e) { return e.source_type + ' · ' + e.source_name; } },
      note: 'op.note.update_evidence',
      fields: [
        { k: 'verification_status', kind: 'select', options: V.verification, ns: 'ws.v' },
        { k: 'limitations', kind: 'lines' }
      ],
      build: function (v, c) {
        var patch = {};
        if (v.verification_status) patch.verification_status = v.verification_status;
        if (v.limitations && v.limitations.length) patch.limitations = v.limitations;
        return { op: 'update_evidence', organization_id: c.org, evidence_id: v.__target,
                 patch: patch, expected_version: v.__version };
      },
      validate: function (v) {
        if (!v.verification_status && !(v.limitations && v.limitations.length)) return 'op.err.emptyPatch';
        return null;
      }
    },
    {
      op: 'propose_evidence_request', tab: 'evidence', icon: 'inbox',
      note: 'op.note.burden',
      fields: [
        { k: 'requested_item', kind: 'textarea', max: 1000, required: true },
        { k: 'reason', kind: 'textarea', max: 1000, required: true, hint: 'op.hint.reason' },
        { k: 'uncertainty_resolved', kind: 'text', max: 300, required: true, hint: 'op.hint.uncertainty' },
        { k: 'burden_gate', kind: 'burden', required: true }
      ],
      build: function (v, c) {
        return { op: 'propose_evidence_request', organization_id: c.org, case_id: c.caseId,
                 requested_item: v.requested_item, reason: v.reason,
                 uncertainty_resolved: v.uncertainty_resolved, burden_gate: v.burden_gate,
                 estimated_burden: 'unknown' };
      }
    },
    {
      op: 'decide_evidence_request', tab: 'evidence', icon: 'scale', material: true,
      target: { list: 'evidenceRequests', id: 'evidence_request_id', labelOf: function (r) { return r.requested_item; } },
      fields: [
        { k: 'decision', kind: 'select', options: V.request_decision, ns: 'ws.d', required: true },
        { k: 'comment', kind: 'textarea', max: 1000 }
      ],
      build: function (v, c) {
        return { op: 'decide_evidence_request', organization_id: c.org, evidence_request_id: v.__target,
                 decision: v.decision, expected_version: v.__version, comment: v.comment };
      }
    },

    /* ── contradictions ───────────────────────────────────────────────── */
    {
      op: 'record_contradiction', tab: 'gaps', icon: 'conflict',
      fields: [
        { k: 'kind', kind: 'select', options: V.contradiction_kind, ns: 'ws.ckind', required: true },
        { k: 'summary', kind: 'textarea', max: 1000, required: true, hint: 'op.hint.contradiction' },
        { k: 'left_evidence_id', kind: 'pick', list: 'evidence', id: 'evidence_id',
          labelOf: function (e) { return e.source_type + ' · ' + e.source_name; } },
        { k: 'right_evidence_id', kind: 'pick', list: 'evidence', id: 'evidence_id',
          labelOf: function (e) { return e.source_type + ' · ' + e.source_name; } }
      ],
      build: function (v, c) {
        return { op: 'record_contradiction', organization_id: c.org, case_id: c.caseId, kind: v.kind,
                 summary: v.summary, left_evidence_id: v.left_evidence_id || null,
                 right_evidence_id: v.right_evidence_id || null };
      }
    },

    /* ── findings ─────────────────────────────────────────────────────── */
    {
      op: 'draft_finding', tab: 'findings', icon: 'target',
      note: 'op.note.strength',
      fields: [
        { k: 'statement', kind: 'textarea', max: 4000, required: true },
        { k: 'scope', kind: 'text', max: 1000, required: true, hint: 'op.hint.scope' },
        { k: 'supporting_evidence', kind: 'multi', list: 'evidence', id: 'evidence_id',
          labelOf: function (e) { return e.source_type + ' · ' + e.source_name; } },
        { k: 'counter_evidence', kind: 'multi', list: 'evidence', id: 'evidence_id',
          labelOf: function (e) { return e.source_type + ' · ' + e.source_name; } },
        { k: 'alternative_explanations', kind: 'lines' },
        { k: 'limitations', kind: 'lines' }
      ],
      build: function (v, c) {
        return { op: 'draft_finding', organization_id: c.org, case_id: c.caseId,
                 statement: v.statement, scope: v.scope,
                 supporting_evidence: v.supporting_evidence, counter_evidence: v.counter_evidence,
                 alternative_explanations: v.alternative_explanations, limitations: v.limitations };
      }
    },
    {
      op: 'revise_finding', tab: 'findings', icon: 'edit', material: true,
      target: { list: 'findings', id: 'finding_id', labelOf: function (f) { return 'v' + f.version + ' · ' + f.statement; } },
      note: 'op.note.revise',
      fields: [
        { k: 'statement', kind: 'textarea', max: 4000 },
        { k: 'scope', kind: 'text', max: 1000 },
        { k: 'limitations', kind: 'lines' },
        { k: 'alternative_explanations', kind: 'lines' }
      ],
      build: function (v, c) {
        var patch = {};
        if (v.statement) patch.statement = v.statement;
        if (v.scope) patch.scope = v.scope;
        if (v.limitations && v.limitations.length) patch.limitations = v.limitations;
        if (v.alternative_explanations && v.alternative_explanations.length) patch.alternative_explanations = v.alternative_explanations;
        return { op: 'revise_finding', organization_id: c.org, finding_id: v.__target,
                 patch: patch, expected_version: v.__version };
      },
      validate: function (v) {
        if (!v.statement && !v.scope && !(v.limitations || []).length && !(v.alternative_explanations || []).length) {
          return 'op.err.emptyPatch';
        }
        return null;
      }
    },
    {
      op: 'run_challenge', tab: 'findings', icon: 'shield',
      note: 'op.note.challenge',
      target: { list: 'findings', id: 'finding_id', labelOf: function (f) { return 'v' + f.version + ' · ' + f.statement; }, noVersion: true },
      fields: [],
      build: function (v, c) {
        return { op: 'run_challenge', organization_id: c.org, case_id: c.caseId, finding_id: v.__target };
      }
    },
    {
      op: 'record_approval', tab: 'findings', icon: 'approved', material: true,
      note: 'op.note.approval',
      target: { list: 'findings', id: 'finding_id', labelOf: function (f) { return 'v' + f.version + ' · ' + f.statement; } },
      fields: [
        { k: 'decision', kind: 'select', options: V.approval_decision, ns: 'ws.d', required: true },
        { k: 'comment', kind: 'textarea', max: 2000, hint: 'op.hint.approvalComment' }
      ],
      build: function (v, c) {
        return { op: 'record_approval', organization_id: c.org, case_id: c.caseId,
                 artifact_type: 'finding', artifact_id: v.__target, artifact_version: v.__version,
                 decision: v.decision, comment: v.comment };
      }
    },

    /* ── case state ───────────────────────────────────────────────────── */
    {
      op: 'transition', tab: 'overview', icon: 'handoff', material: true,
      note: 'op.note.transition',
      fields: [
        { k: 'to_state', kind: 'select', options: V.case_state, ns: 'ws.cs', required: true }
      ],
      build: function (v, c) {
        return { op: 'transition', organization_id: c.org, case_id: c.caseId,
                 to_state: v.to_state, expected_version: (c.bundle && c.bundle.case && c.bundle.case.version) };
      }
    }
  ];

  function formsFor(tab) { return FORMS.filter(function (f) { return f.tab === tab; }); }

  /* ── What survives a re-render ───────────────────────────────────────────
     A successful write is followed by a read-back from the server, and the
     read-back re-renders the whole page — which would erase the very answer the
     operator needs to see. So the outcome of the last write per operation is
     kept here and re-drawn by panelFor, along with which form was open.

     Only the SERVER'S OWN field names and values are kept (`rows`); the wording
     around them is translated again at render time, so switching language does
     not leave a sentence in the other one. A version conflict is NOT kept: that
     path never reloads, its DOM survives, and its Refresh button must stay the
     one the click handler was bound to. */
  var LAST = {};
  var OPEN = {};

  /* ── Unsaved work, and a decision that has been reviewed ─────────────────
     BETA-R02. The page rebuilds `#app` wholesale on a language switch, a tab
     change and every read-back, so a half-typed evidence note simply vanished.
     Nobody loses three paragraphs of an interview twice before they stop
     trusting the screen.

     DRAFTS keeps what is in the form, keyed by ORGANIZATION, CASE and OPERATION
     together — so a draft can never surface on a different case, which would be
     far worse than losing it. It is in-memory only: it lives as long as the tab
     and is never written to storage, because an interview note is a client's
     words and does not belong in localStorage.

     BETA-R01. PENDING holds the ONE payload the operator actually reviewed,
     frozen at the moment the confirmation was rendered. `run()` sends that
     object and never re-reads the form, because re-reading is precisely how a
     confirmation showing ACTIVE came to submit NOT_SUPPORTED. Any edit to the
     form, and any re-render of the panel, discards it and the operator has to
     review again. Restoring a draft therefore never revives a pending decision,
     and an expected_version is never quietly swapped underneath one. */
  var DRAFTS = {};
  var PENDING = {};

  function scopeOf(ctx) { return (ctx && ctx.org ? ctx.org : '-') + '|' + (ctx && ctx.caseId ? ctx.caseId : '-'); }
  function draftKey(ctx, op) { return scopeOf(ctx) + '|' + op; }
  function draftFor(ctx, op) { return DRAFTS[draftKey(ctx, op)] || {}; }
  function invalidatePending(op) { if (op) { delete PENDING[op]; } else { PENDING = {}; } }
  function forgetAll() { LAST = {}; OPEN = {}; DRAFTS = {}; PENDING = {}; }

  /* ── Field rendering ────────────────────────────────────────────────── */

  function optLabel(ns, v) {
    var key = ns + '.' + v;
    return I.has(key) ? t(key) : v;
  }

  function listOf(ctx, name) {
    var b = ctx.bundle || {};
    return b[name] || [];
  }

  function fieldId(op, k) { return 'op-' + op + '-' + k; }

  /* `draft` is what the operator had typed before the last re-render. It is
     written back into the markup rather than re-applied afterwards, so the form
     is correct on first paint and there is no flash of an empty field. */
  function renderField(f, spec, ctx, draft) {
    var id = fieldId(spec.op, f.k);
    var lab = t('op.f.' + f.k);
    var req = f.required ? '<span class="hv-req">*</span>' : '';
    var hint = f.hint ? '<p class="hv-help">' + esc(t(f.hint)) + '</p>' : '';
    var head = '<label class="hv-label" for="' + id + '">' + esc(lab) + req + '</label>' + hint;
    var d = draft ? draft[f.k] : undefined;

    if (f.kind === 'textarea') {
      return '<div class="hv-field">' + head +
        '<textarea class="hv-textarea" id="' + id + '" data-op-f="' + f.k + '" maxlength="' + f.max + '">' +
        esc(d || '') + '</textarea></div>';
    }
    if (f.kind === 'text' || f.kind === 'date') {
      return '<div class="hv-field">' + head +
        '<input class="hv-input" id="' + id + '" data-op-f="' + f.k + '" type="' + (f.kind === 'date' ? 'date' : 'text') + '"' +
        (f.max ? ' maxlength="' + f.max + '"' : '') + ' value="' + esc(d || '') + '"></div>';
    }
    if (f.kind === 'lines') {
      return '<div class="hv-field">' + head +
        '<textarea class="hv-textarea" style="min-height:70px" id="' + id + '" data-op-f="' + f.k + '" data-op-lines="1">' +
        esc(Array.isArray(d) ? d.join('\n') : (d || '')) + '</textarea>' +
        '<p class="hv-help">' + esc(t('op.hint.onePerLine')) + '</p></div>';
    }
    if (f.kind === 'select') {
      return '<div class="hv-field">' + head +
        '<select class="hv-select" id="' + id + '" data-op-f="' + f.k + '">' +
        '<option value="">' + esc(t('op.choose')) + '</option>' +
        f.options.map(function (o) {
          return '<option value="' + esc(o) + '"' + (d === o ? ' selected' : '') + '>' +
            esc(optLabel(f.ns, o)) + '</option>';
        }).join('') + '</select></div>';
    }
    if (f.kind === 'pick' || f.kind === 'multi') {
      var items = listOf(ctx, f.list);
      if (!items.length) {
        return '<div class="hv-field">' + head +
          '<p class="hv-xs hv-muted">' + esc(t('op.noneYet')) + '</p></div>';
      }
      if (f.kind === 'pick') {
        return '<div class="hv-field">' + head +
          '<select class="hv-select" id="' + id + '" data-op-f="' + f.k + '">' +
          '<option value="">' + esc(t('op.choose')) + '</option>' +
          items.map(function (x) {
            return '<option value="' + esc(x[f.id]) + '"' + (d === x[f.id] ? ' selected' : '') + '>' +
              esc(String(f.labelOf(x)).slice(0, 90)) + '</option>';
          }).join('') + '</select></div>';
      }
      var chosen = Array.isArray(d) ? d : [];
      return '<div class="hv-field">' + head +
        '<div class="op-checks" id="' + id + '" data-op-f="' + f.k + '" data-op-multi="1">' +
        items.map(function (x) {
          return '<label class="op-check"><input type="checkbox" value="' + esc(x[f.id]) + '"' +
            (chosen.indexOf(x[f.id]) !== -1 ? ' checked' : '') + '>' +
            '<span>' + esc(String(f.labelOf(x)).slice(0, 90)) + '</span></label>';
        }).join('') + '</div></div>';
    }
    if (f.kind === 'burden') {
      var g = (d && typeof d === 'object') ? d : {};
      return '<div class="hv-field">' + head +
        '<div class="op-checks" id="' + id + '" data-op-f="' + f.k + '" data-op-burden="1">' +
        V.burden.map(function (q) {
          return '<label class="op-check"><input type="checkbox" value="' + esc(q) + '"' +
            (g[q] ? ' checked' : '') + '>' +
            '<span>' + esc(t('op.burden.' + q)) + '</span></label>';
        }).join('') + '</div>' +
        '<p class="hv-help">' + esc(t('op.hint.burdenGate')) + '</p></div>';
    }
    return '';
  }

  function renderTarget(spec, ctx, draft) {
    if (!spec.target) return '';
    var items = listOf(ctx, spec.target.list);
    var id = fieldId(spec.op, '__target');
    if (!items.length) {
      return '<div class="hv-field"><label class="hv-label">' + esc(t('op.target')) + '</label>' +
        '<p class="hv-xs hv-muted">' + esc(t('op.noneYet')) + '</p></div>';
    }
    /* The selection is restored; the VERSION attached to it is not. Every option
       carries the version the server reported in the bundle just loaded, so a
       restored choice always re-reads its current version rather than carrying a
       stale one forward. A decision already under review is discarded by
       panelFor before this runs, so no pending approval can inherit a version it
       was not shown. */
    var want = draft ? draft.__target : undefined;
    return '<div class="hv-field">' +
      '<label class="hv-label" for="' + id + '">' + esc(t('op.target')) + '<span class="hv-req">*</span></label>' +
      '<select class="hv-select" id="' + id + '" data-op-f="__target">' +
      '<option value="">' + esc(t('op.choose')) + '</option>' +
      items.map(function (x) {
        var v = x.version === undefined ? '' : ' data-op-version="' + esc(String(x.version)) + '"';
        var sel = want && want === x[spec.target.id] ? ' selected' : '';
        return '<option value="' + esc(x[spec.target.id]) + '"' + v + sel + '>' +
          esc(String(spec.target.labelOf(x)).slice(0, 100)) + '</option>';
      }).join('') + '</select>' +
      (spec.target.noVersion ? '' :
        '<p class="hv-help" data-op-versionnote="' + esc(spec.op) + '">' + esc(t('op.versionNote')) + '</p>') +
      '</div>';
  }

  /* ── The panel ──────────────────────────────────────────────────────── */

  function panelFor(tab, ctx) {
    var specs = formsFor(tab);
    if (!specs.length) return '';

    /* Re-rendering the panel means the context underneath a reviewed decision
       may have moved — a fresh bundle, a different case, another language. The
       confirmation the operator read is discarded here, unconditionally, so a
       decision can only ever be sent from a review of the state it was shown
       against. Losing a confirmation costs one click; keeping a stale one costs
       a wrong write to a client's case. */
    invalidatePending();

    if (ctx.isDemo) {
      return '<div class="op-panel op-panel-demo">' +
        '<div class="op-panel-head">' + HVIcons.icon('lock', { size: 15 }) +
          '<strong>' + esc(t('op.panel.title')) + '</strong></div>' +
        '<p class="hv-sm hv-muted">' + esc(t('op.demoReadOnly')) + '</p></div>';
    }
    if (!ctx.org || !ctx.caseId) {
      return '<div class="op-panel"><div class="op-panel-head">' + HVIcons.icon('lock', { size: 15 }) +
        '<strong>' + esc(t('op.panel.title')) + '</strong></div>' +
        '<p class="hv-sm hv-muted">' + esc(t('op.needCase')) + '</p></div>';
    }

    return '<div class="op-panel">' +
      '<div class="op-panel-head">' + HVIcons.icon('role', { size: 15 }) +
        '<strong>' + esc(t('op.panel.title')) + '</strong>' +
        '<span class="op-panel-sub">' + esc(t('op.panel.sub')) + '</span></div>' +
      specs.map(function (spec) {
        var last = LAST[spec.op];
        var draft = draftFor(ctx, spec.op);
        var hasDraft = Object.keys(draft).length > 0;
        return '<details class="op-form" data-op="' + esc(spec.op) + '"' +
            ((OPEN[spec.op] || hasDraft) ? ' open' : '') + '>' +
          '<summary>' + HVIcons.icon(spec.icon, { size: 15 }) +
            '<span>' + esc(t('op.op.' + spec.op)) + '</span>' +
            (hasDraft ? '<span class="op-draft">' + esc(t('op.draftKept')) + '</span>' : '') +
            '<span class="op-code">' + esc(spec.op) + '</span></summary>' +
          '<div class="op-form-body">' +
            (spec.note ? '<p class="op-note">' + HVIcons.icon('info', { size: 13 }) + ' ' + esc(t(spec.note)) + '</p>' : '') +
            renderTarget(spec, ctx, draft) +
            spec.fields.map(function (f) { return renderField(f, spec, ctx, draft); }).join('') +
            '<div class="op-actions">' +
              '<button class="hv-btn hv-btn-primary hv-btn-sm" type="button" data-op-run="' + esc(spec.op) + '">' +
                esc(t(spec.material ? 'op.review' : 'op.run')) + '</button>' +
              '<span class="op-status op-status-' + (last ? esc(last.kind) : '') + '" data-op-status="' + esc(spec.op) + '">' +
                (last ? esc(t(last.msgKey)) : '') + '</span>' +
            '</div>' +
            '<div class="op-result" data-op-result="' + esc(spec.op) + '">' +
              (last ? '<div class="op-ok"><strong>' + esc(t('op.serverSaid')) + '</strong>' + last.rows + '</div>' : '') +
            '</div>' +
          '</div></details>';
      }).join('') +
      '</div>';
  }

  /* ── Reading the form ───────────────────────────────────────────────── */

  function readForm(root, spec) {
    var v = {};
    var missing = [];
    var host = root.querySelector('[data-op="' + spec.op + '"]');
    if (!host) return { v: v, missing: ['host'] };

    if (spec.target) {
      var sel = host.querySelector('[data-op-f="__target"]');
      v.__target = sel ? sel.value : '';
      if (!v.__target) missing.push(t('op.target'));
      if (sel && sel.selectedOptions && sel.selectedOptions[0]) {
        var ver = sel.selectedOptions[0].getAttribute('data-op-version');
        v.__version = ver === null || ver === '' ? undefined : Number(ver);
      }
    }

    spec.fields.forEach(function (f) {
      var el = host.querySelector('[data-op-f="' + f.k + '"]');
      if (!el) { v[f.k] = f.kind === 'lines' || f.kind === 'multi' ? [] : ''; return; }
      if (f.kind === 'multi') {
        v[f.k] = Array.prototype.slice.call(el.querySelectorAll('input:checked')).map(function (i) { return i.value; });
      } else if (f.kind === 'burden') {
        var g = {};
        Array.prototype.slice.call(el.querySelectorAll('input')).forEach(function (i) { g[i.value] = i.checked; });
        v[f.k] = g;
      } else if (f.kind === 'lines') {
        v[f.k] = String(el.value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      } else {
        v[f.k] = String(el.value || '').trim();
      }
      if (f.required) {
        var empty = f.kind === 'multi' ? !v[f.k].length
                  : f.kind === 'burden' ? false
                  : !v[f.k];
        if (empty) missing.push(t('op.f.' + f.k));
      }
    });
    return { v: v, missing: missing, host: host };
  }

  /* ── Drafts ─────────────────────────────────────────────────────────────
     Capture is deliberately UNVALIDATED: half-typed work is exactly what has to
     survive, and refusing to keep it because a required field is still empty
     would defeat the point. Only fields the operator actually filled are kept,
     so an untouched form does not advertise a draft it does not have. */
  function meaningful(x) {
    if (x === undefined || x === null || x === '') return false;
    if (Array.isArray(x)) return x.length > 0;
    if (typeof x === 'object') return Object.keys(x).some(function (k) { return !!x[k]; });
    return true;
  }

  function captureDraft(ctx, spec, root) {
    var read = readForm(root, spec);
    if (read.missing.indexOf('host') !== -1) return;
    var keep = {};
    if (meaningful(read.v.__target)) keep.__target = read.v.__target;
    spec.fields.forEach(function (f) {
      if (meaningful(read.v[f.k])) keep[f.k] = read.v[f.k];
    });
    var key = draftKey(ctx, spec.op);
    if (Object.keys(keep).length) DRAFTS[key] = keep; else delete DRAFTS[key];
  }

  function clearDraft(ctx, op) { delete DRAFTS[draftKey(ctx, op)]; }

  /* ADDED 2026-09-19. Leaving the workspace by a header link discards whatever
     is held in DRAFTS, because nothing here is persisted — deliberately, since
     case evidence does not belong in browser storage. The page therefore has to
     be able to ASK before it navigates, and to ask it must know whether there is
     anything to lose. Scoped to the case on screen: an unsaved draft on a
     different case is not this navigation's business. Reading it changes
     nothing. */
  function hasDrafts(ctx) {
    var prefix = scopeOf(ctx) + '|';
    return Object.keys(DRAFTS).some(function (k) {
      return k.indexOf(prefix) === 0 && Object.keys(DRAFTS[k] || {}).length > 0;
    });
  }

  /* ── The decision, in words ─────────────────────────────────────────────
     BETA-R01 asks for a readable summary first and the raw payload second. A
     reviewer approving a finding should be reading a sentence in their own
     language, not scanning JSON for a changed enum. The JSON stays available
     underneath, because it is the thing actually being sent and hiding it would
     be its own kind of dishonesty. */
  function readable(spec, f, value, ctx) {
    if (Array.isArray(value)) return value.join(' · ');
    if (f && f.kind === 'burden') {
      return V.burden.filter(function (q) { return value && value[q]; })
        .map(function (q) { return t('op.burden.' + q); }).join(' · ') || t('rv.none');
    }
    if (f && f.kind === 'select' && f.ns) return optLabel(f.ns, value);
    if (f && (f.kind === 'pick' || f.kind === 'multi')) {
      var items = listOf(ctx, f.list);
      var hit = items.filter(function (x) { return x[f.id] === value; })[0];
      return hit ? String(f.labelOf(hit)) : String(value);
    }
    return String(value);
  }

  function summaryRows(spec, v, ctx) {
    var rows = [];
    if (spec.target && v.__target) {
      var items = listOf(ctx, spec.target.list);
      var hit = items.filter(function (x) { return x[spec.target.id] === v.__target; })[0];
      rows.push({ label: t('op.target'), value: hit ? String(spec.target.labelOf(hit)) : v.__target });
      if (v.__version !== undefined) {
        rows.push({ label: t('ws.k.version'), value: 'v' + v.__version });
      }
    }
    spec.fields.forEach(function (f) {
      if (!meaningful(v[f.k])) return;
      rows.push({ label: t('op.f.' + f.k), value: readable(spec, f, v[f.k], ctx) });
    });
    return rows;
  }

  /* ── Result rendering ───────────────────────────────────────────────── */

  function kv(k, val) {
    return '<div class="op-kv"><span>' + esc(k) + '</span><span>' + esc(String(val)) + '</span></div>';
  }

  /** What the server sent back, in the server's own words. Nothing invented. */
  function readBack(out) {
    if (!out || typeof out !== 'object') return '';
    var rows = [];
    ['hypothesis_id', 'evidence_id', 'contradiction_id', 'evidence_request_id',
     'finding_id', 'challenge_id', 'approval_id', 'case_id'].forEach(function (k) {
      if (out[k]) rows.push(kv(k, out[k]));
    });
    if (out.finding && out.finding.finding_id) rows.push(kv('finding_id', out.finding.finding_id));
    ['version', 'state', 'status', 'evidence_strength', 'verdict', 'decision', 'to_state'].forEach(function (k) {
      if (out[k] !== undefined && out[k] !== null) rows.push(kv(k, out[k]));
    });
    if (out.finding && out.finding.version !== undefined) rows.push(kv('version', out.finding.version));
    if (out.material_change !== undefined) rows.push(kv('material_change', out.material_change));
    if (Array.isArray(out.strength_caps) && out.strength_caps.length) {
      rows.push('<div class="op-caps"><strong>' + esc(t('op.caps')) + '</strong><ul>' +
        out.strength_caps.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>');
    }
    if (Array.isArray(out.checks)) {
      var failed = out.checks.filter(function (c) { return !c.passed; });
      rows.push('<div class="op-caps"><strong>' + esc(t('op.checks')) + ' (' + out.checks.length + ')</strong><ul>' +
        (failed.length
          ? failed.map(function (c) { return '<li>' + esc(c.id) + ' — ' + esc(c.conclusion) + '</li>'; }).join('')
          : '<li>' + esc(t('op.allChecksPassed')) + '</li>') + '</ul></div>');
    }
    return rows.join('');
  }

  /* ── Wiring ─────────────────────────────────────────────────────────── */

  function wire(ctx) {
    var root = document.getElementById('app');
    if (!root) return;

    root.querySelectorAll('[data-op-run]').forEach(function (btn) {
      var op = btn.getAttribute('data-op-run');
      var spec = FORMS.filter(function (f) { return f.op === op; })[0];
      if (!spec) return;
      btn.addEventListener('click', function () { run(ctx, spec, root, btn, null); });
    });

    /* Which form the operator had open, so a read-back does not close it. */
    root.querySelectorAll('details[data-op]').forEach(function (d) {
      d.addEventListener('toggle', function () { OPEN[d.getAttribute('data-op')] = d.open; });
    });

    /* Every edit does two things: it is remembered, so a re-render cannot throw
       it away (R02), and it retires any decision already under review, so the
       confirmation can never describe one thing while the form holds another
       (R01). Both listeners are on the form container and use the capture-free
       bubbling path, so a field added later is still covered. */
    root.querySelectorAll('details[data-op]').forEach(function (host) {
      var op = host.getAttribute('data-op');
      var spec = FORMS.filter(function (f) { return f.op === op; })[0];
      if (!spec) return;
      var onEdit = function () {
        captureDraft(ctx, spec, root);
        if (PENDING[op]) {
          invalidatePending(op);
          var box = root.querySelector('[data-op-result="' + op + '"]');
          if (box && box.querySelector('.op-confirm')) {
            setResult(root, op,
              '<div class="op-confirm op-confirm-stale">' +
                '<strong>' + esc(t('op.confirm.staleTitle')) + '</strong>' +
                '<p class="hv-xs">' + esc(t('op.confirm.staleBody')) + '</p>' +
              '</div>');
            setStatus(root, op, 'bad', t('op.confirm.staleShort'));
          }
        }
      };
      host.addEventListener('input', onEdit);
      host.addEventListener('change', onEdit);
    });
  }

  function setStatus(root, op, kind, msg) {
    var el = root.querySelector('[data-op-status="' + op + '"]');
    if (!el) return;
    el.className = 'op-status op-status-' + kind;
    el.textContent = msg || '';
  }
  function setResult(root, op, html) {
    var el = root.querySelector('[data-op-result="' + op + '"]');
    if (el) el.innerHTML = html || '';
  }

  /**
   * `reviewed` is either null — meaning this is the first press, read the form —
   * or the exact record frozen when the confirmation was rendered.
   *
   * BETA-R01 was here. The old code called `run(..., true)` from the Confirm
   * button and then read the form AGAIN, so anything typed while the
   * confirmation sat on screen silently replaced what the operator had read. A
   * confirmation that can describe one decision and send another is worse than
   * no confirmation at all: it manufactures a record of a review that did not
   * happen. The payload is now built once, kept, and sent unchanged.
   */
  async function run(ctx, spec, root, btn, reviewed) {
    var payload;

    if (reviewed) {
      /* The confirmation path. The form is NOT read here — deliberately. */
      if (PENDING[spec.op] !== reviewed || reviewed.scope !== scopeOf(ctx)) {
        invalidatePending(spec.op);
        setStatus(root, spec.op, 'bad', t('op.confirm.staleShort'));
        setResult(root, spec.op,
          '<div class="op-confirm op-confirm-stale">' +
            '<strong>' + esc(t('op.confirm.staleTitle')) + '</strong>' +
            '<p class="hv-xs">' + esc(t('op.confirm.staleBody')) + '</p>' +
          '</div>');
        return;
      }
      payload = reviewed.payload;
    } else {
      var read = readForm(root, spec);
      if (read.missing.length) {
        setStatus(root, spec.op, 'bad', t('op.missing') + ' ' + read.missing.join(t('op.listSep')));
        setResult(root, spec.op, '');
        return;
      }
      if (spec.validate) {
        var problem = spec.validate(read.v);
        if (problem) { setStatus(root, spec.op, 'bad', t(problem)); return; }
      }
      payload = spec.build(read.v, ctx);

      /* A material decision is shown back to the operator before it is sent. */
      if (spec.material) {
        var record = {
          op: spec.op,
          scope: scopeOf(ctx),
          payload: payload,
          rows: summaryRows(spec, read.v, ctx),
          at: Date.now()
        };
        PENDING[spec.op] = record;

        setStatus(root, spec.op, '', '');
        setResult(root, spec.op,
          '<div class="op-confirm">' +
            '<strong>' + esc(t('op.confirm.title')) + '</strong>' +
            '<p class="hv-xs">' + esc(t('op.confirm.body')) + '</p>' +
            '<dl class="op-decision">' +
              record.rows.map(function (r) {
                return '<dt>' + esc(r.label) + '</dt><dd>' + esc(r.value) + '</dd>';
              }).join('') +
            '</dl>' +
            '<details class="op-raw"><summary>' + esc(t('op.confirm.raw')) + '</summary>' +
              '<pre class="op-pre">' + esc(JSON.stringify(payload, null, 1)) + '</pre></details>' +
            '<div class="hv-row" style="gap:8px">' +
              '<button class="hv-btn hv-btn-signal hv-btn-sm" type="button" data-op-confirm="' + esc(spec.op) + '">' +
                esc(t('op.confirm.yes')) + '</button>' +
              '<button class="hv-btn hv-btn-ghost hv-btn-sm" type="button" data-op-cancel="' + esc(spec.op) + '">' +
                esc(t('op.confirm.no')) + '</button>' +
            '</div>' +
          '</div>');
        var yes = root.querySelector('[data-op-confirm="' + spec.op + '"]');
        var no = root.querySelector('[data-op-cancel="' + spec.op + '"]');
        /* `record` is captured by value in this closure, so the button can only
           ever send the decision it was rendered beside. */
        if (yes) yes.addEventListener('click', function () { run(ctx, spec, root, btn, record); });
        if (no) no.addEventListener('click', function () {
          invalidatePending(spec.op);
          setResult(root, spec.op, '');
        });
        return;
      }
    }

    btn.disabled = true;
    setStatus(root, spec.op, 'busy', t('op.sending'));
    setResult(root, spec.op, '');

    try {
      var out = await ctx.api('/api/v2/case', { method: 'POST', body: JSON.stringify(payload) });
      /* Kept BEFORE the reload, because the reload rebuilds this panel. */
      LAST[spec.op] = { kind: 'ok', msgKey: 'op.done', rows: readBack(out) };
      OPEN[spec.op] = true;
      /* The work is on the server now, so this form's draft has served its
         purpose — and leaving it filled invites the same write twice. Only THIS
         operation's draft is cleared; another form's unsaved work is untouched
         by a successful write over here. */
      clearDraft(ctx, spec.op);
      invalidatePending(spec.op);
      setStatus(root, spec.op, 'ok', t('op.done'));
      setResult(root, spec.op,
        '<div class="op-ok"><strong>' + esc(t('op.serverSaid')) + '</strong>' + LAST[spec.op].rows + '</div>');
      /* Read the case back from the server, so the screen shows stored state
         rather than what this page believes it just did. */
      await ctx.reload();
    } catch (e) {
      btn.disabled = false;
      if (e.code === 'version_conflict') {
        /* The draft is kept. Nothing is replayed. The operator reconciles.
           Captured explicitly rather than relying on the edit listeners having
           fired, so the words survive even if the form was filled some other
           way. The reviewed decision does NOT survive: the state it was read
           against has moved, which is the whole meaning of this refusal. */
        captureDraft(ctx, spec, root);
        invalidatePending(spec.op);
        setStatus(root, spec.op, 'bad', t('op.conflict.short'));
        setResult(root, spec.op,
          '<div class="op-conflict">' +
            '<strong>' + esc(t('op.conflict.title')) + '</strong>' +
            '<p class="hv-xs">' + esc(t('op.conflict.body')) + '</p>' +
            '<p class="hv-xs op-conflict-msg">' + esc(e.message || '') + '</p>' +
            '<button class="hv-btn hv-btn-outline hv-btn-sm" type="button" data-op-refresh="' + esc(spec.op) + '">' +
              esc(t('op.conflict.refresh')) + '</button>' +
          '</div>');
        var refresh = root.querySelector('[data-op-refresh="' + spec.op + '"]');
        if (refresh) {
          refresh.addEventListener('click', async function () {
            /* Re-read the case. The rebuilt panel restores the draft from DRAFTS
               and re-reads every version from the server, so the operator
               reconciles against current state rather than the state that was
               just refused. Nothing is sent. */
            await ctx.reload();
            var host = document.querySelector('[data-op="' + spec.op + '"]');
            if (host && host.tagName === 'DETAILS') host.open = true;
            setStatus(document.getElementById('app'), spec.op, '', t('op.conflict.restored'));
          });
        }
        return;
      }
      setStatus(root, spec.op, 'bad', (e.code ? e.code + ': ' : '') + (e.message || t('op.failed')));
      setResult(root, spec.op, '');
    } finally {
      btn.disabled = false;
    }
  }

  global.HV = global.HV || {};
  global.HV.ops = {
    FORMS: FORMS, VOCAB: V,
    panelFor: panelFor, wire: wire, formsFor: formsFor,
    readBack: readBack, forgetAll: forgetAll, hasDrafts: hasDrafts,
    /* Exposed for the regression checks, which need to see that a decision was
       actually frozen and actually retired rather than inferring it from the
       screen. Reading them changes nothing. */
    _pending: function (op) { return op ? PENDING[op] : PENDING; },
    _draft: function (ctx, op) { return draftFor(ctx, op); }
  };
})(window);
