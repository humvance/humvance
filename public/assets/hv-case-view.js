/* ===========================================================================
   Humvance — case-view rules
   ---------------------------------------------------------------------------
   The two decisions the diagnostic workspace must never get wrong:

     1. does an approval actually cover this finding, right now?
     2. what does a contradiction say, and between which evidence?

   They live here rather than inline in the page for one reason: a rule that
   only exists inside a template can only be tested by scraping a template, so
   in practice it is not tested at all. That is how the first version shipped
   matching `approval.finding_id` — a field that does not exist — and labelling a
   genuinely approved finding as a draft.

   `findingApprovalState` mirrors `approvalCoversFinding` in api/v2/_domain.js
   field for field. If that function changes, this one must change with it, and
   tests/ui/workspace-mapping.test.js builds real approvals through the real
   service to make sure they still agree.

   Loads as a browser global (HV.caseView) and as a CommonJS module, so the page
   and the test run the same code.
   =========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.HV = root.HV || {}; root.HV.caseView = api; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function newestFirst(a, b) { return Number(b.created_at || 0) - Number(a.created_at || 0); }
  function byVersionDesc(a, b) { return Number(b.artifact_version) - Number(a.artifact_version); }

  /**
   * Does this approval cover this finding, as the backend defines coverage?
   * Mirrors D.approvalCoversFinding exactly — all five conditions.
   */
  function approvalCovers(approval, finding) {
    if (!approval || !finding) return false;
    return approval.artifact_type === 'finding'
        && approval.artifact_id === finding.finding_id
        && Number(approval.artifact_version) === Number(finding.version)
        && approval.organization_id === finding.organization_id
        && approval.decision === 'APPROVED';
  }

  /**
   * The display state of a finding, given every approval on the case.
   *
   *   approved            an APPROVED decision covering this exact version
   *   rejected            a REJECTED decision on this version
   *   decided             MODIFIED / MORE_EVIDENCE_REQUIRED on this version
   *   stale               APPROVED, but bound to an EARLIER version — the
   *                       finding has been revised since, so the approval does
   *                       not cover what is on screen. Never render as approved.
   *   supersededDecision  some other decision on an earlier version
   *   draft               no decision at all
   *
   * Approvals for a different artifact, a different organisation or a different
   * artifact type are ignored entirely — they are somebody else's record.
   */
  function findingApprovalState(finding, approvals) {
    if (!finding) return { kind: 'draft', approval: null };

    var mine = (approvals || []).filter(function (a) {
      return a
          && a.artifact_type === 'finding'
          && a.artifact_id === finding.finding_id
          && a.organization_id === finding.organization_id;
    });

    var covering = mine.filter(function (a) { return approvalCovers(a, finding); }).sort(newestFirst)[0];
    if (covering) return { kind: 'approved', approval: covering };

    var thisVersion = mine.filter(function (a) {
      return Number(a.artifact_version) === Number(finding.version);
    }).sort(newestFirst);
    if (thisVersion.length) {
      var d = thisVersion[0];
      return { kind: d.decision === 'REJECTED' ? 'rejected' : 'decided', approval: d };
    }

    var older = mine.filter(function (a) {
      return Number(a.artifact_version) < Number(finding.version);
    }).sort(byVersionDesc);
    if (older.length) {
      var priorApproved = older.filter(function (a) { return a.decision === 'APPROVED'; })[0];
      if (priorApproved) return { kind: 'stale', approval: priorApproved };
      return { kind: 'supersededDecision', approval: older[0] };
    }

    return { kind: 'draft', approval: null };
  }

  /** True only for the one state that may be presented as approved. */
  function isApproved(state) { return state && state.kind === 'approved'; }

  /**
   * A contradiction's text. The backend field is `summary`; there is no
   * `statement`. Reading the wrong one renders an empty contradiction, which is
   * worse than rendering none — it looks like the contradiction is trivial.
   */
  function contradictionText(c) {
    return (c && typeof c.summary === 'string') ? c.summary : '';
  }

  /** The evidence a contradiction sits between, in order, skipping absent sides. */
  function contradictionEvidenceIds(c) {
    if (!c) return [];
    return [c.left_evidence_id, c.right_evidence_id].filter(function (x) { return !!x; });
  }

  /** A live contradiction still constrains approval; a settled one does not. */
  function contradictionIsLive(c) {
    return !!c && (c.state === 'OPEN' || c.state === 'INVESTIGATING');
  }

  /**
   * Is a collection actually supplied by this bundle?
   *
   * An absent key and an empty array mean completely different things. The
   * reviewer bundle has no `unknowns` key at all, so a screen that renders
   * "no unknowns" from its absence is asserting something nobody told it.
   */
  function sectionAvailability(bundle, key) {
    if (!bundle || !Object.prototype.hasOwnProperty.call(bundle, key)) return 'unsupported';
    var v = bundle[key];
    if (!Array.isArray(v)) return 'unsupported';
    return v.length ? 'present' : 'empty';
  }

  /** The challenge run against the version of the finding now on screen. */
  function challengeForFinding(finding, challenges) {
    if (!finding) return null;
    return (challenges || []).filter(function (c) {
      return c.finding_id === finding.finding_id && Number(c.finding_version) === Number(finding.version);
    }).sort(newestFirst)[0] || null;
  }

  return {
    approvalCovers: approvalCovers,
    findingApprovalState: findingApprovalState,
    isApproved: isApproved,
    contradictionText: contradictionText,
    contradictionEvidenceIds: contradictionEvidenceIds,
    contradictionIsLive: contradictionIsLive,
    sectionAvailability: sectionAvailability,
    challengeForFinding: challengeForFinding
  };
});
