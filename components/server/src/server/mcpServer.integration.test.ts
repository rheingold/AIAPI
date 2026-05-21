/**
 * mcpServer.integration.test.ts
 *
 * Integration tests for MCPServer: exercises the full HTTP/JSON-RPC stack
 * without requiring any compiled helper binaries.
 *
 * The server is spun up on a random free port in beforeAll and torn down in
 * afterAll.  Tests that need security filter state inject directly into the
 * server instance via (srv as any).advancedFilters.
 *
 * Coverage:
 *   ── HTTP transport layer ─────────────────────────────────────────────
 *   - GET / (health check)                           → 200 status:ok
 *   - GET /health                                    → 200 status:ok
 *   - GET /ping                                      → 200 status:ok
 *   - OPTIONS preflight                              → 200 CORS headers
 *   - Non-POST / Non-GET methods                     → 405
 *   - Malformed JSON body                            → 400 parse error
 *   ── JSON-RPC 2.0 compliance ──────────────────────────────────────────
 *   - jsonrpc ≠ "2.0"                                → 400 -32600
 *   - method field missing                           → 400 -32600
 *   - Unknown method                                 → 200 -32601
 *   ── Core MCP methods ─────────────────────────────────────────────────
 *   - initialize                                     → protocolVersion + serverInfo
 *   - tools/list                                     → array of ≥ 10 tools
 *   - resources/list                                 → []
 *   - prompts/list                                   → []
 *   ── tools/call without binaries ─────────────────────────────────────
 *   - getProviders                                   → array of strings
 *   - listHelpers                                    → success:true, helpers:[]
 *   - getHelperSchema (unknown name)                 → RPC error -32602
 *   - tools/call unknown name (no helper schema)     → error
 *   ── Admin token endpoint ─────────────────────────────────────────────
 *   - POST /api/auth/admin-token (no password)       → 400
 *   - POST /api/auth/admin-token (wrong password)    → 401
 *   - POST /api/auth/admin-token (correct password)  → 200 token
 *   ── Security filter integration ──────────────────────────────────────
 *   - No filters → getProviders succeeds
 *   - DENY_ALL filter → helper tool blocked
 *   - ALLOW filter + matching rule → not blocked by filter (hits binary error)
 */

import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { MCPServer } from './mcpServer';

// Integration tests spin up a real server — extend the default 5 s timeout.
jest.setTimeout(30_000);

// ── helpers ──────────────────────────────────────────────────────────────────

/** Find an available TCP port on localhost. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

/** Send an HTTP request and return { status, body }. */
function httpRequest(
  port: number,
  method: string,
  path_: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string; resHeaders: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      method,
      path: path_,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
        ...(headers || {}),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () =>
        resolve({ status: res.statusCode!, body: data, resHeaders: res.headers }),
      );
    });
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** POST a JSON-RPC 2.0 request and return the parsed response. */
async function rpc(port: number, method: string, params?: unknown, id: number | string = 1): Promise<any> {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
  const { body: raw } = await httpRequest(port, 'POST', '/', body);
  return JSON.parse(raw);
}

/** POST a JSON-RPC request with custom HTTP headers. */
async function rpcH(
  port: number,
  method: string,
  params: unknown,
  headers: Record<string, string>,
  id: number | string = 1,
): Promise<any> {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
  const { body: raw } = await httpRequest(port, 'POST', '/', body, headers);
  return JSON.parse(raw);
}

// ── test lifecycle ────────────────────────────────────────────────────────────

let port: number;
let srv: MCPServer;

beforeAll(async () => {
  port = await getFreePort();
  srv = new MCPServer(undefined, port);
  await srv.start();
}, 15_000);

afterAll(async () => {
  await srv.stop();
  // MCPServer watches dashboard-settings.json; unwatch to allow Jest to exit.
  const settingsPath = path.resolve(process.cwd(), 'config', 'dashboard-settings.json');
  try { fs.unwatchFile(settingsPath); } catch { /* ok */ }
}, 10_000);

// ─── HTTP transport ───────────────────────────────────────────────────────────

describe('HTTP transport', () => {
  it('GET / returns 200 with status:ok', async () => {
    const { status, body } = await httpRequest(port, 'GET', '/');
    expect(status).toBe(200);
    const json = JSON.parse(body);
    expect(json.status).toBe('ok');
    expect(json.server).toBe('ai-ui-automation');
  });

  it('GET /health returns 200 with status:ok', async () => {
    const { status, body } = await httpRequest(port, 'GET', '/health');
    expect(status).toBe(200);
    expect(JSON.parse(body).status).toBe('ok');
  });

  it('GET /ping returns 200 with status:ok', async () => {
    const { status, body } = await httpRequest(port, 'GET', '/ping');
    expect(status).toBe(200);
    expect(JSON.parse(body).status).toBe('ok');
  });

  it('GET / includes port in health payload', async () => {
    const { body } = await httpRequest(port, 'GET', '/');
    expect(JSON.parse(body).port).toBe(port);
  });

  it('OPTIONS preflight returns 200', async () => {
    const { status, resHeaders } = await httpRequest(port, 'OPTIONS', '/');
    expect(status).toBe(200);
    expect(resHeaders['access-control-allow-origin']).toBe('*');
  });

  it('CORS headers present on POST responses', async () => {
    const { resHeaders } = await httpRequest(
      port, 'POST', '/',
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    );
    expect(resHeaders['access-control-allow-origin']).toBe('*');
  });

  it('PUT method returns 405', async () => {
    const { status } = await httpRequest(port, 'PUT', '/');
    expect(status).toBe(405);
  });

  it('DELETE method returns 405', async () => {
    const { status } = await httpRequest(port, 'DELETE', '/');
    expect(status).toBe(405);
  });

  it('POST with malformed JSON returns 400', async () => {
    const { status, body } = await httpRequest(port, 'POST', '/', '{not-json}');
    expect(status).toBe(400);
    const err = JSON.parse(body);
    expect(err.error.code).toBe(-32700);
  });

  it('GET /scenarios returns 200', async () => {
    const { status } = await httpRequest(port, 'GET', '/scenarios');
    expect(status).toBe(200);
  });
});

// ─── JSON-RPC 2.0 compliance ──────────────────────────────────────────────────

describe('JSON-RPC 2.0 compliance', () => {
  it('jsonrpc field not "2.0" → 400 -32600', async () => {
    const body = JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'initialize' });
    const { status, body: raw } = await httpRequest(port, 'POST', '/', body);
    expect(status).toBe(400);
    expect(JSON.parse(raw).error.code).toBe(-32600);
  });

  it('missing method field → 400 -32600', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1 });
    const { status, body: raw } = await httpRequest(port, 'POST', '/', body);
    expect(status).toBe(400);
    expect(JSON.parse(raw).error.code).toBe(-32600);
  });

  it('unknown method → 200 with error -32601', async () => {
    const res = await rpc(port, 'nonexistent/method');
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32601);
  });

  it('id is echoed back in success response', async () => {
    const res = await rpc(port, 'initialize', {}, 42);
    expect(res.id).toBe(42);
  });

  it('id is echoed back in error response', async () => {
    const res = await rpc(port, 'doesNotExist', {}, 99);
    expect(res.id).toBe(99);
    expect(res.error).toBeDefined();
  });

  it('jsonrpc field in success response equals "2.0"', async () => {
    const res = await rpc(port, 'tools/list');
    expect(res.jsonrpc).toBe('2.0');
  });
});

// ─── Core MCP methods ────────────────────────────────────────────────────────

describe('MCP methods', () => {
  it('initialize returns protocolVersion and serverInfo', async () => {
    const res = await rpc(port, 'initialize', {});
    expect(res.error).toBeUndefined();
    expect(res.result.protocolVersion).toBeTruthy();
    expect(res.result.serverInfo.name).toBe('ai-ui-automation');
    expect(res.result.serverInfo.version).toBeTruthy();
  });

  it('initialize returns capabilities object', async () => {
    const res = await rpc(port, 'initialize', {});
    expect(res.result.capabilities).toBeDefined();
    expect(res.result.capabilities.tools).toBeDefined();
  });

  it('tools/list returns array of ≥ 10 tools', async () => {
    const res = await rpc(port, 'tools/list');
    expect(res.error).toBeUndefined();
    expect(Array.isArray(res.result.tools)).toBe(true);
    expect(res.result.tools.length).toBeGreaterThanOrEqual(10);
  });

  it('tools/list includes known tool names', async () => {
    const res = await rpc(port, 'tools/list');
    const names: string[] = res.result.tools.map((t: any) => t.name);
    for (const expected of ['queryTree', 'clickElement', 'getProviders', 'listWindows',
                             'executeScenario', 'listHelpers', 'fetch_webpage']) {
      expect(names).toContain(expected);
    }
  });

  it('each tool has name, description, inputSchema', async () => {
    const res = await rpc(port, 'tools/list');
    for (const tool of res.result.tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('resources/list returns empty list', async () => {
    const res = await rpc(port, 'resources/list');
    expect(res.error).toBeUndefined();
    expect(Array.isArray(res.result.resources)).toBe(true);
    expect(res.result.resources.length).toBe(0);
  });

  it('prompts/list returns empty list', async () => {
    const res = await rpc(port, 'prompts/list');
    expect(res.error).toBeUndefined();
    expect(Array.isArray(res.result.prompts)).toBe(true);
    expect(res.result.prompts.length).toBe(0);
  });
});

// ─── tools/call (no binaries) ────────────────────────────────────────────────

describe('tools/call — no binary required', () => {
  it('getProviders returns array of provider names', async () => {
    const res = await rpc(port, 'tools/call', { name: 'getProviders', arguments: {} });
    expect(res.error).toBeUndefined();
    // Result is directly an array of strings (provider names)
    const providers = res.result;
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.every((p: unknown) => typeof p === 'string')).toBe(true);
  });

  it('listHelpers returns success:true and empty helpers array (no helpers discovered)', async () => {
    const res = await rpc(port, 'tools/call', { name: 'listHelpers', arguments: {} });
    expect(res.error).toBeUndefined();
    expect(res.result.success).toBe(true);
    expect(Array.isArray(res.result.helpers)).toBe(true);
  });

  it('getHelperSchema for unknown name returns RPC error -32602', async () => {
    const res = await rpc(port, 'tools/call', {
      name: 'getHelperSchema',
      arguments: { helperName: 'NonExistentHelper.exe' },
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32602);
  });

  it('unknown tool name returns error', async () => {
    const res = await rpc(port, 'tools/call', {
      name: 'nosuchTool',
      arguments: {},
    });
    // Either an RPC error or a result with error field
    const isError = res.error !== undefined || (res.result && res.result.error);
    expect(isError).toBe(true);
  });

  it('tools/call missing params.arguments is handled gracefully', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'tools/call',
      params: { name: 'listHelpers' },   // missing arguments field
    });
    const { body: raw } = await httpRequest(port, 'POST', '/', body);
    const res = JSON.parse(raw);
    // Should not crash the server — result or error, both acceptable
    expect(res.jsonrpc).toBe('2.0');
  });
});

// ─── Admin token endpoint ─────────────────────────────────────────────────────

describe('POST /api/auth/admin-token', () => {
  async function tokenRequest(bodyObj: unknown): Promise<{ status: number; json: any }> {
    const body = JSON.stringify(bodyObj);
    const { status, body: raw } = await httpRequest(port, 'POST', '/api/auth/admin-token', body);
    return { status, json: JSON.parse(raw) };
  }

  it('missing password field → 400', async () => {
    const { status } = await tokenRequest({});
    expect(status).toBe(400);
  });

  it('empty password → 400', async () => {
    const { status } = await tokenRequest({ password: '' });
    expect(status).toBe(400);
  });

  it('wrong password → 401', async () => {
    const { status } = await tokenRequest({ password: 'wrong-password-xyz' });
    expect(status).toBe(401);
  });

  it('correct password → 200 with token', async () => {
    // Default password from SessionTokenManager is process.env.ADMIN_PASSWORD || 'admin123'
    const { status, json } = await tokenRequest({ password: 'admin123' });
    expect(status).toBe(200);
    expect(typeof json.token).toBe('string');
    expect(json.token.length).toBeGreaterThan(10);
  });

  it('correct password response includes expiry', async () => {
    const { json } = await tokenRequest({ password: 'admin123' });
    expect(typeof json.expiry).toBe('string');
    // Should be a future ISO date
    expect(new Date(json.expiry).getTime()).toBeGreaterThan(Date.now());
  });
});

// ─── Security filter integration ─────────────────────────────────────────────

/** Minimal HelperSchema for injection into the registry. */
const FAKE_HELPER_SCHEMA = {
  helper: 'KeyWin.exe',
  toolName: 'KeyWin',
  version: '1.0',
  description: 'Fake test helper',
  commands: [{ name: 'SENDKEYS', description: 'Send keys', parameters: [] }],
  filePath: 'C:/fake/KeyWin.exe',
};

describe('Security filter integration', () => {
  let schemasMap: Map<string, unknown>;

  beforeEach(() => {
    schemasMap = (srv as any).helperRegistry['schemas'] as Map<string, unknown>;
  });

  afterEach(() => {
    // Reset filters and remove injected fake helper
    (srv as any).advancedFilters = [];
    schemasMap.delete('KeyWin.exe');
  });

  it('no filters → getProviders succeeds (permissive default)', async () => {
    (srv as any).advancedFilters = [];
    const res = await rpc(port, 'tools/call', { name: 'getProviders', arguments: {} });
    expect(res.error).toBeUndefined();
    expect(Array.isArray(res.result)).toBe(true);
  });

  it('DENY_ALL filter blocks helper tool call → -32603 "Security filter blocked"', async () => {
    // Register fake helper so the tool lookup succeeds and reaches security check
    schemasMap.set('KeyWin.exe', FAKE_HELPER_SCHEMA);
    // Inject deny-all rule
    (srv as any).advancedFilters = [
      { id: 1, action: 'deny', process: '*', helper: '*', command: '*', pattern: '*', description: 'block all' },
    ];
    const res = await rpc(port, 'tools/call', {
      name: 'KeyWin',
      arguments: { proc: 'calc.exe', action: 'SENDKEYS', value: 'x' },
    });
    // Security filter should fire before invoking the (fake) helper binary
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32603);
    expect(res.error.message.toLowerCase()).toContain('security filter');
  });

  it('DENY_ALL filter: error message includes command and target', async () => {
    schemasMap.set('KeyWin.exe', FAKE_HELPER_SCHEMA);
    (srv as any).advancedFilters = [
      { id: 1, action: 'deny', process: '*', helper: '*', command: '*', pattern: '*' },
    ];
    const res = await rpc(port, 'tools/call', {
      name: 'KeyWin',
      arguments: { proc: 'notepad.exe', action: 'CLICKID', path: '//Button[@id=\'btn1\']' },
    });
    expect(res.error.message).toContain('CLICKID');
    expect(res.error.message).toContain('notepad.exe');
  });

  it('DENY for specific process does not block different process', async () => {
    schemasMap.set('KeyWin.exe', FAKE_HELPER_SCHEMA);
    (srv as any).advancedFilters = [
      { id: 1, action: 'deny', process: 'mspaint.exe', helper: '*', command: '*', pattern: '*' },
    ];
    const res = await rpc(port, 'tools/call', {
      name: 'KeyWin',
      arguments: { proc: 'calc.exe', action: 'SENDKEYS', value: 'x' },
    });
    // Filter doesn't match calc.exe → security passes; helper binary missing → -32603 execution error
    // Either way: NOT a "Security filter blocked" error
    if (res.error) {
      expect(res.error.message.toLowerCase()).not.toContain('security filter');
    }
  });

  it('ALLOW filter for matching process does not block getProviders', async () => {
    (srv as any).advancedFilters = [
      { id: 1, action: 'allow', process: 'calc.exe', helper: '*', command: '*', pattern: '*' },
    ];
    const res = await rpc(port, 'tools/call', { name: 'getProviders', arguments: {} });
    expect(res.error).toBeUndefined();
  });

  it('DENY filter for specific process does not block getProviders', async () => {
    (srv as any).advancedFilters = [
      { id: 1, action: 'deny', process: 'calc.exe', helper: '*', command: 'SENDKEYS', pattern: '*' },
    ];
    const res = await rpc(port, 'tools/call', { name: 'getProviders', arguments: {} });
    expect(res.error).toBeUndefined();
    expect(Array.isArray(res.result)).toBe(true);
  });
});

// ─── D2: MCP schema round-trip ───────────────────────────────────────────────

describe('D2 — MCP schema round-trip (getHelperSchema → tool discovery → dispatch)', () => {
  const D2_SCHEMA = {
    helper: 'KeyWin.exe',
    toolName: 'KeyWin',
    version: '1.0',
    description: 'D2 test helper',
    commands: [
      { name: 'LISTWINDOWS', description: 'List windows', parameters: [] },
      { name: 'SENDKEYS',    description: 'Send keystrokes', parameters: [{ name: 'value', type: 'string' }] },
    ],
    filePath: 'C:/d2/KeyWin.exe',
  };

  let schemasMap: Map<string, unknown>;

  beforeEach(() => {
    schemasMap = (srv as any).helperRegistry['schemas'] as Map<string, unknown>;
    schemasMap.set('KeyWin.exe', D2_SCHEMA);
  });

  afterEach(() => {
    schemasMap.delete('KeyWin.exe');
  });

  it('getHelperSchema returns schema with commands array', async () => {
    const res = await rpc(port, 'tools/call', {
      name: 'getHelperSchema',
      arguments: { helperName: 'KeyWin.exe' },
    });
    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();
    // Schema is returned under result.schema or result directly
    const schema = res.result?.schema ?? res.result;
    expect(schema.helper).toBe('KeyWin.exe');
    expect(Array.isArray(schema.commands)).toBe(true);
    expect(schema.commands.map((c: any) => c.name)).toContain('LISTWINDOWS');
    expect(schema.commands.map((c: any) => c.name)).toContain('SENDKEYS');
  });

  it('getHelperSchema result contains version and description', async () => {
    const res = await rpc(port, 'tools/call', {
      name: 'getHelperSchema',
      arguments: { helperName: 'KeyWin.exe' },
    });
    const schema = res.result?.schema ?? res.result;
    expect(schema.version).toBe('1.0');
    expect(typeof schema.description).toBe('string');
  });

  it('tools/list includes KeyWin tool when schema is registered', async () => {
    const res = await rpc(port, 'tools/list');
    expect(res.error).toBeUndefined();
    const names = (res.result?.tools ?? []).map((t: any) => t.name);
    expect(names).toContain('KeyWin');
  });

  it('calling KeyWin tool reaches dispatch (not blocked by security filter with no rules)', async () => {
    // No DENY rules → security filter ALLOW → proceeds to helper execution
    // Helper binary is fake so it fails at execution, not at filter level
    const res = await rpc(port, 'tools/call', {
      name: 'KeyWin',
      arguments: { proc: 'notepad.exe', action: 'LISTWINDOWS' },
    });
    // Should NOT be a security-filter error; may be an execution error for missing binary
    if (res.error) {
      expect(res.error.message.toLowerCase()).not.toContain('security filter');
    }
  });
});

// ─── D3: Admin token bypass of security filter ───────────────────────────────

describe('D3 — admin token bypass of security filter', () => {
  let schemasMap: Map<string, unknown>;

  beforeEach(() => {
    schemasMap = (srv as any).helperRegistry['schemas'] as Map<string, unknown>;
    schemasMap.set('KeyWin.exe', FAKE_HELPER_SCHEMA);
  });

  afterEach(() => {
    (srv as any).advancedFilters = [];
    schemasMap.delete('KeyWin.exe');
  });

  it('DENY_ALL without token → security filter blocked', async () => {
    (srv as any).advancedFilters = [
      { id: 1, action: 'deny', process: '*', helper: '*', command: '*', pattern: '*' },
    ];
    const res = await rpc(port, 'tools/call', {
      name: 'KeyWin',
      arguments: { proc: 'notepad.exe', action: 'SENDKEYS', value: 'hello' },
    });
    expect(res.error).toBeDefined();
    expect(res.error.message.toLowerCase()).toContain('security filter');
  });

  it('DENY_ALL with valid X-Admin-Token header → filter bypassed (execution fails elsewhere, not at filter)', async () => {
    (srv as any).advancedFilters = [
      { id: 1, action: 'deny', process: '*', helper: '*', command: '*', pattern: '*' },
    ];
    // Obtain a valid admin token
    const tokenRes = await httpRequest(
      port, 'POST', '/api/auth/admin-token',
      JSON.stringify({ password: 'admin123' }),
    );
    const { token } = JSON.parse(tokenRes.body);
    expect(typeof token).toBe('string');

    // Call with valid token → should NOT be blocked by security filter
    const res = await rpcH(port, 'tools/call', {
      name: 'KeyWin',
      arguments: { proc: 'notepad.exe', action: 'SENDKEYS', value: 'hello' },
    }, { 'x-admin-token': token });

    // Security filter is bypassed — failure is at execution (fake binary) not at filter level
    if (res.error) {
      expect(res.error.message.toLowerCase()).not.toContain('security filter');
    }
    // (If some future test wires a real binary this could be res.result — that's also fine)
  });

  it('DENY_ALL with invalid/expired X-Admin-Token → still blocked by filter', async () => {
    (srv as any).advancedFilters = [
      { id: 1, action: 'deny', process: '*', helper: '*', command: '*', pattern: '*' },
    ];
    const res = await rpcH(port, 'tools/call', {
      name: 'KeyWin',
      arguments: { proc: 'notepad.exe', action: 'SENDKEYS', value: 'hello' },
    }, { 'x-admin-token': 'invalid-token-xyz' });

    expect(res.error).toBeDefined();
    expect(res.error.message.toLowerCase()).toContain('security filter');
  });
});

// ─── SSE transport ────────────────────────────────────────────────────────────

describe('SSE transport', () => {
  it('GET /sse returns text/event-stream content-type', (done) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method: 'GET', path: '/sse' },
      (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        req.destroy();
        done();
      },
    );
    req.on('error', () => { /* destroyed */ });
    req.end();
  });

  it('GET /sse emits endpoint event containing /messages?sessionId=', (done) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method: 'GET', path: '/sse' },
      (res) => {
        let buf = '';
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString();
          if (buf.includes('event: endpoint')) {
            expect(buf).toContain('event: endpoint');
            expect(buf).toContain('/messages?sessionId=');
            req.destroy();
            done();
          }
        });
      },
    );
    req.on('error', () => { /* destroyed */ });
    req.setTimeout(5_000, () => { req.destroy(); done(new Error('timeout waiting for endpoint event')); });
    req.end();
  });

  it('POST /messages returns 202 and SSE stream receives event: message', (done) => {
    // Step 1: open SSE connection, read sessionId from endpoint event
    const sseReq = http.request(
      { hostname: '127.0.0.1', port, method: 'GET', path: '/sse' },
      (sseRes) => {
        let sseBuf = '';
        sseRes.on('data', (chunk: Buffer) => {
          sseBuf += chunk.toString();

          // Extract sessionId from "data: /messages?sessionId=<uuid>"
          const match = sseBuf.match(/data: \/messages\?sessionId=([^\s\n]+)/);
          if (!match) return;
          const sessionId = match[1];

          // Step 2: POST a tools/list request to /messages?sessionId=...
          const rpcBody = JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list' });
          const postReq = http.request(
            {
              hostname: '127.0.0.1',
              port,
              method: 'POST',
              path: `/messages?sessionId=${sessionId}`,
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': String(Buffer.byteLength(rpcBody)),
              },
            },
            (postRes) => {
              // POST must return 202
              expect(postRes.statusCode).toBe(202);

              // Step 3: SSE stream must emit event: message with the JSON-RPC response
              sseRes.on('data', (chunk2: Buffer) => {
                sseBuf += chunk2.toString();
                if (sseBuf.includes('event: message')) {
                  expect(sseBuf).toContain('event: message');
                  expect(sseBuf).toContain('"jsonrpc":"2.0"');
                  sseReq.destroy();
                  done();
                }
              });
            },
          );
          postReq.on('error', () => { /* ignored after destroy */ });
          postReq.write(rpcBody);
          postReq.end();
        });
      },
    );
    sseReq.on('error', () => { /* destroyed */ });
    sseReq.setTimeout(10_000, () => { sseReq.destroy(); done(new Error('SSE test timeout')); });
    sseReq.end();
  });

  it('POST / plain JSON-RPC still works (backward compat)', async () => {
    const res = await rpc(port, 'tools/list');
    expect(res.error).toBeUndefined();
    expect(Array.isArray(res.result.tools)).toBe(true);
    expect(res.result.tools.length).toBeGreaterThanOrEqual(10);
  });
});
