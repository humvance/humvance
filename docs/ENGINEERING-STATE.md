# Humvance — Engineering State

**Last updated:** 2026-09-17
**Maintained on:** `v2-case-spine`
**Contains no secrets.** Environment variables are referred to by NAME only; no value, token, URL or credential appears in this file.

---

## 1. Production

| | |
|---|---|
| Live deployment | `dpl_DbqESRz5X3KJyRUkdz38Q5Fh2iX5` |
| Commit | `f2374043d3ba603fba6ab5de16437776192eaf00` |
| State | READY |
| Aliases | `humvance.com`, `www.humvance.com`, `humvance.vercel.app` |
| Previous good deployment | `dpl_9kGyzjSgJ7RJSNrXNmdNT8aX5iCb` @ `0d60514` |
| Plan | Vercel Hobby — **no Instant Rollback, no promote**. Rollback = redeploy from commit. |
| Repository | `github.com/humvance/humvance` — **public** |

`f2374043` is the canonical baseline. Its ancestry is the complete deployment record:

```
f2374043  Reject invalid and colliding refs in unauthenticated intake   [Hotfix 01]
0d60514   Fix cross-client authorization on admin endpoints             [Hotfix 00]
3296bd4   Capture exact Production baseline before auth hotfix          [live tree, hash-verified]
20ed482   Humvance Phase 2 stable baseline                              [root]
```

Verified 2026-09-17, read-only: homepage 200, `/api/auth/status` → `{"setupDone":true,"authenticated":false}`, `/api/v2/case` → **404** (V2 is not on Production and must not be).

---

## 2. Repository lineage

Two unrelated roots share one repository.

```
LINEAGE B — dead, unrelated application (5 commits)
  08ca3f2 … ee129eb   ← origin/main, GitHub default, Vercel Production Branch  ⚠ STILL ARMED

LINEAGE A — Humvance
  20ed482 ─┬─ 3296bd4 ─ 0d60514 ─ f2374043    DEPLOYMENT LINE  ← live
           │                         └─ 795cc26  V2 Case spine   (local only)
           └─ d381dc2 … 57526a2 ─ … ─ 2605c90   DEVELOPMENT LINE (never deployed)
```

`git merge-base main f2374043` → **none**. `main` is not an old Humvance; it is a different application with a different data layer, a root-level `index.html`, no admin console and no client portal. Neither security hotfix exists on it.

### Branch roles

| Ref | SHA | Where | Role |
|---|---|---|---|
| `production` | `f2374043` | **local only** | canonical deployment branch (pending push) |
| `v2-case-spine` | `795cc26` | **local only** | V2 development (pending push) |
| `legacy/hr-platform-2026-09-14` | `ee129eb` | **local only** | parked dead lineage (pending push) |
| `hotfix-submit-validation-2026-09-16` | `f2374043` | origin | what Production was built from |
| `production-auth-hotfix-2026-09-16` | `0d60514` | origin | previous good deployment |
| `phase3-meeting-intelligence-2026-09-16` | `2605c90` | origin | port source for V2 — **never merge into the deployment line** |
| `recovered-phase2-2026-09-16` | `57526a2` | origin | strict ancestor of Phase 3; **zero unique content** |
| `main` | `ee129eb` | origin | dead lineage; to be retired |

### Provenance tags — created locally, NOT yet on origin

| Tag | → commit |
|---|---|
| `prod/2026-09-16-baseline` | `3296bd4` |
| `prod/2026-09-16-auth` | `0d60514` |
| `prod/2026-09-16-submit` | `f2374043` |
| `archive/legacy-hr-platform` | `ee129eb` |
| `archive/phase2` | `57526a2` |
| `archive/phase3` | `2605c90` |
| `archive/superseded-auth-fix` | `f384154` |

`f384154` exists on **no remote** and is patch-identical to `2605c90`; its tag is the only thing that will preserve it.

---

## 3. Open blockers

### 3.1 Preview/Production data isolation — HARD GATE, NOT SATISFIED

Preview and Production share one Upstash Redis database. `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN` and `REDIS_URL` are each scoped to **both** `production` and `preview` with identical values.

Provisioning a second database through the existing, already-authorised Upstash marketplace installation is **not possible without a payment method**. The plan list returned for a new resource contains eight plans — Pay As You Go, Fixed 250MB, 1GB, 5GB, 10GB, 50GB, 100GB, 500GB — and every one carries `paymentMethodRequired: true`. There is no free plan for a new resource; the existing store sits on a legacy `free` plan that is no longer offered.

**Consequence: V2 must not be deployed to Preview until this is resolved.** All V2 work to date runs on the in-process memory driver and has contacted no database of any kind.

### 3.2 No write credentials to `origin`

The workspace has no git credential helper, no `.git-credentials`, no `~/.netrc`, no SSH key, and no `gh` or `vercel` CLI. Anonymous reads succeed (the repository is public); `git push` fails at authentication. Consequently the tags, `production`, `legacy/hr-platform-2026-09-14` and `v2-case-spine` all exist **locally only**.

### 3.3 `main` is still an armed production trigger

Vercel Production Branch = `main`, `ignoreCommand: null`, GitHub default branch = `main`, project Git-linked. One push to `main` deploys the unrelated application over `humvance.com`.

Flipping the setting was attempted on 2026-09-17 and **could not be completed**: Vercel rejects a Production Branch that does not exist in the connected repository (`Failed to save branch tracking`), and `production` cannot be created on origin without push credentials. **Vercel configuration was left exactly as found** — `productionBranch: "main"`, all other project settings unchanged, live deployment unchanged.

---

## 4. V2 architecture

Commit `795cc26` on `v2-case-spine`, cut from `production` (`f2374043`). `git merge-base --is-ancestor production v2-case-spine` passes, so V2 inherits both security fixes through ancestry rather than by re-application. `api/submit.js` on the V2 branch is byte-identical to Production's; `requireAdmin` is present in the same four V1 files. **No V1 file is modified by V2.**

### Modules

| File | Lines | Responsibility |
|---|---|---|
| `api/v2/_ids.js` | 78 | server-minted opaque identifiers |
| `api/v2/_store.js` | 220 | storage boundary and isolation barriers |
| `api/v2/_domain.js` | 408 | pure domain rules — no I/O, no env, no framework |
| `api/v2/_untrusted.js` | 87 | untrusted-content scanning and fencing |
| `api/v2/_challenge.js` | 168 | deterministic adversarial review |
| `api/v2/_repo.js` | 193 | persistence, optimistic concurrency, audit |
| `api/v2/_authz.js` | 125 | authentication, roles, tenant scope, AI boundary |
| `api/v2/_service.js` | 684 | application service — the only place rules compose |
| `api/v2/case.js` | 182 | HTTP surface; parses, authorises, dispatches, maps errors |
| `public/v2-workspace.html` | 340 | minimal reviewer workspace |

### Objects

`Organization`, `Case`, `Claim`, `Hypothesis`, `Evidence`, `EvidenceRequest`, `Contradiction`, `Finding`, `ChallengeReview`, `Approval`, `AuditEvent`.

Every object carries `organization_id`, `created_at` / `created_by` / `created_by_type`, `updated_at` / `updated_by` / `updated_by_type`, and `version`.

Architected for but deliberately **not built**: Engagement, Intervention, Action, Metric, Verification, Monitoring Signal, Organizational Memory. Records are memory-ready (source, source date, verification status, version, snapshot) so the graph can be added without a migration.

### Storage isolation — four barriers

1. **Credential namespace.** V2 reads `V2_REDIS_URL` / `V2_KV_REST_API_URL` / `V2_KV_REST_API_TOKEN` and never reads the V1 production variable names. Pointing V2 at Production requires a human to deliberately copy a production secret into a differently-named variable.
2. **Fail closed.** No driver default, no credential default, no fallback. `V2_STORE_DRIVER` and `V2_NAMESPACE` are both required; a misconfigured deployment throws `503 store_misconfigured` on its first request.
3. **Key namespace.** Keys are composed inside `_store.js` as `v2:{namespace}:{type}:{id}` from a validated namespace, a whitelisted type and a server-minted id. No exported function accepts a caller-supplied key.
4. **Legacy deny-list.** Every computed key is asserted against the V2 grammar and refused if it starts with `client:`, `clients:`, `admin:`, `questions:`, `session:` or `user:`.

`assertIsolated()` compares the configured host against `KV_REST_API_URL` / `KV_URL` and **refuses to start** when they match, unless `V2_ACKNOWLEDGE_SHARED_PRODUCTION_DB=yes` is set deliberately. Every V2 response carries `X-Humvance-V2-Store`, `X-Humvance-V2-Isolation` and `X-Humvance-V2-Namespace` so the isolation state is visible on every request.

**This is code-level isolation. It is weaker than a separate database and does not satisfy §3.1.**

### Case state machine

```
INTAKE → STRUCTURING → INVESTIGATION_PLANNING → HUMAN_REVIEW
  → AWAITING_EVIDENCE → ANALYZING_EVIDENCE → { FINDING_DRAFT | CLARIFICATION_REQUIRED }
  → CHALLENGE_REVIEW → HUMAN_APPROVAL → APPROVED
```

Declarative and total: a transition absent from `CASE_TRANSITIONS` does not exist. Self-transitions are refused. Unknown states and unknown actor types are refused.

Five transitions are human-only and are refused for `ai` and `system` actors: `HUMAN_REVIEW→AWAITING_EVIDENCE`, `HUMAN_APPROVAL→APPROVED`, `HUMAN_APPROVAL→FINDING_DRAFT`, `HUMAN_APPROVAL→AWAITING_EVIDENCE`, `APPROVED→FINDING_DRAFT`.

Entering `APPROVED` additionally requires a stored human Approval that covers the current Finding's exact version; without one the transition fails `approval_required`.

### AI governance — enforced in code, not in prompts

| | |
|---|---|
| AI may | read, extract, classify, analyse, propose, draft, challenge, flag, summarise |
| AI may not | approve findings, approve interventions, execute interventions, make client or employment decisions, bypass human approval |

Three independent enforcement points: `_domain.canTransition` (actor type vs `HUMAN_ONLY_TRANSITIONS`), `_authz.requireApprovalAuthority` (human + approval-bearing role), `_service.recordApproval` (re-checks, and writes `security.rejected` to the audit trail on refusal).

### Authorization and tenant isolation

Four gates on every request, in order: authenticate → reviewer role → organization scope → operation.

A valid signature is not authorization — the V1 lesson. Client portal tokens (`role:'client'`) never reach V2. Reviewer tokens must carry an `org` or `orgs` claim; an unscoped token is refused (`unscoped_token`) rather than treated as "all organisations".

Cross-tenant access returns **404, not 403** — confirming that a Case exists in another organisation is itself a disclosure. The check lives in `_repo.readScoped()`, through which every read passes.

### Approval model

An Approval binds `organization_id` + `artifact_type` + `artifact_id` + **`artifact_version`** + reviewer + role + timestamp + decision + comment. Decisions: `APPROVED`, `MODIFIED`, `MORE_EVIDENCE_REQUIRED`, `REJECTED`.

An approval of Finding v1 does not cover v2. Recording the outcome on the finding deliberately does **not** bump its version (`bumpVersion:false`), so the approval cannot invalidate the number it just named. A material revision (`statement`, `scope`, `limitations`, `alternative_explanations`, `evidence_strength`) clears the Case's `approved_finding_id`, so the Case stops having an answer until a human reviews again. Browser-side flags are never authoritative.

Approving over a `BLOCKED` challenge requires a written reviewer justification of at least 20 characters.

### Evidence, findings and language

`original_content`, `ai_extraction` and `ai_interpretation` are separate fields and are never merged; `original_content` is not in any update allow-list, so a source can never be edited — a correction is new evidence. Submitted content is scanned for instruction-shaped text, stored **verbatim**, flagged, and written to the audit trail; it is never obeyed.

Findings are rated `STRONG` / `MODERATE` / `LIMITED` by rule, with the caps that produced the rating returned alongside. Caps: no usable evidence → LIMITED; a single independent source → LIMITED; self-report only → LIMITED; any open contradiction → at most MODERATE. STRONG requires ≥3 independent sources, ≥1 non-self-report source, no open contradiction, and ≥1 alternative explanation explicitly tested. Legacy V1 material enters as `legacy_unverified` and never counts.

Phase 2's confidence arithmetic survives as structured sufficiency logic. **The 0–100 score does not survive.** The caller cannot assert a strength; a claimed `evidence_strength` is ignored and recomputed.

Causal phrasing with less than STRONG evidence is flagged, in English **and Arabic** — note that JavaScript's `\b` never fires between two Arabic letters, so the Arabic patterns are deliberately unanchored.

### Audit

Append-oriented, 18 event types, ordered, each attributed to an actor and an actor type, each organisation-scoped. Records the material chain: Claim → Evidence → Hypothesis → Contradiction → Finding → Challenge → Human decision. **No prompts, no model reasoning, no chain-of-thought** — asserted by test.

### Client experience

Internal state names, competing hypotheses, challenge internals and strength arithmetic are never exposed. The client sees Current Focus, Status (`Understanding` / `Reviewing` / `Clarifying` / `Finding Ready`; `Complete` reserved for the deferred Engagement close), What We Need From You, Next Step, and — only after human approval — the approved Finding with its scope, limitations, alternative explanations and bounded evidence strength.

---

## 5. Phase 3 components reused

| Pattern | Disposition |
|---|---|
| Declarative `STATUS_TRANSITIONS` table | **refactored** into `CASE_TRANSITIONS` + `HYPOTHESIS_TRANSITIONS` |
| Pure domain functions separated from transport | **adopted** as the shape of `_domain.js` |
| Allow-listed `UPDATABLE_FIELDS` | **adopted** per object type |
| `buildDiagnosticSnapshot` / `isSnapshotStale` | **generalised** to `buildEvidenceSnapshot` / `isSnapshotStale` — the seed of evidence versioning |
| Artifact-before-index writes | **adopted** in `_repo.js` |
| Optimistic concurrency | **strengthened** — `expected_version` is mandatory, not optional |
| `_diagnostic-core` factor/cap logic | **refactored** into `assessEvidenceStrength`; numeric score removed |
| `isValidRef` (`/^[A-Za-z0-9._-]+$/`) | **NOT ported** — permits `.`, i.e. the namespace escape Hotfix 01 closed |
| `client.js` diagnostic POST (blind whole-object write) | **NOT ported** |
| Browser-side approval authority | **NOT ported** |
| Caller-controlled storage keys | **NOT ported** — impossible to express in V2 |

---

## 6. Legacy compatibility

No legacy data migrated, no Production data rewritten, the V1 flow untouched. `Case.legacy_source_ref` exists as a forward hook. Legacy diagnostic text has no provenance and is not trusted V2 evidence; a legacy browser-side approval is not a V2 Approval.

---

## 7. Tests

```
node tests/v2/run.js        →  119 checks, 119 passed, 0 failed
node scripts/v2-case-001.js →   56 checks,  56 passed, 0 failed
```

Both run on the memory driver. **No KV of any kind is contacted.** No external dependency; `node` alone.

Coverage: identifier safety and namespace escape; state-machine reachability and totality; invalid transitions; the AI/human boundary; client status mapping; hypothesis lifecycle; evidence sufficiency rules and caps; causality guard (English and Arabic); allow-listed updates; approval version binding; snapshots and staleness; the burden gate; untrusted-content scanning and fencing; the ten challenge checks; storage fail-closed configuration; V1 credential-name avoidance; key namespace escape; legacy prefix denial; case creation; transitions; stale and missing versions; evidence provenance; evidence update allow-list; evidence requests; finding drafting and versioning; unauthorized and authorized approval; tenant isolation (read and write); authorization layer; audit completeness and chain-of-thought absence; client-view leakage.

### Synthetic Case #001

Invented Saudi owner-led company, ~120 employees, rapid growth. Sponsor claim recorded as `UNVERIFIED`. Six competing hypotheses (H1–H6). Six evidence items plus a deliberately hostile document. A `policy_vs_practice` contradiction — the delegation matrix grants authority up to SAR 20,000 while 412 of 480 sub-threshold purchase orders carry the owner as final approver — is recorded openly and drives the finding rather than being resolved away.

The challenge engine returned **BLOCKED** (two live competing explanations; one open contradiction). The reviewer approved over it with a written justification, which is the designed path, and every refusal below fired as intended: AI approval, stale-version approval, blocked-challenge approval without justification, the v1 approval failing to cover v2, cross-tenant read and write, undefined transition, stale version, malformed payload, and a V1-shaped identifier reaching the store.

**All data synthetic. No real company, employee or client record.**

---

## 8. Known technical debt — recorded, not fixed

| # | Item | Notes |
|---|---|---|
| 1 | V1 `submit.js` non-atomic get-then-set | check-then-act; fix is a single conditional write (`SET … NX`) |
| 2 | V1 `genRef()` — 9,000 values/year, client-side `Math.random()` | ~50% chance of a collision by ~112 submissions/year; ~13.9 expected colliding pairs at 500. Self-heals via the 409 only because Hotfix 01 is deployed |
| 3 | V1 flat KV namespace | no prefixing, no key grammar |
| 4 | QA records awaiting cleanup | `HUM-QA-DUMMY-A-1789588888234`, `HUM-QA-DUMMY-B-1789588888234`, `client:HUM-2026-2420` + its `clients:refs` entry. **No cleanup performed; none authorised** |
| 5 | Hardcoded JWT fallback secret in `api/_utils.js` | inert while `SESSION_SECRET` is set; V2 should fail closed instead |
| 6 | Phase 3 permissive `isValidRef` | not in Production, not ported to V2 |
| 7 | Phase 3 blind diagnostic POST | not in Production, not ported to V2 |
| 8 | V1 browser-only approval state | `public/admin.html` sets approval in the browser with no server authority |
| 9 | **The repository is public** | `.env.example` publishes a plausible `SESSION_SECRET` value, and `_utils.js` publishes the fallback string. History scanned across all refs: no real secret was ever committed. **Verify that the live `SESSION_SECRET` is neither published string** |
| 10 | V1 admin tokens carry no `org` claim | V2 refuses them by design; admin login must issue org-scoped tokens before the reviewer workspace can be used |

None of these were introduced into V2.

---

## 9. PDPL and privacy readiness

**No claim of PDPL compliance is made.** No real employee data has been used.

Present in the architecture: organisation scoping on every object and every read; role-based access with deny-by-default; append-oriented audit of material events; source provenance and versioning; explicit separation of source from AI interpretation; retention hooks (`version`, `superseded_by` semantics, snapshots); no chain-of-thought retention.

Required before any real client employee data is processed: a lawful-processing basis and recorded purpose per data category; data minimisation review of Evidence intake; a retention and deletion policy with enforcement; data-subject access, correction and erasure paths; cross-border transfer controls (the Upstash primary region is a configuration decision with PDPL consequences); AI-processing transparency notices; a DPA with the processor; encryption-at-rest confirmation; breach notification runbook; and a decision on whether interview transcripts naming individuals may be stored verbatim as `original_content`.

---

## 10. Next recommended build slice

1. **Resolve §3.2** — one `git push` publishes the tags, `production`, `legacy/hr-platform-2026-09-14` and `v2-case-spine`.
2. **Resolve §3.3** — flip Vercel's Production Branch to `production` (only possible once the branch exists on origin), then GitHub's default branch, then branch protection. Public repositories get rulesets free.
3. **Resolve §3.1** — a payment-method decision on a second Upstash resource, or an equivalent isolated store. Until then V2 stays off Preview.
4. **Org-scoped admin tokens** — add `org`/`orgs` claims at login so the reviewer workspace can authenticate. Small, self-contained, and it unblocks the whole V2 UI.
5. **Then, and only then:** deploy V2 to Preview and re-run Case #001 against the isolated store.

After that, the first product slice worth building is **Evidence intake for the client** — the portal side of `EvidenceRequest`, so a sponsor can answer the five investigation questions without a consultant transcribing them. It is the narrowest path from "Humvance can reason about a case" to "a real client can be in one", and it needs no new domain concepts.
