'use strict';
// Resolution shim, not a fixture.
//
// The frozen Production handlers in ./v1-auth-baseline/ must stay byte-identical
// to the Production commit, so their `require('../_utils')` cannot be edited.
// From that directory the request resolves to THIS file, which simply re-exports
// the real module. Nothing is stubbed here: the tests exercise the genuine
// hashPassword / signJWT / verifyJWT / getToken / setJSON.
module.exports = require('../../api/_utils');
