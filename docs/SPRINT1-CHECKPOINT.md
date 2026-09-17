# Sprint 1 — Diagnostic Intake V2 · checkpoint

**Purpose:** resume point. If a session is interrupted, start here rather than from scratch.

| | |
|---|---|
| Branch | `sprint1-diagnostic-intake-v2` |
| Cut from | `v2-case-spine` @ `88a866c` |
| Start checkpoint tag | `checkpoint/sprint1-start-2026-09-18` → `88a866c` |
| Status | **implementation complete; not merged, not deployed, landing CTA unchanged** |

## Commits

| Commit | What |
|---|---|
| `fe17368` | Diagnostic Intake V2: anonymous holding area and its human gate |
| `fdb94d7` | Intake page: isolate numeric labels so Arabic does not reverse them |
| *(this file)* | docs: Sprint 1 engineering state and checkpoint |

## Verification, last run 2026-09-18 on the device, memory driver only

```
node tests/v2/run.js          → 227/227   (baseline 162 unchanged, 65 added)
node scripts/v2-case-001.js   →  62/62    (unchanged)
node scripts/v2-intake-001.js →  75/75    (new)
```

No database of any kind was contacted. `V2_STORE_DRIVER` and `V2_NAMESPACE` are still unset in Preview, so nothing could have been written even by accident.

## Files

**New (7)** — `api/v2/_intake.js`, `api/v2/intake.js`, `api/v2/intake-review.js`, `public/intake.html`, `public/v2-intake-review.html`, `tests/v2/intake.test.js`, `scripts/v2-intake-001.js`

**Modified (8)** — `api/v2/_domain.js`, `api/v2/_ids.js`, `api/v2/_store.js`, `api/v2/_service.js`, `tests/v2/run.js`, `package.json`, `vercel.json`, `docs/ENGINEERING-STATE.md`

**Untouched, verified** — every V1 file (`api/submit.js`, `api/agent.js`, `api/client.js`, `api/portal.js`, `api/questions.js`, `api/send-questions.js`, `api/_utils.js`, `api/auth/*`, `public/index.html`, `public/admin.html`, `public/portal.html`, `public/questions.html`) and, in V2, `api/v2/case.js`, `_authz.js`, `_repo.js`, `_membership.js`, `_untrusted.js`, `_challenge.js`.

`api/v2/case.js` being unmodified is asserted by a test, not just by inspection.

## What exists now

See `docs/ENGINEERING-STATE.md` §11 for the architecture. In one paragraph: an anonymous visitor at `/intake` fills in twelve steps; `POST /api/v2/intake` validates against an allow-list, scans every free-text field, and writes one immutable `intakeseed` plus one `intakereview` in `PENDING_REVIEW`. Nothing else is created. A reviewer at `/v2-intake-review` reads the submission with client-reported content and Humvance's review visually separated, and accepts or rejects it. Accept creates the Organization, a Case in `INTAKE`, two `UNVERIFIED` claims and up to three `sponsor_statement` evidence items. Reject creates nothing.

## What is deliberately NOT done

- No merge, no push of this branch, no deployment, no Production change.
- The landing CTA on `/` still points at the V1 questionnaire. `/intake` is parallel.
- No 14-domain taxonomy, no `PLAYBOOKS`, no `calculateConfidence()` recovered from the archive branches.
- No `add_claim` operation added to `api/v2/case.js`.
- No AI anywhere in the intake path.
- `api/questions.js` ref validation deliberately left alone (V1 file; recorded as debt 12).

## To resume

1. `git rev-parse --abbrev-ref HEAD` → expect `sprint1-diagnostic-intake-v2`; `git status` clean.
2. `node tests/v2/run.js && node scripts/v2-case-001.js && node scripts/v2-intake-001.js` → 227 / 62 / 75.
3. Read `docs/ENGINEERING-STATE.md` §8 for what is still blocked, §9 debt 12–17 for what Sprint 1 knowingly left.

## Operational note

Git on this machine leaves a stale `.git/index.lock` after most commands, because `.git` is inside a OneDrive-synced folder and the unlink fails. `rm -f .git/index.lock` before a commit; the real fix is `ENGINEERING-STATE.md` §0 option 3.
