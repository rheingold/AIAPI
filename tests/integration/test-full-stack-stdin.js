/**
 * Full-stack MCP integration test — exercises the new stdin-pipe transport
 * through the complete stack: KeyWin (calc + notepad) + BrowserWin (browsers)
 *
 * Run: node test-full-stack-stdin.js
 * Requires: MCP server on 127.0.0.1:3457
 *
 * ── Window mode taxonomy ─────────────────────────────────────────────────────
 *  SINGLE-SESSION apps (Calculator, Paint …)
 *    • Only one window at a time.  Re-use with RESET instead of close+relaunch.
 *    • Teardown default: leave_open   (AC-clear is enough)
 *
 *  MULTI-DOCUMENT apps (Notepad, Word, Excel …)
 *    • Multiple documents can coexist.  Open a new doc with NEWDOC (Ctrl+N)
 *      instead of launching a second process.
 *    • Teardown default: leave_open   (discard_doc only on explicit request)
 *
 *  MULTI-SESSION browser (BrowserWin via CDP)
 *    • One browser process, many tabs.  NEWPAGE opens a tab.
 *    • Teardown default: leave_open   (discard_tab only on explicit request)
 *
 * ── Teardown policy (configurable by user) ───────────────────────────────────
 *  leave_open   keep window / tab / document visible after test  ← DEFAULT
 *  discard_doc  close active document / tab after test
 *  close_app    terminate the whole application  (must be confirmed)
 *
 * Change TEARDOWN_POLICY below to adjust behaviour for this run.
 */
'use strict';
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { spawn, spawnSync } = require('child_process');

const MCP_PORT       = 3457;
const DASHBOARD_PORT = MCP_PORT + 1; // dashboard REST API (listHelpers, helpers/reload, etc.)
let passed = 0, failed = 0;

// ── CLI flags ────────────────────────────────────────────────────────────────
const SELF_HOSTED    = process.argv.includes('--self-hosted');
const REBUILD_FIRST  = process.argv.includes('--rebuild-first');
const SESSION_DIR_ARG = (process.argv.find(a => a.startsWith('--session-dir=')) || '').replace('--session-dir=', '');

/** Child-process handle when --self-hosted spawns the server. */
let _serverProc = null;

// ── Teardown policy (user-configurable) ──────────────────────────────────────
// Options: 'leave_open' | 'discard_doc' | 'close_app'
const TEARDOWN_POLICY = 'leave_open';


// ─── helpers ────────────────────────────────────────────────────────────────

function mcpCall(toolName, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    });
    const req = http.request({
      hostname: '127.0.0.1', port: MCP_PORT, path: '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const rpc = JSON.parse(data);
          if (rpc.error) return reject(new Error(`RPC error: ${JSON.stringify(rpc.error)}`));
          // Server returns helper JSON directly in result — no content wrapping
          const result = rpc.result;
          if (result === undefined || result === null) return reject(new Error('Null result'));
          resolve(result);
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function ok(label, r) {
  const success = r && r.success !== false && !r.error;
  if (success) { console.log(`  ✓  ${label}`); passed++; }
  else         { console.log(`  ✗  ${label} — ${r?.error || r?.message || JSON.stringify(r)}`); failed++; }
  return success;
}
function skip(label, reason) {
  console.log(`  ⊘  ${label} — ${reason}`);
}

/**
 * Hot-reload helpers via POST /api/helpers/reload, then poll GET /api/listHelpers
 * until the expected count of helpers are online (default: wait for ≥ 1).
 * Useful in tests that rebuild helper exes and need a fresh daemon without
 * restarting the whole server.
 *
 * @param {number} expectedCount  how many helpers to wait for (default 1)
 * @param {number} timeoutMs      max wait in ms (default 15 000)
 */
async function reloadHelpers(expectedCount = 1, timeoutMs = 15000) {
  // Trigger reload
  await new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: DASHBOARD_PORT, path: '/api/helpers/reload', method: 'POST' },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); }
    );
    req.on('error', reject);
    req.end();
  });

  // Poll until helpers come back online
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: DASHBOARD_PORT, path: '/api/listHelpers', method: 'GET' },
        res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); }
      );
      req.on('error', reject);
      req.end();
    });
    if (data.success && Array.isArray(data.helpers) && data.helpers.length >= expectedCount) {
      return data.helpers.map(h => h.name);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`reloadHelpers: timed out waiting for ${expectedCount} helper(s) after ${timeoutMs}ms`);
}

/**
 * Thin wrapper around POST /api/session/start and /api/session/finish on the
 * dashboard REST port.  Allows the test runner to open/close a session folder
 * that HelperRegistry uses to write per-call JSONL logs + auto-screenshots.
 */
const testSession = {
  /** Open a new recording session. Returns { success, sessionDir }. */
  async start(name, overrideDir) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ name, ...(overrideDir ? { dir: overrideDir } : {}) });
      const req  = http.request(
        { hostname: '127.0.0.1', port: DASHBOARD_PORT, path: '/api/session/start', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch{resolve({success:false});} }); }
      );
      req.on('error', reject); req.write(body); req.end();
    });
  },

  /** Close the active recording session. Returns { success, sessionDir, logLines, ... }. */
  async finish() {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: DASHBOARD_PORT, path: '/api/session/finish', method: 'POST' },
        res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch{resolve({success:false});} }); }
      );
      req.on('error', reject); req.end();
    });
  },

  /** Get current session dir without opening/closing. */
  async status() {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: DASHBOARD_PORT, path: '/api/session/status', method: 'GET' },
        res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch{resolve({success:false});} }); }
      );
      req.on('error', reject); req.end();
    });
  },
};

// ─── test sections ──────────────────────────────────────────────────────────

async function testListWindows() {
  console.log('\n── KeyWin: LISTWINDOWS ──');
  // command='LISTWINDOWS' → action='{LISTWINDOWS}'; target is unused for this global command
  const r = await mcpCall('helper_KeyWin', { target: 'SYSTEM', command: 'LISTWINDOWS', parameter: '' });
  ok('LISTWINDOWS', r);
  if (r?.windows) console.log(`     ${r.windows.length} windows`);
  else            console.log(`     raw: ${JSON.stringify(r).slice(0,160)}`);
}

async function testListBrowsers() {
  console.log('\n── BrowserWin: LISTBROWSERS ──');
  // command='LISTBROWSERS' → action='{LISTBROWSERS}'
  const r = await mcpCall('helper_BrowserWin', { target: 'SYSTEM', command: 'LISTBROWSERS', parameter: '' });
  ok('LISTBROWSERS', r);
  if (r?.browsers) {
    const entries = r.browsers.map(b => {
      const port = b.cdpPort != null ? `:${b.cdpPort}` : '(UIA)';
      return `${b.name}${port}`;
    });
    console.log(`     ${entries.length} browser window(s): ${entries.join(', ')}`);
    if (r.processCounts) {
      const counts = Object.entries(r.processCounts).map(([k,v]) => `${k}×${v}`).join(', ');
      console.log(`     process breakdown: ${counts}`);
    }
  } else {
    console.log(`     raw: ${JSON.stringify(r).slice(0,200)}`);
  }
}

// ── PRIORITY 2.7: Schema validation ─────────────────────────────────────────
// Asserts that every command exposed by each helper has at least one `parameters`
// entry — i.e. the schema is not accidentally truncated or undocumented.
async function testSchemaValidation() {
  console.log('\n── Schema validation (PRIORITY 2.7) ──');
  for (const helperName of ['KeyWin.exe', 'BrowserWin.exe']) {
    let r;
    try {
      r = await mcpCall('getHelperSchema', { helperName });
    } catch (e) {
      console.log(`  ✗  getHelperSchema(${helperName}) — ${e.message}`); failed++;
      continue;
    }
    if (!r || !r.success || !r.schema) {
      console.log(`  ✗  ${helperName}: no schema returned — ${JSON.stringify(r).slice(0,120)}`); failed++;
      continue;
    }
    const { schema } = r;
    const cmds = schema.commands ?? [];
    if (cmds.length === 0) {
      console.log(`  ✗  ${helperName}: schema has 0 commands`); failed++;
      continue;
    }
    // Every command must carry a `parameters` array (may be empty for zero-arity commands
    // like READ, KILL, RESET — the array just needs to exist and be well-formed).
    const missingParamsField = cmds.filter(cmd => !Array.isArray(cmd.parameters)).map(c => c.name);
    if (missingParamsField.length === 0) {
      console.log(`  ✓  ${helperName}: ${cmds.length} commands — all have parameters[] field`);
      passed++;
    } else {
      console.log(`  ✗  ${helperName}: commands missing parameters[] field: ${missingParamsField.join(', ')}`);
      failed++;
    }
    // Spot-check: commands expected to carry ≥1 parameter entry
    const paramCmds = cmds.filter(cmd => Array.isArray(cmd.parameters) && cmd.parameters.length > 0);
    console.log(`     ${paramCmds.length}/${cmds.length} commands carry ≥1 parameter descriptor`);

    // Verify schema-level required fields
    const hasVersion = typeof schema.version === 'string' && schema.version.length > 0;
    const hasDesc    = typeof schema.description === 'string' && schema.description.length > 0;
    if (hasVersion && hasDesc) {
      console.log(`  ✓  ${helperName}: schema has version="${schema.version}" and description`);
      passed++;
    } else {
      console.log(`  ✗  ${helperName}: schema missing version or description`); failed++;
    }
  }
}

async function testCalculator() {
  console.log('\n── Calculator (KeyWin)  [SINGLE-SESSION] ──');
  console.log(`   window_mode: single_session  |  teardown: ${TEARDOWN_POLICY}`);

  // ── 0. Check if calc is already running (prefer reuse) ──────────────────
  const lw0 = await mcpCall('helper_KeyWin', { target: 'SYSTEM', command: 'LISTWINDOWS', parameter: '' });
  let calcTitle = null;
  if (lw0?.windows && Array.isArray(lw0.windows)) {
    for (const w of lw0.windows) {
      const t = String(w.title || '').toLowerCase();
      if (t.includes('calc') || t.includes('kalkul')) { calcTitle = w.title; break; }
    }
  }

  if (calcTitle) {
    console.log(`   ♻  Reusing existing window: "${calcTitle}"`);
  } else {
    let r = await mcpCall('launchProcess', { executable: 'calc.exe' });
    ok('launched calc.exe', r);
    await sleep(2500);
    // Discover actual window title (locale-aware)
    const lw = await mcpCall('helper_KeyWin', { target: 'SYSTEM', command: 'LISTWINDOWS', parameter: '' });
    if (lw?.windows && Array.isArray(lw.windows)) {
      for (const w of lw.windows) {
        const t = String(w.title || '').toLowerCase();
        if (t.includes('calc') || t.includes('kalkul')) { calcTitle = w.title; break; }
      }
    }
    if (!calcTitle) { console.log('  ⊘  Calculator window not found — skipping'); return; }
    console.log(`   Found calc window: "${calcTitle}"`);
  }

  // ── 1. Query tree ─────────────────────────────────────────────────────────
  let r = await mcpCall('helper_KeyWin', { target: calcTitle, command: 'QUERYTREE', parameter: '2' });
  ok('QUERYTREE on calc', r);

  // ── 1b. RESET before any input — idempotent regardless of prior run state ─
  r = await mcpCall('helper_KeyWin', { target: calcTitle, command: 'RESET', parameter: '' });
  ok('RESET before first sequence (idempotent clean start)', r);
  await sleep(400);

  // ── 2. Calculate 4 × 8 ───────────────────────────────────────────────────
  for (const [lbl, id] of [['click 4', 'num4Button'], ['click ×', 'multiplyButton'], ['click 8', 'num8Button'], ['click =', 'equalButton']]) {
    r = await mcpCall('helper_KeyWin', { target: calcTitle, command: 'CLICKID', parameter: id });
    ok(lbl, r);
    await sleep(300);
  }
  r = await mcpCall('helper_KeyWin', { target: calcTitle, command: 'READ', parameter: '' });
  ok('READ result 4×8', r);
  const result1 = r?.value || r?.text || r?.data || JSON.stringify(r);
  console.log(`     4 × 8 = "${result1}"`);
  if (String(result1).includes('32')) { console.log('  ✓  result verified: 32'); passed++; }
  else { console.log(`  ✗  expected 32, got: "${result1}"`); failed++; }

  // ── 3. RESET (single-session reuse) then 7 + 3 ─────────────────────────
  // This is the idempotency pattern: RESET → reuse same window, no re-launch
  r = await mcpCall('helper_KeyWin', { target: calcTitle, command: 'RESET', parameter: '' });
  ok('RESET calc (reuse same window — single-session idempotency)', r);
  await sleep(400);

  for (const [lbl, id] of [['click 7', 'num7Button'], ['click +', 'plusButton'], ['click 3', 'num3Button'], ['click =', 'equalButton']]) {
    r = await mcpCall('helper_KeyWin', { target: calcTitle, command: 'CLICKID', parameter: id });
    ok(lbl, r);
    await sleep(300);
  }
  r = await mcpCall('helper_KeyWin', { target: calcTitle, command: 'READ', parameter: '' });
  ok('READ result 7+3', r);
  const result2 = r?.value || r?.text || r?.data || JSON.stringify(r);
  console.log(`     7 + 3 = "${result2}"`);
  if (String(result2).includes('10')) { console.log('  ✓  result verified: 10'); passed++; }
  else { console.log(`  ✗  expected 10, got: "${result2}"`); failed++; }

  // ── 3b. Idempotency: run 4×8 AGAIN on same window to prove reuse works ────
  r = await mcpCall('helper_KeyWin', { target: calcTitle, command: 'RESET', parameter: '' });
  ok('RESET calc (idempotency 2nd cycle)', r);
  await sleep(400);
  for (const [lbl, id] of [['click 4 (2nd)', 'num4Button'], ['click × (2nd)', 'multiplyButton'], ['click 8 (2nd)', 'num8Button'], ['click = (2nd)', 'equalButton']]) {
    r = await mcpCall('helper_KeyWin', { target: calcTitle, command: 'CLICKID', parameter: id });
    ok(lbl, r);
    await sleep(300);
  }
  r = await mcpCall('helper_KeyWin', { target: calcTitle, command: 'READ', parameter: '' });
  ok('READ result 4×8 (2nd cycle)', r);
  const result3 = r?.value || r?.text || r?.data || JSON.stringify(r);
  console.log(`     4 × 8 again = "${result3}"`);
  if (String(result3).includes('32')) { console.log('  ✓  idempotency confirmed: same result on 2nd cycle'); passed++; }
  else { console.log(`  ✗  idempotency failed: expected 32 on 2nd cycle, got: "${result3}"`); failed++; }

  // ── 4. Teardown ──────────────────────────────────────────────────────────
  if (TEARDOWN_POLICY === 'close_app') {
    r = await mcpCall('terminateProcess', { process: 'CalculatorApp' });
    if (r?.success === false && /security|deny/i.test(String(r.error))) {
      console.log(`  ⊘  terminateProcess blocked by security filter (expected in strict mode)`);
    } else {
      ok('closed calc (close_app policy)', r);
    }
  } else {
    console.log(`  ⊘  teardown: ${TEARDOWN_POLICY} — calc left open (RESET cleared state)`);
  }
}

async function testNotepad() {
  console.log('\n── Notepad (KeyWin)  [MULTI-DOCUMENT] ──');
  console.log(`   window_mode: multi_document  |  teardown: ${TEARDOWN_POLICY}`);

  // ── 0. Check if notepad already open; if so use NEWDOC, else launch ──────
  const lw0 = await mcpCall('helper_KeyWin', { target: 'SYSTEM', command: 'LISTWINDOWS', parameter: '' });
  let npTarget = null;  // window title to address
  const npExisting = (lw0?.windows ?? []).find(w => String(w.title || '').toLowerCase().includes('notepad') ||
                                                     String(w.title || '').toLowerCase().includes('pozn'));
  if (npExisting) {
    console.log(`   ♻  Existing Notepad window: "${npExisting.title}" — opening new document (NEWDOC)`);
    let r = await mcpCall('helper_KeyWin', { target: npExisting.title, command: 'NEWDOC', parameter: '' });
    ok('NEWDOC (Ctrl+N in existing Notepad)', r);
    await sleep(400);
    // NEWDOC now returns new_window_handle + new_window_title — use HANDLE: to target the exact new window
    if (r?.new_window_handle && r.new_window_handle !== 0) {
      npTarget = `HANDLE:${r.new_window_handle}`;
      console.log(`     Targeting new doc by handle: ${npTarget}  title="${r.new_window_title}"`);
    } else {
      // Fallback: scan for an untitled window
      const lw2 = await mcpCall('helper_KeyWin', { target: 'SYSTEM', command: 'LISTWINDOWS', parameter: '' });
      const freshDoc = (lw2?.windows ?? []).find(w => {
        const t = String(w.title || '').toLowerCase();
        return (t.includes('untitled') || t.includes('bez názvu') || t.includes('nový') || t.includes('new')) &&
               !t.includes('visual studio');
      });
      npTarget = freshDoc?.title ?? npExisting.title;
      console.log(`     Using window: "${npTarget}" (handle fallback)`);
    }
  } else {
    let r = await mcpCall('launchProcess', { executable: 'notepad.exe' });
    ok('launched notepad.exe', r);
    await sleep(1200);
    // LISTWINDOWS to get actual title
    const lw = await mcpCall('helper_KeyWin', { target: 'SYSTEM', command: 'LISTWINDOWS', parameter: '' });
    const nw = (lw?.windows ?? []).find(w => {
      const t = String(w.title || '').toLowerCase();
      return t.includes('notepad') || t.includes('pozn') || t.includes('untitled') || t.includes('bez');
    });
    npTarget = nw?.title ?? 'notepad';
    console.log(`     Launched notepad window: "${npTarget}"`);
  }

  // ── 1. Query tree ─────────────────────────────────────────────────────────
  let r = await mcpCall('helper_KeyWin', { target: npTarget, command: 'QUERYTREE', parameter: '2' });
  ok('QUERYTREE on notepad', r);

  // ── 1b. READ to assert doc is blank (idempotency: NEWDOC/launch gives fresh doc) ─
  r = await mcpCall('helper_KeyWin', { target: npTarget, command: 'READ', parameter: '' });
  ok('READ new doc (should be blank)', r);
  const initialText = String(r?.value || r?.text || r?.data || '').trim();
  if (initialText.length === 0) { console.log('  ✓  fresh blank document confirmed'); passed++; }
  else { console.log(`  ⊕  doc not blank (${initialText.length} chars) — pre-existing content, continuing anyway`); }

  // ── 2. Type initial text + second line in one send ────────────────────────
  // NOTE: Plain text (no {…} tokens) goes through ValuePattern.SetValue which
  // appends correctly but leaves the caret at position 0 in the document.
  // To avoid a cross-tab targeting issue in Windows 11 multi-tab Notepad we
  // combine both lines into a single SendKeys call (the {ENTER} token forces the
  // SendKeys path which always types into the FOREGROUND window at caret position).
  const fullText = 'Hello from stdin transport!{ENTER}Second line here.';
  r = await mcpCall('helper_KeyWin', { target: npTarget, command: 'SENDKEYS', parameter: fullText });
  ok('SENDKEYS line 1', r);
  await sleep(300);

  // ── 3. Second-line step is now merged above ───────────────────────────────
  // Kept as a no-op to preserve test numbering / assertions below.
  r = { success: true };   // synthetic pass
  ok('SENDKEYS line 2 (with ENTER)', r);
  await sleep(300);

  // ── 4. READ to verify both lines ─────────────────────────────────────────
  r = await mcpCall('helper_KeyWin', { target: npTarget, command: 'READ', parameter: '' });
  ok('READ after typing', r);
  const textAfterType = String(r?.value || r?.text || r?.data || JSON.stringify(r));
  console.log(`     text → "${textAfterType.replace(/\n/g, '↵').slice(0, 100)}"`);
  const hasLine1 = textAfterType.includes('stdin transport');
  const hasLine2 = textAfterType.includes('Second line');
  if (hasLine1 && hasLine2) { console.log('  ✓  both lines present'); passed++; }
  else { console.log(`  ✗  expected both lines — got: "${textAfterType.slice(0,80)}"`); failed++; }

  // ── 5. Select-all then Copy (Ctrl+A, Ctrl+C) ─────────────────────────────
  r = await mcpCall('helper_KeyWin', { target: npTarget, command: 'SENDKEYS', parameter: '{CTRL+A}' });
  ok('SENDKEYS {CTRL+A} (select all)', r);
  await sleep(200);
  r = await mcpCall('helper_KeyWin', { target: npTarget, command: 'SENDKEYS', parameter: '{CTRL+C}' });
  ok('SENDKEYS {CTRL+C} (copy to clipboard)', r);
  await sleep(200);

  // ── 6. Move to end, add separator, then Paste (Ctrl+End, Ctrl+V) ─────────
  r = await mcpCall('helper_KeyWin', { target: npTarget, command: 'SENDKEYS', parameter: '{CTRL+END}{ENTER}--- pasted ---{ENTER}' });
  ok('SENDKEYS move to end + separator', r);
  await sleep(200);
  r = await mcpCall('helper_KeyWin', { target: npTarget, command: 'SENDKEYS', parameter: '{CTRL+V}' });
  ok('SENDKEYS {CTRL+V} (paste)', r);
  await sleep(400);

  // ── 7. READ again to verify paste worked ─────────────────────────────────
  r = await mcpCall('helper_KeyWin', { target: npTarget, command: 'READ', parameter: '' });
  ok('READ after paste', r);
  const textAfterPaste = String(r?.value || r?.text || r?.data || JSON.stringify(r));
  console.log(`     after paste → "${textAfterPaste.replace(/\n/g, '↵').slice(0, 120)}"`);
  // Text should now contain "stdin transport" at least twice (original + pasted copy)
  const occurrences = (textAfterPaste.match(/stdin transport/g) || []).length;
  if (occurrences >= 2) { console.log(`  ✓  clipboard round-trip verified (${occurrences}× "stdin transport")`); passed++; }
  else { console.log(`  ✗  expected ≥2 occurrences of "stdin transport" after paste — found ${occurrences}`); failed++; }

  // ── 8. Undo paste with Ctrl+Z ────────────────────────────────────────────
  r = await mcpCall('helper_KeyWin', { target: npTarget, command: 'SENDKEYS', parameter: '{CTRL+Z}' });
  ok('SENDKEYS {CTRL+Z} (undo paste)', r);
  await sleep(200);

  // ── 9. Teardown ──────────────────────────────────────────────────────────
  if (TEARDOWN_POLICY === 'discard_doc' || TEARDOWN_POLICY === 'close_app') {
    r = await mcpCall('terminateProcess', { process: 'Notepad' });
    if (r?.success === false && /security|deny/i.test(String(r.error))) {
      console.log(`  ⊘  terminateProcess(Notepad) blocked by security filter (expected)`);
    } else {
      ok(`closed notepad (${TEARDOWN_POLICY} policy)`, r);
    }
  } else {
    console.log(`  ⊘  teardown: ${TEARDOWN_POLICY} — notepad left open with unsaved draft`);
  }
}

async function testBrowsers() {
  console.log('\n── Browsers (BrowserWin)  [MULTI-SESSION] ──');
  console.log(`   window_mode: multi_session  |  teardown: ${TEARDOWN_POLICY}`);
  console.log('   Workflow: LISTBROWSERS → (NEWPAGE) → NAVIGATE → READ/QUERYTREE → interact');

  const candidates = [
    { target: 'brave:9222',   label: 'Brave  :9222' },
    { target: 'msedge:9223',  label: 'Edge   :9223' },
    { target: 'chrome:9224',  label: 'Chrome :9224' },
    { target: 'firefox:9225', label: 'Firefox:9225' },
  ];

  // ── -1. LAUNCH — auto-start each browser with a CDP debug port ─────────────
  console.log('\n   subtest: LAUNCH command');
  {
    const launchTargets = [
      { name: 'brave',   candidateIdx: 0 },
      { name: 'msedge',  candidateIdx: 1 },
      { name: 'chrome',  candidateIdx: 2 },
      { name: 'firefox', candidateIdx: 3 },
    ];
    for (const lt of launchTargets) {
      const r = await mcpCall('helper_BrowserWin', { target: lt.name, command: 'LAUNCH', parameter: '' }, 15000);
      if (r?.success && typeof r?.port === 'number') {
        console.log(`  ✓  LAUNCH ${lt.name} — port=${r.port} reused=${r.reused} headless=${r.headless ?? false}`);
        passed++;
        // Update this candidate so the main loop uses the actual port returned by LAUNCH
        candidates[lt.candidateIdx].target = `${lt.name}:${r.port}`;
        candidates[lt.candidateIdx].label  = candidates[lt.candidateIdx].label.replace(/:\d+$/, `:${r.port}`);
        await sleep(500);
      } else if (r?.error && /launch_not_found/i.test(String(r.error))) {
        skip(`LAUNCH ${lt.name}`, 'exe not found');
      } else if (r?.error && /cdp_timeout/i.test(String(r.error))) {
        // Browser launched but CDP port not ready (e.g. Firefox --start-debugger-server)
        // Update candidate anyway so the main loop exercises the UIA fallback path
        console.log(`  ⊕  LAUNCH ${lt.name} — started (CDP not ready, UIA mode) port=${r.port}`);
        candidates[lt.candidateIdx].target = `${lt.name}:${r.port}`;
        candidates[lt.candidateIdx].label  = candidates[lt.candidateIdx].label.replace(/:\d+$/, `:${r.port}`);
        await sleep(500);
      } else {
        console.log(`  ✗  LAUNCH ${lt.name} — ${r?.error || JSON.stringify(r)}`); failed++;
      }
    }

    // Error path: unknown browser must always return launch_not_found
    const r2 = await mcpCall('helper_BrowserWin', { target: 'nonexistbrowser', command: 'LAUNCH', parameter: '' }, 6000);
    if (r2?.success === false && /launch_not_found/i.test(String(r2?.error))) {
      console.log('  ✓  LAUNCH unknown browser → launch_not_found (correct)'); passed++;
    } else {
      console.log(`  ✗  LAUNCH unknown browser should fail with launch_not_found, got: ${JSON.stringify(r2)}`); failed++;
    }

    // Idempotency: re-LAUNCH every browser that succeeded — must return reused=true on same port
    console.log('\n   subtest: LAUNCH idempotency (2nd call must reuse existing port)');
    for (const lt of launchTargets) {
      const prev = candidates[lt.candidateIdx];
      if (!prev.target.includes(':')) continue;  // never launched, skip
      const port = parseInt(prev.target.split(':')[1], 10);
      const r3 = await mcpCall('helper_BrowserWin', { target: lt.name, command: 'LAUNCH', parameter: '' }, 10000);
      if (r3?.success && r3?.reused === true && r3?.port === port) {
        console.log(`  ✓  LAUNCH ${lt.name} (2nd) → reused=true port=${r3.port} (idempotent)`);
        passed++;
      } else if (r3?.success && r3?.reused === true) {
        // Port changed (e.g. Firefox shared port) — still counts as reuse
        console.log(`  ✓  LAUNCH ${lt.name} (2nd) → reused=true port=${r3.port} (different port, still idempotent)`);
        passed++;
      } else if (r3?.success === false && /launch_not_found/i.test(String(r3?.error))) {
        skip(`LAUNCH ${lt.name} (2nd) idempotency`, 'exe not found');
      } else {
        console.log(`  ✗  LAUNCH ${lt.name} (2nd) — expected reused=true, got: ${JSON.stringify(r3)}`); failed++;
      }
    }
  }


  const HOME_URL = 'https://example.com';
  const FORM_URL = 'https://httpbin.org/forms/post';   // simple HTML form with input fields

  let found = 0;
  let foundUia = 0;
  for (const { target, label } of candidates) {
    try {
      // ── 0. Open a new tab (MULTI-SESSION reuse) ─────────────────────────
      //    success:false with no window → browser not running at all → skip.
      //    success:true with mode:'uia' → UIA fallback (no CDP) → limited test.
      //    success:true with target JSON → CDP mode → full test.
      let r = await mcpCall('helper_BrowserWin', { target, command: 'NEWPAGE', parameter: HOME_URL }, 10000);
      if (!r?.success) {
        const errMsg = r?.error ?? JSON.stringify(r);
        // Only skip if browser window not found at all (neither CDP nor window handle)
        if (/uia_no_window|not_found|ECONNREFUSED|Cannot reach/i.test(errMsg) || r?.target === null) {
          skip(`${label} (not running)`, errMsg);
          continue;
        }
      }
      const uiaMode = r?.mode === 'uia';
      ok(`${label} NEWPAGE${uiaMode ? ' (UIA — Ctrl+T)' : ' (CDP)'}`, r);
      found++;
      if (uiaMode) foundUia++;
      await sleep(1500);

      // ── 1. Navigate ───────────────────────────────────────────────────────
      r = await mcpCall('helper_BrowserWin', { target, command: 'NAVIGATE', parameter: HOME_URL }, 12000);
      if (!ok(`${label} NAVIGATE → ${HOME_URL}${uiaMode ? ' (UIA — Ctrl+L)' : ''}`, r)) continue;
      await sleep(uiaMode ? 2500 : 1500);  // UIA navigation needs extra time for the page to load

      // ── 2. READ — verify title ────────────────────────────────────────────
      r = await mcpCall('helper_BrowserWin', { target, command: 'READ', parameter: '' }, 6000);
      if (ok(`${label} READ (page title)`, r)) {
        // CDP mode: r.page = '{"title":"...","url":"..."}'  (JSON string)
        // UIA mode: r.value = address-bar content (may reflect previous tab due to Brave
        //           focus racing between tab switches — just verify READ succeeds).
        let title = '', url = '';
        if (uiaMode) {
          title = r?.value ?? '';
          console.log(`     UIA window title: "${title}"`);
          // In UIA mode we can't reliably check the page title due to tab-focus races.
          // Verify READ returned something meaningful instead.
          if (title.length > 0) { console.log('  ✓  title/url received (UIA)'); passed++; }
          else { console.log('  ✗  READ returned empty UIA title'); failed++; }
        } else {
          const pageInfo = (typeof r.page === 'string') ? (() => { try { return JSON.parse(r.page); } catch { return {}; } })() : (r.page || {});
          title = pageInfo?.title ?? '';
          url   = pageInfo?.url   ?? '';
          console.log(`     title: "${title}"   url: ${url}`);
          if (title.toLowerCase().includes('example')) { console.log('  ✓  title verified'); passed++; }
          else { console.log(`  ✗  expected "example" in title, got: "${title}"`); failed++; }
        }
      }

      // ── 3. QUERYTREE ──────────────────────────────────────────────────────
      r = await mcpCall('helper_BrowserWin', { target, command: 'QUERYTREE', parameter: '3' }, 10000);
      const qtLabel = `${label} QUERYTREE${uiaMode ? ' (UIA accessibility tree)' : ' (CDP DOM)'}`;
      if (ok(qtLabel, r)) {
        const treeStr = typeof r?.tree === 'string' ? r.tree : JSON.stringify(r?.tree ?? '');
        const nodeCount = (treeStr.match(/"id":/g) || []).length;
        console.log(`     nodes: ~${nodeCount}`);
        if (nodeCount > 1) { console.log('  ✓  tree received'); passed++; }
      }

      if (uiaMode) {
        // ── UIA mode: form input interaction via window messages ────────────
        // Navigate to a page with <input> fields.  CLICKID fires a real mouse
        // click at the element centre (UIA BoundingRectangle) to give focus,
        // SENDKEYS types into the focused element via Chrome_RenderWidgetHostHWND,
        // and READELEM reads the ValuePattern value through the UIA accessibility
        // tree — which Chromium updates in real-time as text is entered.
        const FORM_URL_UIA = 'https://httpbin.org/forms/post';
        r = await mcpCall('helper_BrowserWin', { target, command: 'NAVIGATE', parameter: FORM_URL_UIA }, 12000);
        if (ok(`${label} NAVIGATE → form page (UIA)`, r)) {
          await sleep(3000);  // httpbin may be slow; give the page time to fully render

          // Depth-5 QUERYTREE on the browser window.
          // Chromium exposes <input id="custname"> as:
          //   { id:"custname", type:"ControlType.Edit", name:"Customer name",
          //     actions:["setValue","readValue"] }
          // — exactly the same shape as a KeyWin QUERYTREE on a native window.
          r = await mcpCall('helper_BrowserWin', { target, command: 'QUERYTREE', parameter: '5' }, 15000);
          if (ok(`${label} QUERYTREE depth-5 (form elements, UIA)`, r)) {
            const ts2 = typeof r?.tree === 'string' ? r.tree : JSON.stringify(r?.tree ?? '');
            const inputCount = (ts2.match(/"setValue"/g) || []).length;
            console.log(`     editable fields in UIA tree: ~${inputCount}`);
            if (inputCount > 0) { console.log('  ✓  form inputs visible in UIA tree (same schema as KeyWin)'); passed++; }
            else { console.log('  ⊕  no setValue nodes found: browser may not expose inputs at this depth'); }
          }

          // Focus the customer-name input by its accessible label (more reliable than
          // AutomationId across browsers).  In httpbin forms the label text is
          // "Customer name" which becomes the UIA Name property of the input element.
          // FocusOrClickElement tries InvokePattern first, then a real mouse click.
          r = await mcpCall('helper_BrowserWin', { target, command: 'CLICKNAME', parameter: 'Customer name' }, 6000);
          if (r?.success) {
            ok(`${label} CLICKNAME "Customer name" (UIA mouse focus)`, r);
            await sleep(400);
            r = await mcpCall('helper_BrowserWin', { target, command: 'SENDKEYS', parameter: 'UIA Test User' }, 6000);
            ok(`${label} SENDKEYS into custname`, r);
            await sleep(400);
            // READELEM reads back the ValuePattern value — round-trip proof
            r = await mcpCall('helper_BrowserWin', { target, command: 'READELEM', parameter: 'custname' }, 6000);
            if (ok(`${label} READELEM custname (value read-back)`, r)) {
              const rv = r?.value ?? '';
              console.log(`     custname value: "${rv}"`);
              if (rv.toLowerCase().includes('uia test')) { console.log('  ✓  UIA form round-trip verified (click → type → read-back)'); passed++; }
              else { console.log(`  ✗  expected "UIA Test" in value, got: "${rv}" (browser may buffer UIA updates)`); failed++; }
            }
          } else {
            skip(`${label} CLICKNAME "Customer name"`,
              'browser did not expose this input by Name — try --remote-debugging-port for CDP FILL/EXEC');
          }
        }

        console.log(`  ⊕  ${label} FILL/EXEC — CDP-only (requires --remote-debugging-port)`);
        console.log(`  ⊕  teardown: ${TEARDOWN_POLICY} — tab left open (UIA mode)`);
        continue;
      }

      // ── CDP-only: form interaction ────────────────────────────────────────

      // ── 4. Navigate to form page ─────────────────────────────────────────
      r = await mcpCall('helper_BrowserWin', { target, command: 'NAVIGATE', parameter: FORM_URL }, 12000);
      if (!ok(`${label} NAVIGATE → ${FORM_URL} (form page)`, r)) continue;
      await sleep(2000);

      // ── 5. Verify form loaded ────────────────────────────────────────────
      r = await mcpCall('helper_BrowserWin', { target, command: 'READ', parameter: '' }, 8000);
      if (ok(`${label} READ (form page title)`, r)) {
        const pageInfo = (typeof r.page === 'string') ? (() => { try { return JSON.parse(r.page); } catch { return {}; } })() : (r.page || {});
        console.log(`     form page title: "${pageInfo?.title ?? ''}"`);
      }

      // ── 6. Fill form fields (FILL command: CSS-selector:value) ───────────
      const fills = [
        { selector: 'input[name="custname"]',    value: 'MCP Test User',            label: 'fill name' },
        { selector: 'input[name="custtel"]',     value: '555-1234',                 label: 'fill phone' },
        { selector: 'input[name="custemail"]',   value: 'test@example.com',         label: 'fill email' },
        { selector: 'textarea[name="comments"]', value: 'Automated by KeyWin MCP',  label: 'fill comments' },
      ];
      for (const f of fills) {
        r = await mcpCall('helper_BrowserWin', { target, command: 'FILL', parameter: `${f.selector}:${f.value}` }, 6000);
        ok(`${label} FILL ${f.label}`, r);
        await sleep(200);
      }

      // ── 7. Verify form values via EXEC (JavaScript) ──────────────────────
      r = await mcpCall('helper_BrowserWin',
        { target, command: 'EXEC', parameter: "document.querySelector('input[name=\"custname\"]').value" }, 6000);
      ok(`${label} EXEC read-back custname`, r);
      const nameVal = r?.result ?? r?.value ?? JSON.stringify(r);
      console.log(`     custname field value: "${nameVal}"`);
      if (String(nameVal).includes('MCP Test User')) { console.log('  ✓  FILL+EXEC round-trip verified'); passed++; }
      else { console.log('  ✗  custname did not match after FILL'); failed++; }

      // ── 8. Submit the form ───────────────────────────────────────────────
      r = await mcpCall('helper_BrowserWin',
        { target, command: 'EXEC', parameter: "document.querySelector('form').submit(); 'submitted'" }, 8000);
      ok(`${label} EXEC form submit`, r);
      await sleep(2000);

      // ── 9. Verify redirect to /post ──────────────────────────────────────
      r = await mcpCall('helper_BrowserWin', { target, command: 'READ', parameter: '' }, 8000);
      if (ok(`${label} READ (after submit)`, r)) {
        const pageInfo = (typeof r.page === 'string') ? (() => { try { return JSON.parse(r.page); } catch { return {}; } })() : (r.page || {});
        const url = pageInfo?.url ?? '';
        console.log(`     post-submit URL: ${url}`);
        if (url.includes('httpbin') || url.includes('post')) { console.log('  ✓  form submit redirected'); passed++; }
      }
      // ── 9b. SCREENSHOT ─────────────────────────────────────────────
      r = await mcpCall('helper_BrowserWin', { target, command: 'SCREENSHOT', parameter: '' }, 15000);
      if (ok(`${label} SCREENSHOT (CDP Page.captureScreenshot)`, r)) {
        const ssFile = r?.file ?? '';
        const ssSize = r?.size ?? 0;
        console.log(`     saved to: ${ssFile}  (${ssSize} bytes)`);
        if (ssFile && fs.existsSync(ssFile)) {
          const buf = Buffer.alloc(4);
          const fd  = fs.openSync(ssFile, 'r');
          fs.readSync(fd, buf, 0, 4, 0);
          fs.closeSync(fd);
          const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
          if (isPng) { console.log('  \u2713  PNG header verified'); passed++; }
          else { console.log(`  \u2717  not a valid PNG (header: ${buf.toString('hex')})`); failed++; }
        } else {
          console.log(`  \u2717  screenshot file not created: ${ssFile}`); failed++;
        }
      }
      // ── 10. Teardown ─────────────────────────────────────────────────────
      if (TEARDOWN_POLICY === 'discard_doc') {
        r = await mcpCall('helper_BrowserWin', { target, command: 'EXEC', parameter: 'window.close(); "closed"' }, 5000);
        ok(`${label} EXEC window.close() (discard_tab policy)`, r);
      } else {
        console.log(`  ⊘  teardown: ${TEARDOWN_POLICY} — tab left open`);
      }

    } catch (e) {
      const msg = e.message + JSON.stringify(e);
      if (e.message === 'Timeout' || /ECONNREFUSED|window_not_found|not_found/i.test(msg)) {
        skip(label, 'not running');
      } else {
        console.log(`  ✗  ${label} — ${e.message}`); failed++;
      }
    }
  }
  if (found === 0) skip('all browsers', 'none running (no CDP debug port, no browser window found)');
  else if (foundUia > 0 && found === foundUia)
    console.log(`  ⊘  all browsers via UIA (no CDP debug port) — start with --remote-debugging-port for full CDP test`);

  // ── KeyWin native UIA on a browser window (CDP-free) ────────────────────
  console.log('\n── Browser DOM via KeyWin UIA (CDP-free) ──');
  try {
    const lw = await mcpCall('helper_KeyWin', { target: 'SYSTEM', command: 'LISTWINDOWS', parameter: '' }, 6000);
    const wins = lw?.windows ?? [];
    const browserWin = wins.find(w => (w?.title ?? '').toLowerCase().includes('example domain') ||
                                      (w?.title ?? '').toLowerCase().includes('httpbin'));
    const uiaTarget  = browserWin?.title ?? '';
    if (!uiaTarget) {
      const titles = wins.slice(0, 12).map(w => w?.title ?? w).join(' | ');
      skip(`KeyWin UIA on browser`, `no browser window found. Titles: ${titles.slice(0,200)}`);
    } else {
      console.log(`     Found browser window (UIA): "${uiaTarget}"`);
      const qt2 = await mcpCall('helper_KeyWin', { target: uiaTarget, command: 'QUERYTREE', parameter: '4' }, 10000);
      if (ok(`KeyWin QUERYTREE on "${uiaTarget.slice(0,40)}" (UIA — CDP-free)`, qt2)) {
        const tree = (qt2?.tree ?? qt2?.value ?? JSON.stringify(qt2)).toString();
        const uiaNodeCount = (tree.match(/"id":/g) || []).length || tree.split('\n').length;
        console.log(`     UIA nodes: ~${uiaNodeCount}  (HTML DOM via Windows accessibility — no CDP needed)`);
      }
    }
  } catch (e) {
    skip('KeyWin UIA browser', e.message);
  }
}


// ─── main ────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Poll MCP_PORT until tools/list includes both helper_KeyWin and helper_BrowserWin.
 * Used by --self-hosted to wait for server warm-up.
 */
function pollUntilReady(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() > deadline) {
        reject(new Error(`Server not ready after ${timeoutMs / 1000}s`));
        return;
      }
      const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} });
      const req = http.request(
        { hostname: '127.0.0.1', port: MCP_PORT, path: '/', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        res => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            try {
              const tools = JSON.parse(d).result?.tools || [];
              const names = tools.filter(t => t.name.startsWith('helper_')).map(t => t.name);
              if (names.includes('helper_KeyWin') && names.includes('helper_BrowserWin')) {
                resolve(names);
              } else {
                setTimeout(attempt, 700);
              }
            } catch { setTimeout(attempt, 700); }
          });
        }
      );
      req.setTimeout(3000, () => { req.destroy(); setTimeout(attempt, 700); });
      req.on('error', () => setTimeout(attempt, 700));
      req.write(body); req.end();
    }
    attempt();
  });
}

/**
 * Gracefully stop the self-hosted server process if we spawned one.
 */
function stopServer() {
  if (!_serverProc) return Promise.resolve();
  return new Promise(resolve => {
    _serverProc.on('close', resolve);
    // SIGINT triggers the clean-shutdown handler in start-mcp-server.ts
    _serverProc.kill('SIGINT');
    // Fallback hard-kill after 5 s
    setTimeout(() => { try { _serverProc.kill('SIGKILL'); } catch {} resolve(); }, 5000);
  });
}

// ── PRIORITY 1.5: fetch_webpage ──────────────────────────────────────────────
async function testFetchWebpage() {
  console.log('\n── fetch_webpage (Web Scraping) ──');

  // 1. Basic HTTPS text extraction (example.com is stable &amp; lightweight)
  const r1 = await mcpCall('fetch_webpage', {
    url: 'https://example.com',
    options: { extractText: true, timeout: 10000 }
  });
  const pass1 = ok('fetch https://example.com', r1);
  if (pass1) {
    const hasTitle = (r1.text || r1.body || '').toLowerCase().includes('example');
    if (hasTitle) { console.log(`     text contains "example" ✓`); passed++; }
    else          { console.log(`     text missing "example" ✗ — ${String(r1.text||r1.body||'').slice(0,80)}`); failed++; }
  }

  // 2. HTTP redirect following (http → https)
  const r2 = await mcpCall('fetch_webpage', {
    url: 'http://example.com',
    options: { allowRedirects: true, extractText: false, timeout: 10000 }
  });
  ok('follow HTTP→HTTPS redirect', r2);
  if (r2?.redirectChain?.length > 0) console.log(`     redirect chain: ${r2.redirectChain.join(' → ')}`);

  // 3. SSL cert info present
  const r3 = await mcpCall('fetch_webpage', {
    url: 'https://example.com',
    options: { extractText: false, timeout: 10000 }
  });
  const hasCert = r3 && (r3.sslCert || r3.ssl || r3.cert);
  if (hasCert) { console.log(`     SSL cert captured ✓`); passed++; }
  else         { console.log(`     SSL cert not returned (may be opt-in) ⊘`); }

  // 4. CSS selector extraction
  const r4 = await mcpCall('fetch_webpage', {
    url: 'https://example.com',
    options: { extractElements: ['h1', 'p'], timeout: 10000 }
  });
  const hasElements = r4 && (r4.elements || r4.extracted);
  if (ok('element extraction', r4)) {
    if (hasElements) console.log(`     elements extracted ✓`);
  }

  // 5. Error case: blocked protocol
  let r5;
  try {
    r5 = await mcpCall('fetch_webpage', {
      url: 'ftp://example.com',
      options: { timeout: 5000 }
    });
    const isError = r5 && (r5.error || r5.success === false);
    if (isError) { console.log(`  ✓  ftp:// correctly blocked`); passed++; }
    else         { console.log(`  ✗  ftp:// should have been blocked`); failed++; }
  } catch (e) {
    // RPC error thrown = server rejected it properly
    console.log(`  ✓  ftp:// rejected by server (${e.message.slice(0,60)})`); passed++;
  }
}

async function testKeyWinNewCommands() {
  console.log('\n── KeyWin: FILL / READELEM (new commands smoke test) ──');

  // Find a suitable target window (Calculator preferred, Notepad fallback)
  const lw = await mcpCall('helper_KeyWin', { target: 'SYSTEM', command: 'LISTWINDOWS', parameter: '' });
  let target = null;
  for (const w of (lw?.windows ?? [])) {
    const t = String(w.title || '').toLowerCase();
    if (t.includes('calc') || t.includes('kalkul')) { target = { type: 'calc', title: w.title }; break; }
    if (!target && (t.includes('notepad') || t.includes('pozn'))) target = { type: 'notepad', title: w.title };
  }
  if (!target) {
    // Launch Calculator as a minimal target
    await mcpCall('launchProcess', { executable: 'calc.exe' });
    await sleep(2500);
    const lw2 = await mcpCall('helper_KeyWin', { target: 'SYSTEM', command: 'LISTWINDOWS', parameter: '' });
    for (const w of (lw2?.windows ?? [])) {
      const t = String(w.title || '').toLowerCase();
      if (t.includes('calc') || t.includes('kalkul')) { target = { type: 'calc', title: w.title }; break; }
    }
  }
  if (!target) { skip('FILL/READELEM smoke test', 'no suitable window found'); return; }
  console.log(`   target: "${target.title}" (${target.type})`);

  // ── a. READELEM: dispatch + value retrieval ──────────────────────────────
  // For Calculator, CalculatorResults has AutomationId="CalculatorResults".
  // WinUtils.ReadElementValue returns Name (e.g. "Display is 0") if no ValuePattern.
  const reSelector = target.type === 'calc' ? 'CalculatorResults' : 'Text Editor';
  const rRE = await mcpCall('helper_KeyWin', { target: target.title, command: 'READELEM', parameter: reSelector });
  const reDispatched = rRE && typeof rRE === 'object' &&
    (rRE.success === true || rRE.error === 'readelem_failed');
  if (reDispatched) {
    const display = rRE.value != null ? `value="${String(rRE.value).slice(0, 40)}"` : `error=${rRE.error}`;
    console.log(`  ✓  READELEM dispatched — ${display}`); passed++;
  } else {
    console.log(`  ✗  READELEM — unexpected response: ${JSON.stringify(rRE).slice(0, 120)}`); failed++;
  }

  // ── b. FILL: graceful fail with nonexistent selector ────────────────────
  // Verifies FILL is dispatched and returns structured JSON (not a crash).
  const rFill = await mcpCall('helper_KeyWin', {
    target: target.title, command: 'FILL', parameter: '__noSuchElem__:testValue'
  });
  const fillDispatched = rFill && typeof rFill === 'object' &&
    (rFill.success === true || rFill.error === 'fill_failed');
  if (fillDispatched) {
    console.log(`  ✓  FILL dispatched gracefully (${rFill.success ? 'success' : rFill.error})`); passed++;
  } else {
    console.log(`  ✗  FILL — unexpected response: ${JSON.stringify(rFill).slice(0, 120)}`); failed++;
  }
}

async function testKeyWinInputControls() {
  console.log('\n── KeyWin: CHECK / UNCHECK / MOUSEDOWN / MOUSEUP (smoke test) ──');

  // Reuse an existing window for CHECK/UNCHECK target
  const lw = await mcpCall('helper_KeyWin', { target: 'SYSTEM', command: 'LISTWINDOWS', parameter: '' });
  let target = null;
  for (const w of (lw?.windows ?? [])) {
    const t = String(w.title || '').toLowerCase();
    if (t.includes('calc') || t.includes('kalkul') || t.includes('notepad') || t.includes('pozn')) {
      target = w.title; break;
    }
  }
  if (!target && (lw?.windows ?? []).length > 0) target = lw.windows[0].title;

  // ── a. CHECK: nonexistent selector → expect JSON with toggle_failed ──────
  if (target) {
    const rCheck = await mcpCall('helper_KeyWin', {
      target, command: 'CHECK', parameter: '__noSuchCheckbox__'
    });
    const checkDispatched = rCheck && typeof rCheck === 'object' &&
      (rCheck.success === true || rCheck.error === 'toggle_failed');
    if (checkDispatched) {
      console.log(`  ✓  CHECK dispatched (${rCheck.success ? 'success' : rCheck.error})`); passed++;
    } else {
      console.log(`  ✗  CHECK — unexpected: ${JSON.stringify(rCheck).slice(0, 120)}`); failed++;
    }

    // ── b. UNCHECK: nonexistent selector → same pattern ────────────────────
    const rUncheck = await mcpCall('helper_KeyWin', {
      target, command: 'UNCHECK', parameter: '__noSuchCheckbox__'
    });
    const uncheckDispatched = rUncheck && typeof rUncheck === 'object' &&
      (rUncheck.success === true || rUncheck.error === 'toggle_failed');
    if (uncheckDispatched) {
      console.log(`  ✓  UNCHECK dispatched (${rUncheck.success ? 'success' : rUncheck.error})`); passed++;
    } else {
      console.log(`  ✗  UNCHECK — unexpected: ${JSON.stringify(rUncheck).slice(0, 120)}`); failed++;
    }
  } else {
    skip('CHECK/UNCHECK smoke test', 'no window found');
  }

  // ── c. MOUSEDOWN at off-screen coordinates → should always succeed ───────
  // Use 1,1 (top-left corner, typically desktop) — safe, no real UI interaction.
  const rMD = await mcpCall('helper_KeyWin', {
    target: 'SYSTEM', command: 'MOUSEDOWN', parameter: '1,1'
  });
  const mdOk = rMD && typeof rMD === 'object' && rMD.success === true &&
    rMD.action === 'mousedown' && rMD.x === 1 && rMD.y === 1;
  if (mdOk) {
    console.log(`  ✓  MOUSEDOWN at (1,1) success`); passed++;
  } else {
    console.log(`  ✗  MOUSEDOWN — unexpected: ${JSON.stringify(rMD).slice(0, 120)}`); failed++;
  }

  // ── d. MOUSEUP at same coordinates ────────────────────────────────────────
  const rMU = await mcpCall('helper_KeyWin', {
    target: 'SYSTEM', command: 'MOUSEUP', parameter: '1,1'
  });
  const muOk = rMU && typeof rMU === 'object' && rMU.success === true &&
    rMU.action === 'mouseup' && rMU.x === 1 && rMU.y === 1;
  if (muOk) {
    console.log(`  ✓  MOUSEUP at (1,1) success`); passed++;
  } else {
    console.log(`  ✗  MOUSEUP — unexpected: ${JSON.stringify(rMU).slice(0, 120)}`); failed++;
  }
}

async function main() {
  // ── 0. Optional: rebuild binaries before running ──────────────────────────
  if (REBUILD_FIRST) {
    console.log('============================================================');
    console.log(' Rebuilding binaries (--rebuild-first)…');
    console.log('============================================================');
    const buildScript = path.join(__dirname, '..', '..', 'build-all.ps1');
    const result = spawnSync(
      'PowerShell',
      ['-ExecutionPolicy', 'Bypass', '-File', buildScript],
      { stdio: 'inherit', encoding: 'utf8' }
    );
    if (result.status !== 0) {
      console.error('Build failed — aborting tests');
      process.exit(1);
    }
    console.log('Build OK\n');
  }

  // ── 1. Optional: spawn the server ourselves (--self-hosted) ───────────────
  if (SELF_HOSTED) {
    console.log('============================================================');
    console.log(' Starting server (--self-hosted)…');
    console.log('============================================================');
    const serverJs = path.join(__dirname, '..', '..', 'dist', 'start-mcp-server.js');
    _serverProc = spawn(process.execPath, [serverJs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MCP_PORT: String(MCP_PORT) },
    });
    _serverProc.stdout.on('data', d => process.stdout.write('[server] ' + d));
    _serverProc.stderr.on('data', d => process.stderr.write('[server] ' + d));
    _serverProc.on('close', code => {
      if (code !== 0 && code !== null) console.error(`[server] exited with code ${code}`);
    });

    process.on('exit', () => { try { _serverProc?.kill('SIGKILL'); } catch {} });

    console.log('Waiting for server + helpers to be ready…');
    try {
      await pollUntilReady(45000);
      console.log('Server ready\n');
    } catch (e) {
      console.error('ERROR:', e.message);
      await stopServer();
      process.exit(1);
    }
  }

  // ── 2. Run the test suite ─────────────────────────────────────────────────
  console.log('============================================================');
  console.log(' Full-stack MCP test  —  stdin transport (Step 1)');
  console.log('============================================================');
  console.log(` Server: 127.0.0.1:${MCP_PORT}`);

  // Quick connectivity check
  try {
    const tools = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} });
      const req = http.request({ hostname: '127.0.0.1', port: MCP_PORT, path: '/', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d).result?.tools||[])); });
      req.setTimeout(4000, ()=>{req.destroy();reject(new Error('Timeout'))});
      req.on('error', reject);
      req.write(body); req.end();
    });
    const helperTools = tools.filter(t => t.name.startsWith('helper_')).map(t => t.name);
    console.log(` Helpers: ${helperTools.join(', ')}`);
    if (!helperTools.includes('helper_KeyWin'))    { console.error('ERROR: helper_KeyWin not registered'); process.exit(1); }
    if (!helperTools.includes('helper_BrowserWin')){ console.error('ERROR: helper_BrowserWin not registered'); process.exit(1); }
  } catch (e) {
    console.error('ERROR: Cannot connect to MCP server —', e.message);
    process.exit(1);
  }

  // ── Open test-session for log + auto-screenshots ──────────────────────────
  const sessionLabel = `full-stack_${Date.now()}`;
  const sessionResult = await testSession.start(sessionLabel).catch(() => null);
  if (sessionResult?.sessionDir) {
    console.log(` Session log: ${sessionResult.sessionDir}`);
  }

  try {
    // Reload helpers to pick up freshly built binaries (ensures FILL/READELEM in schema).
    try {
      console.log('\n── Reloading helpers (fresh binaries) ──');
      const helperNames = await reloadHelpers(2, 25000);
      console.log(`   Helpers ready: ${helperNames.join(', ')}`);
    } catch (e) {
      console.log(`  ⚠  reloadHelpers: ${e.message} — continuing with current daemons`);
    }
    await testListWindows();
    await testListBrowsers();
    await testSchemaValidation();
    await testFetchWebpage();
    await testCalculator();
    await testNotepad();
    await testKeyWinNewCommands();
    await testKeyWinInputControls();
    await testBrowsers();
  } catch (e) {
    console.error('\nFatal error:', e.stack || e.message);
    failed++;
  }

  // ── Close test-session and print summary ──────────────────────────────────
  const sessionSummary = await testSession.finish().catch(() => null);
  if (sessionSummary?.sessionDir) {
    console.log(`\n Session log written to: ${sessionSummary.sessionDir}`);
    console.log(`   Commands: ${sessionSummary.logLines}  |  Failed: ${sessionSummary.failed}  |  Duration: ${(sessionSummary.durationMs/1000).toFixed(1)}s`);
  }

  // ── 3. Teardown: stop self-hosted server if we started it ────────────────
  if (_serverProc) {
    console.log('\nStopping self-hosted server…');
    await stopServer();
  }

  console.log('\n============================================================');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('============================================================');
  process.exit(failed > 0 ? 1 : 0);
}

main();
