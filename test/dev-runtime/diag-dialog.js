'use strict';
/**
 * Dialog diagnostic — test/dev-runtime/diag-dialog.js
 *
 * Uses KeyWin LISTWINDOWS + READ UI-tree to detect any dialog
 * that appears after clicking btn-save-settings, WITHOUT patching JS.
 *
 * Run: node test/dev-runtime/diag-dialog.js
 */
const { dashRest } = require('../e2e/_shared');
const { ScenarioRunner } = require('../e2e/_scenario-runner');

const BROWSER  = process.env.BROWSER || 'chrome';
const DASH_URL = 'http://localhost:3458';

// Direct helper call via POST /api/scenarios/run with a single step
function runStep(helper, proc, action, path, value) {
  return dashRest('POST', '/api/scenarios/run', {
    steps: [{ command: action, target: proc, parameter: value !== undefined ? `${path}|${value}` : path }],
    helper,
  });
}

async function listWindows() {
  return dashRest('GET', '/api/listWindows');
}

async function main() {
  const runner = new ScenarioRunner({ browser: BROWSER, dashUrl: DASH_URL });
  await runner.waitReady();

  console.log('Launching Chrome (no JS shim this time)...');
  await runner.launch();

  console.log('\n[1] Navigate to Settings...');
  await runner.run('d2', 's2-nav-to-settings');

  console.log('[2] Snapshot windows BEFORE clicking Save...');
  const before = await listWindows();
  const beforeTitles = (before?.data ?? []).map(w => w.title);
  console.log('  Before:', beforeTitles.join(' | '));

  console.log('[3] Clicking Save (NO shim)...');
  await runner.rawExec(`document.getElementById('btn-save-settings')&&document.getElementById('btn-save-settings').click()`);

  // Poll for new windows for up to 3 seconds
  let dialogWindow = null;
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 500));
    const after = await listWindows();
    const newWins = (after?.data ?? []).filter(w => !beforeTitles.includes(w.title));
    if (newWins.length) {
      dialogWindow = newWins[0];
      console.log(`\n[4] NEW window detected after ${(i+1)*500}ms:`, newWins);
      break;
    }
  }

  if (!dialogWindow) {
    console.log('\n[4] No new window appeared — Chrome JS dialog is rendered inline (not a native window).');
    console.log('    The JS shim approach IS correct. Dialog only shows when shim is missing.');
  } else {
    console.log('\n[4] Dialog is a native OS window — can dismiss with KeyWin SENDKEYS {ENTER}');
    const hwnd = dialogWindow.hwnd ? `HANDLE:${dialogWindow.hwnd}` : dialogWindow.title;
    console.log(`    Sending ENTER to: ${hwnd}`);
    const r = await runStep('KeyWin.exe', hwnd, 'SENDKEYS', '', '{ENTER}');
    console.log('    Result:', r);
  }

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
