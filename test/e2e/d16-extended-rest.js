'use strict';
/**
 * D16 — Extended REST Coverage  (harness — test/e2e/d16-extended-rest.js)
 *
 * Architecture
 * ────────────
 *   All assertions live in test/e2e/d16/scenarios.xml (ADR-008).
 *   This file is a thin bootstrap: run XML scenarios via ScenarioRunner.
 *
 *   Scenarios (d16/scenarios.xml):
 *     ex1-settings-validate     — GET /api/settings/validate → checks[] shape
 *     ex2-auth-config-roundtrip — GET→POST same mode→GET verify unchanged
 *     ex4-setup-status          — GET /api/_internal/setup/status → indicator
 *     ex5-helpers-disabled      — GET /api/helpers/disabled → array
 *     ex6-helpers-reload        — POST /api/helpers/reload → no error
 *     ex7-server-status         — GET /api/status → health indicator
 *     ex8-auth-config-toggle    — toggle debugExternalAuth → verify → restore
 *     d16-suite                 — chain ex1,ex2,ex4–ex8
 *
 *   EX3 (openFileDialog) cannot be expressed in sequential XML steps because
 *   it requires a concurrent JS timer to send {ESC} to dismiss the native OS
 *   dialog while the blocking POST is in flight.  It is handled as a graceful
 *   JS-only test below.
 *
 * Run:   node test/e2e/d16-extended-rest.js
 * Env:   DASH_PORT (default 3458)
 */

const {
  dashRest, kw, ok, assert, skip,
  TEST_TAG, runSuite,
} = require('./_shared');
const { labelFrom }      = require('./_make-suite');
const { ScenarioRunner } = require('./_scenario-runner');

const DASH_PORT = parseInt(process.env.DASH_PORT || '3458', 10);
const DASH_URL  = `http://localhost:${DASH_PORT}`;

// ── EX3: openFileDialog — JS-only (requires concurrent ESC timer) ─────────────
// Cannot be expressed in sequential XML steps: POST /api/shell/openFileDialog
// blocks until the OS dialog is closed; the ESC must fire concurrently.

async function testFileDialog() {
  console.log('\n── EX3 · POST /api/shell/openFileDialog (cancel via ESC) ──');
  const helpersR = await dashRest('GET', '/api/listHelpers').catch(() => null);
  const helpers  = helpersR?.helpers ?? (Array.isArray(helpersR) ? helpersR : []);
  if (!helpers.some(h => (h.name || h) === 'KeyWin')) {
    skip('File dialog test', 'KeyWin not available to send ESC');
    return;
  }
  const escTimer = setTimeout(async () => {
    await kw('SYSTEM', 'SENDKEYS', '{ESC}', 8000).catch(() => null);
  }, 1500);
  const dialogR = await dashRest('POST', '/api/shell/openFileDialog', {
    folder: false,
    title: `D16 dogfood ${TEST_TAG}`,
  }).catch(e => { clearTimeout(escTimer); return { _e: e.message }; });
  clearTimeout(escTimer);
  if (dialogR?._e) { skip('File dialog', dialogR._e); return; }
  ok('POST /api/shell/openFileDialog returns result', dialogR);
  assert('File dialog returns "success" field', typeof dialogR?.success === 'boolean',
    JSON.stringify(dialogR).slice(0, 80));
  const cancelled = dialogR?.path == null || dialogR?.path === '';
  assert('Cancelled dialog returns path: null/empty', cancelled, `path: "${dialogR?.path}"`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    const runner = new ScenarioRunner({ browser: null, dashUrl: DASH_URL });
    await runner.waitReady();
    const vars = { dashUrl: DASH_URL };
    await runner.runOk('d16', 'd16-suite', vars);
    await testFileDialog();
  });
}

if (require.main === module) run();
module.exports = { run };



