'use strict';
/**
 * D2 — Settings UI Dogfood
 * L3 XML : test/e2e/d2/scenarios.xml  (ALL steps — browser + HTTP_FETCH)
 * L1 JS  : thin bootstrap via _make-suite.js — label derived from __filename
 * Run:   node test/e2e/d2-settings-ui.js
 * Env:   BROWSER=msedge  (default: chrome)
 */
const { makeSuite, DASH_PORT } = require('./_make-suite');

// Bogus paths used to trigger validation errors — intentionally non-existent.
// Forward-slash format avoids backslash-escape issues in CDP_EXECUTE JS strings.
// Derived from __dirname so they're always relative to the test file's location
// on the current machine (yet guaranteed not to be real helper/work paths).
const BOGUS_BASE   = __dirname.replace(/\\/g, '/') + '/bogus-d2-test';
const BOGUS_FIELD  = BOGUS_BASE + '/helpers';
const BOGUS_BROWSE = BOGUS_BASE + '/browsed';
const BOGUS_WORK   = BOGUS_BASE + '/workdir';

const run = makeSuite(
  __filename,
  'd2-suite',
  ({ DASH_URL, DASH_PORT: port }) => ({
    dashUrl:   DASH_URL,
    dashPort:  String(port),
    fieldVal:  BOGUS_FIELD,
    browseVal: BOGUS_BROWSE,
    newDir:    BOGUS_WORK,
  }),
);

if (require.main === module) run();
module.exports = { run };
