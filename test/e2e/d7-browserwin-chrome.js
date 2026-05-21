'use strict';
/**
 * D7 — BrowserWin + Chrome Dogfood  [ADR-008 UI-only]
 * All assertions live in d7/scenarios.xml (ASSERT / ASSERTPATHEVAL steps).
 * Label derived from __filename — no hardcoded strings.
 * Run:  node test/e2e/d7-browserwin-chrome.js
 */
const { makeSuite, TEST_TAG } = require('./_make-suite');

const run = makeSuite(
  __filename,
  'd7-suite',
  ({ DASH_URL }) => ({ testTag: TEST_TAG, fillValue: `d7_fill_${TEST_TAG}`, dashUrl: DASH_URL }),
  { skipOnFail: true },
);

if (require.main === module) run();
module.exports = { run };
