'use strict';
/**
 * D5-modes — KeyWin + Calculator mode-switching dogfood  (bootstrap — ADR-010)
 *
 * Exercises Standard → Scientific → Standard mode switching via the nav pane,
 * covering both CLICKID and SENDKEYS input paths, and assert-gated controls
 * (clearEntryButton, factorialButton, squareRootButton) whose presence is
 * conditional on the active mode as declared in tree.xml <assert> wrappers.
 *
 * All assertions live inside d5/scenarios.xml (ASSERT steps — ADR-010).
 * This file is a bootstrap only. NO JS assertions, NO dashRest().
 *
 * Run:  node test/e2e/d5-keywin-calc-modes.js
 */
const { DASH_PORT, runSuite } = require('./_shared');
const { labelFrom } = require('./_make-suite');
const { ScenarioRunner } = require('./_scenario-runner');

const DASH_URL = `http://localhost:${DASH_PORT}`;

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    console.log(`  Dashboard: ${DASH_URL}`);
    const runner = new ScenarioRunner({ dashUrl: DASH_URL });
    await runner.waitReady();
    await runner.runOk('d5', 'd5-mode-suite');
  });
}

if (require.main === module) run();
module.exports = { run };
