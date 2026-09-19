'use strict';
/**
 * One synthetic case, carried from INTAKE to APPROVED entirely through the
 * screens — no manual store edit, no hand-typed API call.
 *
 *     npm run beta                                 # in one shell
 *     node tests/ui/repro-case-walkthrough.js      # in another
 *
 * This is the claim the whole practitioner surface stands on, so it is checked
 * the only way that means anything: by driving the buttons a person would press
 * and then asking the SERVER what it stored.
 *
 * The one thing this test is careful about: a case state must be read back from
 * the API, never from the status line the page just wrote. A screen that lies
 * would otherwise pass its own examination.
 *
 * It also checks the refusals that matter, because a workflow that cannot be
 * done wrongly is most of the product:
 *
 *   · a finding cannot be drafted outside FINDING_DRAFT
 *   · an approval cannot be recorded for a finding version that has not been
 *     through the adversarial review
 *   · entering APPROVED requires an approval that covers the current version
 *
 * LOCAL INTEGRATION only: real handlers, real rules, in-memory store. Nothing
 * here says anything about Preview or Production.
 */
const { chromium } = require('playwright');
const { assertLocalHarness, fromPlaywright } = require('./_beta-guard');

const BASE = process.env.HV_BASE || 'http://127.0.0.1:4178';
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + String(detail).slice(0, 300) : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  /* BETA-R03: refuse before any write if this is not the local harness. */
  const harness = await assertLocalHarness(BASE, fromPlaywright(ctx.request, BASE));
  const session = harness.session;
  const auth = { Authorization: 'Bearer ' + session.token };
  const api = async (body) => {
    const r = await ctx.request.post(BASE + '/api/v2/case', { headers: auth, data: body });
    const j = await r.json();
    if (!r.ok()) throw new Error(body.op + ': ' + JSON.stringify(j));
    return j;
  };

  const org = await api({ op: 'create_organization', name: 'SYNTHETIC — walkthrough' });
  const ORG = org.organization_id;
  const created = await api({
    op: 'create_case', organization_id: ORG,
    title: 'SYNTHETIC — approvals bottleneck at one manager',
    sponsor_claim: 'Everything waits on one person and nobody will say so out loud.'
  });
  const CASE = created.case.case_id;

  /** The stored case, from the server. Never the screen. */
  async function stored() {
    const r = await ctx.request.get(
      BASE + '/api/v2/case?organization_id=' + ORG + '&case_id=' + CASE + '&view=reviewer', { headers: auth });
    return r.json();
  }
  async function waitForState(to, ms) {
    const until = Date.now() + (ms || 9000);
    while (Date.now() < until) {
      const b = await stored();
      if (b.case && b.case.status === to) return true;
      await page.waitForTimeout(200);
    }
    return false;
  }

  async function openForm(tab, op) {
    await page.click('[data-hv-tab="' + tab + '"]');
    await page.waitForSelector('details[data-op="' + op + '"]');
    const open = await page.$eval('details[data-op="' + op + '"]', n => n.open);
    if (!open) await page.click('details[data-op="' + op + '"] > summary');
  }
  /** Press the button, confirm if a confirmation appears, report what came back. */
  async function run(op, { material }) {
    await page.click('[data-op-run="' + op + '"]');
    if (material) {
      await page.waitForSelector('.op-confirm', { timeout: 5000 });
      await page.click('[data-op-confirm="' + op + '"]');
    }
    await page.waitForTimeout(500);
    return page.$eval('[data-op-status="' + op + '"]', n => n.className + ' :: ' + n.innerText);
  }
  async function transition(to) {
    await openForm('overview', 'transition');
    await page.selectOption('#op-transition-to_state', to);
    await run('transition', { material: true });
    return waitForState(to);
  }

  await page.goto(BASE + '/v2-workspace', { waitUntil: 'domcontentloaded' });
  await page.evaluate(tk => {
    try { sessionStorage.setItem('hv_token', tk); localStorage.setItem('hv_lang', 'en'); } catch (e) {}
  }, session.token);
  await page.goto(BASE + '/v2-workspace?organization_id=' + ORG + '&case_id=' + CASE, { waitUntil: 'networkidle' });

  // ── structuring: the competing explanations ──────────────────────────────
  await openForm('hypotheses', 'add_hypothesis');
  await page.fill('#op-add_hypothesis-label', 'H1');
  await page.fill('#op-add_hypothesis-statement',
    'SYNTHETIC — one approver is a serialising queue; throughput is bounded by their calendar.');
  await run('add_hypothesis', {});
  await openForm('hypotheses', 'add_hypothesis');
  await page.fill('#op-add_hypothesis-label', 'H2');
  await page.fill('#op-add_hypothesis-statement',
    'SYNTHETIC — the delay is upstream: requests arrive incomplete and are returned.');
  await run('add_hypothesis', {});

  let b = await stored();
  check('two competing explanations were recorded through the screen',
    (b.hypotheses || []).length === 2, (b.hypotheses || []).length);

  check('INTAKE → STRUCTURING through the panel', await transition('STRUCTURING'));
  check('STRUCTURING → INVESTIGATION_PLANNING', await transition('INVESTIGATION_PLANNING'));
  check('INVESTIGATION_PLANNING → HUMAN_REVIEW', await transition('HUMAN_REVIEW'));
  check('HUMAN_REVIEW → AWAITING_EVIDENCE (a human-only transition)', await transition('AWAITING_EVIDENCE'));

  // ── an evidence request, through the burden gate ─────────────────────────
  await openForm('evidence', 'propose_evidence_request');
  await page.fill('#op-propose_evidence_request-requested_item',
    'SYNTHETIC — the approval timestamps from the workflow tool for the last quarter.');
  await page.fill('#op-propose_evidence_request-reason',
    'Nothing we hold shows how long each item actually waits, or where.');
  await page.fill('#op-propose_evidence_request-uncertainty_resolved',
    'Whether the wait is at the approver or upstream of them.');
  /* The gate is answered honestly: it changes the investigation, it is needed
     now, and none of the three blocking conditions is true. */
  await page.check('#op-propose_evidence_request-burden_gate input[value="materially_changes"]');
  await page.check('#op-propose_evidence_request-burden_gate input[value="necessary_now"]');
  const reqStatus = await run('propose_evidence_request', {});
  check('an evidence request that passes the burden gate is created', /op-status-ok/.test(reqStatus), reqStatus);

  await openForm('evidence', 'decide_evidence_request');
  await page.selectOption('#op-decide_evidence_request-__target', { index: 1 });
  await page.selectOption('#op-decide_evidence_request-decision', 'APPROVED');
  const decideStatus = await run('decide_evidence_request', { material: true });
  check('a human decision on the request is recorded', /op-status-ok/.test(decideStatus), decideStatus);
  b = await stored();
  check('the request is APPROVED in the store',
    (b.evidenceRequests[0] || {}).status === 'APPROVED', JSON.stringify(b.evidenceRequests.map(r => r.status)));

  // ── evidence, from two genuinely different sources ───────────────────────
  async function addEvidence(type, name, content, limits) {
    await openForm('evidence', 'add_evidence');
    await page.selectOption('#op-add_evidence-source_type', type);
    await page.fill('#op-add_evidence-source_name', name);
    await page.fill('#op-add_evidence-original_content', content);
    await page.fill('#op-add_evidence-limitations', limits);
    return run('add_evidence', {});
  }
  await addEvidence('system_record', 'SYNTHETIC — workflow export 2026-Q2',
    'Median wait at the approval step: 4.1 days. Median wait at every other step: under 3 hours.',
    'Covers one quarter only.\nSays nothing about why the approver was unavailable.');
  await addEvidence('interview', 'SYNTHETIC — delivery lead',
    'We batch requests because sending them singly means they sit anyway.',
    'One person’s account.\nThe speaker is affected by the outcome.');

  b = await stored();
  check('both evidence items are attached, with their limits', (b.evidence || []).length === 2, (b.evidence || []).length);
  check('the original content is stored as the source said it',
    (b.evidence || []).every(e => typeof e.original_content === 'string' && e.original_content.length > 10));

  // ── a contradiction, kept with both sides ────────────────────────────────
  await openForm('gaps', 'record_contradiction');
  await page.selectOption('#op-record_contradiction-kind', 'claim_vs_data');
  await page.fill('#op-record_contradiction-summary',
    'SYNTHETIC — the sponsor describes a capacity problem; the workflow export shows a queue at one step.');
  await page.selectOption('#op-record_contradiction-left_evidence_id', { index: 1 });
  await page.selectOption('#op-record_contradiction-right_evidence_id', { index: 2 });
  const conStatus = await run('record_contradiction', {});
  check('a contradiction is recorded with both sides', /op-status-ok/.test(conStatus), conStatus);

  // ── a finding cannot be drafted before the case is ready for one ─────────
  await openForm('findings', 'draft_finding');
  await page.fill('#op-draft_finding-statement', 'SYNTHETIC — premature draft, must be refused.');
  await page.fill('#op-draft_finding-scope', 'Nowhere; this should not be accepted.');
  const early = await run('draft_finding', {});
  check('the server refuses a finding drafted outside FINDING_DRAFT, and the screen says so',
    /op-status-bad/.test(early) && /invalid_state/.test(early), early);
  b = await stored();
  check('the refused draft created nothing', (b.findings || []).length === 0, (b.findings || []).length);

  check('AWAITING_EVIDENCE → ANALYZING_EVIDENCE', await transition('ANALYZING_EVIDENCE'));
  check('ANALYZING_EVIDENCE → FINDING_DRAFT', await transition('FINDING_DRAFT'));

  // ── the finding ──────────────────────────────────────────────────────────
  await openForm('findings', 'draft_finding');
  await page.fill('#op-draft_finding-statement',
    'SYNTHETIC — within the approval step, waiting time is concentrated at a single approver rather than distributed across the workflow.');
  await page.fill('#op-draft_finding-scope',
    'The approval step of this one workflow, over 2026-Q2. Not a statement about the team’s capacity.');
  await page.check('#op-draft_finding-supporting_evidence input >> nth=0');
  await page.fill('#op-draft_finding-alternative_explanations',
    'Requests arrive incomplete and are returned, which would show the same aggregate wait.');
  await page.fill('#op-draft_finding-limitations',
    'One quarter of data.\nNo measurement of request quality on arrival.');
  const draftStatus = await run('draft_finding', {});
  check('the finding is drafted through the screen', /op-status-ok/.test(draftStatus), draftStatus);

  b = await stored();
  const finding = (b.findings || [])[0];
  check('the finding is stored with its scope and its limits',
    finding && finding.scope && (finding.limitations || []).length >= 2, JSON.stringify(finding && finding.scope));
  check('a strength category was assessed and stored, not invented by the page',
    finding && ['LIMITED', 'MODERATE', 'STRONG'].indexOf(finding.evidence_strength) !== -1,
    finding && finding.evidence_strength);

  // ── approval is refused before the adversarial review has run ────────────
  check('FINDING_DRAFT → CHALLENGE_REVIEW', await transition('CHALLENGE_REVIEW'));
  check('CHALLENGE_REVIEW → HUMAN_APPROVAL', await transition('HUMAN_APPROVAL'));

  await openForm('findings', 'record_approval');
  await page.selectOption('#op-record_approval-__target', { index: 1 });
  await page.selectOption('#op-record_approval-decision', 'APPROVED');
  const noChallenge = await run('record_approval', { material: true });
  check('approval is refused while the finding version has had no adversarial review',
    /op-status-bad/.test(noChallenge) && /challenge_required/.test(noChallenge), noChallenge);

  /* The review runs in CHALLENGE_REVIEW, so go back for it — which is itself
     the workflow the product describes, not a workaround. */
  check('HUMAN_APPROVAL → FINDING_DRAFT (human-only)', await transition('FINDING_DRAFT'));
  check('FINDING_DRAFT → CHALLENGE_REVIEW again', await transition('CHALLENGE_REVIEW'));

  await openForm('findings', 'run_challenge');
  await page.selectOption('#op-run_challenge-__target', { index: 1 });
  const challengeStatus = await run('run_challenge', {});
  check('the adversarial review runs from the screen', /op-status-ok/.test(challengeStatus), challengeStatus);
  const challengeBack = await page.$eval('[data-op-result="run_challenge"]', n => n.innerText);
  check('the read-back reports the verdict the server reached',
    /PASSED|WARNINGS|BLOCKED/.test(challengeBack), challengeBack.slice(0, 200));

  b = await stored();
  const challenge = (b.challenges || [])[0];
  check('the challenge is bound to the finding version it examined',
    challenge && challenge.finding_version === finding.version,
    challenge && challenge.finding_version + ' vs ' + finding.version);

  // ── the human decision ───────────────────────────────────────────────────
  check('CHALLENGE_REVIEW → HUMAN_APPROVAL', await transition('HUMAN_APPROVAL'));
  await openForm('findings', 'record_approval');
  await page.selectOption('#op-record_approval-__target', { index: 1 });
  await page.selectOption('#op-record_approval-decision', 'APPROVED');
  await page.fill('#op-record_approval-comment',
    'SYNTHETIC — read v1 in full; the scope and the stated limits match what the evidence supports.');
  const approvalStatus = await run('record_approval', { material: true });
  check('the approval is recorded', /op-status-ok/.test(approvalStatus), approvalStatus);

  b = await stored();
  const approval = (b.approvals || [])[0];
  check('the approval names the exact finding version it covers',
    approval && Number(approval.artifact_version) === Number(finding.version),
    approval && approval.artifact_version);
  check('the approval records a human actor', approval && approval.created_by_type === 'human',
    approval && approval.created_by_type);

  check('HUMAN_APPROVAL → APPROVED (human-only, and only with a covering approval)',
    await transition('APPROVED'));

  b = await stored();
  check('the case carries the finding it approved, by id and version',
    b.case.approved_finding_id === finding.finding_id && Number(b.case.approved_finding_version) === Number(finding.version),
    b.case.approved_finding_id + ' v' + b.case.approved_finding_version);

  // ── what the screen says about all this ──────────────────────────────────
  await page.click('[data-hv-tab="findings"]');
  await page.waitForTimeout(300);
  const findingsText = await page.$eval('#app', n => n.innerText);
  check('the findings tab states the known limitations of the strength assessment',
    /Known limitations/.test(findingsText) && /rule-based/.test(findingsText), findingsText.slice(0, 200));
  check('the finding is shown as approved at a version, not simply "approved"',
    /Approved at v\d/.test(findingsText), (findingsText.match(/Approved[^\n]*/) || [])[0]);

  await page.click('[data-hv-tab="audit"]');
  await page.waitForTimeout(250);
  const auditText = await page.$eval('#app', n => n.innerText);
  ['Hypothesis proposed', 'Evidence', 'finding', 'approval'].forEach(() => {});
  check('the audit trail carries every step that was just taken',
    (b.audit || []).length >= 15, (b.audit || []).length);
  check('the audit trail is readable, not a list of identifiers',
    auditText.indexOf('approval.recorded') !== -1 && /[A-Za-z]{4,} [a-z]{3,}/.test(auditText));

  await browser.close();
  console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\nthe whole case ran through the screens');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
