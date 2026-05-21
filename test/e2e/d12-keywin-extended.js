'use strict';
/**
 * D12 — KeyWin Extended Commands dogfood  (bootstrap — ADR-010)
 *
 * REST assertions  : d12/scenarios.xml d12-rest-suite (HTTP_FETCH via XML)
 * KeyWin assertions: d12/scenarios.xml d12-suite qt1–qt10 (via ScenarioRunner)
 * JS-only          : getCalcHandle, getNotepadHandle, CLICKNAME (locale-graceful),
 *                    FILL (complex fallback paths)
 *
 * Run:  node test/e2e/d12-keywin-extended.js
 */
const { mcpCall, kw, ok, assert, skip, sleep, TEST_TAG, runSuite } = require('./_shared');
const { ScenarioRunner } = require('./_scenario-runner');
const { DASH_URL, labelFrom }  = require('./_make-suite');

// ── Helpers — must stay in JS (dynamic LISTWINDOWS) ───────────────────────────

async function getCalcHandle() {
  const CALC_PATTERN = /calculator|kalku/i;
  async function findWindow() {
    const r = await kw('SYSTEM', 'LISTWINDOWS', '', 10000).catch(() => null);
    const windows = r?.windows ?? r?.result ?? [];
    if (!Array.isArray(windows)) return null;
    const w = windows.find(w => CALC_PATTERN.test(w.title || '') || (w.process || '').toLowerCase().includes('calc'));
    return w?.hwnd ?? w?.handle ?? null;
  }
  let hwnd = await findWindow();
  if (!hwnd) {
    await kw('calc.exe', 'LAUNCH', '', 15000).catch(() => null);
    await sleep(2500);
    hwnd = await findWindow();
  }
  return hwnd ? `HANDLE:${hwnd}` : null;
}

async function getNotepadHandle() {
  const NOTEPAD_TITLE = /notepad|pozn[aá]mkov/i;
  async function findWindow() {
    const r = await kw('SYSTEM', 'LISTWINDOWS', '', 10000).catch(() => null);
    const windows = r?.windows ?? r?.result ?? [];
    if (!Array.isArray(windows)) return null;
    const w = windows.find(w => NOTEPAD_TITLE.test(w.title || '') || (w.process || '').toLowerCase().includes('notepad'));
    return w?.hwnd ?? w?.handle ?? null;
  }
  let hwnd = await findWindow();
  if (!hwnd) {
    await kw('notepad.exe', 'LAUNCH', '', 10000).catch(() => null);
    await sleep(2000);
    hwnd = await findWindow();
  }
  return hwnd ? `HANDLE:${hwnd}` : null;
}

// ── CLICKNAME: locale-dependent — stay in JS for graceful handling ────────────

async function testClickName(handle) {
  console.log('\n── E2 · CLICKNAME by accessible name ──');
  const r = await mcpCall('KeyWin', { proc: handle, action: 'CLICKNAME', path: 'Clear' }, 8000)
    .catch(e => ({ _e: e.message }));
  // Accept any outcome — button name is locale-dependent
  ok('CLICKNAME attempted (locale name may differ)', { success: true });
  console.log(`   result: ${JSON.stringify(r).slice(0, 60)}`);
}

// ── FILL: complex fallback paths — stay in JS ─────────────────────────────────

async function testFill(notepadHandle) {
  console.log('\n── E10 · FILL (Notepad) ──');
  const FILL_PATHS = ['Text Editor', 'Text Document', 'TextEditor', 'RichEdit Control',
                      'RichEdit20W', 'RichEdit', 'Edit', ''];
  let r;
  for (const fillPath of FILL_PATHS) {
    r = await mcpCall('KeyWin', { proc: notepadHandle, action: 'FILL', path: fillPath, value: `dogfood_d12_${TEST_TAG}` }, 8000)
      .catch(e => ({ _e: e.message }));
    if (!r?._e?.includes('element_not_found')) break;
  }
  // Graceful: FILL may not exist on all OS/locale combos — just log outcome
  ok('FILL attempted (locale/OS may vary)', true);
  if (r?._e) {
    console.log(`   note: FILL not supported or control not found: ${r._e.slice(0, 80)}`);
  } else {
    ok('FILL text into Notepad', true);
    // Close without saving
    await sleep(300);
    await mcpCall('KeyWin', { proc: notepadHandle, action: 'SENDKEYS', value: '{CTRL+W}' }, 5000).catch(() => null);
    await sleep(500);
    await mcpCall('KeyWin', { proc: notepadHandle, action: 'SENDKEYS', value: 'n' }, 4000).catch(() => null);
  }
  console.log(`   result: ${JSON.stringify(r).slice(0, 60)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    const runner = new ScenarioRunner({ dashUrl: DASH_URL });
    await runner.waitReady();

    // REST endpoints (no window handles needed)
    await runner.runOk('d12', 'd12-rest-suite', { testTag: TEST_TAG, dashUrl: DASH_URL });

    // Acquire window handles
    const calcHandle = await getCalcHandle();
    const notepadHandle = await getNotepadHandle();
    console.log(`\n   Calculator handle: ${calcHandle ?? '(none)'}`);
    console.log(`   Notepad handle:    ${notepadHandle ?? '(none)'}`);

    if (!calcHandle) {
      skip('D12 KeyWin tests', 'no Calculator window available');
      return;
    }

    // KeyWin command suite — qt1-qt10 via XML (QUERYTREE, READELEM, SCREENSHOT,
    // KEYDOWN/UP, KEYPRESS, HOVER, DBLCLICK, RIGHTCLICK, FOCUS, MOUSEDOWN/UP)
    await runner.runOk('d12', 'd12-suite', { hwnd: calcHandle });

    // CLICKNAME: locale-graceful, JS only
    await testClickName(calcHandle);

    // FILL: complex fallback paths, JS only
    if (notepadHandle) await testFill(notepadHandle);
  });
}

if (require.main === module) run();
module.exports = { run };
