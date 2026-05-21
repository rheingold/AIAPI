'use strict';
/**
 * D4 — Scenarios Editor Dogfood  [ADR-008 UI-only]
 *
 * All assertions live in d4/scenarios.xml (ASSERT / ASSERTPATHEVAL steps).
 * This file wires up the flow that passes firstScenId from se2 into se3/se4.
 *
 * Run:  node test/e2e/d4-scenarios-editor.js
 */
const { DASH_PORT, runSuite, skip } = require('./_shared');
const { labelFrom } = require('./_make-suite');
const { ScenarioRunner } = require('./_scenario-runner');

const BROWSER  = process.env.BROWSER || 'chrome';
const DASH_URL = `http://localhost:${DASH_PORT}`;

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    const runner = new ScenarioRunner({ browser: BROWSER, dashUrl: DASH_URL });
    await runner.waitReady();
    await runner.launch();
    await runner.runOk('d4', 'override-page-dialogs');
    await runner.runOk('d4', 'se1-list-apps');

    for (const appName of ['calculator', 'notepad']) {
      const r2 = await runner.runOk('d4', 'se2-app-scenarios', { appName });
      if (appName === 'calculator' && r2.vars?.firstScenId) {
        const scenId = r2.vars.firstScenId;
        await runner.runOk('d4', 'se3-editor-round-trip', { appName, scenId });
        const r4a = await runner.runOk('d4', 'se4a-editor-save', { appName, scenId });
        await runner.runOk('d4', 'se4b-editor-restore', {
          appName, scenId, stepCountBefore: String(r4a.vars?.stepCountBefore ?? 0),
        });
      } else if (appName === 'calculator') {
        skip('SE3/SE4a/SE4b', 'no firstScenId from se2-calculator');
      }
    }
  });
}

if (require.main === module) run();
module.exports = { run };

