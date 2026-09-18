# Humvance — Engineering State

**Last updated:** 2026-09-18 (V1 auth consolidation — §13)
**Maintained on:** `v2-case-spine`; §11 and §13 were added on `sprint1-diagnostic-intake-v2`, which is not merged and, since the auth-consolidation commit, not pushed
**Contains no secrets.** Environment variables are referred to by NAME only. No value, token, URL, connection string or credential appears in this file. Resource identifiers (store ids, deployment ids) are not credentials and are recorded deliberately as evidence.

---

## 0. OneDrive recovery incident — 2026-09-17

**Outcome: nothing was lost. `64206ee` was recovered exactly. No reconstruction was performed and no recovery commit was needed.**

### What happened

The project lives in a OneDrive-synced folder and the owner works from two computers. OneDrive synchronised `.git` itself, which it is not safe to do: git writes a loose object to `.git/objects/xx/tmp_obj_*` and then renames it into place, and it rewrites `.git/index` under `.git/index.lock`. While OneDrive holds those files open, the rename and the unlink fail — visible throughout the previous session as `unable to unlink '.git/objects/…/tmp_obj_…': Operation not permitted`.

Two consequences followed:

1. **Stale lock files.** `.git/index.lock` and several `.lock` files survived, and 35 orphaned `tmp_obj_*` files accumulated. A lingering `index.lock` is enough on its own to make git refuse to read the index, which is what surfaced as `fatal: bad object HEAD` on the second computer.
2. **Conflict duplicates.** The second computer synchronised an older state, so OneDrive renamed 27 working files to `*-MOHAMMED*` and created a branch ref `refs/heads/v2-case-spine-MOHAMMED` at `08eb9db`.

### What was actually true

The object database was **complete and uncorrupted**. All 201 loose objects were present and verified, including every commit in the V2 chain:

```
64206ee  commit  886 B   sha-1 verified
4dd35ce  commit 1502 B   sha-1 verified
cd2f06c  commit 2628 B   sha-1 verified
08eb9db  commit 1635 B   sha-1 verified
```

Each of the 35 `tmp_obj_*` files was decompressed and hashed: every one was a **duplicate of an object already correctly stored**. None was a missing object, so none needed rescuing.

`git fsck --full` reports one dangling tree (`e65d1df`) and nothing else — no missing object, no corruption. The working tree was clean against `64206ee` with zero modified tracked files.

**The symptom was a lock file, not data loss.** No file was recovered from the safety backup, the recovery ZIP or any remote, because none needed to be.

### Conflict-file analysis — all 27 accounted for

Each `*-MOHAMMED*` file was hashed and compared against its canonical counterpart and against every commit in the V2 chain, normalising CRLF (OneDrive rewrote line endings, which is why a byte comparison alone is misleading):

| Class | Count | Finding |
|---|---|---|
| Identical to the canonical file | 16 | pure duplicates; differ only in line endings |
| Identical to the **`08eb9db`** version of the same path | 11 | the older state from the second computer |
| Containing unique work | **0** | — |

Every one is **class D — stale conflict artifact**. Not one contains work that is missing from `64206ee`, so there was nothing to merge and no risk in leaving them in place.

They were **not deleted**: deletion is unnecessary for the recovery, their content is fully accounted for, and they remain in the safety backup. They are untracked and cannot enter a commit unless someone runs `git add -A` — see §8.

### What was cleaned

Only git-internal debris, after the object store was proven complete:

- 35 orphaned `.git/objects/*/tmp_obj_*` files (all proven duplicates)
- `.git/index.lock` and 8 `.lock.stale-*` files
- the branch ref `v2-case-spine-MOHAMMED`, first preserved as the annotated tag **`recovery/onedrive-conflict-ref-2026-09-17`** → `08eb9db`

No source file, no conflict file, no backup and no remote ref was touched.

### Canonical repository health after recovery

| | |
|---|---|
| Location | `C:\Users\abbal\OneDrive\المستندات\claucode` — unchanged, still OneDrive-synced |
| Branch | `v2-case-spine` |
| HEAD | `64206ee02aaa7729d1c3d418f72f5de882c26d46` |
| Upstream | `origin/v2-case-spine` (tracking configured) |
| `git status` | clean — 0 modified tracked files, 27 untracked conflict artifacts |
| `git fsck --full` | clean (one harmless dangling tree) |
| `git log` / `branch` / `fetch` | all working |
| Loose objects | 201, all verified |
| Lock / temp debris | none |
| `origin/HEAD` | corrected from the stale `main` to **`production`** |

### Recommendation — stop OneDrive from syncing `.git`

The incident will recur while `.git` is inside a synced folder. The working files can stay exactly where they are; it is only `.git` that must not be synchronised. Options, in order of preference:

1. **Right-click `.git` → "Always keep on this device" is not enough** — the problem is concurrent write access, not availability. Prefer excluding the folder from sync, or
2. keep the repository in OneDrive but **never run git on two machines without letting sync settle first**, and never leave a git command interrupted, or
3. move only `.git` out of OneDrive using a `.git` file pointing at an external gitdir (`gitdir: C:/git-repos/claucode.git`), which keeps every source file in OneDrive and takes the object database out of the sync path.

Option 3 preserves the non-negotiable requirement — the working files stay in the OneDrive project folder, available on both computers — while removing the cause entirely.

---

## 1. Production

| | |
|---|---|
| Live deployment | `dpl_DbqESRz5X3KJyRUkdz38Q5Fh2iX5` |
| Commit | `f2374043d3ba603fba6ab5de16437776192eaf00` |
| State | READY |
| Aliases | `humvance.com`, `www.humvance.com`, `humvance.vercel.app` |
| Vercel Production Branch | **`production`** (changed from `main` on 2026-09-17; no deployment was triggered) |
| GitHub default branch | **`production`** — verified 2026-09-17 from the remote symref (`git ls-remote --symref origin HEAD`), not from local state |
| Previous good deployment | `dpl_9kGyzjSgJ7RJSNrXNmdNT8aX5iCb` @ `0d60514` |
| Plan | Vercel Hobby — no Instant Rollback, no promote. Rollback = redeploy from commit. |
| Repository | `github.com/humvance/humvance` — **public** |

Production ancestry, complete and auditable:

```
f2374043  Reject invalid and colliding refs in unauthenticated intake   [Hotfix 01]
0d60514   Fix cross-client authorization on admin endpoints             [Hotfix 00]
3296bd4   Capture exact Production baseline before auth hotfix          [live tree, hash-verified]
20ed482   Humvance Phase 2 stable baseline                              [root]
```

**Verified read-only, 2026-09-17:** `/` returns 200, 99,310 bytes, SHA-256 `4ec41442ef2cceac914192744f178e9fa420b82899ad3951ef074a02c7799655` — byte-identical to `production:public/index.html`. `/api/auth/status` → `{"setupDone":true,"authenticated":false}`. `/api/v2/case` → **404**.

**V2 is NOT deployed to Production, and must not be.**

---

## 2. Preview storage isolation — GATE: PASS

The V2 Preview database is a genuinely separate Upstash resource, connected to Preview only.

| | Production | V2 Preview |
|---|---|---|
| Store name | `humvance-redis` | `upstash-kv-violet-forest` |
| Vercel store id | `store_32sl108ph8DN7thl` | `store_Frs3olczZI0JBWfJ` |
| Upstash resource id | *(distinct; not recorded here)* | `632d5d4e-f87f-4c49-88da-586c70dbb618` |
| Plan | Free (legacy) | Pay As You Go |
| Connected environments | Production, Preview | **Preview only** |
| Created | 2026-09-14 | 2026-09-17 |

### Evidence

1. Both appear as **separate rows** in the team Storage list and as **two separate Installed Products** under one Upstash installation — different names, different store ids, different plans, different creation dates.
2. The new store's Projects page lists exactly one connection: project `humvance`, environments **`Preview`**.
3. The **Production environment variable list contains no `V2_*` variable at all.** It holds exactly nine: `RESEND_API_KEY`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `REDIS_URL`, `KV_REST_API_TOKEN`, `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_READ_ONLY_TOKEN`, `GLOBAL_CONFIG`.
4. The five `V2_KV_*` variables appear only in the **Preview** environment list.
5. No credential value was read, printed or handled at any point. Isolation was established from provenance and scope, not by comparing secrets.

### Runtime re-verification

Provenance is not the last word. `_store.assertIsolated()` compares the V2 host against `KV_REST_API_URL` / `KV_URL` at boot and **refuses to start** if they match, and every V2 response carries `X-Humvance-V2-Store`, `X-Humvance-V2-Isolation` and `X-Humvance-V2-Namespace`. The HTTP validation script refuses to write anything when that header reports `SHARED-WITH-PRODUCTION`. So the claim in this section is machine-checked on every request, not asserted once in a document.

---

## 3. V2 environment variable contract — Preview only

### Credentials (provisioned by the integration; values never handled)

The database was connected with a Vercel integration custom prefix of `V2_KV`, which produces:

```
V2_KV_KV_REST_API_URL
V2_KV_KV_REST_API_TOKEN
V2_KV_KV_REST_API_READ_ONLY_TOKEN
V2_KV_KV_URL
V2_KV_REDIS_URL
```

The V2 contract is the **`V2_` prefix**, not one exact spelling, because the spelling is determined by a prefix chosen at connection time (prefix `V2` yields `V2_KV_REST_API_URL`; prefix `V2_KV` yields `V2_KV_KV_REST_API_URL`). `_store.js` accepts either, in that preference order, and records which variable it used — the name, never the value.

`pickV2Credential()` **refuses any candidate name that does not begin `V2_`**, and a test asserts that none of `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN` or `REDIS_URL` appears in any candidate list. V1's production credentials are unreachable from V2 code by name.

### Required non-secret settings — ⚠ CORRECTED 2026-09-18

An earlier version of this section said these two variables were "NOT YET SET". **That is stale and was wrong.** Mohammed reports that the Vercel dashboard shows:

- **`V2_STORE_DRIVER` and `V2_NAMESPACE` entries scoped to Production**, and
- **branch-specific entries for `v2-case-spine`.**

What follows from that, precisely:

| | |
|---|---|
| Their **values** | **unverified.** Never read in this session, and must remain untouched. Nothing below assumes what they contain |
| Production-scoped entries | leave alone. V2 is not deployed to Production and must not be |
| `v2-case-spine` branch entries | **must not be assumed to apply to `sprint1-diagnostic-intake-v2`.** Branch-scoped Vercel variables apply to the branch they name. Sprint 1 is a different branch and may have none |
| Scope of the Preview database credentials | **still needs verification** — §2 records the store as Preview-only from the dashboard, which is not the same as confirming which branches receive the credentials |

The intended Preview-only values for Sprint 1 remain:

```
V2_STORE_DRIVER = redis                    (Preview)
V2_NAMESPACE    = humvance-v2-preview      (Preview)
```

**Do not silently adopt a different namespace.** If a different value is already present, or a different one is wanted, record the proposed change here and have it decided deliberately — a namespace change silently applied would split the store in a way that looks like data loss.

Until both exist for the environment the deployment actually runs in, V2 answers `503 store_misconfigured` and writes nothing. That is the designed behaviour, not a fault, and it is the fail-closed reason this uncertainty is safe to carry overnight.

**Network reachability:** this session cannot reach `vercel.com`, `api.vercel.com` or `*.vercel.app` from either the cloud container or the device VM. Nothing about the dashboard, the deployment or the Preview host can be verified from here; every statement about them in this document is either Mohammed's report or an inference clearly labelled as one.

**Do not set `V2_ACKNOWLEDGE_SHARED_PRODUCTION_DB`.** It exists only as a deliberate human override and is unnecessary here.

### Fail-closed behaviour (all covered by tests)

| Condition | Result |
|---|---|
| `V2_STORE_DRIVER` absent | throws; no default, no fallback |
| `V2_NAMESPACE` absent or malformed | throws |
| namespace starting `prod` | throws unless explicitly acknowledged |
| only V1 credentials present | throws; names not read |
| V2 host equals the production host | `assertIsolated()` refuses to start |
| a caller-supplied storage key | refused before it reaches the driver |
| any V1 key prefix | denied by the key assertion |

---

## 4. Authorization — organization scope is server-side

**What changed and why.** Scope used to come from `org` / `orgs` JWT claims. That is the wrong kind of answer: a claim is something the caller presents, so the tenant boundary was being defined by the party it exists to constrain. Those claims are now **ignored entirely** — no code path in `api/v2` reads them, asserted by test.

Scope now comes from a membership record in V2 storage (`api/v2/_membership.js`). Membership is acquired in exactly two ways, both server-side:

1. **Creating an organisation makes the creator a member of it.** An ownership rule, applied on the server.
2. **An existing member may grant access to a named principal.** Human reviewers only; a non-member attempting to grant is answered **404**, not 403.

Principal identity comes from the token subject when there is one. Principal ids are hex-encoded for storage — injective, and inside the V2 key alphabet. A token from which no safe identity can be derived is refused: an unattributable action cannot be audited.

### ⚠ Known limitation — reviewer-vs-reviewer separation is NOT achieved

`api/auth/login.js` issues `signJWT({ role: 'admin' })` against a single shared password hash at `admin:password_hash`. The token has **no `sub`, no `uid`, no subject of any kind**. Every Humvance reviewer authenticating through V1 is therefore literally the same principal, represented explicitly as `admin:shared` rather than the previous silent `'unknown'`.

Consequences, stated plainly:

- **Achieved:** client organisations are separated from each other. A case in org A cannot be read or written through org B's scope, and the check is repeated on every read in `_repo.readScoped()`. Client portal tokens never gain reviewer access. Approval remains human-only and server-enforced.
- **Not achieved:** two different Humvance reviewers cannot be told apart, so membership cannot separate them.

**The smallest identity model that would close this** (a V1 change, deliberately not attempted here):

1. A reviewer record per person — `reviewer:{id}` with their own credential, replacing the single shared `admin:password_hash`.
2. `signJWT({ sub: reviewerId, role })` at login, so the token carries a subject. `_membership.principalIdFrom()` already prefers a subject when present, so V2 needs **no change** once this exists.
3. A first-reviewer bootstrap during setup, and reviewer administration behind the existing admin role.

Nothing in V2 needs to be weakened or revisited to adopt it.

### Signing secret

The repository is public, so two strings are known to everyone: `hv-change-this-secret` (the `api/_utils.js` fallback) and the `SESSION_SECRET` value published in `.env.example`. V1's fallback is left exactly as it is — changing it is a Production code change and out of scope — but **V2 refuses to serve on a missing, weak (<24 chars) or published signing secret**, returning `503 signing_secret_*`. The value is compared, never logged, never returned, never included in an error; a test asserts that.

`SESSION_SECRET` is present in both Production and Preview as a `sensitive` variable. Its value has not been read and must not be. **Someone with dashboard access should confirm it is neither published string.** This cannot be checked from here without forging a token against Production, which was not done and must not be.

---

## 5. V2 architecture

Branch `v2-case-spine`, cut from `production`. `git merge-base --is-ancestor production v2-case-spine` passes, so both security fixes are inherited through ancestry rather than re-applied. `api/submit.js` on V2 is byte-identical to Production's and `requireAdmin` is in the same four V1 files. **No V1 file is modified by V2.**

| File | Responsibility |
|---|---|
| `api/v2/_ids.js` | server-minted opaque identifiers |
| `api/v2/_store.js` | storage boundary, credential contract, isolation barriers |
| `api/v2/_membership.js` | principal identity and organization membership |
| `api/v2/_domain.js` | pure domain rules — no I/O, no env, no framework |
| `api/v2/_untrusted.js` | untrusted-content scanning and fencing |
| `api/v2/_challenge.js` | deterministic adversarial review |
| `api/v2/_repo.js` | persistence, optimistic concurrency, audit |
| `api/v2/_authz.js` | authentication, roles, tenant scope, AI boundary, secret posture |
| `api/v2/_service.js` | application service — the only place rules compose |
| `api/v2/case.js` | HTTP surface; parses, authorises, dispatches, maps errors |
| `api/v2/_intake.js` | Diagnostic Intake V2 — allow-list schema, record builders, holding-area storage |
| `api/v2/intake.js` | the only unauthenticated endpoint in `api/v2`; create-only |
| `api/v2/intake-review.js` | authenticated reviewer surface for the holding area |
| `public/v2-workspace.html` | minimal reviewer workspace |
| `public/intake.html` | client-facing Diagnostic Intake V2, 12 steps, AR/EN |
| `public/v2-intake-review.html` | reviewer surface for pending submissions |

Objects: Organization, Membership, Case, Claim, Hypothesis, Evidence, EvidenceRequest, Contradiction, Finding, ChallengeReview, Approval, AuditEvent, plus the two pre-tenant intake objects IntakeSeed and IntakeReview (§11). Architected for but not built: Engagement, Intervention, Action, Metric, Verification, Monitoring Signal, Organizational Memory.

**Case lifecycle:** INTAKE → STRUCTURING → INVESTIGATION_PLANNING → HUMAN_REVIEW → AWAITING_EVIDENCE → ANALYZING_EVIDENCE → {FINDING_DRAFT | CLARIFICATION_REQUIRED} → CHALLENGE_REVIEW → HUMAN_APPROVAL → APPROVED. Declarative and total; a transition absent from the table does not exist. Five transitions are human-only and refused for `ai` and `system`. Entering APPROVED additionally requires a stored human approval covering the current finding's exact version.

**Approval** binds organization + artifact type + artifact id + **version** + reviewer + role + timestamp + decision + comment. An approval of v1 does not cover v2; a material revision clears the case's approved answer. Approving over a BLOCKED challenge requires written justification.

**Evidence:** `original_content`, `ai_extraction` and `ai_interpretation` are separate fields, never merged; `original_content` is in no update allow-list, so a source can never be edited — a correction is new evidence. Submitted content is scanned for instruction-shaped text, stored verbatim, flagged, audited, never obeyed.

**Findings** are rated STRONG / MODERATE / LIMITED by rule with the caps that produced the rating. A caller-asserted strength is ignored and recomputed. No numeric truth score exists anywhere. Causal phrasing below STRONG is flagged in English and Arabic.

**Audit:** 20 event types, ordered, attributed, org-scoped. No prompts, no reasoning, no chain-of-thought — asserted by test.

---

## 6. Tests

```
node tests/v1/run.js          →  105 checks, 105 passed, 0 failed   (new, §13)
node tests/v2/run.js          →  246 checks, 246 passed, 0 failed   (baseline was 162)
node scripts/v2-case-001.js   →   62 checks,  62 passed, 0 failed   (unchanged)
node scripts/v2-intake-001.js →   90 checks,  90 passed, 0 failed   (new, §11)
```

`npm run test:all` runs all four in that order. `npm run test:v1` and `npm run test:v2` run one each. Last run 2026-09-18; the numbers above are the runner's own output, not an expectation copied forward.

The 162 baseline checks are unchanged by Sprint 1. Of the 84 added: 65 in `tests/v2/intake.test.js` (the holding area) and 19 in `tests/v2/intake-recovery.test.js` (failure injection, idempotency and concurrency).

The 105 V1 checks are the auth consolidation's evidence (§13): 36 in `tests/v1/auth-equivalence.test.js` (behavioural equivalence against frozen copies of the Production handlers), 40 in `tests/v1/auth-dispatch.test.js` (the dispatcher's fail-closed matrix) and 29 in `tests/v1/baseline-integrity.test.js` (everything the consolidation was not allowed to touch).

**These are memory-driver results. Sprint 1 is locally verified, not integration verified** — no run has yet touched the isolated Preview store (§8, blockers 1–4).

**The recovery tests inject failures into the memory driver. That does not establish deployed failure-injection behaviour.** A real Redis driver fails in ways the memory driver cannot reproduce — partial writes, timeouts, retries that succeed after the caller has given up, connection resets mid-sequence. What the memory-driver tests establish is that the *promotion algorithm* converges under interruption at six named boundaries; what they do not establish is how the real store behaves when it is the thing that breaks.

Both run on the in-process memory driver. **No database of any kind is contacted.** No external dependency; `node` alone.

`scripts/v2-case-001-http.js` drives the same synthetic pilot against a deployed Preview over HTTP. It refuses to run against a Production host, refuses to run when the deployment reports `SHARED-WITH-PRODUCTION`, refuses to run when storage is unconfigured, and prints no secret.

### Synthetic Case #001

Invented Saudi owner-led company, ~120 employees. Sponsor claim recorded as `UNVERIFIED`. Six competing hypotheses. Six evidence items plus a deliberately hostile document. A `policy_vs_practice` contradiction — the delegation matrix grants authority up to SAR 20,000 while 412 of 480 sub-threshold purchase orders carry the owner as final approver — is carried openly and drives the finding.

The challenge engine returns **BLOCKED** (two live competing explanations, one open contradiction) and the reviewer approves over it with written justification. That is the designed path. Every refusal fires: AI approval, stale-version approval, blocked-challenge approval without justification, the v1 approval failing to cover v2, cross-tenant read and write, a non-member organisation, token org claims granting nothing, an undefined transition, a stale version, a malformed payload, and a V1-shaped identifier reaching the store.

**All data synthetic. No real company, employee or client record. The Preview database must contain synthetic test data only.**

---

## 7. Repository

**Branches on origin:** `production` (`f2374043`), `v2-case-spine`, `legacy/hr-platform-2026-09-14` (`ee129eb`), `main` (`ee129eb`), `hotfix-submit-validation-2026-09-16`, `production-auth-hotfix-2026-09-16`, `phase3-meeting-intelligence-2026-09-16`, `recovered-phase2-2026-09-16`.

**Tags on origin (7, annotated):** `prod/2026-09-16-baseline` → `3296bd4` · `prod/2026-09-16-auth` → `0d60514` · `prod/2026-09-16-submit` → `f2374043` · `archive/legacy-hr-platform` → `ee129eb` · `archive/phase2` → `57526a2` · `archive/phase3` → `2605c90` · `archive/superseded-auth-fix` → `f384154`.

---

## 8. Open blockers

| # | Blocker | What is needed |
|---|---|---|
| 1 | `V2_STORE_DRIVER` / `V2_NAMESPACE` scope for the Sprint 1 branch is unknown | **corrected 2026-09-18** — entries exist for Production and for `v2-case-spine`; whether `sprint1-diagnostic-intake-v2` receives them is unverified, as is the scope of the Preview credentials. See §3 |
| 2 | This workspace has **no git push credentials** | the operator pushes `v2-case-spine` |
| 3 | V2 Preview deployment not yet created | follows from 1 and 2 |
| 4 | Isolated-store Case #001 not yet run | follows from 3; `scripts/v2-case-001-http.js` is ready |
| ~~5~~ | ~~GitHub default branch~~ | **RESOLVED** — GitHub's default is `production`; local `origin/HEAD` corrected to match |
| 6 | No branch protection on `production` | free for public repos |
| 7 | Reviewer identity model | §4; needed before multiple reviewers can be separated |
| 8 | `SESSION_SECRET` value unverified against the two published strings | a human check in the dashboard |
| 9 | 27 untracked `*-MOHAMMED*` OneDrive conflict artifacts remain in the working tree | harmless and fully accounted for (§0); delete when convenient, or add `*-MOHAMMED*` to `.gitignore` so `git add -A` can never pick them up |
| 10 | `.git` is inside a OneDrive-synced folder | the cause of the 2026-09-17 incident; see the recommendation at the end of §0 |
| 11 | Preview build for `295635b` failed: *"No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan"* | **addressed locally, unverified in deployment** — the auth consolidation (§13) takes the source-level count from 14 to 10. Only a successful Preview build confirms it |
| 12 | Auth routing under the legacy `routes` key is unverified | `vercel.json` uses top-level `routes`. Whether Vercel's filesystem handler still resolves `api/auth/[action].js` under that configuration cannot be established locally. A concrete fallback is prepared and **not applied** — see §13 "Routing" |
| 13 | Branch not pushed since `295635b` | the auth-consolidation commit is local only. Mohammed's decision; no push authorization was used |

---

## 9. Technical debt — recorded, not fixed

| # | Item | Notes |
|---|---|---|
| 1 | V1 `submit.js` non-atomic get-then-set | check-then-act; fix is one conditional write (`SET … NX`) |
| 2 | V1 `genRef()` — 9,000 values/year, client-side `Math.random()` | ~50% collision chance by ~112 submissions/year; ~13.9 expected colliding pairs at 500. Self-heals via the 409 only because Hotfix 01 is deployed |
| 3 | V1 flat KV namespace | no prefixing, no key grammar |
| 4 | QA records awaiting cleanup | `HUM-QA-DUMMY-A-1789588888234`, `HUM-QA-DUMMY-B-1789588888234`, `client:HUM-2026-2420` + its `clients:refs` entry. **No cleanup performed; none authorised** |
| 5 | Hardcoded JWT fallback secret in `api/_utils.js` | inert while `SESSION_SECRET` is set; V2 now fails closed on it |
| 6 | Phase 3 permissive `isValidRef` | not in Production, not ported to V2 |
| 7 | Phase 3 blind diagnostic POST | not in Production, not ported to V2 |
| 8 | V1 browser-only approval state | `public/admin.html` sets approval in the browser with no server authority |
| 9 | Repository is public | history scanned across all refs — no real secret was ever committed |
| 10 | V1 admin tokens carry no subject | see §4 |
| 11 | Integration prefix is `V2_KV`, producing doubled names | cosmetic; the code contract covers it. Tidy by reconnecting with prefix `V2` if desired |
| 12 | `api/questions.js` interpolates an unvalidated `ref` into `client:${ref}` | the last unvalidated V1 key interpolation. Bounded — the record must already exist and `phases.p2.clientToken` must match — but it is the same coupling Hotfix 01 closed in `submit.js`, and it is inconsistent with `submit.js` and `portal.js`. **Deliberately not fixed in Sprint 1** (V1 files were out of scope); needs its own hotfix |
| 13 | `case_intent` rides in `case.metadata`, not as a first-class Case field | tightening `createCase()` would change the authenticated Case API, which Sprint 1 did not do. The value is validated against `CASE_INTENTS` before it is written and is never rewritten |
| 14 | `add_claim` is not exposed on `api/v2/case.js` | promotion creates the client-belief claim through an internal service helper. A reviewer still cannot add a claim to a live case over HTTP; needed for reviewer case work, not for intake |
| 15 | Intake rate limiting is per serverless instance | the V2 store driver exposes no TTL primitive, so a durable counter would accumulate keys forever and hashed-IP counters would be personal data at rest. Fix is a platform-level rule (Vercel Firewall) or a TTL primitive on the store |
| 16 | Promotion is convergent, not atomic | the store has no transaction. Each attempt moves strictly closer to the planned end state and the end state is identical whichever attempt reaches it, but a single ACCEPT is several writes and can still be observed half-done between them. See §11 "Recovery" for what is and is not guaranteed |
| 17 | `public/v2-workspace.html` still explains `unscoped_token` | that code no longer exists; `_authz.js` returns `no_org_membership` / `not_found` since scope moved to server-side membership. Cosmetic, left alone to keep Sprint 1 scoped |
| 18 | V1 `forgot.js` prints the reset OTP to the server log when no email service is configured | `console.log('[forgot] OTP (no email service configured):', otp)`. **Pre-existing; observed while freezing the baseline for the auth consolidation, not introduced by it.** Whoever can read Vercel's function logs can read a live password-reset code. Inert only while `RESEND_API_KEY` is set. Not changed here: the consolidation preserves baseline behaviour exactly, and silently altering an auth path was out of bounds |
| 19 | V1 `reset.js` has no attempt limit, and `forgot.js` no rate limit | **Pre-existing; observed during the same review.** The OTP is six digits with a 15-minute window and no counter, so it is brute-forceable within its validity; and `forgot` is unauthenticated, so it can be triggered repeatedly, overwriting the stored code and mailing the admin each time. The replay path *is* closed (the code is deleted before the new hash is written, and that is tested), so this is about guessing and nuisance, not replay |

None of these were introduced into V2 except 13–17, which are Sprint 1's own recorded debt. **18 and 19 are pre-existing V1 defects found during the auth consolidation and deliberately left unchanged** — equivalence to the Production baseline is the whole point of that change, and fixing an auth path inside a packaging change would have hidden the fix.

---

## 10. PDPL and privacy readiness

**No claim of PDPL compliance is made.** No real employee data has been used, and the Preview database is for synthetic data only.

Present: organisation scoping on every object and read; role-based access, deny by default; append-oriented audit of material events; source provenance and versioning; explicit separation of source from AI interpretation; retention hooks; no chain-of-thought retention.

Required before any real client employee data is processed: lawful basis and recorded purpose per data category; data-minimisation review of Evidence intake; a retention and deletion policy with enforcement; data-subject access, correction and erasure paths; cross-border transfer controls (the Upstash primary region is a configuration decision with PDPL consequences); AI-processing transparency notices; a DPA with the processor; encryption-at-rest confirmation; a breach-notification runbook; and a decision on whether interview transcripts naming individuals may be stored verbatim as `original_content`.

---

## 11. Diagnostic Intake V2 — the holding area (Sprint 1)

**Branch:** `sprint1-diagnostic-intake-v2`, cut from `v2-case-spine` @ `88a866c` (checkpoint tag `checkpoint/sprint1-start-2026-09-18`). **Not merged. Not deployed. The live landing CTA is unchanged.**

### The architecture in one line

```
anonymous visitor → immutable Pending Intake Seed → human review → accept / reject
                                                          ↓ accept only
                                        Organization + Case(INTAKE) + claims + evidence
```

**A stranger cannot create a tenant.** An anonymous submission creates exactly two records and nothing else: no Organization, no Case, no Claim, no Evidence, no Hypothesis, no Finding, no Approval, no membership, no conclusion. Asserted against the raw contents of the store, not against a return value.

### Two objects, because the seed must be immutable

| Type | Written | Contains |
|---|---|---|
| `intakeseed` | once, with `putIfAbsent`; **never updated** | the client's own words, the untrusted scan, and the epistemic labels |
| `intakereview` | version-checked updates | Humvance's handling: status, reviewer, timestamp, reason, resulting org/case |

The brief asked the seed to carry a `status`. It carries it on the review record instead: a status is a fact about *our* handling, and mixing the two is how an "immutable" record stops being one. Both types are **pre-tenant** — they have no `organization_id`, so `_repo.readScoped()` must never be used on them, and `_store.js` says so at the type list.

### Why `api/v2/intake.js` is a separate file

`api/v2/case.js` is **unchanged by this sprint**, asserted by test. Its whole value is that every request goes through authenticate → reviewer → membership → operation with no exceptions; an anonymous branch inside it would be a hole in the one file designed not to have one. The new endpoint does not import it, shares no dispatcher with it, and references none of its operations (also asserted by test).

`api/v2/intake.js`: POST only — a GET is `405`, so **there is no anonymous read**; create-only; strict allow-list that rejects unknown keys rather than dropping them; per-field and body-size limits; every free-text field scanned by `_untrusted.js`; every id, status, timestamp and provenance marker minted server-side. The response carries `success`, an opaque `HVS-` reference and `status: RECEIVED` — nothing else, so it cannot be used as an oracle.

### What acceptance maps, and what it refuses to do

| Intake step | Becomes | State |
|---|---|---|
| 3 — what is happening | the **primary Claim** (`createCase({sponsor_claim})`) | `UNVERIFIED` |
| 9 — client belief | a **secondary Claim** | `UNVERIFIED`, `is_primary:false`, `metadata.role: client_belief` |
| 6 — recent examples (0–3) | **Evidence**, `source_type: sponsor_statement` | `UNVERIFIED`, explicit limitations, one shared `source_name` so three stories from one person count as **one** independent source |
| 1 — organisation context | **Organization** (created, or an existing one the reviewer already belongs to) | — |
| 2 — intent | `case.metadata.case_intent`, validated against `CASE_INTENTS` | — |
| 4,5,7,8,10,11 | `case.metadata.intake_*`, plus the immutable seed reference | — |

The Case is left in **INTAKE**. Acceptance proposes no hypothesis, drafts no finding, runs no challenge, records no approval and computes no strength. It means "this is worth investigating", not "we know what is wrong".

**§23 is enforced mechanically:** an `OPPORTUNITY` submission whose title contains pathology language (English or Arabic) is refused with `pathology_language_in_opportunity_title`, and the generated default title is `"<company> — preparation for growth or organizational change"`.

### Recovery — the decision is not the work

**DECISION STATE ≠ PROMOTION EXECUTION STATE.** The review record carries both, separately:

| Field | Meaning | Lifecycle |
|---|---|---|
| `status` | what a human decided | `PENDING_REVIEW` → `ACCEPTED` \| `REJECTED`, once, never again |
| `promotion_state` | whether the work finished | `null` → `PENDING` → `COMPLETE`, retried as often as needed |

Two mechanisms make that work:

1. **The decision is claimed atomically.** `intakedecision` is written once per submission with `setIfAbsent` — Redis `SET NX`, the only operation in this store that cannot be interleaved. The version check that preceded it is read-then-write and therefore *cannot* promise one decision: two reviewers pressing Accept in the same instant both read version 1, both pass, and without the marker one of them would go on to build a second Organization and a second Case from the same submission. That was measured, not theorised — a concurrency test produced exactly that before the marker existed.
2. **Every identifier is minted before anything is created.** The promotion plan — organization, case, primary claim, belief claim, one id per example — is written down in the same operation that records the decision. A resumed attempt therefore asks the store *"does `case_id` exist yet?"* instead of *"did I already make a case for this?"*. The first question has an answer; the second does not, which is why a crash between creating an object and recording its id used to produce a duplicate.

`resume_promotion` finishes an interrupted promotion. It asks for no new decision, is gated on the same human approval authority, and running it against a `COMPLETE` promotion creates nothing and reports what exists.

**What is guaranteed, and what is not.** The store offers no transaction, and this does not pretend otherwise. The guarantee is **convergence**: each attempt moves strictly closer to the planned end state, and the end state is identical whichever attempt reaches it. A single ACCEPT is still several writes and can be observed half-done between them — which is why `resulting_organization_id` and `resulting_case_id` stay null until the promotion is `COMPLETE`, so a half-built promotion never *looks* finished.

**Audit reconciliation.** Creations audit themselves, but an attempt that died between creating an object and auditing it would leave a gap the resumed attempt cannot see — it correctly skips the creation, and would skip the entry too. So before declaring the promotion complete, the case's trail is read and any missing entry is written with `backfilled: true`. Idempotent: an uninterrupted run finds everything present and writes nothing.

### Two defects, both found by testing rather than by reading

1. **Sprint 1:** the Organization and the Case were created *before* the version check, so a stale Accept was refused after it had already built a tenant nobody could see. Caught by `scripts/v2-intake-001.js`.
2. **Hardening pass:** every failure boundary after the decision left the submission permanently stranded — `ACCEPTED`, nothing built, and a retry refused as "already decided". Six injected failures, six strandings. That is what the plan/marker/resume design above fixes, and `tests/v2/intake-recovery.test.js` injects a real write failure at each of those six boundaries and proves the promotion converges on one Organization, one Case, two Claims and three Evidence items every time.

### Epistemic labels in the data

Every seed carries `epistemic_status`, so a later consumer cannot mistake one kind of statement for another:

```
reported_situation    → CLIENT_REPORTED_OBSERVATION
recent_examples       → CLIENT_REPORTED_SELF_REPORT
observed_impact       → CLIENT_STATED_NOT_MEASURED
change_context        → TEMPORAL_ASSOCIATION_ONLY_NOT_CAUSAL
client_belief         → CLIENT_CLAIM_UNVERIFIED
evidence_availability → AVAILABILITY_ONLY_NOT_EVIDENCE
desired_outcome       → CLIENT_STATED_GOAL_NOT_AN_INTERVENTION
```

Evidence **availability** is never stored as Evidence. Nothing has been received, there is no provenance and there is no content; counting it would let `assessEvidenceStrength()` weigh material that does not exist.

### Client-facing page

`/intake` → `public/intake.html`. Twelve steps, Arabic (RTL) and English (LTR), responsive at 360/390/768/1280 with no horizontal overflow at any width. It computes nothing. The post-submit screen carries the reference and:

> **Your submission has been received.** Humvance will review the information you provided and determine the appropriate next step. Nothing has been assessed yet, and no conclusion about your organization has been drawn from what you sent.

It deliberately does **not** say "your case has been created", because no Case exists before human acceptance. A test asserts the page contains no score, no `/100`, no maturity rating, no diagnosis, no root cause, no recommendation and no proposal promise, in either language.

### Privacy

Data minimisation by construction: an employee-count *band* rather than a headcount, one respondent rather than a roster, no uploads, no communications metadata, no individual ratings, no health data. Three separate consent acknowledgements are required — data use, AI transparency, and a confirmation that the submitter avoided unnecessary personal or sensitive employee information — and the UI says so in both languages. The client IP is used only for in-memory rate limiting, hashed with a per-process salt, and is never written to the store, the seed, the audit trail or a log. **No claim of PDPL compliance is made** (§10 still applies).

---

## 12. Next recommended build slice

Sprint 1 built the front half of the path: a real client can now describe what they are seeing, and a reviewer can turn that into a Case without anything being concluded on the way. What it did not build is the reply.

**The next slice is the client-facing side of `EvidenceRequest`** — the thing §11 of the old numbering already pointed at, now with a reason it did not have before: an accepted intake arrives with an *availability map* (what the client says exists) and zero evidence. The obvious next move is to let a reviewer turn one line of that map into an approved request, and let the sponsor answer it directly instead of a consultant transcribing them.

It introduces no new domain concepts, it exercises provenance-on-arrival and the burden gate under real use, and it closes the loop that Sprint 1 deliberately left open.

Two things should land before or alongside it:

1. **Blocker 7 — reviewer identity.** Every reviewer is still `admin:shared`, so every intake decision recorded in §11 is attributed to the same principal. That is tolerable with one reviewer and wrong with two.
2. **Debt 12 — `api/questions.js` ref validation**, as its own small hotfix on the V1 line.

Not next, and deliberately so: the 14-domain taxonomy, any automatic hypothesis generation from an intake, and any AI step inside the intake path. Sprint 1's value is that the input is clean and the epistemic state is preserved; adding reasoning before that has been used in anger would be building on an untested foundation.

---

## 13. V1 auth consolidation — buying back the function budget (2026-09-18)

### The blocker, stated precisely

The Preview build for `295635b` failed with:

> No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan.

Vercel creates one Serverless Function per `.js` file under `api/`, **except** files whose basename begins with an underscore, which are treated as shared modules. The evidence for that exclusion is a single direct observation, not documentation: the READY `v2-case-spine` deployment at `88a866c` reports **Functions 12** from an `api/` tree of 22 `.js` files, of which exactly 10 are underscore-prefixed. 22 − 10 = 12.

| branch | `.js` under `api/` | `_`-prefixed | would-be functions |
|---|---|---|---|
| `production` | 12 | 1 | 11 |
| `v2-case-spine` @ `88a866c` | 22 | 10 | **12** (matches the reported count) |
| `sprint1-diagnostic-intake-v2` @ `295635b` | 25 | 11 | **14** → over the limit |
| `sprint1-diagnostic-intake-v2` after this change | 21 | 11 | **10** |

Sprint 1 added two endpoints (`api/v2/intake.js`, `api/v2/intake-review.js`). Those are the work; they are not negotiable. The five `api/auth/*.js` handlers are, because they are five functions doing one job.

### What was done

`api/auth/{login,setup,status,forgot,reset}.js` are superseded by a single file, `api/auth/[action].js`, which contains all five handler bodies **lifted verbatim** — same method gate, same status codes, same Arabic strings, same `catch` semantics, same KV call order — plus a dispatcher.

This is a **packaging change, not a behaviour change**. Nothing was refactored, unified or tidied on the way through, because every difference would be behaviour risk bought for no benefit.

**Every public URL is unchanged.** `/api/auth/login`, `/api/auth/setup`, `/api/auth/status`, `/api/auth/forgot`, `/api/auth/reset` are all still live, and `public/index.html` and `public/admin.html` were not modified.

### The dispatcher — the URL decides, not the query string

This is the only genuinely new code, and therefore the new risk surface.

```
path names a known action   → that action runs; a query `action` may agree, never contradict
path names something else   → 404, whatever the query says
path names no action        → the query decides, if it names a known action
anything else               → 404
```

Concretely: `/api/auth/anything?action=login` **does not reach login**; `/api/auth/status?action=setup` is refused rather than resolved either way; a repeated `?action=` (which arrives as an array), or any non-string value, is refused rather than silently narrowed to one element. Every refusal is a 404 that performs **no storage access and no outbound call** — asserted, because a dispatcher that answered 404 *after* running `reset` would pass a status-only test.

The lookup table is a null-prototype object over a frozen allow-list, so `constructor`, `__proto__`, `toString` and a deliberately poisoned `Object.prototype` all resolve to nothing. That is tested directly.

**Recorded uncertainty, deliberately not claimed as solved:** we could not establish locally how Vercel's runtime represents a *dynamic path parameter* versus a *caller-supplied query parameter* of the same name, or which wins when they differ. There is no local Vercel runtime here and the question is about the platform, not this code. The dispatcher is therefore written so that the answer does not matter: it never lets a query parameter override an action the path has already named.

### Routing — the prepared fallback, NOT applied

`vercel.json` uses the legacy top-level `routes` key. Whether the filesystem handler still resolves the dynamic segment `api/auth/[action].js` under that legacy configuration is **unverified and unverifiable locally**. If a Preview deployment shows the five auth URLs 404ing, the fix is a configuration change with **no code change**, because the dispatcher already resolves correctly under it:

```json
{ "src": "/api/auth/(login|setup|status|forgot|reset)",
  "dest": "/api/auth/[action]?action=$1" }
```

It is left unapplied pending Mohammed's decision, per the instruction to prepare the alternative and stop before implementing it.

### How equivalence is evidenced

`tests/fixtures/v1-auth-baseline/{login,setup,status,forgot,reset}.js` are **byte-identical frozen copies** of the Production files; their SHA-256 hashes are asserted against the recorded Production values on every run. `tests/v1/harness-v1.js` runs the frozen handler and the consolidated one in identical isolated worlds — same fake KV, same pinned clock, same pinned `Math.random`, same stubbed `fetch` — and compares status, body, headers, **the exact ordered sequence of KV operations including expiry options**, the resulting stored state and the outbound calls.

Behaviours that a rewrite would plausibly have lost, and that are now pinned by name:

- a portal token (`role:'client'`) is a validly signed JWT and must still read as **not** authenticated (Hotfix 00);
- a KV failure in `status` returns **200 with both flags false**, not 500;
- `forgot` answers `200 {sent:true}` for a non-matching address **without touching storage at all** (anti-enumeration);
- `reset` deletes the OTP **before** writing the new hash, so a code cannot be replayed if the write then fails;
- a wrong OTP leaves the stored code intact.

**Nothing real is touched by these tests.** No database, no mail service, no secret, no customer data. `@vercel/kv` is not installed in this checkout and is intercepted at require time rather than resolved; the interception hook is removed immediately after loading and a test asserts it is gone.

### What this changes about our guarantees

Until now, every V1 file was byte-identical to Production. That is **no longer true of `api/auth/*`**, deliberately. The weaker, accurate claim that replaces it:

> **Auth packaging differs from the Production baseline. Local behavioural equivalence is tested. Other V1 files and the Case API remain unchanged. Real Preview routing and deployed function count remain unverified until deployment.**

`tests/v1/baseline-integrity.test.js` pins the rest of that sentence: the seven untouched V1 files, `api/v2/case.js` and `scripts/v2-intake-http.js` are each asserted against their recorded Production hash, and the source-level function count is asserted to be within the limit.

**The budget test guards source structure, not Vercel's deployed artifact count.** It counts files in this repository under an inferred naming convention. Only a deployment reports the real number.

### Not done, deliberately

- No endpoint was deleted to save a slot. `api/send-questions.js` (email) is retained, as instructed.
- Anonymous intake and reviewer operations remain two separate files; merging them to save a slot was explicitly out of bounds and is asserted against.
- No plan upgrade, no Production change, no Vercel setting touched.
- No authentication redesign. Equivalence to the baseline is not a claim that the baseline is secure — see debt 5, 8 and 10.
