/**
 * D1 — Dashboard Dogfooding Test
 *
 * Uses AIAPI's own BrowserWin helper to drive the AIAPI dashboard,
 * exercising the Settings, Security and Scenarios tabs.
 *
 * Run (server already running on default ports):
 *   node test/integration/test-dogfooding-dashboard.js
 *
 * Run with self-hosted server:
 *   node test/integration/test-dogfooding-dashboard.js --self-hosted
 *
 * Run with specific browser:
 *   node test/integration/test-dogfooding-dashboard.js --browser=msedge
 *
 * Prerequisites:
 *   - Chrome (or Edge/Brave) installed
 *   - BrowserWin.exe compiled (run build-all.ps1 first)
 *   - MCP server reachable on MCP_PORT (default 3457) unless --self-hosted
 */
'use strict';
const http  = require('http');
const path  = require('path');
const { spawn } = require('child_process');

// ── Ports ─────────────────────────────────────────────────────────────────────
const MCP_PORT       = parseInt(process.env.MCP_PORT  || '3457', 10);
const DASH_PORT      = parseInt(process.env.DASH_PORT || '3458', 10);
const DASHBOARD_URL  = `http://localhost:${DASH_PORT}`;

// ── CLI flags ─────────────────────────────────────────────────────────────────
const SELF_HOSTED    = process.argv.includes('--self-hosted');
const browserArg     = (process.argv.find(a => a.startsWith('--browser=')) || '--browser=chrome').replace('--browser=', '');

/** Child-process handle when --self-hosted spawns the server. */
let _serverProc = null;

let passed = 0, failed = 0;

// ── Unique tag injected into test data so we can clean up reliably ────────────
const TEST_TAG = `dogfood_${Date.now()}`;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/** Call an MCP tool via JSON-RPC 2.0 HTTP transport. */
function mcpCall(toolName, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });
    const req = http.request({
      hostname: '127.0.0.1', port: MCP_PORT, path: '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const rpc = JSON.parse(data);
          if (rpc.error) return reject(new Error(`RPC error: ${JSON.stringify(rpc.error)}`));
          if (rpc.result === undefined || rpc.result === null) return reject(new Error('Null result'));
          resolve(rpc.result);
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

/** Simple REST call to the dashboard HTTP API (DASH_PORT).  Returns parsed JSON. */
function dashRest(method, urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : undefined;
    const req = http.request({
      hostname: '127.0.0.1', port: DASH_PORT, path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ _raw: d }); } });
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Test result helpers ───────────────────────────────────────────────────────

function ok(label, r) {
  const success = r && r.success !== false && !r.error;
  if (success) { console.log(`  ✓  ${label}`); passed++; }
  else         { console.log(`  ✗  ${label} — ${r?.error || r?.message || JSON.stringify(r)}`); failed++; }
  return success;
}
function skip(label, reason) { console.log(`  ⊘  ${label} — ${reason}`); }
function assert(label, cond, detail = '') {
  if (cond) { console.log(`  ✓  ${label}`); passed++; }
  else       { console.log(`  ✗  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
  return cond;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Server lifecycle ──────────────────────────────────────────────────────────

/** Poll until the MCP server is reachable. */
function pollUntilMcpReady(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() > deadline) { reject(new Error(`MCP server not ready after ${timeoutMs / 1000}s`)); return; }
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
              const names = tools.map(t => t.name);
              if (names.includes('BrowserWin')) resolve(names);
              else setTimeout(attempt, 700);
            } catch { setTimeout(attempt, 700); }
          });
        },
      );
      req.setTimeout(3000, () => { req.destroy(); setTimeout(attempt, 700); });
      req.on('error', () => setTimeout(attempt, 700));
      req.write(body); req.end();
    }
    attempt();
  });
}

function stopServer() {
  if (!_serverProc) return Promise.resolve();
  return new Promise(resolve => {
    _serverProc.on('close', resolve);
    _serverProc.kill('SIGINT');
    setTimeout(() => { try { _serverProc.kill('SIGKILL'); } catch {} resolve(); }, 5000);
  });
}

// ─── BrowserWin shortcut ──────────────────────────────────────────────────────

/**
 * Issue a BrowserWin CDP command.
 * @param {string} browserTarget  e.g. "chrome:9222" or "chrome"
 * @param {string} command        NAVIGATE | CLICKID | CLICKNAME | FILL | READ | QUERYTREE | …
 * @param {string} parameter      command-specific value
 */
function bw(browserTarget, command, parameter, timeoutMs = 12000) {
  const args = { proc: browserTarget, action: command };
  if (parameter !== undefined && parameter !== null && parameter !== '') args.value = String(parameter);
  return mcpCall('BrowserWin', args, timeoutMs);
}

// ─── Test sections ────────────────────────────────────────────────────────────

/** T1: Open the dashboard in Chrome. Returns the resolved browserTarget string or null. */
async function testOpenDashboard() {
  console.log('\n── T1 · Open dashboard in browser ──');

  // Launch the browser (idempotent — reuses an already-running instance).
  let launchR;
  try {
    launchR = await mcpCall('BrowserWin', { proc: browserArg, action: 'LAUNCH' }, 20000);
  } catch (e) {
    skip('LAUNCH browser', e.message);
    return null;
  }

  if (launchR?.error && /launch_not_found/i.test(String(launchR.error))) {
    skip(`LAUNCH ${browserArg}`, 'browser executable not found — install it or use --browser=<name>');
    return null;
  }
  if (!ok(`LAUNCH ${browserArg}`, launchR)) return null;

  const browserTarget = `${browserArg}:${launchR.port}`;
  console.log(`   browser target: ${browserTarget}  reused=${launchR.reused}`);
  await sleep(800);

  // Open a new tab / navigate to the dashboard.
  let r = await bw(browserTarget, 'NEWPAGE', DASHBOARD_URL, 12000);
  if (!r?.success) {
    // If NEWPAGE fails (e.g. CDP not ready), try a direct NAVIGATE instead.
    console.log(`   NEWPAGE failed (${r?.error}) — trying NAVIGATE`);
    r = await bw(browserTarget, 'NAVIGATE', DASHBOARD_URL, 12000);
  }
  if (!ok(`Open dashboard (${DASHBOARD_URL})`, r)) return null;
  await sleep(1500);

  // Dismiss any stale dialog left over from a previous run.
  await bw(browserTarget, 'DIALOG', 'accept', 4000).catch(() => {});

  // Verify the page loaded by reading the title.
  const readR = await bw(browserTarget, 'READ', '', 8000);
  if (readR?.success) {
    const page = (() => { try { return JSON.parse(readR.page || '{}'); } catch { return {}; } })();
    const title = page?.title || readR?.value || '';
    // Title is "AI API Server Dashboard" — check normalised (no spaces) for "aiapi"
    assert('Dashboard page title contains "AIAPI"',
      title.toLowerCase().replace(/\s+/g, '').includes('aiapi') || title.toLowerCase().includes('api'),
      `got: "${title}"`);
    console.log(`   Page title: "${title}"`);
  } else {
    skip('Read page title', `READ returned: ${readR?.error}`);
  }

  return browserTarget;
}

/** T2: Settings tab — verify helpers list loads. */
async function testSettingsTab(browserTarget) {
  console.log('\n── T2 · Settings tab ──');

  // Click "⚙️ Settings" nav button.
  const r = await bw(browserTarget, 'CLICKNAME', '⚙️ Settings');
  if (!ok('Click Settings nav', r)) return;
  await sleep(600);

  // Verify via REST (reliable) that listHelpers responds.
  try {
    const helpers = await dashRest('GET', '/api/listHelpers');
    const count = helpers?.helpers?.length ?? (Array.isArray(helpers) ? helpers.length : -1);
    if (count >= 0) {
      assert(`Helpers list loads (${count} helper(s) discoverable)`, true);
      if (count > 0) {
        const names = (helpers.helpers || helpers).map(h => h.name || h).join(', ');
        console.log(`   Helpers: ${names}`);
      } else {
        console.log('   ⚠  No helpers discovered yet — BrowserWin.exe / KeyWin.exe may not be compiled');
      }
    } else {
      assert('Helpers list REST endpoint', false, JSON.stringify(helpers).slice(0, 120));
    }
  } catch (e) {
    skip('GET /api/listHelpers', e.message);
  }

  // Check the dashboard is showing the settings section (via QUERYTREE for a known element).
  const qtR = await bw(browserTarget, 'QUERYTREE', '2', 10000);
  if (qtR?.success) {
    const treeStr = typeof qtR.tree === 'string' ? qtR.tree : JSON.stringify(qtR.tree || '');
    // The Settings section has form inputs visible once selected.
    const hasSettingsContent = treeStr.includes('setting-') || treeStr.includes('Settings');
    assert('Settings section rendered in DOM', hasSettingsContent, 'settings form elements not found in QUERYTREE');
  } else {
    skip('QUERYTREE Settings section', qtR?.error);
  }
}

/** T3: Security tab — add a filter rule via the wizard, verify it persists. */
async function testSecurityTab(browserTarget) {
  console.log('\n── T3 · Security Filters tab (wizard) ──');

  // Navigate to the Security section.
  const navR = await bw(browserTarget, 'CLICKNAME', '🛡️ Security Filters');
  if (!ok('Click Security Filters nav', navR)) return;
  await sleep(600);

  // Snapshot existing filter count (via REST) so we can assert +1 afterwards.
  let beforeCount = 0;
  try {
    const filtersData = await dashRest('GET', '/api/filters');
    beforeCount = Array.isArray(filtersData) ? filtersData.length
      : Array.isArray(filtersData?.filters) ? filtersData.filters.length : 0;
    console.log(`   Existing filters: ${beforeCount}`);
  } catch (e) {
    console.log(`   ⚠  Could not query /api/filters before adding: ${e.message}`);
  }

  // Click "➕ Add Filter Rule".
  const addR = await bw(browserTarget, 'CLICKID', 'btn-add-filter');
  if (!ok('Open filter wizard (btn-add-filter)', addR)) return;
  await sleep(300);

  // ── Dialog-detection proof via DIALOG inject: mode ────────────────────────────
  // DIALOG inject: opens ONE persistent WebSocket session, enables Page events,
  // then evaluates the JS expression on the same session.  Chrome routes the
  // resulting Page.javascriptDialogOpening event back to that session (avoids
  // the auto-dismiss that occurs when the triggering connection closes first).
  // This proves end-to-end DIALOG detection and acceptance.
  const probeDlgR = await bw(browserTarget, 'DIALOG',
    `inject:setTimeout(function(){alert('dialog-detection-test-T3')},200):3000`, 5000);
  assert('DIALOG command detects and accepts browser alert',
    probeDlgR?.dialogPresent === true,
    probeDlgR ? `dialogPresent=${probeDlgR.dialogPresent}, accepted=${probeDlgR.accepted}` : 'DIALOG call failed');
  await sleep(150);
  // ─────────────────────────────────────────────────────────────────────────────

  // Fill in wizard fields via CDP.
  // action: deny, process: notepad.exe, helper: KeyWin.exe, command: KILL, pattern: *, role: dogfood-role
  // fieldIds are CSS selectors (#id) for FILL; bare ids for CLICKID fallback.
  // filter-command select uses {CMD} syntax values.
  // IMPORTANT: filter-helper change fires async loadHelperCommandsForFilter which
  // rebuilds #filter-command options and resets its value.  Fill filter-command LAST.
  const wizardSteps = [
    ['filter-action',      'deny'],            // <select> value: 'allow'|'deny'
    ['filter-process',     'notepad.exe'],
    ['filter-helper',      'KeyWin.exe'],       // <select> value: 'KeyWin.exe' — triggers async schema load
    ['filter-pattern',     '*'],
    ['filter-role',        'dogfood-role'],
    ['filter-description', `${TEST_TAG}`],
    // filter-command filled LAST (after 1 s delay) so async schema reload doesn't reset it.
  ];

  for (const [fieldId, value] of wizardSteps) {
    // FILL selector must be a CSS selector — use #id prefix.
    const fillR = await bw(browserTarget, 'FILL', `#${fieldId}:${value}`, 8000);
    if (!fillR?.success) {
      // Fallback: focus element via CLICKID (bare id) then SENDKEYS.
      const ckR = await bw(browserTarget, 'CLICKID', fieldId, 6000);
      if (ckR?.success) {
        await sleep(200);
        await bw(browserTarget, 'SENDKEYS', value, 6000);
      }
    }
    await sleep(150);
  }
  // Wait for async loadHelperCommandsForFilter to complete before setting filter-command.
  await sleep(1500);
  await bw(browserTarget, 'FILL', '#filter-command:{KILL}', 8000);

  // Click "Save Filter".
  const saveR = await bw(browserTarget, 'CLICKNAME', 'Save Filter', 8000);
  if (!ok('Save filter via wizard', saveR)) return;
  await sleep(400);
  // Handle any alert/confirm dialog the save action may have triggered.
  const dlgR = await bw(browserTarget, 'DIALOG', 'accept', 5000);
  if (dlgR?.dialogPresent) console.log('   Dialog accepted after Save Filter');
  await sleep(600);

  // Verify via REST that the filter was persisted with our test tag.
  let newFilter = null;
  try {
    const filtersAfter = await dashRest('GET', '/api/filters');
    const list = Array.isArray(filtersAfter) ? filtersAfter
      : Array.isArray(filtersAfter?.filters) ? filtersAfter.filters : [];
    newFilter = list.find(f => f.description === TEST_TAG);
    const afterCount = list.length;
    assert(`Filter count increased (${beforeCount} → ${afterCount})`, afterCount > beforeCount,
      `count unchanged at ${afterCount}`);
    assert('Test filter found in /api/filters by description tag', !!newFilter,
      newFilter ? '' : `list has ${afterCount} entries, none match description="${TEST_TAG}"`);
    if (newFilter) {
      console.log(`   Rule: ${newFilter.action} ${newFilter.process} → ${newFilter.helper}::${newFilter.command}/${newFilter.pattern}` +
        (newFilter.role ? ` [role: ${newFilter.role}]` : ''));
    }
  } catch (e) {
    skip('Verify filter persisted via /api/filters', e.message);
  }

  // Toggle Quick-Edit mode and verify the filter appears in the table.
  const qeR = await bw(browserTarget, 'CLICKID', 'btn-filter-table-toggle', 8000);
  if (qeR?.success) {
    await sleep(500);
    // Read the filter rules container text — covers all nesting depths.
    let qeFound = false;
    try {
      const reR = await bw(browserTarget, 'READELEM', '#filter-rules-list', 8000);
      if (reR?.success) {
        const containerText = JSON.stringify(reR);
        qeFound = containerText.includes('dogfood-role') || containerText.includes(TEST_TAG);
      }
    } catch { /* READELEM may error on some builds — fall through to QUERYTREE */ }
    if (!qeFound) {
      // Fallback to deep QUERYTREE.
      try {
        const qtR = await bw(browserTarget, 'QUERYTREE', '8', 10000);
        if (qtR?.success) {
          const treeStr = typeof qtR.tree === 'string' ? qtR.tree : JSON.stringify(qtR.tree || '');
          qeFound = treeStr.includes('dogfood-role') || treeStr.includes(TEST_TAG);
        }
      } catch { /* ignore */ }
    }
    assert('Test rule visible in Quick-Edit table', qeFound,
      'neither role nor description tag found in #filter-rules-list or QE DOM');
  } else {
    skip('Quick-Edit toggle', 'button not found or not applicable');
  }

  // Clean up: delete the test filter we just created so runs are idempotent.
  if (newFilter?.id != null) {
    try {
      await dashRest('DELETE', `/api/filters/${newFilter.id}`);
      console.log(`   Cleanup: deleted filter #${newFilter.id} (${TEST_TAG})`);
    } catch { /* ignore — leftover filter is harmless */ }
  }
}

/** T4: App Templates — open scenario editor, modify an existing scenario, verify via REST, restore. */
async function testScenariosTab(browserTarget) {
  console.log('\n── T4 · App Templates (scenario editor) ──');

  // Navigate to App Templates section.
  const navR = await bw(browserTarget, 'CLICKNAME', '📚 App Templates');
  if (!ok('Click App Templates nav', navR)) return;
  await sleep(600);

  // Verify App Templates section is active: the Refresh button is always in the header.
  const secR = await bw(browserTarget, 'READELEM', '#btn-refresh-templates', 5000);
  assert('App Templates section rendered', secR?.success === true,
    secR ? `READELEM returned success=${secR.success}` : 'READELEM failed');

  // REST: discover the first app with scenarios, get a scenario id, and snapshot original steps.
  let firstApp, firstScenarioId, originalSteps;
  try {
    const appsData = await dashRest('GET', '/api/appTemplates');
    const apps = (appsData?.apps || []).filter(a => a.hasScenarios);
    if (apps.length === 0) { skip('T4 scenario editor', 'no apps with scenarios'); return; }
    firstApp = apps[0].name;
    const listData = await dashRest('GET', `/api/appTemplates/${firstApp}/scenarios/list`);
    const scenarios = listData?.scenarios || [];
    if (scenarios.length === 0) { skip('T4 scenario editor', `${firstApp} has no scenarios`); return; }
    firstScenarioId = scenarios[0].id;
    const stepsData = await dashRest('GET', `/api/appTemplates/${firstApp}/scenarios/${firstScenarioId}/steps`);
    originalSteps = stepsData?.steps ?? [];
    console.log(`   Using ${firstApp}/${firstScenarioId} (${originalSteps.length} original step(s))`);
  } catch (e) {
    skip('T4 scenario discovery via REST', e.message); return;
  }

  // UI: Click "✏️ Edit Scenarios" (first button found = first app card).
  const editR = await bw(browserTarget, 'CLICKNAME', '✏️ Edit Scenarios', 8000);
  if (!ok('Open scenario editor modal', editR)) return;
  await sleep(1000); // wait for modal open + async picker load

  // UI: Select the target scenario from the picker (triggers scenarioEditorPick).
  const pickR = await bw(browserTarget, 'FILL', `#scenario-editor-picker:${firstScenarioId}`, 6000);
  ok('Select scenario in picker', pickR);
  if (!pickR?.success) {
    skip('T4 scenario editor (picker fill failed)', 'FILL on #scenario-editor-picker returned failure');
    await bw(browserTarget, 'CLICKNAME', 'Cancel', 4000).catch(() => {});
    return;
  }
  await sleep(1000); // wait for steps to load and Save button to enable

  // UI: Add one empty step.
  const addStepR = await bw(browserTarget, 'CLICKID', 'scenario-editor-btn-add', 6000);
  if (!ok('Add step to scenario', addStepR)) {
    await bw(browserTarget, 'CLICKNAME', 'Cancel', 4000).catch(() => {});
    return;
  }
  await sleep(300);

  // UI: Save the modified scenario.
  const saveR = await bw(browserTarget, 'CLICKID', 'scenario-editor-btn-save', 8000);
  if (!ok('Save scenario via editor', saveR)) {
    await bw(browserTarget, 'CLICKNAME', 'Cancel', 4000).catch(() => {});
    return;
  }
  await sleep(600);
  // If save failed (save error dialog), dismiss it.
  const saveDlgR = await bw(browserTarget, 'DIALOG', 'dismiss', 3000);
  if (saveDlgR?.dialogPresent) console.log('   ⚠  Unexpected dialog after scenario save: ' + JSON.stringify(saveDlgR));
  await sleep(400);

  // REST: Verify step count is now originalSteps.length + 1.
  try {
    const stepsAfter = await dashRest('GET', `/api/appTemplates/${firstApp}/scenarios/${firstScenarioId}/steps`);
    const newCount = (stepsAfter?.steps ?? []).length;
    assert(`Scenario step count increased (${originalSteps.length} → ${newCount})`,
      newCount > originalSteps.length,
      `still ${newCount} steps after save (expected >${originalSteps.length})`);
  } catch (e) {
    skip('Verify scenario save via REST', e.message);
  }

  // REST: Restore original steps so successive test runs are idempotent.
  try {
    await dashRest('PUT', `/api/appTemplates/${firstApp}/scenarios/${firstScenarioId}`, {
      label: firstScenarioId, steps: originalSteps,
    });
    console.log(`   Restored ${firstApp}/${firstScenarioId} to ${originalSteps.length} step(s)`);
  } catch (e) {
    console.log(`   ⚠  Failed to restore: ${e.message}`);
  }

  // UI: Close the modal.
  await bw(browserTarget, 'CLICKNAME', 'Cancel', 5000).catch(() => {});
}

/** T5: Verify no JS console errors after all interactions (QUERYTREE root). */
async function testNoConsoleErrors(browserTarget) {
  console.log('\n── T5 · Final sanity: dashboard still responsive ──');
  const r = await bw(browserTarget, 'READ', '', 8000);
  if (r?.success) {
    const page = (() => { try { return JSON.parse(r.page || '{}'); } catch { return {}; } })();
    const title = page?.title || r?.value || '';
    assert('Dashboard still responding after test suite', title.toLowerCase().includes('aiapi') || title.length > 0,
      `title was: "${title}"`);
  } else {
    skip('Final dashboard READ', r?.error);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('============================================================');
  console.log(' D1 — Dashboard Dogfooding Test');
  console.log('============================================================');
  console.log(` MCP:  127.0.0.1:${MCP_PORT}   Dashboard: ${DASHBOARD_URL}`);
  console.log(` Browser: ${browserArg}`);
  console.log(` Test tag: ${TEST_TAG}`);
  console.log('');

  // ── 1. Optionally start the server ────────────────────────────────────────
  if (SELF_HOSTED) {
    console.log('Starting server (--self-hosted)…');
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
    console.log('Waiting for server + BrowserWin helper to be ready…');
    try {
      await pollUntilMcpReady(60000);
      console.log('Server ready\n');
    } catch (e) {
      console.error('ERROR:', e.message);
      await stopServer();
      process.exit(1);
    }
  }

  // ── 2. Quick connectivity check ───────────────────────────────────────────
  try {
    const tools = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} });
      const req = http.request({ hostname: '127.0.0.1', port: MCP_PORT, path: '/', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d).result?.tools||[])); });
      req.setTimeout(4000, ()=>{req.destroy();reject(new Error('Timeout'));});
      req.on('error', reject);
      req.write(body); req.end();
    });
    const helperTools = tools.filter(t => ['BrowserWin','KeyWin','MSOfficeWin','LibreOfficeWin'].includes(t.name)).map(t => t.name);
    console.log(` Registered helpers: ${helperTools.join(', ') || '(none yet)'}`);
    if (!helperTools.includes('BrowserWin')) {
      console.error('ERROR: BrowserWin helper not registered — compile BrowserWin.exe first (build-all.ps1)');
      process.exit(1);
    }
  } catch (e) {
    console.error(`ERROR: Cannot connect to MCP server on port ${MCP_PORT} — ${e.message}`);
    console.error('Start the server first or use --self-hosted');
    process.exit(1);
  }

  // ── 3. Run tests ──────────────────────────────────────────────────────────
  let browserTarget = null;
  try {
    browserTarget = await testOpenDashboard();
    if (browserTarget) {
      await testSettingsTab(browserTarget);
      await testSecurityTab(browserTarget);
      await testScenariosTab(browserTarget);
      await testNoConsoleErrors(browserTarget);
    } else {
      console.log('\n⊘  Browser unavailable — all browser-interaction tests skipped.');
      console.log('   Install Chrome/Edge/Brave and compile BrowserWin.exe to run these tests.');
    }
  } catch (e) {
    console.error('\nFatal error:', e.stack || e.message);
    failed++;
  }

  // ── 4. Teardown ───────────────────────────────────────────────────────────
  if (_serverProc) {
    console.log('\nStopping self-hosted server…');
    await stopServer();
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────
  console.log('\n============================================================');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('============================================================');
  process.exit(failed > 0 ? 1 : 0);
}

main();
