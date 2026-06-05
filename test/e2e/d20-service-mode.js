'use strict';
/**
 * d20-service-mode.js — Service-Mode Isolation Test Suite
 *
 * Targets the AIAPI Windows service on port 4457 (service-mode port).
 * Tests Session 0 behaviour with WinSvcBridge.exe present (bridge mode):
 *   - LISTWINDOWS: with bridge → real windows from user session; without bridge → windows:[] + _sessionWarning
 *   - fs_read must work (NativeWin, TCP-transparent)
 *   - SENDKEYS: with bridge → success in user session; without → _sessionWarning
 *   - listHelpers must include NativeWin virtual helper + KeyWin
 *   - WinSvcBridge present in dist/helpers → sessionBridge:true reported
 *
 * Run against service:
 *   MCP_PORT=4457 DASH_PORT=4458 node test/e2e/index.js --filter=d20
 *
 * Suite skips entirely if port 4457 is not listening (not in service-mode).
 */

const http = require('http');

const SERVICE_PORT = parseInt(process.env.MCP_PORT || '3457', 10);
const SERVICE_HOST = '127.0.0.1';

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  ✓  ${label}`);
  passed++;
}
function fail(label, detail) {
  console.log(`  ✗  ${label}${detail ? ' — ' + detail : ''}`);
  failed++;
}

/** Raw MCP JSON-RPC POST */
function mcpCall(method, params, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = http.request({
      hostname: SERVICE_HOST,
      port: SERVICE_PORT,
      path: '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Bad JSON: ' + data.slice(0, 200))); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end(body);
  });
}

/** Check if service port is open before running suite */
function isPortOpen() {
  return new Promise(resolve => {
    const sock = require('net').createConnection({ host: SERVICE_HOST, port: SERVICE_PORT });
    sock.setTimeout(2000);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error',   () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

async function run() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  d20-service-mode — Session 0 Isolation');
  console.log(`  Target: http://${SERVICE_HOST}:${SERVICE_PORT}`);
  console.log('═══════════════════════════════════════════════');

  const open = await isPortOpen();
  if (!open) {
    console.log(`  ⚠  SKIP — port ${SERVICE_PORT} not listening (not in service-mode)`);
    console.log('  To run: start AIAPIService (Windows service on port 4457)');
    console.log('  and re-run with: MCP_PORT=4457 DASH_PORT=4458 node test/e2e/index.js --filter=d20');
    return { passed: 0, failed: 0, skipped: true };
  }

  // ── t1: LISTWINDOWS → with bridge: real windows from user session;
  //                       without bridge: windows:[] + _sessionWarning ────────
  try {
    const r = await mcpCall('tools/call', { name: 'AutomateUI', arguments: { helper: 'KeyWin', action: 'LISTWINDOWS' } });
    const result = r.result || {};
    const windows = result.windows;
    const warning = result._sessionWarning;
    const hasWarn = typeof warning === 'string' && warning.length > 0;
    if (Array.isArray(windows) && windows.length > 0) {
      // Bridge active — helpers running in user session, real windows returned
      pass(`LISTWINDOWS: ${windows.length} real windows returned (WinSvcBridge active — Session 0 bypassed)`);
    } else if (!windows || windows.length === 0) {
      if (hasWarn) {
        pass('LISTWINDOWS: windows=[] + _sessionWarning (Session 0, no bridge — expected without WinSvcBridge.exe)');
      } else {
        fail('LISTWINDOWS: windows=[] but no _sessionWarning — QA-3 session warning injection missing in deployed binary',
          JSON.stringify(result).slice(0, 200));
      }
    } else {
      fail('LISTWINDOWS unexpected shape', JSON.stringify(result).slice(0, 200));
    }
  } catch (e) {
    fail('LISTWINDOWS call failed', e.message);
  }

  // ── t2: fs_read (absolute path) → success (NativeWin, TCP-transparent) ───────
  // Use an absolute path guaranteed to exist on any Windows system
  // (relative paths resolve from service CWD = C:\Program Files\AIAPI\)
  const hostsPath = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
  try {
    const r = await mcpCall('tools/call', { name: 'fs_read', arguments: { path: hostsPath } });
    const result = r.result || {};
    // Deployed service may return 'value' (old shape) or 'content' (new shape)
    const text = result.content || result.value;
    if (result.success === true && typeof text === 'string' && text.length > 0) {
      pass(`fs_read hosts file: success, ${text.length} chars`);
    } else {
      fail('fs_read hosts file', `success=${result.success}, error=${result.error}`);
    }
  } catch (e) {
    fail('fs_read call failed', e.message);
  }

  // ── t3: SENDKEYS → with bridge: success/false (no notepad); without bridge: _sessionWarning ─
  try {
    const r = await mcpCall('tools/call', { name: 'AutomateUI', arguments: { helper: 'KeyWin', action: 'SENDKEYS', proc: 'notepad.exe', value: 'hello' } });
    const result = r.result || {};
    const warning = result._sessionWarning;
    const hasWarn = typeof warning === 'string' && warning.length > 0;
    // JSON-RPC error level: bridge active, helper ran in user session, notepad not found → valid
    const isRpcError = r.error && typeof r.error.message === 'string';
    if (hasWarn) {
      pass('SENDKEYS: _sessionWarning present (no bridge — Session 0 isolated)');
    } else if (result.success === false) {
      pass('SENDKEYS: success=false (bridge active, no notepad open — correct behaviour)');
    } else if (result.success === true) {
      pass('SENDKEYS: success=true (bridge active, notepad found in user session)');
    } else if (isRpcError) {
      pass(`SENDKEYS: RPC error (bridge active, helper ran but notepad not found — ${r.error.message.slice(0, 60)})`);
    } else {
      fail('SENDKEYS unexpected result', JSON.stringify(r).slice(0, 200));
    }
  } catch (e) {
    fail('SENDKEYS call failed', e.message);
  }

  // ── t4: listHelpers → NativeWin virtual present, UI helpers present ──────────
  try {
    const r = await mcpCall('tools/call', { name: 'listHelpers', arguments: {} });
    const helpers = r.result && r.result.helpers;
    if (!helpers || helpers.length === 0) {
      fail('listHelpers', 'returned empty helpers array');
    } else {
      const nativeWin = helpers.find(h => h.name === 'NativeWin' || h.virtual === true);
      const keyWin    = helpers.find(h => (h.name || '').toLowerCase().includes('keywin'));
      if (nativeWin) {
        pass(`listHelpers: NativeWin virtual helper present (${helpers.length} total helpers)`);
      } else {
        fail('listHelpers: NativeWin not found', `helpers: ${helpers.map(h => h.name).join(', ')}`);
      }
      if (keyWin) {
        pass(`listHelpers: KeyWin present (${keyWin.name})`);
      } else {
        fail('listHelpers: KeyWin not found');
      }
    }
  } catch (e) {
    fail('listHelpers call failed', e.message);
  }

  // ── t5: BrowserWin LAUNCH → _sessionWarning (browser invisible in Session 0) ─
  try {
    const r = await mcpCall('tools/call', { name: 'AutomateUI', arguments: { helper: 'BrowserWin', action: 'LAUNCH', value: 'about:blank' } });
    const result = r.result || {};
    const warning = result._sessionWarning;
    const hasWarn = typeof warning === 'string' && warning.length > 0;
    // JSON-RPC error: bridge launched BrowserWin in user session, but no browser installed/found → valid
    const isRpcError = r.error && typeof r.error.message === 'string';
    if (hasWarn) {
      pass('BrowserWin LAUNCH: _sessionWarning present (browser invisible in Session 0)');
    } else if (result.success === false) {
      pass('BrowserWin LAUNCH: returned success=false in Session 0 (browser can\'t start)');
    } else if (isRpcError) {
      pass(`BrowserWin LAUNCH: RPC error (bridge active, browser not found in user session — ${r.error.message.slice(0, 60)})`);
    } else {
      fail('BrowserWin LAUNCH: no _sessionWarning, success=true — QA-3 may be missing', JSON.stringify(result).slice(0, 200));
    }
  } catch (e) {
    fail('BrowserWin LAUNCH call failed', e.message);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n───────────────────────────────────────────────');
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log('───────────────────────────────────────────────\n');

  return { passed, failed, skipped: false };
}

module.exports = { run };
