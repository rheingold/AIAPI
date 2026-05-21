/**
 * mcpServer.error.test.ts
 *
 * Verifies the error-handling contract of MCPServer:
 *
 *   PROTOCOL LEVEL (rpc.error)
 *   - Unknown JSON-RPC method                 → -32601, no stack trace
 *   - Unknown tool name                       → -32602 / -32603, no stack trace
 *   - Missing required args to a known tool   → doesn't crash server
 *   - Internal sanitisation: correlationId present, no raw stack in wire message
 *
 *   APPLICATION LEVEL (rpc.result.success === false)
 *   - executeScenario with unknown app        → success:false, error string, NO stack field
 *   - Helper soft-fail propagation            → success:false + error message
 *
 *   SECURITY
 *   - No stack trace or internal path in any error response to a remote caller
 *
 * The server is started once with an empty helper list (no binaries required).
 */

import * as http from 'http';
import * as net from 'net';
import { MCPServer } from './mcpServer';

jest.setTimeout(30_000);

// ── helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Send a raw JSON-RPC POST and return the parsed response.
 * Never rejects on rpc.error — returns the full envelope.
 */
function rpc(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
  id: number | string = 1,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const req = http.request(
      { hostname: '127.0.0.1', port, method: 'POST', path: '/',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      },
    );
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Shortcut for tools/call. */
function toolsCall(port: number, name: string, args: Record<string, unknown> = {}) {
  return rpc(port, 'tools/call', { name, arguments: args });
}

// ── test fixtures ─────────────────────────────────────────────────────────────

let port: number;
let srv: MCPServer;

beforeAll(async () => {
  port = await getFreePort();
  srv = new MCPServer(undefined, port);
  await srv.start();
});

afterAll(async () => {
  await srv.stop();
});

// ── PROTOCOL LEVEL errors ─────────────────────────────────────────────────────

describe('Protocol-level error responses', () => {
  it('unknown JSON-RPC method returns -32601', async () => {
    const res = await rpc(port, 'noSuchMethod');
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32601);
    expect(res.error.message).toMatch(/Method not found/i);
  });

  it('error response for unknown method has no stack trace', async () => {
    const res = await rpc(port, 'noSuchMethod');
    const wire = JSON.stringify(res);
    // Stack traces contain "    at " patterns
    expect(wire).not.toMatch(/\s+at\s+\w+[\s(]/);
    // No internal file paths
    expect(wire).not.toMatch(/[/\\]components[/\\]/);
  });

  it('unknown tool name returns an error (code -32602 or -32603)', async () => {
    const res = await toolsCall(port, 'NoSuchTool___xyz', {});
    expect(res.error).toBeDefined();
    expect([-32602, -32603]).toContain(res.error.code);
  });

  it('unknown tool error has no stack trace in wire message', async () => {
    const res = await toolsCall(port, 'NoSuchTool___xyz', {});
    const wire = JSON.stringify(res);
    expect(wire).not.toMatch(/\s+at\s+\w+[\s(]/);
  });

  it('missing required args to getHelperSchema returns -32602', async () => {
    const res = await toolsCall(port, 'getHelperSchema', {}); // helperName required
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32602);
  });

  it('malformed JSON body returns 400 + -32700', async () => {
    await new Promise<void>((resolve, reject) => {
      const body = '{ bad json ///';
      const req = http.request(
        { hostname: '127.0.0.1', port, method: 'POST', path: '/',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        res => {
          expect(res.statusCode).toBe(400);
          let d = '';
          res.on('data', c => (d += c));
          res.on('end', () => {
            const parsed = JSON.parse(d);
            expect(parsed.error.code).toBe(-32700);
            resolve();
          });
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  });
});

// ── APPLICATION LEVEL errors ─────────────────────────────────────────────────

describe('Application-level error responses (success:false)', () => {
  it('executeScenario with unknown app returns success:false, not a crash', async () => {
    const res = await toolsCall(port, 'executeScenario', {
      app: '__no_such_app_xyz__',
      scenarioId: 'intro',
    });
    // Must be a result (not a protocol error)
    expect(res.result).toBeDefined();
    expect(res.result.success).toBe(false);
    expect(typeof res.result.error).toBe('string');
    expect(res.result.error.length).toBeGreaterThan(0);
  });

  it('executeScenario error result MUST NOT contain a "stack" field', async () => {
    const res = await toolsCall(port, 'executeScenario', {
      app: '__no_such_app_xyz__',
      scenarioId: 'intro',
    });
    expect(res?.result?.stack).toBeUndefined();
  });

  it('executeScenario error result contains a correlationId for tracing', async () => {
    const res = await toolsCall(port, 'executeScenario', {
      app: '__no_such_app_xyz__',
      scenarioId: 'intro',
    });
    expect(typeof res?.result?.correlationId).toBe('string');
    expect(res.result.correlationId.length).toBeGreaterThan(0);
  });

  it('executeScenario with neither app+scenarioId nor scenarioPath returns success:false', async () => {
    const res = await toolsCall(port, 'executeScenario', {});
    expect(res.result).toBeDefined();
    expect(res.result.success).toBe(false);
  });

  it('no response body contains a raw Node.js stack trace', async () => {
    const scenarios = [
      toolsCall(port, '__bad_tool__', {}),
      toolsCall(port, 'executeScenario', { app: '__bad__', scenarioId: '__bad__' }),
      toolsCall(port, 'getHelperSchema', {}),
      rpc(port, '__bad_method__'),
    ];
    const results = await Promise.all(scenarios);
    for (const res of results) {
      const wire = JSON.stringify(res);
      // Must not contain actual stack-trace lines (e.g. "    at MCPServer.foo (")
      expect(wire).not.toMatch(/\\n\s+at\s+\w/);
    }
  });
});

// ── correlationId contract ────────────────────────────────────────────────────

describe('correlationId contract', () => {
  it('internal protocol errors include a correlationId in error.data', async () => {
    // Trigger an internal error by calling a tool with args that will throw
    // before reaching a helper. We patch the server to inject a throwing handler.
    const orig = (srv as any).handleInitialize as Function;
    (srv as any).handleInitialize = (_id: any, _p: any) => { throw new Error('__injected_test_error__'); };
    try {
      const res = await rpc(port, 'initialize', {});
      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32603);
      // correlationId must be present so operators can trace the full error in the logs
      expect(typeof res.error.data?.correlationId).toBe('string');
      // Wire message must NOT contain the raw thrown message (for remote safety)
      // but for local connections (127.0.0.1) it IS included for dev convenience
      expect(res.error.message).not.toMatch(/\s+at\s+\w+[\s(]/);
    } finally {
      (srv as any).handleInitialize = orig;
    }
  });
});

// ── HELPER SOFT-FAIL propagation ──────────────────────────────────────────────

describe('Helper soft-fail propagation', () => {
  // Unique tool name so the default switch-case routes to helperRegistry
  const FAKE_TOOL = '__FakeHelper__';

  let origGetByToolName: Function;
  let origCallCommand: Function;

  beforeEach(() => {
    const reg = (srv as any).helperRegistry;
    origGetByToolName = reg.getByToolName.bind(reg);
    origCallCommand   = reg.callCommand.bind(reg);
    // Inject a fake schema so the server thinks the tool exists
    reg.getByToolName = (name: string) =>
      name === FAKE_TOOL
        ? { helper: FAKE_TOOL, toolName: FAKE_TOOL, commands: [] }
        : origGetByToolName(name);
  });

  afterEach(() => {
    const reg = (srv as any).helperRegistry;
    reg.getByToolName = origGetByToolName;
    reg.callCommand   = origCallCommand;
  });

  it('helper_timeout sentinel → JSON-RPC error -32603', async () => {
    (srv as any).helperRegistry.callCommand = async () =>
      ({ success: false, error: 'helper_timeout: no response after 5000ms' });
    const res = await toolsCall(port, FAKE_TOOL, { proc: 'SYSTEM', action: 'LISTWINDOWS' });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32603);
  });

  it('daemon_exited sentinel → JSON-RPC error -32603', async () => {
    (srv as any).helperRegistry.callCommand = async () =>
      ({ success: false, error: 'daemon_exited: helper process exited with code=1' });
    const res = await toolsCall(port, FAKE_TOOL, { proc: 'SYSTEM', action: 'LISTWINDOWS' });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32603);
  });

  it('app-level success:false propagates error message through -32603', async () => {
    (srv as any).helperRegistry.callCommand = async () =>
      ({ success: false, error: 'LISTWINDOWS failed: Window not found' });
    const res = await toolsCall(port, FAKE_TOOL, { proc: 'SYSTEM', action: 'LISTWINDOWS' });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32603);
    expect(res.error.message).toContain('LISTWINDOWS failed');
  });

  it('helper soft-fail does not expose stack trace on wire', async () => {
    (srv as any).helperRegistry.callCommand = async () =>
      ({ success: false, error: 'helper_timeout: no response after 5000ms' });
    const res = await toolsCall(port, FAKE_TOOL, { proc: 'SYSTEM', action: 'LISTWINDOWS' });
    const wire = JSON.stringify(res);
    expect(wire).not.toMatch(/\\n\s+at\s+\w/);
    expect(wire).not.toMatch(/[/\\]components[/\\]/);
  });

  it('callCommand throwing unexpectedly → -32603 with no stack on wire', async () => {
    (srv as any).helperRegistry.callCommand = async () => {
      const err = new Error('Simulated crash');
      // Attach an artificial stack referencing internal paths (must be scrubbed)
      err.stack = 'Error: Simulated crash\n    at HelperDaemon.dispatch (/components/server/src/helpers/HelperDaemon.ts:42:18)';
      throw err;
    };
    const res = await toolsCall(port, FAKE_TOOL, { proc: 'SYSTEM', action: 'LISTWINDOWS' });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32603);
    const wire = JSON.stringify(res);
    // The raw stack or internal path must NOT appear in the wire response
    expect(wire).not.toMatch(/\\n\s+at\s+\w/);
    expect(wire).not.toMatch(/[/\\]components[/\\]/);
  });
});
