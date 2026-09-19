'use strict';
// Runner for the interface tests. No dependencies, no browser:
//     node tests/ui/run.js
const { run } = require('../v2/harness');

require('./intake-contract.test');
require('./workspace-mapping.test');

run().then(ok => process.exit(ok ? 0 : 1)).catch(err => { console.error(err); process.exit(1); });
