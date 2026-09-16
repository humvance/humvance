'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Humvance Phase 3 — Meeting API (Checkpoint 1: persistence + read only).
//
// ADMIN-ONLY. Meeting intelligence is internal consultant data and must never
// be reachable from /api/portal, /api/questions or any client-facing surface.
//
// This endpoint never reads-for-write or writes `client:{ref}.diagnostic`.
// It reads the diagnostic once, at meeting creation, to record lightweight
// provenance (see _meeting-core.buildDiagnosticSnapshot).
// ─────────────────────────────────────────────────────────────────────────────

const { verifyJWT, getToken, setJSON } = require('./_utils');
const { kv } = require('@vercel/kv');
const M = require('./_meeting-core');

// Phase 2's /api/client and /api/agent accept ANY valid JWT. Phase 3 does not:
// a portal token (role:'client') must never reach meeting intelligence.
function requireAdmin(req) {
  const payload = verifyJWT(getToken(req));
  if (!payload) return { ok: false, code: 401, error: 'Unauthorized' };
  if (payload.role !== 'admin') return { ok: false, code: 403, error: 'غير مصرح' };
  return { ok: true, payload };
}

async function loadMeeting(ref, id) {
  if (!M.isValidMeetingId(id)) return { code: 400, error: 'معرّف اجتماع غير صالح' };
  const meeting = await kv.get(M.meetingKey(ref, id));
  if (!meeting) return { code: 404, error: 'الاجتماع غير موجود' };
  // Defence in depth: a meeting artifact must belong to the ref that addressed it.
  if (meeting.ref !== ref) return { code: 404, error: 'الاجتماع غير موجود' };
  return { meeting };
}

module.exports = async function handler(req, res) {
  setJSON(res);

  const auth = requireAdmin(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  const ref = req.query?.ref;
  const id = req.query?.id;

  if (!M.isValidRef(ref)) return res.status(400).json({ error: 'المعرف المرجعي مطلوب' });

  try {
    const client = await kv.get(`client:${ref}`);
    if (!client) return res.status(404).json({ error: 'العميل غير موجود' });

    // ── GET: list, or fetch one ──────────────────────────────────────────────
    if (req.method === 'GET') {
      if (id) {
        const found = await loadMeeting(ref, id);
        if (found.error) return res.status(found.code).json({ error: found.error });
        const diag = await kv.get(`client:${ref}.diagnostic`);
        return res.status(200).json({
          ...found.meeting,
          diagnosticStale: M.isSnapshotStale(found.meeting.diagnosticSnapshot, diag)
        });
      }
      const index = await kv.get(M.indexKey(ref));
      return res.status(200).json(Array.isArray(index) ? index : []);
    }

    // ── POST: create ─────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action !== 'create') return res.status(400).json({ error: 'action غير معروف' });
      if (!M.isValidKind(body.kind)) {
        return res.status(400).json({ error: 'نوع اجتماع غير مدعوم. المسموح: ' + M.MEETING_KINDS.join(', ') });
      }
      const when = M.normaliseDate(body.scheduledAt);
      if (!when.ok) return res.status(400).json({ error: 'تاريخ غير صالح' });

      const now = Date.now();
      const diag = await kv.get(`client:${ref}.diagnostic`);
      const meeting = M.buildMeeting({
        id: M.newMeetingId(), ref, kind: body.kind, title: body.title,
        scheduledAt: when.value, snapshot: M.buildDiagnosticSnapshot(diag, now), now
      });

      // Artifact first, then index. If the index write fails the artifact is
      // orphaned but nothing is lost; the reverse order could index a meeting
      // that does not exist.
      await kv.set(M.meetingKey(ref, meeting.id), meeting);
      const index = await kv.get(M.indexKey(ref));
      await kv.set(M.indexKey(ref), M.upsertIndex(index, M.toIndexEntry(meeting)));

      return res.status(201).json(meeting);
    }

    // ── PATCH: metadata / status ─────────────────────────────────────────────
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'معرّف الاجتماع مطلوب' });
      const found = await loadMeeting(ref, id);
      if (found.error) return res.status(found.code).json({ error: found.error });
      const meeting = found.meeting;

      const body = req.body || {};
      // Lightweight optimistic concurrency: callers may pass the rev they read.
      if (body.expectedRev !== undefined && body.expectedRev !== meeting.rev) {
        return res.status(409).json({
          error: 'تم تعديل الاجتماع من مكان آخر — أعد التحميل ثم حاول مجدداً',
          currentRev: meeting.rev
        });
      }

      const { problems, patch } = M.validateUpdate(meeting, body);
      if (problems.length) return res.status(400).json({ error: problems.join(' | ') });
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'لا يوجد تغيير' });

      const updated = { ...meeting, ...patch, rev: meeting.rev + 1, updatedAt: Date.now() };
      await kv.set(M.meetingKey(ref, id), updated);
      const index = await kv.get(M.indexKey(ref));
      await kv.set(M.indexKey(ref), M.upsertIndex(index, M.toIndexEntry(updated)));

      return res.status(200).json(updated);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[meeting]', err.message);
    return res.status(500).json({ error: 'حدث خطأ في الخادم' });
  }
};
