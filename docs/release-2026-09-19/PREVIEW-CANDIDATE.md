# Internal Preview candidate — 2026-09-19

Source base: `a89ac99fd92f4e83e29219b11d5add99a43ce341`, branch `sprint1-diagnostic-intake-v2`, existing `humvance/humvance` repository and `humvance` Vercel project.

Mohammed requested the next release-preparation step after the developer handoff and confirmed current project records are synthetic test data. This candidate integrates the delivered public interface and management navigation for a protected Preview. It is not production or diagnostic-release clearance.

The delivery was copied into an isolated checkout outside OneDrive. The developer's original working tree was preserved. Existing API handlers are unchanged from the source base; no diagnostic policy, owner identity, approval semantics, credentials, storage settings or domain mappings were changed.

`scripts/build-preview.js` creates an explicit static allowlist in `preview-public`. The deployed root is the redesigned homepage. Runtime pages/assets are included, while fixture data and local session-issuing tools are absent from static output. Source fixtures and the local harness remain available to local tests. The builder rejects a non-Preview Vercel environment, so promotion requires a separately reviewed production candidate.

Local memory integration and deployed Redis integration are separate evidence. Do not weaken Vercel protection or extract browser credentials to run a gate. Use only synthetic records and existing authorized authentication. D1/D2/R4 remain open; generated or stale findings must not be treated as approved client deliverables. Mohammed personally controls client release; this candidate does not claim that complete owner-bound enforcement is implemented.

At preparation, Vercel UI verified current Production as `dpl_DbqESRz5X3KJyRUkdz38Q5Fh2iX5`, source `f2374043d3ba603fba6ab5de16437776192eaf00`; latest existing Preview as `dpl_DYAv77UXvyuAcWs9n8WaCahkDWPA`, source `a89ac99fd92f4e83e29219b11d5add99a43ce341`. The source files copied here were not present in those historical builds.

V2 Preview configuration on this branch was observed as `redis` / `humvance-v2-preview`. V2 credential names are scoped to Preview. Production has V2 driver/namespace names but no corresponding V2 credential names were shown in the inspected project list. Secret values were not revealed. V1 storage, mail and AI credential names are shared between Production and Preview; do not use V1 writes, mail or paid AI in Preview as if isolated.

Production remains untouched. Preview source identity, resulting routes, function inventory and actual access/storage behavior must be verified after deployment. This document is preparation evidence, not a claim of completed deployment.

## Candidate verification

Windows Node 24.19.0, with installed Chrome: V1 121/121, UI 66/66, V2 249/249, case001 62/62, intake001 90/90, beta browser integration 325/325. The generated static artifact additionally passed management round-trip 94/94 and public request-to-case journey 38/38 through the existing local memory harness. Each browser integration script used a private loopback server; owned servers were stopped. These results do not establish deployed Redis behavior.

Artifact checks confirmed 24 static files, redesigned `index.html` matching `home.html`, no fixture asset, and disabled fixture mode. A Production-environment build was refused before any artifact bytes changed.

The first baseline run failed because Windows checkout converted unchanged LF Git blobs into CRLF files. Every restored file was first proven identical to its Git blob after CRLF-to-LF normalization; only those unchanged files were restored byte-for-byte in this isolated checkout. The original failed output was retained. Existing hashes/assertions were not changed, and the subsequent full baseline passed.
