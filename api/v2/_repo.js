'use strict';
// Humvance V2 — persistence, concurrency and audit.
//
// Three invariants this layer exists to hold:
//
//   TENANT SCOPE. Every read takes an organization_id and compares it to the
//   stored object. A mismatch returns null — "not found", not "forbidden" —
//   because telling Organization B that Case X exists is itself a leak. UI
//   filtering is not isolation; this is.
//
//   OPTIMISTIC CONCURRENCY. Every material object carries `version`. An update
//   states the version it read; a mismatch is refused. This is what stops the
//   read-modify-write races that V1's blind `kv.set(key, {...body})` pattern had.
//
//   ARTIFACT BEFORE INDEX. The object is durable before anything points at it, so
//   a failure between the two leaves an orphan (harmless, invisible) rather than a
//   dangling index entry (a 404 the UI cannot explain). Pattern ported from Phase 3
//   _meeting-core's upsertIndex discipline.

const { PREFIXES, newId, isAnyId, isId } = require('./_ids');
const { AUDIT_EVENTS } = require('./_domain');

class RepoError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.name = 'RepoError'; this.code = code; this.status = status;
  }
}

// Index names live in the key's final segment, which forbids ':' — so segments are
// joined with '-'. Ids already contain '_' and are safe here.
const idx = {
  orgCases:      orgId  => `org-${orgId}-cases`,
  orgAudit:      orgId  => `org-${orgId}-audit`,
  caseClaims:    caseId => `case-${caseId}-claims`,
  caseHypotheses:caseId => `case-${caseId}-hypotheses`,
  caseEvidence:  caseId => `case-${caseId}-evidence`,
  caseContradictions: caseId => `case-${caseId}-contradictions`,
  caseEvidenceReqs:   caseId => `case-${caseId}-evidencereqs`,
  caseFindings:  caseId => `case-${caseId}-findings`,
  caseChallenges:caseId => `case-${caseId}-challenges`,
  caseApprovals: caseId => `case-${caseId}-approvals`,
  caseAudit:     caseId => `case-${caseId}-audit`
};

function createRepo(store) {

  // ── low level ──────────────────────────────────────────────────────────────

  async function readScoped(type, id, organization_id) {
    if (!isAnyId(id)) throw new RepoError('invalid_id', `malformed ${type} id`, 400);
    const obj = await store.get(type, id);
    if (!obj) return null;
    // The tenant check happens here, once, for every object type. There is no
    // read path around it.
    if (obj.organization_id !== organization_id) return null;
    return obj;
  }

  // `prefixKey` names an entry in _ids.PREFIXES (e.g. 'evidenceReq'), not the raw
  // prefix string — so the id alphabet stays in one place and a typo here is a
  // startup error rather than a malformed identifier in storage.
  //
  // `opts.id` lets a caller supply an identifier that was MINTED EARLIER BY THIS
  // SAME CODE and written down before the object was created. It exists for one
  // purpose: making a multi-step creation resumable, so that a retry after a crash
  // writes to the same key instead of minting a second object. It is never reachable
  // from an HTTP body — every caller passes it as a separate argument, and the value
  // is still checked against the id grammar here, so a caller-supplied identifier
  // cannot enter storage through it.
  async function createObject(type, prefixKey, organization_id, actor, fields, { id: plannedId = null } = {}) {
    const prefix = PREFIXES[prefixKey];
    if (!prefix) throw new RepoError('invalid_prefix', `no id prefix registered for "${prefixKey}"`, 500);
    if (plannedId !== null && !isId(prefix, plannedId)) {
      throw new RepoError('invalid_id', `planned ${type} id is not a well-formed ${prefix} identifier`, 500);
    }
    const now = Date.now();
    const id = plannedId || newId(prefix);
    const idField = `${type === 'evidencereq' ? 'evidence_request' : type}_id`;
    const obj = {
      [idField]: id,
      organization_id,
      created_at: now,
      created_by: actor.actor_id,
      created_by_type: actor.actor_type,
      updated_at: now,
      updated_by: actor.actor_id,
      updated_by_type: actor.actor_type,
      version: 1,
      ...fields
    };
    const written = await store.putIfAbsent(type, id, obj);
    if (!written) throw new RepoError('id_collision', 'identifier collision', 500);
    return obj;
  }

  /**
   * Version-checked update. `mutate` receives a deep copy and returns the next
   * state; it must not mutate its argument in place.
   *
   * `bumpVersion:false` still performs the stale-write check but leaves `version`
   * alone. It exists for one narrow case: recording the workflow state of an
   * artifact whose CONTENT has not changed. A Finding's `version` is what an
   * approval binds to, so flipping its state to APPROVED must not itself move the
   * number the approval just named.
   */
  async function updateObject(type, id, organization_id, actor, expected_version, mutate, { bumpVersion = true } = {}) {
    const current = await readScoped(type, id, organization_id);
    if (!current) throw new RepoError('not_found', `${type} not found`, 404);
    if (expected_version === undefined || expected_version === null) {
      throw new RepoError('version_required', 'expected_version is required for material updates', 400);
    }
    if (Number(expected_version) !== Number(current.version)) {
      throw new RepoError(
        'version_conflict',
        `stale update: expected version ${expected_version}, stored version is ${current.version}`,
        409
      );
    }
    const draft = JSON.parse(JSON.stringify(current));
    const next = await mutate(draft);
    next.version = bumpVersion ? current.version + 1 : current.version;
    next.updated_at = Date.now();
    next.updated_by = actor.actor_id;
    next.updated_by_type = actor.actor_type;
    await store.put(type, id, next);
    return next;
  }

  // ── audit ──────────────────────────────────────────────────────────────────

  async function audit(event, { organization_id, case_id = null, actor, subject_type = null, subject_id = null, summary = '', details = {} }) {
    if (!AUDIT_EVENTS.includes(event)) throw new RepoError('invalid_audit_event', `unknown audit event "${event}"`, 500);
    const entry = {
      audit_id: newId(PREFIXES.audit),
      organization_id,
      case_id,
      event,
      at: Date.now(),
      actor_id: actor.actor_id,
      actor_type: actor.actor_type,
      actor_role: actor.role || null,
      subject_type,
      subject_id,
      summary: String(summary).slice(0, 500),
      // Business-level provenance only. No prompts, no model reasoning.
      details
    };
    await store.put('audit', entry.audit_id, entry);
    if (case_id) await store.appendToIndex(idx.caseAudit(case_id), entry.audit_id);
    await store.appendToIndex(idx.orgAudit(organization_id), entry.audit_id);
    return entry;
  }

  async function readAudit(case_id, organization_id) {
    const ids = await store.readIndex(idx.caseAudit(case_id));
    const out = [];
    for (const id of ids) {
      const e = await store.get('audit', id);
      if (e && e.organization_id === organization_id) out.push(e);
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // ── collections ────────────────────────────────────────────────────────────

  async function listByIndex(type, indexName, organization_id) {
    const ids = await store.readIndex(indexName);
    const out = [];
    for (const id of ids) {
      const o = await readScoped(type, id, organization_id);
      if (o) out.push(o);
    }
    return out;
  }

  /**
   * Everything attached to a Case, in one read. Used by the reviewer workspace and
   * by the challenge engine, both of which need the whole picture to be correct.
   */
  async function loadCaseBundle(case_id, organization_id) {
    const kase = await readScoped('case', case_id, organization_id);
    if (!kase) return null;
    const [claims, hypotheses, evidence, contradictions, evidenceRequests, findings, challenges, approvals] = await Promise.all([
      listByIndex('claim',        idx.caseClaims(case_id),         organization_id),
      listByIndex('hypothesis',   idx.caseHypotheses(case_id),     organization_id),
      listByIndex('evidence',     idx.caseEvidence(case_id),       organization_id),
      listByIndex('contradiction',idx.caseContradictions(case_id), organization_id),
      listByIndex('evidencereq',  idx.caseEvidenceReqs(case_id),   organization_id),
      listByIndex('finding',      idx.caseFindings(case_id),       organization_id),
      listByIndex('challenge',    idx.caseChallenges(case_id),     organization_id),
      listByIndex('approval',     idx.caseApprovals(case_id),      organization_id)
    ]);
    return { case: kase, claims, hypotheses, evidence, contradictions, evidenceRequests, findings, challenges, approvals };
  }

  return {
    store, idx, RepoError,
    readScoped, createObject, updateObject,
    audit, readAudit, listByIndex, loadCaseBundle,

    /**
     * Idempotent by design. An index is a set of ids, not a log: appending the same
     * id twice has never been meaningful, and after a crash between "object created"
     * and "object indexed", a resumed run must be able to finish the indexing without
     * producing a second entry. Reading first costs one round trip on a list that is
     * bounded by the size of a single case.
     */
    async attachToIndex(indexName, id) {
      const current = await store.readIndex(indexName);
      if (current.includes(id)) return { appended: false };
      await store.appendToIndex(indexName, id);
      return { appended: true };
    }
  };
}

module.exports = { createRepo, RepoError, idx };
