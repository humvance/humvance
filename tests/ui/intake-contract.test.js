'use strict';
// The redesigned intake form against the backend contract it posts to.
//
// WHY THIS TEST EXISTS, AND WHAT IT DELIBERATELY IS NOT.
//
// It is not a test that re-states the markup. Asserting "the heading says X" is
// a copy of the template with extra steps, and it fails for reasons nobody
// cares about. This file tests the one thing that can silently break and that
// nothing else catches:
//
//     the form offers a value the server's allow-list will reject,
//     or stops sending a field the server requires.
//
// That failure is invisible in a browser until a real visitor loses a filled-in
// form to a 400, and it is exactly the failure a redesign introduces — someone
// adds a friendlier option, or drops a field that looked redundant.
//
// So the test reads the ACTUAL enumerations out of api/v2/_domain.js and the
// ACTUAL required set out of api/v2/_intake.js, reads what public/intake.html
// offers, and demands they agree in both directions. It also checks that every
// offered value has visitor-facing copy in both languages, because an untranslated
// option is a silent gap the eye skips over.
//
// Nothing here contacts a server, a store or a browser.

const fs = require('fs');
const path = require('path');
const { suite, test, assert } = require('../v2/harness');

const REPO = path.join(__dirname, '..', '..');
const D = require(path.join(REPO, 'api/v2/_domain.js'));

const intakeHtml = fs.readFileSync(path.join(REPO, 'public/intake.html'), 'utf8');
const copyJs = fs.readFileSync(path.join(REPO, 'public/assets/hv-intake-copy.js'), 'utf8');
const intakeSrc = fs.readFileSync(path.join(REPO, 'api/v2/_intake.js'), 'utf8');

/** Read a `var NAME = ['a','b'];` array out of the page's script. */
function formList(name) {
  const m = new RegExp('var\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\];').exec(intakeHtml);
  assert.ok(m, `public/intake.html must declare ${name}`);
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/** Does the copy file carry this key, in this language? */
function hasCopy(lang, key) {
  const block = copyJs.slice(copyJs.indexOf(lang + ': {'));
  const end = block.indexOf("\n    },");
  const scope = end === -1 ? block : block.slice(0, end);
  return scope.indexOf("'" + key + "'") !== -1;
}

// Which form list corresponds to which backend enumeration, and which copy
// prefix names its options.
const PAIRS = [
  { list: 'INTENTS',  backend: D.CASE_INTENTS,                        copy: 'o.case_intent' },
  { list: 'SCOPES',   backend: D.INTAKE_SCOPE_KINDS,                  copy: 'o.scope_kind' },
  { list: 'PATTERNS', backend: D.INTAKE_TEMPORAL_PATTERNS,            copy: 'o.pattern' },
  { list: 'BANDS',    backend: D.INTAKE_EMPLOYEE_BANDS,               copy: 'o.employee_count_band' },
  { list: 'STAGES',   backend: D.INTAKE_GROWTH_STAGES,                copy: 'o.growth_stage' },
  { list: 'CONTACTS', backend: D.INTAKE_CONTACT_PREFERENCES,          copy: 'o.preferred_contact' },
  { list: 'IMPACTS',  backend: D.INTAKE_IMPACT_KINDS,                 copy: 'o.impact' },
  { list: 'CHANGES',  backend: D.INTAKE_CHANGE_CONTEXT_KINDS,         copy: 'o.change' },
  { list: 'AVAIL',    backend: D.INTAKE_EVIDENCE_AVAILABILITY_KINDS,  copy: 'o.avail' }
];

// ─────────────────────────────────────────────────────────────────────────────

suite('intake form — every offered value is one the server accepts', () => {

  for (const p of PAIRS) {
    test(`${p.list} offers nothing outside the backend enumeration`, () => {
      const offered = formList(p.list);
      const extra = offered.filter(v => p.backend.indexOf(v) === -1);
      assert.deepEqual(extra, [],
        `${p.list} offers value(s) the server's allow-list would reject with 400`);
    });

    test(`${p.list} offers every value the backend supports`, () => {
      // A missing option is not a rejection, but it does quietly narrow what a
      // client can tell us — which is the opposite of the point of this form.
      const offered = formList(p.list);
      const missing = p.backend.filter(v => offered.indexOf(v) === -1);
      assert.deepEqual(missing, [], `${p.list} does not offer: ${missing.join(', ')}`);
    });
  }
});

suite('intake form — every offered value has copy in both languages', () => {

  for (const p of PAIRS) {
    test(`${p.copy}.* is complete in Arabic and English`, () => {
      const gaps = [];
      for (const v of formList(p.list)) {
        if (!hasCopy('ar', p.copy + '.' + v)) gaps.push('ar:' + v);
        if (!hasCopy('en', p.copy + '.' + v)) gaps.push('en:' + v);
      }
      assert.deepEqual(gaps, [], `untranslated options under ${p.copy}`);
    });
  }
});

suite('intake form — the required set matches the server exactly', () => {

  /* The server's required fields, read from its own source rather than from a
     list somebody typed here. `required: true` is how _intake.js marks them. */
  function serverRequired() {
    const out = new Set();
    const re = /str\(body\.([A-Za-z_.]+)[^)]*required:\s*true/g;
    let m;
    while ((m = re.exec(intakeSrc))) out.add(m[1]);
    // The enumerations and consent are marked differently in the source.
    if (/enumVal\(body\.case_intent[\s\S]{0,120}required:\s*true/.test(intakeSrc)) out.add('case_intent');
    if (/enumVal\(body\.scope\.kind[\s\S]{0,120}required:\s*true/.test(intakeSrc)) out.add('scope.kind');
    if (/enumVal\(body\.timeline\.pattern[\s\S]{0,120}required:\s*true/.test(intakeSrc)) out.add('timeline.pattern');
    return out;
  }

  /* What the form enforces, read out of its validate() function. */
  const validateFn = (function () {
    const i = intakeHtml.indexOf('function validate(step)');
    return intakeHtml.slice(i, intakeHtml.indexOf('\n  }', i));
  })();

  const FORM_KEY_FOR = {
    'organization_context.company_name': 'company_name',
    'respondent_context.name': 'name',
    'respondent_context.role_title': 'role_title',
    'respondent_context.email': 'email',
    'reported_situation': 'reported_situation',
    'desired_outcome': 'desired_outcome',
    'case_intent': 'case_intent',
    'scope.kind': 'scope_kind',
    'timeline.pattern': 'pattern'
  };

  test('the server requires exactly the nine fields we think it does', () => {
    const required = [...serverRequired()].sort();
    assert.deepEqual(required, Object.keys(FORM_KEY_FOR).sort(),
      'the server-side required set changed — the form must be updated to match');
  });

  test('the form blocks on every field the server requires', () => {
    const unenforced = [];
    for (const [serverPath, formKey] of Object.entries(FORM_KEY_FOR)) {
      if (validateFn.indexOf('e.' + formKey) === -1) unenforced.push(serverPath);
    }
    assert.deepEqual(unenforced, [],
      'a server-required field is not validated in the form: the visitor would lose a filled form to a 400');
  });

  test('all three consent acknowledgements are enforced before sending', () => {
    for (const k of ['consent_data_use', 'consent_ai', 'consent_sensitive']) {
      assert.includes(validateFn, k, `${k} must be checked before submit`);
    }
  });

  test('the payload sends all three consent keys the server demands', () => {
    for (const k of ['data_use', 'ai_transparency_ack', 'sensitive_data_ack']) {
      assert.includes(intakeHtml, k + ':', `consent.${k} must be in the payload`);
    }
  });
});

suite('intake form — it cannot send a key the allow-list rejects', () => {

  /* `assertOnlyKeys` turns an unexpected top-level key into a 400 rather than
     dropping it. So the payload builder must name only the fourteen. */
  const TOP_LEVEL = [
    'organization_context', 'respondent_context', 'case_intent', 'reported_situation',
    'scope', 'timeline', 'recent_examples', 'observed_impact', 'change_context',
    'client_belief', 'evidence_availability', 'desired_outcome', 'consent', 'locale'
  ];

  const payloadFn = (function () {
    const i = intakeHtml.indexOf('function payload()');
    return intakeHtml.slice(i, intakeHtml.indexOf('\n  }', intakeHtml.indexOf('return {', i)));
  })();

  test('the payload names every allowed top-level key and no other', () => {
    const named = [...payloadFn.matchAll(/^\s{6}([a-z_]+):/gm)].map(m => m[1]);
    const extra = named.filter(k => TOP_LEVEL.indexOf(k) === -1);
    assert.deepEqual(extra, [], 'the payload carries a key the server would reject');
  });

  test('server-controlled fields are never sent by the client', () => {
    // A submission that tried to set any of these would be refused, and a form
    // that tried is a form that misunderstands the boundary.
    for (const forbidden of ['status:', 'organization_id:', 'verification_status:', 'promotion_state:', 'intakeseed_id:']) {
      assert.notOk(payloadFn.indexOf(forbidden) !== -1, `payload must not set ${forbidden}`);
    }
  });

  test('the form posts to the one anonymous endpoint, once', () => {
    const posts = [...intakeHtml.matchAll(/fetch\(\s*'([^']+)'/g)].map(m => m[1]);
    assert.deepEqual(posts, ['/api/v2/intake'], 'intake must call exactly one endpoint');
  });

  test('demonstration mode cannot reach that endpoint', () => {
    // The demo guard must sit before the fetch, not after it.
    const submitFn = intakeHtml.slice(intakeHtml.indexOf('async function submit()'));
    const guardAt = submitFn.indexOf('U.isDemo()');
    const fetchAt = submitFn.indexOf('fetch(');
    assert.ok(guardAt !== -1, 'submit must check demo mode');
    assert.ok(guardAt < fetchAt, 'the demo guard must precede the network call');
  });
});

suite('intake form — the receipt claims nothing that has not happened', () => {

  const forbidden = {
    ar: ['تشخيص منظمتكم', 'تم فتح ملف', 'تم إنشاء قضية', 'تم التقييم', 'درجة', 'نتيجتكم'],
    en: ['case created', 'case has been opened', 'assessed', 'your score', 'diagnosis complete', 'approved']
  };

  test('no confirmation string implies a case, a score or a diagnosis', () => {
    const doneKeys = ['done.title', 'done.body', 'done.notDiagnosis', 'q.beforeSend'];
    const hits = [];
    for (const key of doneKeys) {
      for (const lang of ['ar', 'en']) {
        const re = new RegExp("'" + key.replace('.', '\\.') + "':\\s*'([^']*)'");
        const m = re.exec(copyJs);
        if (!m) continue;
        for (const bad of forbidden[lang]) {
          if (m[1].indexOf(bad) !== -1) hits.push(key + ' (' + lang + '): "' + bad + '"');
        }
      }
    }
    assert.deepEqual(hits, [], 'the receipt must say received, not created or assessed');
  });

  test('the confirmation states plainly that nothing was concluded', () => {
    assert.ok(hasCopy('ar', 'done.notDiagnosis') && hasCopy('en', 'done.notDiagnosis'),
      'both languages must carry the "nothing was concluded" statement');
  });
});
