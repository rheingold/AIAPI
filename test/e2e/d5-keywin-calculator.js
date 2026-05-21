'use strict';
/**
 * D5 — KeyWin + Calculator Dogfood  (bootstrap — ADR-010)
 * All assertions live in d5/scenarios.xml (ASSERT steps).
 * NO dashRest() — ADR-008 Rule 1.
 * Label derived from __filename — no hardcoded strings.
 * Run:  node test/e2e/d5-keywin-calculator.js
 */
const { makeSuite } = require('./_make-suite');

const run = makeSuite(
  __filename,
  'd5-suite',
  () => ({}),
  { browser: false },
);

if (require.main === module) run();
module.exports = { run };
