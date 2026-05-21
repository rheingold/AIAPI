'use strict';
/**
 * D1 — Dashboard Smoke Test
 * L3 XML : test/e2e/d1/scenarios.xml  (ALL steps)
 * L1 JS  : thin bootstrap via _make-suite.js — label derived from __filename
 * Run:  node test/e2e/d1-dashboard-smoke.js
 */
const { makeSuite } = require('./_make-suite');

const run = makeSuite(
  __filename,
  'd1-suite',
  ({ DASH_URL }) => ({ dashUrl: DASH_URL }),
);

if (require.main === module) run();
module.exports = { run };
