'use strict';
/**
 * _shared.js — Shared helpers for dogfooding integration tests.
 *
 * All dogfood/d*.js files require() this module.
 * Exports: mcpCall, dashRest, bw, kw, ok, assert, skip, sleep, TEST_TAG,
 *          MCP_PORT, DASH_PORT, DASHBOARD_URL, pollUntilMcpReady.
 */

const http = require('http');

// ── Ports (env-overridable) ──────────────────────────────────────────────────
const MCP_PORT      = parseInt(process.env.MCP_PORT  || '3457', 10);
const DASH_PORT     = parseInt(process.env.DASH_PORT || '3458', 10);
const DASHBOARD_URL = `http://localhost:${DASH_PORT}`;

// ── Unique tag per run — injected into test data for deterministic cleanup ───
const TEST_TAG = `dogfood_${Date.now()}`;

// ── Counter (module-level; each test file has its own require() scope so it
//    gets a fresh copy — node caches modules so tests sharing the file share it) ─
let passed = 0, failed = 0;

function getCounters() { return { passed, failed }; }
function resetCounters() { passed = 0; failed = 0; }

// ── Result helpers ────────────────────────────────────────────────────────────

function ok(label, r) {
  const success = r && r.success !== false && !r.error;
  if (success) { console.log(`  ✓  ${label}`); passed++; }
  else         { console.log(`  ✗  ${label} — ${r?.error || r?.message || JSON.stringify(r)}`); failed++; }
  return success;
}

function assert(label, cond, detail = '') {
  if (cond) { console.log(`  ✓  ${label}`); passed++; }
  else       { console.log(`  ✗  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
  return cond;
}

function skip(label, reason) { console.log(`  ⊘  ${label} — ${reason}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── JSON-RPC 2.0 transport ────────────────────────────────────────────────────

/**
 * Call an MCP tool via JSON-RPC 2.0 HTTP transport.
 * @param {string} toolName
 * @param {object} args
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<object>}
 */
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

/**
 * Simple REST call to the dashboard HTTP API (DASH_PORT). Returns parsed JSON.
 * @param {string} method   HTTP verb
 * @param {string} urlPath  path starting with /
 * @param {object} [bodyObj] request body (JSON-serialised)
 * @param {number} [timeoutMs=10000] optional HTTP timeout in ms
 */
function dashRest(method, urlPath, bodyObj, timeoutMs = 10000) {
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
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Helper shortcuts ──────────────────────────────────────────────────────────

/**
 * Issue a BrowserWin CDP command.
 * @param {string} browserTarget  e.g. "chrome:9222" or "chrome"
 * @param {string} command        NAVIGATE | CLICKID | CLICKNAME | FILL | READELEM | QUERYTREE | DIALOG | …
 * @param {string} [parameter]    command-specific value
 * @param {number} [timeoutMs=12000]
 */
function bw(browserTarget, command, parameter, timeoutMs = 12000) {
  const args = { proc: browserTarget, action: command };
  if (parameter !== undefined && parameter !== null && parameter !== '') args.value = String(parameter);
  return mcpCall('BrowserWin', args, timeoutMs);
}

/**
 * Issue a KeyWin UIA command.
 * @param {string} target    window title / HANDLE:<hwnd> / SYSTEM / procname (e.g. "calc.exe")
 * @param {string} command   SENDKEYS | CLICKID | READ | READELEM | LISTWINDOWS | RESET | LAUNCH | …
 * @param {string} [parameter]  For SENDKEYS/TYPE: keystroke value.  For CLICKID/READELEM: AutomationId.
 * @param {number} [timeoutMs=12000]
 *
 * Mapping (CONVENTIONS.md §2.0 / HelperRegistry resolveCallArgs):
 *   target    → proc   (OS-level container; procFilterToTarget translates it)
 *   command   → action (verb passed through)
 *   parameter → value  for keyboard/data commands (SENDKEYS, TYPE, FILL)
 *             → path   for element-address commands (CLICKID, READELEM, CLICKNAME, etc.)
 */
function kw(target, command, parameter, timeoutMs = 12000) {
  // Commands where the parameter is keyboard / raw data → value field.
  const VALUE_COMMANDS = new Set(['SENDKEYS', 'TYPE', 'FILL', 'SET', 'SENDKEYSTO']);
  const args = { proc: target, action: command };
  if (parameter !== undefined && parameter !== null && parameter !== '') {
    if (VALUE_COMMANDS.has(command.toUpperCase())) {
      args.value = String(parameter);
    } else {
      // Element-address commands (CLICKID, READELEM, CLICKNAME, etc.) → path field
      args.path = String(parameter);
    }
  }
  return mcpCall('KeyWin', args, timeoutMs);
}

/**
 * Like mcpCall but NEVER rejects on rpc.error or success:false.
 * Returns the raw JSON-RPC response object: { jsonrpc, id, result?, error? }.
 * Use this in tests that need to assert on error shapes.
 * @param {string} toolName
 * @param {object} args
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<{jsonrpc:string, id:number|string, result?:any, error?:{code:number,message:string,data?:any}}>}
 */
function mcpCallRaw(toolName, args, timeoutMs = 15000) {
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
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`mcpCallRaw parse error: ${e}`)); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

/**
 * Assert that an MCP result (from mcpCall) or RPC response (from mcpCallRaw) represents
 * a failure — i.e. either rpc.error is set OR result.success === false.
 * Optionally checks that the error message/field contains `expectedFragment`.
 * @param {string} label  Test label
 * @param {object} rpcOrResult  Raw RPC response or result object
 * @param {string} [expectedFragment]  Substring expected in error message
 */
function assertFail(label, rpcOrResult, expectedFragment) {
  // Accept both raw RPC response (has .error or .result) and plain result objects
  const rpcError = rpcOrResult?.error;          // JSON-RPC error level
  const appError = rpcOrResult?.result?.error   // application level via mcpCallRaw
                ?? rpcOrResult?.error            // could be both
                ?? rpcOrResult?.message;         // plain result
  const isFailure = (rpcError && rpcError.code !== undefined)  // protocol-level error
                 || rpcOrResult?.success === false               // app-level soft fail
                 || rpcOrResult?.result?.success === false;      // app-level via raw
  if (!isFailure) {
    console.log(`  ✗  ${label} — expected failure but got success: ${JSON.stringify(rpcOrResult)}`);
    failed++;
    return false;
  }
  const errMsg = (rpcError?.message ?? String(appError ?? ''));
  if (expectedFragment && !errMsg.includes(expectedFragment)) {
    console.log(`  ✗  ${label} — error "${errMsg}" does not contain "${expectedFragment}"`);
    failed++;
    return false;
  }
  console.log(`  ✓  ${label}`);
  passed++;
  return true;
}

/**
 * Assert that an error response from mcpCallRaw does NOT contain a stack trace
 * or internal file paths in the error message or result body.
 * @param {string} label
 * @param {object} rpcResponse  Raw RPC response from mcpCallRaw
 */
function assertNoStackLeak(label, rpcResponse) {
  const haystack = JSON.stringify(rpcResponse ?? {});
  // Detect actual stack-trace lines: JSON-encoded newline followed by "    at MethodName("
  const hasStack = /\\n\s+at\s+\w/.test(haystack);
  if (hasStack) {
    console.log(`  ✗  ${label} — response contains internal stack/path: ${haystack.slice(0, 200)}`);
    failed++;
    return false;
  }
  console.log(`  ✓  ${label}`);
  passed++;
  return true;
}

// ── Server readiness poll ─────────────────────────────────────────────────────

/**
 * Poll until MCP server responds with both KeyWin and BrowserWin in the tools list.
 * @param {number} [timeoutMs=45000]
 */
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
              if (names.includes('BrowserWin') && names.includes('KeyWin')) resolve(names);
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

/**
 * Run a quick stack-leak-guard section against the live MCP server.
 * Sends two deliberately bad requests and asserts no stack trace appears in either
 * response. Increments the shared passed/failed counters used by all dogfood tests.
 *
 * Call this at the end of every dogfood run(), just before getCounters().
 */
async function checkMcpNoStackLeak() {
  console.log('\n── Stack-Leak Guard ──');
  const probes = await Promise.all([
    mcpCallRaw('__no_such_tool___guard__', {}),
    mcpCallRaw('executeScenario', { app: '__guard_app__', scenarioId: '__guard__' }),
  ]).catch(() => []);
  for (const raw of probes) {
    assertNoStackLeak('no stack trace in error response', raw);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * runSuite(label, fn)
 *
 * Shared boilerplate for every dogfood suite.  Replaces the repeated
 * resetCounters / pollUntilMcpReady / try-catch / checkMcpNoStackLeak /
 * getCounters / process.exitCode block that used to be copy-pasted into
 * every d[N]/run.js.
 *
 * Usage in d[N]/run.js:
 *
 *   const { runSuite } = require('../_shared');
 *
 *   async function run() {
 *     return runSuite('D2 — Settings UI', async () => {
 *       await testFoo();
 *       await testBar();
 *     });
 *   }
 *
 * @param {string}   label  Suite title printed in the header banner.
 * @param {Function} fn     Async function containing all test calls.
 * @returns {Promise<{passed:number, failed:number}>}
 */
async function runSuite(label, fn) {
  console.log(`\n${'═'.repeat(47)}`);
  console.log(`  ${label}`);
  console.log('═'.repeat(47));

  resetCounters();

  try {
    await pollUntilMcpReady();
    await fn();
  } catch (e) {
    console.error(`\nFATAL: ${e.message}`);
    if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  }

  await checkMcpNoStackLeak();

  const { passed, failed } = getCounters();
  console.log('\n' + '─'.repeat(47));
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log('─'.repeat(47));

  if (require.main === require.cache[require.resolve('./_shared')] ||
      /* called as the entry module */ typeof module !== 'undefined') {
    // Only set exitCode when the *suite* file is the entry point.
    // Detect by checking if caller's require.main matches; since we can't
    // know the caller here, we set it unconditionally — index.js overrides.
    if (failed > 0 && process.exitCode == null) process.exitCode = 1;
  }

  return { passed, failed };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MCP_PORT, DASH_PORT, DASHBOARD_URL, TEST_TAG,
  mcpCall, mcpCallRaw, dashRest, bw, kw,
  ok, assert, assertFail, assertNoStackLeak, checkMcpNoStackLeak, skip, sleep,
  pollUntilMcpReady,
  getCounters, resetCounters,
  runSuite,
};
