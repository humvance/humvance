'use strict';
// Runner for the V2 core test suite. No dependencies, no config:
//     node tests/v2/run.js
const { run } = require('./harness');

require('./domain.test');
require('./store.test');
require('./authz.test');
require('./service.test');

run().then(ok => process.exit(ok ? 0 : 1)).catch(err => {
  console.error(err);
  process.exit(1);
});
