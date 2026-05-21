'use strict';
/**
 * D10 — Server Foundations dogfood  (bootstrap — ADR-010)
 *
 * All REST assertions live in d10/scenarios.xml (EVAL/ASSERTPATHEVAL steps).
 * The browser UI assertion (H10) also lives in scenarios.xml.
 * This file is a thin bootstrap only — no JS assertions, no dashRest().
 *
 * Run:  node test/e2e/d10-server-foundations.js
 */
const { TEST_TAG, runSuite } = require('./_shared');
const { ScenarioRunner }  = require('./_scenario-runner');
const { DASH_URL, labelFrom } = require('./_make-suite');

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    const runner = new ScenarioRunner({ dashUrl: DASH_URL });
    await runner.waitReady();

    // H1–H9: REST tests via HTTP_FETCH scenarios (no browser)
    await runner.runOk('d10', 'd10-suite', { testTag: TEST_TAG, dashUrl: DASH_URL });

    // H10: Dashboard settings UI fields — requires a browser
    await runner.launch();
    await runner.runOk('d10', 'h10-settings-ui-fields');
  });
}

if (require.main === module) run();
module.exports = { run };
