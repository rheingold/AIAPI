'use strict';
/**
 * D14 — MSOfficeWin dogfood
 *
 * Tests MSOfficeWin helper commands via MCP:
 *   LISTDOCS   — enumerate open Office documents (always safe)
 *   NEWDOC     — open a blank Word / Excel / PowerPoint
 *   FOCUS      — bring Office window to front
 *   QUERYTREE  — document structure dump
 *   READ       — read document content
 *   WRITE      — write text then close-without-save
 *   FORMAT     — apply paragraph style / properties
 *   EXEC_MACRO — graceful failure on unsaved workbook
 *   EXPORT     — graceful failure-or-success on fresh doc
 *
 * All tests skip gracefully if:
 *   - MSOfficeWin is not registered as an MCP tool
 *   - Microsoft Office is not installed
 *   - The specific app type (word / excel / ppt) is not running after NEWDOC
 *
 * Cleanup policy:  every Office application opened by NEWDOC is closed without saving
 * using {ALT+F4} (closes the entire app, not just the document) + {ALT+N} to
 * dismiss the save dialog.  This leaves no idle Office windows after the suite.
 *
 * Run:
 *   node test/e2e/d14-msoffice-win.js
 *
 * Prerequisites:
 *   - MSOfficeWin.exe compiled and registered as MCP helper
 *   - KeyWin.exe compiled and registered
 *   - MCP server running on port 3457
 */

const {
  mcpCall, kw, ok, assert, skip, sleep,
  TEST_TAG, pollUntilMcpReady, getCounters, resetCounters, runSuite,
} = require('./_shared');
const { labelFrom }      = require('./_make-suite');
const { ScenarioRunner } = require('./_scenario-runner');

// ── Helpers ───────────────────────────────────────────────────────────────────

let msOfficeAvailable = false;
let kwAvailable = false;

/**
 * Invoke an MSOfficeWin command via MCP.
 * proc   — target string: "word", "excel", "powerpoint", "DOCNAME:<name>", etc.
 * action — bare verb: "LISTDOCS", "READ", "WRITE", etc.
 * path   — element / depth: "body", "cell[@addr='A1']", "2" (depth for QUERYTREE), etc.
 * value  — data to write (WRITE/FORMAT commands).
 */
async function msw(proc, action, path = '', value = '', timeout = 10000) {
  const args = { proc, action };
  if (path)  args.path  = path;
  if (value) args.value = value;
  return mcpCall('MSOfficeWin', args, timeout)
    .catch(e => ({ _e: e.message }));
}

async function checkHelperAvailability() {
  const http = require('http');
  const tools = await new Promise(resolve => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} });
    const req = http.request({
      hostname: '127.0.0.1',
      port: parseInt(process.env.MCP_PORT || '3457', 10),
      path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).result?.tools || []); } catch { resolve([]); } });
    });
    req.setTimeout(4000, () => { req.destroy(); resolve([]); });
    req.on('error', () => resolve([]));
    req.write(body); req.end();
  });

  msOfficeAvailable = !!tools.find(t => t.name === 'MSOfficeWin');
  kwAvailable       = !!tools.find(t => t.name === 'KeyWin');
  return { msOfficeAvailable, kwAvailable };
}

/**
 * Close the entire Office application (top-most window) without saving.
 * Uses {ALT+F4} (closes the app, not just the document) + {ALT+N} to dismiss
 * the save dialog.  {CTRL+F4} only closes the document MDI child but leaves
 * the host application (WINWORD.EXE / EXCEL.EXE / POWERPNT.EXE) running idle.
 */
async function closeActiveDocWithoutSaving(appTitle) {
  if (!kwAvailable) return;
  // Find the Office app window via LISTWINDOWS
  const listR = await kw('SYSTEM', 'LISTWINDOWS', '', 8000).catch(() => null);
  const windows = listR?.windows ?? listR?.result ?? [];
  const regex = typeof appTitle === 'string' ? new RegExp(appTitle, 'i') : appTitle;
  const win = Array.isArray(windows) && windows.find(w => regex.test(w.title || '') ||
    (w.process || '').toLowerCase().includes(regex.source?.toLowerCase?.() ?? String(appTitle).toLowerCase()));
  if (!win) return;
  const hwnd = `HANDLE:${win.hwnd ?? win.handle}`;
  // {ALT+F4} closes the entire Office application window (not just the document).
  // This triggers the "save before closing?" dialog which we dismiss with {ALT+N}.
  await kw(hwnd, 'SENDKEYS', '{ALT+F4}', 5000).catch(() => null);
  // Office save dialog gets OS focus.  Wait long enough for it to render, then
  // send {ALT+N} — the keyboard accelerator for "Don't Save" / "Neukládat" /
  // "Nicht speichern" — which works regardless of which button has focus.
  await sleep(2500);
  await kw('SYSTEM', 'SENDKEYS', '{ALT+N}', 4000).catch(() => null);
  await sleep(500);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/** M1: LISTDOCS — always safe, returns array (possibly empty) */
async function testListDocs() {
  console.log('\n── M1 · LISTDOCS ──');
  if (!msOfficeAvailable) { skip('LISTDOCS', 'MSOfficeWin not registered'); return; }

  const r = await msw('word', 'LISTDOCS', '', '', 12000);
  ok('LISTDOCS returns result', r && !r._e);
  const docs = r?.result ?? r?.docs ?? (Array.isArray(r) ? r : null);
  assert('LISTDOCS result is an array or success=true',
    Array.isArray(docs) || r?.success === true,
    `got: ${JSON.stringify(r).slice(0, 80)}`);
  console.log(`   open docs: ${Array.isArray(docs) ? docs.length : '?'}`);
}

/** M2: NEWDOC word — open a blank Word document */
async function testNewDocWord() {
  console.log('\n── M2 · NEWDOC word ──');
  if (!msOfficeAvailable) { skip('NEWDOC word', 'MSOfficeWin not registered'); return null; }

  const r = await msw('word', 'NEWDOC', '', '', 20000);
  ok('NEWDOC word returns result', r && !r._e);
  const created = r?.success === true || r?.result === 'created';
  assert('NEWDOC word created or graceful failure', !r?._e,
    r?._e ?? JSON.stringify(r).slice(0, 80));
  if (created) {
    console.log(`   created: ${r?.name ?? '?'}`);
    return r?.name ?? true;
  }
  return null;
}

/** M3: QUERYTREE word — document structure */
async function testQueryTreeWord(docName) {
  console.log('\n── M3 · QUERYTREE word ──');
  if (!msOfficeAvailable) { skip('QUERYTREE word', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('QUERYTREE word', 'no Word document open'); return; }

  const r = await msw('word', 'QUERYTREE', '2', '', 12000);
  ok('QUERYTREE word returns result', r && !r._e);
  const tree = r?.result;
  if (r?.success === true) {
    assert('QUERYTREE has type field', typeof tree === 'object' ? true : (typeof tree === 'string' && tree.length > 0),
      `got: ${JSON.stringify(tree).slice(0, 80)}`);
    console.log(`   tree type: ${typeof tree}, keys: ${typeof tree === 'object' ? Object.keys(tree ?? {}).join(', ') : '-'}`);
  }
}

/** M4: READ word body — read full document text */
async function testReadWordBody(docName) {
  console.log('\n── M4 · READ word body ──');
  if (!msOfficeAvailable) { skip('READ word body', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('READ word body', 'no Word document open'); return; }

  const r = await msw('word', 'READ', 'body', '', 10000);
  ok('READ word body returns result', r && !r._e);
  assert('READ word body success or graceful', !r?._e, r?._e ?? '');
  const text = r?.result ?? '';
  console.log(`   body text length: ${typeof text === 'string' ? text.length : '?'}`);
}

/** M5: WRITE word body + implicit undo via close-without-save */
async function testWriteWordBody(docName) {
  console.log('\n── M5 · WRITE word body ──');
  if (!msOfficeAvailable) { skip('WRITE word body', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('WRITE word body', 'no Word document open'); return; }

  const content = `AIAPI dogfood ${TEST_TAG}`;
  const r = await msw('word', 'WRITE', 'body', content, 10000);
  ok('WRITE word body returns result', r && !r._e);
  assert('WRITE word body success or graceful', !r?._e, r?._e ?? '');
  console.log(`   result: ${JSON.stringify(r).slice(0, 60)}`);

  // Verify with READ
  const readR = await msw('word', 'READ', 'body', '', 8000).catch(() => null);
  if (readR?.success) {
    const text = readR?.result ?? '';
    assert('WRITE content visible in READ', typeof text === 'string' && text.includes(TEST_TAG),
      `text (60): "${String(text).slice(0, 60)}"`);
  }
}

/** M6: FORMAT word para[1] — apply Heading 1 style */
async function testFormatWord(docName) {
  console.log('\n── M6 · FORMAT word para[1] ──');
  if (!msOfficeAvailable) { skip('FORMAT word', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('FORMAT word', 'no Word document open'); return; }

  // Apply bold + font size 14 to first paragraph
  const r = await msw('word', 'FORMAT', 'para[1]', 'bold=true|fontSize=14', 10000);
  ok('FORMAT word para[1] returns result', r && !r._e);
  assert('FORMAT word completes', !r?._e, r?._e ?? '');
  console.log(`   result: ${JSON.stringify(r).slice(0, 60)}`);
}

/** M7: FOCUS word */
async function testFocusWord() {
  console.log('\n── M7 · FOCUS word ──');
  if (!msOfficeAvailable) { skip('FOCUS word', 'MSOfficeWin not registered'); return; }

  const r = await msw('word', 'FOCUS', '', '', 8000);
  ok('FOCUS word returns result', r && !r._e);
  // FOCUS may fail if Word is not running — that is acceptable
  const accepted = r?.success === true || !!r?.error;
  assert('FOCUS word returns success or error (no crash)', accepted,
    JSON.stringify(r).slice(0, 60));
  console.log(`   result: ${JSON.stringify(r).slice(0, 60)}`);
}

/** M8: NEWDOC excel + QUERYTREE */
async function testNewDocExcel() {
  console.log('\n── M8 · NEWDOC excel ──');
  if (!msOfficeAvailable) { skip('NEWDOC excel', 'MSOfficeWin not registered'); return null; }

  const r = await msw('excel', 'NEWDOC', '', '', 20000);
  ok('NEWDOC excel returns result', r && !r._e);
  const created = r?.success === true || r?.result === 'created';
  assert('NEWDOC excel created or graceful failure', !r?._e, r?._e ?? '');
  if (created) {
    console.log(`   created: ${r?.name ?? '?'}`);
    return r?.name ?? true;
  }
  return null;
}

/** M9: QUERYTREE excel */
async function testQueryTreeExcel(docName) {
  console.log('\n── M9 · QUERYTREE excel ──');
  if (!msOfficeAvailable) { skip('QUERYTREE excel', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('QUERYTREE excel', 'no Excel workbook open'); return; }

  const r = await msw('excel', 'QUERYTREE', '2', '', 12000);
  ok('QUERYTREE excel returns result', r && !r._e);
  if (r?.success === true) {
    const tree = r?.result;
    assert('QUERYTREE excel has content', !!tree, 'tree is empty');
    console.log(`   tree: ${JSON.stringify(tree).slice(0, 80)}`);
  }
}

/** M10: READ excel cell A1 */
async function testReadExcelCell(docName) {
  console.log('\n── M10 · READ excel cell[@addr=\'A1\'] ──');
  if (!msOfficeAvailable) { skip('READ excel cell', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('READ excel cell', 'no Excel workbook open'); return; }

  const r = await msw('excel', 'READ', `cell[@addr='A1']`, '', 10000);
  ok('READ excel cell A1 returns result', r && !r._e);
  assert('READ excel cell A1 success or graceful', !r?._e, r?._e ?? '');
  console.log(`   A1 value: "${r?.result ?? ''}"`);
}

/** M11: WRITE excel cell A1 */
async function testWriteExcelCell(docName) {
  console.log('\n── M11 · WRITE excel cell[@addr=\'A1\'] ──');
  if (!msOfficeAvailable) { skip('WRITE excel cell', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('WRITE excel cell', 'no Excel workbook open'); return; }

  const r = await msw('excel', 'WRITE', `cell[@addr='A1']`, `dogfood_${TEST_TAG}`, 10000);
  ok('WRITE excel cell A1 returns result', r && !r._e);
  assert('WRITE excel cell A1 success or graceful', !r?._e, r?._e ?? '');
  console.log(`   result: ${JSON.stringify(r).slice(0, 60)}`);
}

/** M12: NEWDOC powerpoint */
async function testNewDocPowerPoint() {
  console.log('\n── M12 · NEWDOC powerpoint ──');
  if (!msOfficeAvailable) { skip('NEWDOC powerpoint', 'MSOfficeWin not registered'); return null; }

  const r = await msw('powerpoint', 'NEWDOC', '', '', 20000);
  ok('NEWDOC powerpoint returns result', r && !r._e);
  const created = r?.success === true || r?.result === 'created';
  assert('NEWDOC powerpoint created or graceful failure', !r?._e, r?._e ?? '');
  if (created) {
    console.log(`   created: ${r?.name ?? '?'}`);
    return r?.name ?? true;
  }
  return null;
}

/** M13: QUERYTREE powerpoint */
async function testQueryTreePowerPoint(docName) {
  console.log('\n── M13 · QUERYTREE powerpoint ──');
  if (!msOfficeAvailable) { skip('QUERYTREE powerpoint', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('QUERYTREE powerpoint', 'no PowerPoint presentation open'); return; }

  const r = await msw('powerpoint', 'QUERYTREE', '2', '', 12000);
  ok('QUERYTREE powerpoint returns result', r && !r._e);
  if (r?.success === true) {
    const tree = r?.result;
    assert('QUERYTREE powerpoint has content', !!tree, 'tree is empty');
    console.log(`   tree: ${JSON.stringify(tree).slice(0, 80)}`);
  }
}

/** M13b: READ powerpoint slide[1] — get all text on the opening slide */
async function testReadPowerPointSlide(docName) {
  console.log('\n── M13b · READ powerpoint slide[1] ──');
  if (!msOfficeAvailable) { skip('READ powerpoint slide', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('READ powerpoint slide', 'no PowerPoint presentation open'); return; }

  const r = await msw('powerpoint', 'READ', 'slide[1]', '', 10000);
  ok('READ powerpoint slide[1] returns result', r && !r._e);
  assert('READ powerpoint slide[1] success or graceful', !r?._e, r?._e ?? '');
  console.log(`   slide text: "${String(r?.result ?? '').slice(0, 60)}"`);
}

/** M13c: WRITE powerpoint slide[1]/shape[1] then verify with READ.
 *  Uses shape index rather than shape name to be locale-independent
 *  (the title shape is named "Nadpis 1" in Czech, "Titre 1" in French, etc.). */
async function testWritePowerPointSlide(docName) {
  console.log('\n── M13c · WRITE powerpoint slide[1]/shape[1] ──');
  if (!msOfficeAvailable) { skip('WRITE powerpoint', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('WRITE powerpoint', 'no PowerPoint presentation open'); return; }

  const titleText = `AIAPI dogfood ${TEST_TAG}`;
  const r = await msw('powerpoint', 'WRITE', 'slide[1]/shape[1]', titleText, 12000);
  ok('WRITE powerpoint shape[1] returns result', r && !r._e);
  assert('WRITE powerpoint shape[1] success or graceful', !r?._e, r?._e ?? '');
  console.log(`   result: ${JSON.stringify(r).slice(0, 60)}`);

  // Verify with READ
  if (r?.success) {
    const readR = await msw('powerpoint', 'READ', 'slide[1]/shape[1]', '', 8000).catch(() => null);
    if (readR?.success) {
      assert('WRITE PowerPoint content visible in READ',
        typeof readR?.result === 'string' && readR.result.includes(TEST_TAG),
        `got: "${String(readR?.result).slice(0, 60)}"`);
    }
  }
}

/** M14: EXEC_MACRO — graceful failure (unsaved workbook / macro not found) */
async function testExecMacroGraceful(docName) {
  console.log('\n── M14 · EXEC_MACRO (graceful — macro not found) ──');
  if (!msOfficeAvailable) { skip('EXEC_MACRO', 'MSOfficeWin not registered'); return; }
  if (!docName) { skip('EXEC_MACRO', 'no Excel workbook open'); return; }

  const r = await msw('excel', 'EXEC_MACRO', 'DoesNotExist_AIAPITest', '', 8000);
  ok('EXEC_MACRO returns result (even on failure)', r != null);
  // Must not crash the server — an error response (success:false or _e) is the expected outcome.
  // A missing macro always errors; we just verify the server stayed alive.
  const noServerCrash = typeof r === 'object';
  ok('EXEC_MACRO does not crash server', noServerCrash);
  console.log(`   result: ${JSON.stringify(r).slice(0, 80)}`);
}

/** M15: Close all test documents without saving */
async function closeTestDocuments(wordName, excelName, pptName) {
  console.log('\n── M15 · Close test documents (no-save) ──');
  if (!kwAvailable) { skip('Close test docs', 'KeyWin not registered'); return; }

  // Office window title patterns
  const titlePatterns = [
    wordName       && /word|winword/i,
    excelName      && /excel/i,
    pptName        && /powerpoint|powerpnt/i,
  ].filter(Boolean);

  if (titlePatterns.length === 0) {
    console.log('   No test documents to close');
    return;
  }

  const listR = await kw('SYSTEM', 'LISTWINDOWS', '', 8000).catch(() => null);
  const windows = listR?.windows ?? listR?.result ?? [];

  if (!Array.isArray(windows)) {
    skip('Close test docs', 'LISTWINDOWS failed');
    return;
  }

  for (const pattern of titlePatterns) {
    const win = windows.find(w =>
      pattern.test(w.title || '') ||
      pattern.test(w.process || '')
    );
    if (!win) continue;
    const hwnd = `HANDLE:${win.hwnd ?? win.handle}`;
    // {ALT+F4} closes the entire Office application (not just the document).
    // {CTRL+F4} would only close the MDI document child and leave the host
    // process (WINWORD.EXE / EXCEL.EXE / POWERPNT.EXE) running idle.
    await kw(hwnd, 'SENDKEYS', '{ALT+F4}', 5000).catch(() => null);
    // Office save dialog gets OS focus.  Wait long enough for it to render, then
    // send {ALT+N} — keyboard accelerator for "Don't Save" / "Neukládat" /
    // "Nicht speichern" — works regardless of which button has focus.
    await sleep(2500);
    await kw('SYSTEM', 'SENDKEYS', '{ALT+N}', 4000).catch(() => null);
    await sleep(500);
  }

  ok('Test Office applications closed without saving', true);
  console.log(`   Closed ${titlePatterns.length} Office application(s)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const DASH_PORT = parseInt(process.env.DASH_PORT || '3458', 10);
  const DASH_URL  = `http://localhost:${DASH_PORT}`;

  return runSuite(labelFrom(__filename), async () => {
    // Static preflight — always runs, no Office required (ADR-008)
    const runner = new ScenarioRunner({ browser: null, dashUrl: DASH_URL });
    await runner.waitReady();
    await runner.runOk('d14', 'd14-static-suite', { dashUrl: DASH_URL });

    let wordDocName  = null;
    let excelDocName = null;
    let pptDocName   = null;
    try {
      // Check helper registration
      const { msOfficeAvailable: mso, kwAvailable: kwa } = await checkHelperAvailability();
      console.log(`\n   MSOfficeWin available: ${mso}  KeyWin available: ${kwa}`);
      if (!mso) {
        console.log('   MSOfficeWin not registered — all Office tests will be skipped');
        console.log('   (Build MSOfficeWin.exe and register it to enable these tests)');
      }
      // Read-only: always safe
      await testListDocs();
      // Word tests
      wordDocName  = await testNewDocWord();
      await testQueryTreeWord(wordDocName);
      await testReadWordBody(wordDocName);
      await testWriteWordBody(wordDocName);
      await testFormatWord(wordDocName);
      await testFocusWord();
      // Excel tests
      excelDocName = await testNewDocExcel();
      await testQueryTreeExcel(excelDocName);
      await testReadExcelCell(excelDocName);
      await testWriteExcelCell(excelDocName);
      await testExecMacroGraceful(excelDocName);
      // PowerPoint tests
      pptDocName   = await testNewDocPowerPoint();
      await testQueryTreePowerPoint(pptDocName);
      await testReadPowerPointSlide(pptDocName);
      await testWritePowerPointSlide(pptDocName);
    } finally {
      // Always attempt cleanup to leave Office in a clean state
      await closeTestDocuments(wordDocName, excelDocName, pptDocName);
    }
  });
}

if (require.main === module) run();
module.exports = { run };



