# Sprint 1 — Diagnostic Intake V2 · checkpoint

**Purpose:** resume point. If a session is interrupted, start here rather than from scratch.

| | |
|---|---|
| Branch | `sprint1-diagnostic-intake-v2` |
| Cut from | `v2-case-spine` @ `88a866c` |
| Start checkpoint tag | `checkpoint/sprint1-start-2026-09-18` → `88a866c` |
| Status | **implementation complete; auth consolidated to clear the function budget; not pushed since `295635b`, not merged, not deployed, landing CTA unchanged** |

## The invariant, stated exactly

> **Auth packaging differs from the Production baseline. Local behavioural equivalence is tested. Other V1 files and the Case API remain unchanged. Real Preview routing and deployed function count remain unverified until deployment.**

## Commits

| Commit | What | Pushed |
|---|---|---|
| `fe17368` | Diagnostic Intake V2: anonymous holding area and its human gate | yes |
| `fdb94d7` | Intake page: isolate numeric labels so Arabic does not reverse them | yes |
| `94f1eb8` | docs: Sprint 1 engineering state and checkpoint | yes |
| `d9eda3b` | Intake promotion: durable decision, resumable work, decided exactly once | yes |
| `295635b` | Add the Preview HTTP integration gate for Diagnostic Intake | yes |
| *(auth consolidation)* | Five auth handlers into one deployed function | **no — local only** |

## Verification, last run 2026-09-18 on the device, memory driver only

```
node tests/v1/run.js          → 105/105   (new: auth equivalence, dispatch, baseline integrity)
node tests/v2/run.js          → 246/246   (baseline 162 unchanged, 84 added)
node scripts/v2-case-001.js   →  62/62    (unchanged)
node scripts/v2-intake-001.js →  90/90    (includes the interrupted-promotion path)
```

`npm run test:all` runs all four. `node --check` passes on every `.js` file under `api/`, `scripts/` and `tests/`.

No database of any kind was contacted. No mail service, no secret, no customer data. `@vercel/kv` is not installed in this checkout; the V1 rig intercepts it at require time and removes the hook immediately afterwards.

## The function-budget blocker and what was done about it

The Preview build for `295635b` failed: *"No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan."*

`api/auth/{login,setup,status,forgot,reset}.js` are superseded by one file, `api/auth/[action].js`, carrying all five handler bodies verbatim plus a fail-closed dispatcher. Source-level would-be function count: **14 → 10**. Full reasoning, evidence and test design in `ENGINEERING-STATE.md` §13.

**All five public URLs are unchanged**, and `public/index.html` / `public/admin.html` were not modified.

**The budget test guards source structure, not Vercel's deployed artifact count.** Only a deployment reports the real number.

### Two things that remain unverified, by nature

1. **Routing.** `vercel.json` uses the legacy top-level `routes` key. Whether Vercel still resolves the dynamic segment `api/auth/[action].js` under it cannot be established locally. A concrete fallback is written down in §13 and **deliberately not applied**; the dispatcher already works under it, so applying it would be a configuration change with no code change.
2. **How the runtime represents a dynamic path parameter versus a caller-supplied query parameter of the same name.** Unknown, and not assumed: the dispatcher never lets a query parameter override an action the URL has named.

## Files

**New since the last checkpoint (6)** — `api/auth/[action].js`, `tests/v1/harness-v1.js`, `tests/v1/auth-equivalence.test.js`, `tests/v1/auth-dispatch.test.js`, `tests/v1/baseline-integrity.test.js`, `tests/v1/run.js`, plus the frozen fixtures `tests/fixtures/_utils.js` and `tests/fixtures/v1-auth-baseline/{login,setup,status,forgot,reset}.js`.

**Removed (5)** — `api/auth/{login,setup,status,forgot,reset}.js`, superseded by the consolidated handler. Byte-identical copies are frozen under `tests/fixtures/v1-auth-baseline/` and hash-asserted against Production on every test run.

**Modified (1)** — `package.json` (`test:v1`, `test:v2`, `test:all`), plus these docs.

**Untouched, asserted by hash, not by inspection** — `api/_utils.js`, `api/agent.js`, `api/client.js`, `api/portal.js`, `api/questions.js`, `api/send-questions.js`, `api/submit.js`, `api/v2/case.js`, `scripts/v2-intake-http.js`. `vercel.json` unchanged.

**Earlier Sprint 1 files (8 new, 9 modified)** — unchanged by the consolidation; see the list in `ENGINEERING-STATE.md` §11.

## What exists now

See `docs/ENGINEERING-STATE.md` §11 for the intake architecture and §13 for the auth consolidation. In one paragraph: an anonymous visitor at `/intake` fills in twelve steps; `POST /api/v2/intake` validates against an allow-list, scans every free-text field, and writes one immutable `intakeseed` plus one `intakereview` in `PENDING_REVIEW`. Nothing else is created. A reviewer at `/v2-intake-review` reads the submission with client-reported content and Humvance's review visually separated, and accepts or rejects it. Accept creates the Organization, a Case in `INTAKE`, two `UNVERIFIED` claims and up to three `sponsor_statement` evidence items. Reject creates nothing. The decision is claimed atomically and the promotion is resumable.

**Status: locally verified on the memory driver. Not integration verified.** No run has touched the isolated Preview store.

## What is deliberately NOT done

- No push since `295635b`, no merge, no deployment, no Production change, no Vercel setting touched, no plan upgrade.
- No endpoint deleted to save a function slot; the email endpoint is retained.
- Anonymous intake and reviewer operations remain separate files.
- No authentication redesign. Equivalence to the baseline is not a claim that the baseline is secure (debt 5, 8, 10).
- The routing fallback in §13 is written down, not applied.
- The landing CTA on `/` still points at the V1 questionnaire. `/intake` is parallel.
- No 14-domain taxonomy, no `PLAYBOOKS`, no `calculateConfidence()`.
- No `add_claim` on `api/v2/case.js`. No AI anywhere in the intake path.
- `api/questions.js` ref validation deliberately left alone (debt 12).

## To resume

1. `git rev-parse --abbrev-ref HEAD` → expect `sprint1-diagnostic-intake-v2`; `git status` clean.
2. `npm run test:all` → 105 / 246 / 62 / 90.
3. Read `ENGINEERING-STATE.md` §13 first (the auth change), then §8 blockers 11–13, then §11.

### The exact next action, in order

1. **Mohammed decides whether to push.** The auth-consolidation commit is local only; no push authorization was used or requested.
2. **Check the environment-variable scope before setting anything** — see the corrected §3. Entries exist for Production and for `v2-case-spine`; whether `sprint1-diagnostic-intake-v2` receives `V2_STORE_DRIVER` / `V2_NAMESPACE` is unverified, and so is the scope of the Preview database credentials. Existing entries must be preserved, not replaced; their values were never read in this session. Do not silently adopt a different namespace — if one is already set to something else, decide it deliberately and write the decision down.
3. Deploy Preview and **read the Functions count in Resources**. Expected 10. Expected is not verified; the source-level test cannot see Vercel's artifact count.
4. Open the five auth URLs on the Preview deployment. If any 404s, apply the prepared route from §13 — configuration only, no code change — and redeploy.
5. Only then run the HTTP gate: `V2_BASE_URL=<preview> HV_TOKEN=… node scripts/v2-intake-http.js`. It refuses to run against a Production host, against a shared store, and without storage configured. **It must be run by Mohammed:** this session cannot reach `vercel.com`, `api.vercel.com` or `*.vercel.app` from either the cloud container or the device VM.

Until step 5 passes, Sprint 1 is **locally verified on the memory driver**, not integration verified and not production ready. The memory-driver recovery tests establish that the promotion algorithm converges under interruption; they establish nothing about how the real Redis driver fails.

## Operational note

Git on this machine can leave a stale `.git/index.lock`, because `.git` is inside a OneDrive-synced folder and the unlink fails. **Do not remove it automatically.** Check for an active git process first; if removal is genuinely needed, leave it for Mohammed. The real fix is `ENGINEERING-STATE.md` §0 option 3.
