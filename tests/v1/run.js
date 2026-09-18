'use strict';
// Runner for the V1 auth consolidation suite. No dependencies, no config:
//     node tests/v1/run.js
//
// Nothing here touches a database, a mail service, a secret or customer data.
// `@vercel/kv` is intercepted at require time and never resolved; the clock,
// the random source and outbound fetch are all stubbed.
const { run } = require('../v2/harness');

require('./auth-equivalence.test');
require('./auth-dispatch.test');
require('./baseline-integrity.test');

run().then(ok => process.exit(ok ? 0 : 1)).catch(err => {
  console.error(err);
  process.exit(1);
});
