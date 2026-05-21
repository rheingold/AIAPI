'use strict';
/**
 * D13 — BrowserWin Extended Commands dogfood
 *
 * L3 XML  : test/e2e/d13/scenarios.xml   (ALL steps — browser + HTTP_FETCH)
 * L2/L1   : this file — thin orchestration only
 *
 * Run:  node test/e2e/d13-browserwin-extended.js
 */

const { mcpCall, bw, ok, sleep, TEST_TAG, runSuite } = require('./_shared');
const { ScenarioRunner } = require('./_scenario-runner');
const { DASH_URL: DASHBOARD_URL, labelFrom } = require('./_make-suite');

const BROWSER = process.env.BROWSER || 'chrome';

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    const runner = new ScenarioRunner({ browser: BROWSER, dashUrl: DASHBOARD_URL });
    await runner.waitReady();
    await runner.launch();

    console.log('\n── BC1 · LISTBROWSERS ──');
    await runner.runOk('d13', 'bc1-listbrowsers');

    console.log('\n── BC2 · CLICKID btn-validate-config ──');
    await runner.runOk('d13', 'bc2-clickid');

    console.log('\n── BC3 · SENDKEYS into #setting-session-dir ──');
    await runner.runOk('d13', 'bc3-sendkeys', { testTag: TEST_TAG });

    console.log('\n── BC4 · KEYDOWN + KEYUP Tab ──');
    await runner.runOk('d13', 'bc4-keydown-keyup');

    console.log('\n── BC5 · KEYPRESS Escape ──');
    await runner.runOk('d13', 'bc5-keypress');

    console.log('\n── BC6 · DBLCLICK #setting-log-level ──');
    await runner.runOk('d13', 'bc6-dblclick');

    console.log('\n── BC7 · HOVER nav settings ──');
    await runner.runOk('d13', 'bc7-hover');

    console.log('\n── BC8 · RIGHTCLICK + Escape ──');
    await runner.runOk('d13', 'bc8-rightclick');

    console.log('\n── BC9 · CHECK + UNCHECK #setting-require-os-enforcement ──');
    const r9 = await runner.runOk('d13', 'bc9-check-uncheck');
    if (r9?.vars?.initChecked === true || r9?.vars?.initChecked === 'true') {
      await runner.runOk('d13', 'bc9-restore-checked');
      console.log('   checkbox restored to checked');
    }

    console.log('\n── BC10 · MOUSEDOWN + MOUSEUP ──');
    await runner.runOk('d13', 'bc10-mousedown-mouseup');

    console.log('\n── BC11 · FOCUS #setting-log-level ──');
    await runner.runOk('d13', 'bc11-focus');

    console.log('\n── IA1 · /api/_internal/users CRUD ──');
    await runner.runOk('d13', 'ia1-internal-users', { testTag: TEST_TAG, dashUrl: DASHBOARD_URL });

    console.log('\n── IA2 · /api/_internal/roles CRUD ──');
    await runner.runOk('d13', 'ia2-internal-roles', { testTag: TEST_TAG, dashUrl: DASHBOARD_URL });

    console.log('\n── IA3 · /api/_internal/logs GET + DELETE ──');
    await runner.runOk('d13', 'ia3-internal-logs', { dashUrl: DASHBOARD_URL });

    console.log('\n── BC12 · KILL browser instance ──');
    await runner.runOk('d13', 'bc12-kill');
    await sleep(800);

    console.log('\n── BC12 · Restore dialog handling + relaunch ──');
    const restoreAction = process.env.RESTORE_PAGES === 'confirm' ? 'confirm' : 'dismiss';
    const restoreScenario = restoreAction === 'confirm' ? 'bc12-restore-dialog-confirm' : 'bc12-restore-dialog';
    await runner.run('d13', restoreScenario, {
      restoreAction,
      dashUrl: DASHBOARD_URL,
      browser: BROWSER,
    });
    ok('BC12: browser relaunched and dashboard reachable after KILL', true);
  });
}

if (require.main === module) run();
module.exports = { run };

