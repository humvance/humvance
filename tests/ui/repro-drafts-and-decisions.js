'use strict';
/**
 * BETA-R01, BETA-R02 and the coverage BETA-R06 asked for.
 *
 *     npm run beta                                     # in one shell
 *     node tests/ui/repro-drafts-and-decisions.js      # in another
 *
 * Two defects the independent review reproduced, and the two operation forms
 * that had never been exercised through the screen.
 *
 * R01 — the confirmation could submit a decision the operator had not read. It
 *       displayed ACTIVE with one reason, the operator then edited the fields,
 *       and the server received NOT_SUPPORTED with another. The confirmation was
 *       re-reading the form at click time.
 * R02 — a language switch or a tab change emptied every form, losing unsaved
 *       work with no warning.
 *
 * WHAT IS SET UP THROUGH THE API AND WHAT IS TESTED THROUGH THE SCREEN is
 * stated for every section, because a count of passing checks says nothing
 * about which layer was actually exercised. API setup is used only to reach a
 * starting state; every behaviour under test is driven by clicking, typing and
 * selecting, and every outcome is read back from the SERVER.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { assertLocalHarness, fromPlaywright } = require('./_beta-guard');

/* An optional delivery folder. The two things this pass changed on screen — a
   confirmation that reads as a decision, and a form that says it is holding
   unsaved work — cannot be photographed without driving the whole sequence, so
   they are captured here, and only after the checks above them have passed. */
const OUT = process.argv[2] || null;
async function shot(page, name, sel) {
  if (!OUT || failures) return;
  fs.mkdirSync(OUT, { recursive: true });
  const target = sel ? page.locator(sel) : page;
  await target.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('  ' + name + '.png');
}

const BASE = process.env.HV_BASE || 'http://127.0.0.1:4178';
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + String(detail).slice(0, 300) : '')); }
}
function head(s) { console.log('\n' + s); }

const NOTE_A = 'SYNTHETIC — interview note that must survive a language switch and a tab change.';
const REASON_REVIEWED = 'SYNTHETIC — the reason the operator actually reviewed.';
const REASON_SNEAKED = 'SYNTHETIC — typed after the confirmation was already on screen.';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();

  const harness = await assertLocalHarness(BASE, fromPlaywright(ctx.request, BASE));
  const auth = { Authorization: 'Bearer ' + harness.session.token };
  const api = async (body) => {
    const r = await ctx.request.post(BASE + '/api/v2/case', { headers: auth, data: body });
    const j = await r.json();
    if (!r.ok()) throw new Error(body.op + ': ' + JSON.stringify(j));
    return j;
  };
  const bundle = async (org, kase) => (await ctx.request.get(
    BASE + '/api/v2/case?organization_id=' + org + '&case_id=' + kase + '&view=reviewer',
    { headers: auth })).json();

  const posts = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().indexOf('/api/') !== -1) posts.push(r.url()); });

  /* ── SET UP THROUGH THE API: two cases, so a draft can be shown not to
     leak between them. Nothing under test happens here. ─────────────────── */
  async function seedCase(name, toState) {
    const org = await api({ op: 'create_organization', name: 'SYNTHETIC — ' + name });
    const made = await api({
      op: 'create_case', organization_id: org.organization_id,
      title: 'SYNTHETIC — ' + name,
      sponsor_claim: 'Work waits between two teams and nobody can say where.'
    });
    const ORG = org.organization_id, CASE = made.case.case_id;
    await api({ op: 'add_hypothesis', organization_id: ORG, case_id: CASE,
      label: 'H1', statement: 'SYNTHETIC — the wait is a queue at one approver.' });
    const path = ['STRUCTURING', 'INVESTIGATION_PLANNING', 'HUMAN_REVIEW', 'AWAITING_EVIDENCE',
                  'ANALYZING_EVIDENCE', 'FINDING_DRAFT', 'CHALLENGE_REVIEW'];
    for (const to of path) {
      if (!toState || path.indexOf(to) > path.indexOf(toState)) break;
      const b = await bundle(ORG, CASE);
      await api({ op: 'transition', organization_id: ORG, case_id: CASE, to_state: to, expected_version: b.case.version });
      if (to === toState) break;
    }
    return { ORG, CASE };
  }

  const A = await seedCase('case A', 'AWAITING_EVIDENCE');
  const B = await seedCase('case B', 'AWAITING_EVIDENCE');
  const ev = await api({ op: 'add_evidence', organization_id: A.ORG, case_id: A.CASE,
    source_type: 'system_record', source_name: 'SYNTHETIC — workflow export 2026-Q2',
    original_content: 'Median wait at the approval step: 4.1 days.',
    limitations: ['Covers one quarter only.'] });

  const openCase = async (c, lang) => {
    await page.goto(BASE + '/v2-workspace', { waitUntil: 'domcontentloaded' });
    await page.evaluate(function (a) {
      try { sessionStorage.setItem('hv_token', a.tk); localStorage.setItem('hv_lang', a.lang); } catch (e) {}
    }, { tk: harness.session.token, lang: lang || 'en' });
    await page.goto(BASE + '/v2-workspace?organization_id=' + c.ORG + '&case_id=' + c.CASE,
      { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
  };
  const openForm = async (tab, op) => {
    await page.click('[data-hv-tab="' + tab + '"]');
    await page.waitForSelector('details[data-op="' + op + '"]');
    if (!(await page.$eval('details[data-op="' + op + '"]', n => n.open))) {
      await page.click('details[data-op="' + op + '"] > summary');
    }
  };

  /* ══ R02 — unsaved work survives a rerender ═══════════════════════════════
     Driven entirely through the screen. */
  head('BETA-R02 · unsaved practitioner drafts');
  await openCase(A, 'en');
  await openForm('evidence', 'add_evidence');
  await page.selectOption('#op-add_evidence-source_type', 'interview');
  await page.fill('#op-add_evidence-source_name', 'SYNTHETIC — hiring manager');
  await page.fill('#op-add_evidence-original_content', NOTE_A);
  await page.fill('#op-add_evidence-limitations', 'One account.\nThe speaker is affected.');

  const postsBefore = posts.length;

  await page.evaluate(() => HV.i18n.setLang('ar'));
  await page.waitForTimeout(400);
  check('the note survives a switch into Arabic',
    (await page.inputValue('#op-add_evidence-original_content')) === NOTE_A);
  check('the select survives it too',
    (await page.inputValue('#op-add_evidence-source_type')) === 'interview');
  check('and the multi-line field keeps both lines',
    (await page.inputValue('#op-add_evidence-limitations')).split('\n').length === 2);
  check('the form is open and flagged as holding a draft',
    (await page.$$('details[data-op="add_evidence"] .op-draft')).length === 1);
  await shot(page, 'draft-kept-ar-desktop', 'details[data-op="add_evidence"]');

  await page.evaluate(() => HV.i18n.setLang('en'));
  await page.waitForTimeout(400);
  check('and survives the switch back into English',
    (await page.inputValue('#op-add_evidence-original_content')) === NOTE_A);

  await page.click('[data-hv-tab="findings"]');
  await page.waitForTimeout(200);
  await page.click('[data-hv-tab="evidence"]');
  await page.waitForTimeout(250);
  check('the note survives a tab round trip',
    (await page.inputValue('#op-add_evidence-original_content')) === NOTE_A);

  check('none of that sent anything', posts.length === postsBefore, posts.length - postsBefore);

  /* Another operation succeeding must not take this draft with it. */
  await openForm('hypotheses', 'add_hypothesis');
  await page.fill('#op-add_hypothesis-label', 'H2');
  await page.fill('#op-add_hypothesis-statement', 'SYNTHETIC — requests arrive incomplete and are returned.');
  await page.click('[data-op-run="add_hypothesis"]');
  await page.waitForSelector('[data-op-status="add_hypothesis"].op-status-ok', { timeout: 8000 });
  await page.click('[data-hv-tab="evidence"]');
  await page.waitForTimeout(250);
  check('another operation’s successful write leaves this draft intact',
    (await page.inputValue('#op-add_evidence-original_content')) === NOTE_A);

  await openForm('hypotheses', 'add_hypothesis');
  check('and the operation that succeeded has its own draft cleared',
    (await page.inputValue('#op-add_hypothesis-statement')) === '');

  /* A draft belongs to ONE case. Checked at the source rather than by
     navigating, because navigating is a fresh page load: drafts live in memory
     for the life of the tab and are deliberately never written to browser
     storage — an interview note is a client's words and does not belong there.
     What must hold is that within a session the draft is reachable only under
     its own organization and case. */
  const scoping = await page.evaluate(function (a) {
    return {
      own: (HV.ops._draft({ org: a.aOrg, caseId: a.aCase }, 'add_evidence') || {}).original_content || '',
      other: (HV.ops._draft({ org: a.bOrg, caseId: a.bCase }, 'add_evidence') || {}).original_content || '',
      otherOrgSameCase: (HV.ops._draft({ org: a.bOrg, caseId: a.aCase }, 'add_evidence') || {}).original_content || ''
    };
  }, { aOrg: A.ORG, aCase: A.CASE, bOrg: B.ORG, bCase: B.CASE });
  check('the draft is held under its own organization and case', scoping.own === NOTE_A);
  check('and is not reachable under another case', scoping.other === '');
  check('nor under another organization with the same case id', scoping.otherOrgSameCase === '');

  /* And the other case's form really does render empty. */
  await openCase(B, 'en');
  await openForm('evidence', 'add_evidence');
  check('a different case opens with an empty form',
    (await page.inputValue('#op-add_evidence-original_content')) === '');

  /* ══ R01 — the confirmation is the decision ════════════════════════════════
     This is the exact sequence the independent review reproduced. */
  head('BETA-R01 · confirmation submits exactly the reviewed decision');
  await openCase(A, 'en');
  await openForm('hypotheses', 'set_hypothesis_state');
  await page.selectOption('#op-set_hypothesis_state-__target', { index: 1 });
  await page.selectOption('#op-set_hypothesis_state-to_state', 'ACTIVE');
  await page.fill('#op-set_hypothesis_state-because', REASON_REVIEWED);
  await page.click('[data-op-run="set_hypothesis_state"]');
  await page.waitForSelector('.op-confirm');

  const shown = await page.$eval('.op-confirm', n => n.innerText);
  check('the confirmation leads with a readable decision, not JSON',
    (await page.$$('.op-confirm .op-decision')).length === 1);
  check('it names the new state in words', /Under test|ACTIVE/i.test(shown), shown.slice(0, 200));
  check('it shows the reason that was typed', shown.indexOf(REASON_REVIEWED) !== -1);
  check('the raw payload is available but not in the way',
    (await page.$$('.op-confirm details.op-raw')).length === 1);

  await shot(page, 'confirm-decision-en-desktop', '.op-confirm');

  const frozen = await page.evaluate(() => {
    var p = HV.ops._pending('set_hypothesis_state');
    return p ? JSON.parse(JSON.stringify(p.payload)) : null;
  });
  check('the reviewed payload is frozen at review time', !!frozen && frozen.to_state === 'ACTIVE',
    JSON.stringify(frozen));

  /* Now edit both fields underneath the confirmation, exactly as the review did. */
  const postsAtReview = posts.length;
  await page.selectOption('#op-set_hypothesis_state-to_state', 'NOT_SUPPORTED');
  await page.fill('#op-set_hypothesis_state-because', REASON_SNEAKED);
  await page.waitForTimeout(200);

  check('editing after review retires the reviewed decision',
    (await page.evaluate(() => !HV.ops._pending('set_hypothesis_state'))));
  check('the confirm button is gone, so it cannot be pressed',
    (await page.$$('[data-op-confirm="set_hypothesis_state"]')).length === 0);
  check('the screen says the decision changed and nothing was sent',
    (await page.$$('.op-confirm-stale')).length === 1);
  check('nothing was posted by the edit', posts.length === postsAtReview);

  await shot(page, 'confirm-stale-en-desktop', 'details[data-op="set_hypothesis_state"]');

  let after = await bundle(A.ORG, A.CASE);
  check('the hypothesis is untouched in the store',
    after.hypotheses.every(h => h.state === 'PROPOSED'),
    JSON.stringify(after.hypotheses.map(h => h.state)));

  /* Review again, and confirm. What is stored must be what the SECOND review
     displayed — the edited values — and it must arrive because they were
     reviewed, not because they were read at click time. */
  await page.click('[data-op-run="set_hypothesis_state"]');
  await page.waitForSelector('.op-confirm .op-decision');
  const shown2 = await page.$eval('.op-confirm', n => n.innerText);
  check('the second review shows the edited reason', shown2.indexOf(REASON_SNEAKED) !== -1);
  const frozen2 = await page.evaluate(() => JSON.parse(JSON.stringify(HV.ops._pending('set_hypothesis_state').payload)));
  check('and freezes the edited state', frozen2.to_state === 'NOT_SUPPORTED', frozen2.to_state);

  await page.click('[data-op-confirm="set_hypothesis_state"]');
  await page.waitForSelector('[data-op-status="set_hypothesis_state"].op-status-ok', { timeout: 8000 });
  after = await bundle(A.ORG, A.CASE);
  const moved = after.hypotheses.filter(h => h.state !== 'PROPOSED')[0];
  check('the server stored exactly the reviewed state', moved && moved.state === frozen2.to_state,
    moved && moved.state);
  const trail = after.audit.filter(a => a.event === 'hypothesis.state_changed');
  check('the audit trail carries the reviewed reason, not the first one',
    trail.length === 1 && trail[0].details.because === REASON_SNEAKED,
    JSON.stringify(trail.map(x => x.details.because)));
  check('exactly one write was made for the whole sequence',
    posts.length === postsAtReview + 1, posts.length - postsAtReview);

  /* ══ R06 — update_evidence, through its form ══════════════════════════════ */
  head('BETA-R06 · update_evidence through the screen');
  await openCase(A, 'en');
  await openForm('evidence', 'update_evidence');
  await page.selectOption('#op-update_evidence-__target', { index: 1 });
  await page.selectOption('#op-update_evidence-verification_status', 'DISPUTED');
  await page.fill('#op-update_evidence-limitations',
    'Covers one quarter only.\nThe export was later found to double-count re-submissions.');
  await page.click('[data-op-run="update_evidence"]');
  await page.waitForSelector('.op-confirm .op-decision');
  const evShown = await page.$eval('.op-confirm', n => n.innerText);
  check('the decision summary names the evidence item being changed',
    evShown.indexOf('workflow export') !== -1, evShown.slice(0, 200));
  await page.click('[data-op-confirm="update_evidence"]');
  await page.waitForSelector('[data-op-status="update_evidence"].op-status-ok', { timeout: 8000 });

  const evBack = await page.$eval('[data-op-result="update_evidence"]', n => n.innerText);
  check('the read-back reports the version the server wrote', /version/i.test(evBack), evBack.slice(0, 160));
  after = await bundle(A.ORG, A.CASE);
  const stored = after.evidence.filter(e => e.evidence_id === ev.evidence_id)[0];
  check('the store holds the new verification status', stored.verification_status === 'DISPUTED',
    stored.verification_status);
  check('and both limitations', (stored.limitations || []).length === 2,
    JSON.stringify(stored.limitations));
  check('the original content was not touched',
    stored.original_content === 'Median wait at the approval step: 4.1 days.');

  /* ══ R06 — revise_finding, through its form ═══════════════════════════════
     SET UP THROUGH THE API: a case with a drafted finding. The revision itself
     is done on screen. */
  head('BETA-R06 · revise_finding through the screen');
  const C = await seedCase('case C', 'AWAITING_EVIDENCE');
  const ce = await api({ op: 'add_evidence', organization_id: C.ORG, case_id: C.CASE,
    source_type: 'system_record', source_name: 'SYNTHETIC — export',
    original_content: 'Median wait at the approval step: 4.1 days.', limitations: ['One quarter.'] });
  for (const to of ['ANALYZING_EVIDENCE', 'FINDING_DRAFT']) {
    const b = await bundle(C.ORG, C.CASE);
    await api({ op: 'transition', organization_id: C.ORG, case_id: C.CASE, to_state: to, expected_version: b.case.version });
  }
  const f = await api({ op: 'draft_finding', organization_id: C.ORG, case_id: C.CASE,
    statement: 'SYNTHETIC — waiting time is concentrated at a single approver.',
    scope: 'The approval step of one workflow, 2026-Q2.',
    supporting_evidence: [ce.evidence_id], counter_evidence: [],
    alternative_explanations: ['Requests arrive incomplete.'], limitations: ['One quarter of data.'] });

  await openCase(C, 'en');
  await openForm('findings', 'revise_finding');
  await page.selectOption('#op-revise_finding-__target', { index: 1 });
  await page.fill('#op-revise_finding-statement',
    'SYNTHETIC — waiting time is concentrated at a single approver, and the export double-counts.');
  await page.click('[data-op-run="revise_finding"]');
  await page.waitForSelector('.op-confirm .op-decision');
  await page.click('[data-op-confirm="revise_finding"]');
  await page.waitForSelector('[data-op-status="revise_finding"].op-status-ok', { timeout: 8000 });

  const revBack = await page.$eval('[data-op-result="revise_finding"]', n => n.innerText);
  check('the read-back says whether the change was material',
    /material_change/.test(revBack), revBack.slice(0, 200));
  const cb = await bundle(C.ORG, C.CASE);
  const revised = cb.findings.filter(x => x.finding_id === f.finding_id)[0];
  check('the store holds the revised statement', /double-counts/.test(revised.statement));
  check('and the version moved', Number(revised.version) === Number(f.version) + 1,
    f.version + ' → ' + revised.version);

  /* ══ R02 — a version conflict keeps the draft ═════════════════════════════ */
  head('BETA-R02 · a refused write keeps the draft');
  await openCase(C, 'en');
  await openForm('findings', 'revise_finding');
  await page.selectOption('#op-revise_finding-__target', { index: 1 });
  const conflictDraft = 'SYNTHETIC — this revision must survive the refusal.';
  await page.fill('#op-revise_finding-statement', conflictDraft);

  const cur = await bundle(C.ORG, C.CASE);
  const liveF = cur.findings.filter(x => x.finding_id === f.finding_id)[0];
  await api({ op: 'revise_finding', organization_id: C.ORG, finding_id: f.finding_id,
    patch: { scope: 'SYNTHETIC — moved by somebody else.' }, expected_version: liveF.version });

  await page.click('[data-op-run="revise_finding"]');
  await page.waitForSelector('.op-confirm .op-decision');
  await page.click('[data-op-confirm="revise_finding"]');
  await page.waitForSelector('.op-conflict', { timeout: 8000 });
  check('the operator’s words survive the refusal',
    (await page.inputValue('#op-revise_finding-statement')) === conflictDraft);
  check('the reviewed decision is retired by the refusal',
    (await page.evaluate(() => !HV.ops._pending('revise_finding'))));

  await page.click('[data-op-refresh="revise_finding"]');
  await page.waitForTimeout(800);
  check('and are still there after reconciling against current state',
    (await page.inputValue('#op-revise_finding-statement')) === conflictDraft);

  /* ══ R06 — a decline, through the reviewer screen ═════════════════════════ */
  head('BETA-R06 · declining a request through the screen');
  const submissionRes = await ctx.request.post(BASE + '/api/v2/intake', {
    data: {
      organization_context: { company_name: 'SYNTHETIC — out of scope', sector: 'Finance',
        employee_count_band: '51-200', growth_stage: 'growing' },
      respondent_context: { name: 'SYNTHETIC — Founder', role_title: 'Founder',
        email: 'founder@example.invalid', preferred_contact: 'email' },
      case_intent: 'OPPORTUNITY',
      reported_situation: 'SYNTHETIC — we would like a valuation before a funding round.',
      scope: { kind: 'company_wide', labels: ['Whole company'] },
      timeline: { first_noticed_approx: 'This quarter', pattern: 'persistent' },
      recent_examples: [{ what_happened: 'SYNTHETIC — two investors asked for a number.' }],
      observed_impact: [{ kind: 'delays' }],
      desired_outcome: 'SYNTHETIC — a valuation figure.',
      consent: { data_use: true, ai_transparency_ack: true, sensitive_data_ack: true },
      locale: 'en'
    }
  });
  const submission = await submissionRes.json();
  check('the synthetic request was accepted by the real intake handler',
    submissionRes.ok() && !!submission.submission_reference, JSON.stringify(submission).slice(0, 200));

  await page.goto(BASE + '/v2-intake-review', { waitUntil: 'domcontentloaded' });
  await page.evaluate(tk => { try { sessionStorage.setItem('hv_token', tk); } catch (e) {} }, harness.session.token);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const queue = await (await ctx.request.get(BASE + '/api/v2/intake-review?status=all&limit=50',
    { headers: auth })).json();
  const mine = queue.submissions.filter(s => s.submission_reference === submission.submission_reference)[0];
  check('the request is waiting, and is not a case', mine && mine.status === 'PENDING_REVIEW' && !mine.resulting_case_id,
    mine && mine.status);

  await page.click('[data-hv-open="' + mine.intakeseed_id + '"]');
  await page.waitForSelector('#rv-reason');
  const DECLINE_REASON = 'SYNTHETIC — a company valuation is outside HR and organizational development.';
  await page.fill('#rv-reason', DECLINE_REASON);
  page.once('dialog', d => d.accept());
  await page.click('[data-hv-reject]');
  await page.waitForTimeout(1200);

  const decided = await (await ctx.request.get(
    BASE + '/api/v2/intake-review?intakeseed_id=' + mine.intakeseed_id, { headers: auth })).json();
  check('the decline is recorded as a human decision', decided.review.status === 'REJECTED', decided.review.status);
  check('the reason is stored as it was written',
    decided.review.decision_reason === DECLINE_REASON, decided.review.decision_reason);
  check('the decline created no organization and no case',
    !decided.review.resulting_case_id && !decided.review.resulting_organization_id,
    JSON.stringify({ org: decided.review.resulting_organization_id, kase: decided.review.resulting_case_id }));

  const screenAfter = await page.$eval('#app', n => n.innerText);
  check('the screen reads the stored reason back', screenAfter.indexOf(DECLINE_REASON) !== -1,
    screenAfter.slice(0, 250));

  await browser.close();
  console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\ndrafts hold, and a confirmation sends what it showed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
