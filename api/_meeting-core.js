'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Humvance Phase 3 — Meeting core (Checkpoint 1: storage foundation only).
//
// Pure functions: identity, validation, status transitions, diagnostic
// provenance, index maintenance. No I/O, no AI, no intelligence logic.
//
// HARD RULE: nothing in Phase 3 writes to `client:{ref}.diagnostic`.
// The diagnostic object remains the sole source of truth for hypotheses,
// evidence, confidence, conflicts, findings and diagnostic questions.
//
// KV key layout:
//   client:{ref}.meetings            → lightweight index (array)
//   client:{ref}.meeting.{meetingId} → meeting artifact
//   client:{ref}.meeting.{meetingId}.capture   → RESERVED, not created here.
//     Capture is deliberately given its own key so the append-only meeting log
//     can grow without bloating the artifact. Do not fold it into the artifact.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const MEETING_KINDS = ['discovery', 'detailed'];

const MEETING_STATUSES = ['draft', 'ready', 'in_progress', 'captured', 'closed'];

// Allowed transitions. `closed` is terminal in Checkpoint 1.
const STATUS_TRANSITIONS = {
  draft:       ['ready', 'closed'],
  ready:       ['in_progress', 'draft', 'closed'],
  in_progress: ['captured', 'closed'],
  captured:    ['in_progress', 'closed'],
  closed:      []
};

const MAX_TITLE_LEN = 200;

function meetingKey(ref, id)  { return `client:${ref}.meeting.${id}`; }
function indexKey(ref)        { return `client:${ref}.meetings`; }

// Server-generated, unguessable, stable. The browser never supplies an id.
function newMeetingId() {
  return 'mtg_' + Date.now().toString(36) + '_' + crypto.randomBytes(8).toString('hex');
}

function isValidMeetingId(id) {
  return typeof id === 'string' && /^mtg_[a-z0-9]{6,12}_[0-9a-f]{16}$/.test(id);
}

// Refs are created by intake; keep this conservative and reject anything that
// could escape the key namespace.
function isValidRef(ref) {
  return typeof ref === 'string' && ref.length > 0 && ref.length <= 64 && /^[A-Za-z0-9._-]+$/.test(ref);
}

function isValidKind(kind)     { return MEETING_KINDS.includes(kind); }
function isValidStatus(status) { return MEETING_STATUSES.includes(status); }

function canTransition(from, to) {
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  if (from === to) return true;                      // idempotent no-op
  return (STATUS_TRANSITIONS[from] || []).includes(to);
}

// Accepts an ISO-8601 string or epoch ms; returns epoch ms, or null if absent,
// or NaN-marker false when malformed.
function normaliseDate(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const ts = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ts)) return { ok: false, value: null };
  return { ok: true, value: ts };
}

function normaliseTitle(title, fallback) {
  if (title === undefined || title === null || String(title).trim() === '') return fallback;
  const t = String(title).trim();
  return t.length > MAX_TITLE_LEN ? t.slice(0, MAX_TITLE_LEN) : t;
}

// ── Diagnostic provenance ────────────────────────────────────────────────────
// Lightweight only: ids, counts and the confidence values at this instant.
// Never copies hypothesis or evidence objects.
function buildDiagnosticSnapshot(diag, now) {
  if (!diag || typeof diag !== 'object') {
    return { takenAt: now, diagnosticExists: false, diagnosticUpdatedAt: null,
             hypothesisIds: [], confidence: {}, evidenceCount: 0, unresolvedConflictIds: [] };
  }
  const hypotheses = Array.isArray(diag.hypotheses) ? diag.hypotheses : [];
  const confidence = {};
  for (const h of hypotheses) {
    if (h && typeof h.id === 'string') confidence[h.id] = typeof h.confidence === 'number' ? h.confidence : null;
  }
  return {
    takenAt: now,
    diagnosticExists: true,
    diagnosticUpdatedAt: diag.updatedAt ?? null,
    hypothesisIds: hypotheses.map(h => h && h.id).filter(Boolean),
    confidence,
    evidenceCount: Array.isArray(diag.evidence) ? diag.evidence.length : 0,
    unresolvedConflictIds: (Array.isArray(diag.conflicts) ? diag.conflicts : [])
      .filter(c => c && !c.resolved).map(c => c.id).filter(Boolean)
  };
}

// True when the diagnosis moved on after this meeting was prepared.
function isSnapshotStale(snapshot, diag) {
  if (!snapshot || !diag) return false;
  if (snapshot.diagnosticUpdatedAt == null || diag.updatedAt == null) return false;
  return diag.updatedAt > snapshot.diagnosticUpdatedAt;
}

// ── Artifact construction ────────────────────────────────────────────────────
// Deliberately small. No placeholders for later features — Checkpoint 1 stores
// only what is needed to identify and safely manage a meeting.
function buildMeeting({ id, ref, kind, title, scheduledAt, snapshot, now }) {
  return {
    id, ref, kind,
    title: normaliseTitle(title, kind === 'detailed' ? 'الاجتماع التفصيلي' : 'اجتماع الاستكشاف'),
    status: 'draft',
    rev: 1,
    scheduledAt: scheduledAt ?? null,
    diagnosticSnapshot: snapshot,
    createdAt: now,
    updatedAt: now
  };
}

function toIndexEntry(m) {
  return { id: m.id, kind: m.kind, title: m.title, status: m.status,
           scheduledAt: m.scheduledAt ?? null, createdAt: m.createdAt, updatedAt: m.updatedAt };
}

// Read-modify-write helper. Never returns an empty array when adding, and
// never produces duplicate ids.
function upsertIndex(existingIndex, entry) {
  const list = Array.isArray(existingIndex) ? existingIndex.filter(e => e && e.id) : [];
  const without = list.filter(e => e.id !== entry.id);
  return [...without, entry].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ── Update validation ────────────────────────────────────────────────────────
const UPDATABLE_FIELDS = ['title', 'scheduledAt', 'status'];

function validateUpdate(meeting, body) {
  const problems = [];
  const patch = {};
  if (!body || typeof body !== 'object') return { problems: ['طلب غير صالح'], patch };

  const unknown = Object.keys(body).filter(k => !UPDATABLE_FIELDS.includes(k) && k !== 'expectedRev');
  if (unknown.length) problems.push('حقول غير قابلة للتعديل: ' + unknown.join(', '));

  if ('title' in body) {
    const t = normaliseTitle(body.title, null);
    if (t === null) problems.push('العنوان لا يمكن أن يكون فارغاً');
    else patch.title = t;
  }
  if ('scheduledAt' in body) {
    const d = normaliseDate(body.scheduledAt);
    if (!d.ok) problems.push('تاريخ غير صالح');
    else patch.scheduledAt = d.value;
  }
  if ('status' in body) {
    if (!isValidStatus(body.status)) {
      problems.push('حالة غير معروفة: ' + String(body.status).slice(0, 40));
    } else if (!canTransition(meeting.status, body.status)) {
      problems.push(`انتقال غير مسموح: ${meeting.status} → ${body.status}`);
    } else {
      patch.status = body.status;
    }
  }
  return { problems, patch };
}

module.exports = {
  MEETING_KINDS, MEETING_STATUSES, STATUS_TRANSITIONS, UPDATABLE_FIELDS,
  meetingKey, indexKey,
  newMeetingId, isValidMeetingId, isValidRef, isValidKind, isValidStatus,
  canTransition, normaliseDate, normaliseTitle,
  buildDiagnosticSnapshot, isSnapshotStale,
  buildMeeting, toIndexEntry, upsertIndex, validateUpdate
};
