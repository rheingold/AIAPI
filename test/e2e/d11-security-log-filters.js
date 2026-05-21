'use strict';
/**
 * D11 — Security Log & Filter Dry-Run dogfood  (bootstrap — ADR-010)
 *
 * All REST assertions live in d11/scenarios.xml (EVAL/ASSERTPATHEVAL steps).
 * The browser UI assertion (SL-UI) also lives in scenarios.xml.
 * This file is a thin bootstrap only — no JS assertions, no dashRest().
 *
 * Run:  node test/e2e/d11-security-log-filters.js
 */
const { TEST_TAG, runSuite } = require('./_shared');
const { ScenarioRunner }  = require('./_scenario-runner');
const { DASH_URL, labelFrom } = require('./_make-suite');

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    const runner = new ScenarioRunner({ dashUrl: DASH_URL });
    await runner.waitReady();

    // SL1–AOD1: REST tests via HTTP_FETCH scenarios (no browser)
    await runner.runOk('d11', 'd11-suite', { testTag: TEST_TAG, dashUrl: DASH_URL });

    // SL-UI: Security section DOM — requires a browser
    await runner.launch();
    await runner.runOk('d11', 'sl-ui-security-section');
  });
}

if (require.main === module) run();
module.exports = { run };
