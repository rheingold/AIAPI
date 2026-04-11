/**
 * Unit tests for HelperDaemon / HelperRegistry auth + HMAC functionality.
 *
 * Coverage:
 *   ── Startup phase gating ─────────────────────────────────────────────
 *   - SKIP_SESSION_AUTH=true  → startupPhase='skip', readyPromise resolves immediately
 *   - No SKIP_SESSION_AUTH    → startupPhase='awaiting_hello', readyPromise pending
 *   ── _auth_hello → _auth → _auth_ok handshake ─────────────────────────
 *   - Receiving _auth_hello triggers _auth response on stdin
 *   - Receiving _auth_ok resolves readyPromise
 *   - HKDF session key derived from pkBytes + nonces after _auth_ok
 *   - Wrong first action (not _auth_hello) → readyPromise rejected
 *   - Wrong second action (not _auth_ok)   → readyPromise rejected
 *   ── call() HMAC signing ──────────────────────────────────────────────
 *   - No sessionKey → plain JSON request, no hmac field
 *   - sessionKey set → hmac field appended and cryptographically valid
 *   ── dispatchResponse() HMAC verification ────────────────────────────
 *   - No sessionKey → response accepted regardless of hmac presence
 *   - sessionKey set, response has no hmac → accepted (backwards compat)
 *   - sessionKey set, response has valid hmac → accepted
 *   - sessionKey set, response has invalid hmac → resolves {hmac_mismatch}
 *   ── shutdown() async ─────────────────────────────────────────────────
 *   - shutdown() returns a Promise that resolves when child process closes
 *   - shutdown() resolves immediately when process is already null
 *   ── HelperRegistry.setCryptoCredentials() ────────────────────────────
 *   - Propagates pkBytes to all existing daemons
 *   ── HelperDaemon.extractJson() ───────────────────────────────────────
 *   - Extracts complete JSON from partial buffer
 *   - Returns null for incomplete JSON
 *   - Handles nested braces inside strings
 */

// jest.mock() is hoisted before imports by Babel/ts-jest, so the mocked
// module is in place when HelperRegistry.ts is first require()'d.
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
}));

import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import * as child_process from 'child_process';
import { HelperDaemon } from './HelperRegistry';

jest.setTimeout(10_000);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fake child process sporting controllable stdin/stdout/stderr. */
function createFakeProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin  = { write: jest.fn<void, [string]>(), end: jest.fn(), destroy: jest.fn() };
  const proc   = new EventEmitter() as any;
  proc.stdout  = stdout;
  proc.stderr  = stderr;
  proc.stdin   = stdin;
  proc.killed  = false;
  proc.kill    = jest.fn(() => { proc.emit('close', 0); });
  return proc;
}

/** Env that bypasses auth. */
const skipAuthEnv = () => ({ SKIP_SESSION_AUTH: 'true' } as NodeJS.ProcessEnv);
/** Env that requires auth handshake. */
const authRequiredEnv = () => ({} as NodeJS.ProcessEnv);
/** A fake exe path (never actually spawned during these tests). */
const FAKE_EXE = '/fake/KeyWin.exe';

// ── Test setup ────────────────────────────────────────────────────────────────

let fakeProc: ReturnType<typeof createFakeProcess>;

beforeEach(() => {
  fakeProc = createFakeProcess();
  jest.mocked(child_process.spawn).mockReturnValue(fakeProc as any);
});

afterEach(() => {
  jest.mocked(child_process.spawn).mockReset();
});

// ── Startup phase ─────────────────────────────────────────────────────────────

describe('HelperDaemon – startup phase gating', () => {
  it('startupPhase is skip when SKIP_SESSION_AUTH=true', () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    daemon.start();
    expect((daemon as any).startupPhase).toBe('skip');
  });

  it('readyPromise resolves immediately in skip mode', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    daemon.start();
    await expect((daemon as any).readyPromise).resolves.toBeUndefined();
  });

  it('startupPhase is awaiting_hello when SKIP_SESSION_AUTH not set', () => {
    const daemon = new HelperDaemon(FAKE_EXE, authRequiredEnv);
    daemon.start();
    expect((daemon as any).startupPhase).toBe('awaiting_hello');
  });

  it('readyPromise is pending in awaiting_hello mode until handshake', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, authRequiredEnv);
    daemon.start();

    let resolved = false;
    (daemon as any).readyPromise.then(() => { resolved = true; });

    // Give microtasks a chance to settle
    await new Promise<void>(r => setImmediate(r));
    expect(resolved).toBe(false);
  });
});

// ── Auth handshake ────────────────────────────────────────────────────────────

describe('HelperDaemon – auth handshake', () => {
  it('_auth_hello → responds with _auth on stdin', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, authRequiredEnv);
    daemon.start();

    const helperNonce = crypto.randomBytes(32).toString('base64');
    fakeProc.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({ action: '_auth_hello', helperNonce, exeHash: 'aabbcc' }) + '\n'
      )
    );

    await new Promise<void>(r => setImmediate(r));

    // Inspect what was written to stdin (first write after start == _auth response)
    const written = (fakeProc.stdin.write as jest.Mock).mock.calls;
    // At least one call should have happened
    expect(written.length).toBeGreaterThan(0);
    const authMsg = JSON.parse((written[written.length - 1][0] as string).trim());
    expect(authMsg.action).toBe('_auth');
    expect(typeof authMsg.serverNonce).toBe('string');
    // pk is base64 or empty string; both valid
    expect(typeof authMsg.pk).toBe('string');
  });

  it('_auth_ok resolves readyPromise', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, authRequiredEnv);
    daemon.start();

    // Step 1: send _auth_hello
    fakeProc.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({ action: '_auth_hello', helperNonce: 'abc', exeHash: '00' }) + '\n'
      )
    );
    await new Promise<void>(r => setImmediate(r));

    // Step 2: send _auth_ok
    fakeProc.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ action: '_auth_ok' }) + '\n')
    );

    await expect((daemon as any).readyPromise).resolves.toBeUndefined();
    expect((daemon as any).startupPhase).toBe('ready');
  });

  it('HKDF session key is derived after _auth_ok when pkBytes provided', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, authRequiredEnv);
    daemon.pkBytes = crypto.randomBytes(64); // arbitrary private key material
    daemon.start();

    const helperNonce = crypto.randomBytes(32).toString('base64');
    fakeProc.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ action: '_auth_hello', helperNonce, exeHash: '00' }) + '\n')
    );
    await new Promise<void>(r => setImmediate(r));

    fakeProc.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ action: '_auth_ok' }) + '\n')
    );
    await (daemon as any).readyPromise;

    expect((daemon as any).sessionKey).not.toBeNull();
    expect(((daemon as any).sessionKey as Buffer).length).toBe(32);
  });

  it('no HKDF key when pkBytes is null after _auth_ok', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, authRequiredEnv);
    // pkBytes stays null (default)
    daemon.start();

    fakeProc.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ action: '_auth_hello', helperNonce: 'abc', exeHash: '00' }) + '\n')
    );
    await new Promise<void>(r => setImmediate(r));

    fakeProc.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ action: '_auth_ok' }) + '\n')
    );
    await (daemon as any).readyPromise;

    expect((daemon as any).sessionKey).toBeNull();
  });

  it('unexpected first action rejects readyPromise', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, authRequiredEnv);
    daemon.start();

    fakeProc.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ action: 'unexpected_action' }) + '\n')
    );

    await expect((daemon as any).readyPromise).rejects.toThrow(/auth_protocol/);
  });

  it('unexpected second action (after _auth_hello) rejects readyPromise', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, authRequiredEnv);
    daemon.start();

    fakeProc.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ action: '_auth_hello', helperNonce: 'abc', exeHash: '00' }) + '\n')
    );
    await new Promise<void>(r => setImmediate(r));

    fakeProc.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ action: 'not_auth_ok' }) + '\n')
    );

    await expect((daemon as any).readyPromise).rejects.toThrow(/auth_protocol/);
  });
});

// ── call() HMAC signing ───────────────────────────────────────────────────────

describe('HelperDaemon – call() HMAC signing', () => {
  it('plain JSON request when sessionKey is null', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    daemon.start();

    const callPromise = daemon.call('target', '{LISTWINDOWS}', 2000);
    await new Promise<void>(r => setImmediate(r));

    const written: string = (fakeProc.stdin.write as jest.Mock).mock.calls[0][0];
    const msg = JSON.parse(written.trim());
    expect(msg.hmac).toBeUndefined();

    // Respond to unblock the call
    fakeProc.stdout.emit('data', Buffer.from(JSON.stringify({ success: true }) + '\n'));
    await callPromise;
  });

  it('hmac field appended and valid when sessionKey is set', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    const sessionKey = crypto.randomBytes(32);
    (daemon as any).sessionKey = sessionKey;
    daemon.start();

    const callPromise = daemon.call('browser:9222', '{QUERYTREE}', 2000);
    await new Promise<void>(r => setImmediate(r));

    const written: string = (fakeProc.stdin.write as jest.Mock).mock.calls[0][0];
    const raw = written.trim();
    expect(raw).toContain('"hmac":"');

    // Verify the HMAC: strip the ,"hmac":"..."} tail, compute, compare
    const hmacMatch = /,"hmac":"([0-9a-f]{64})"\}$/.exec(raw);
    expect(hmacMatch).not.toBeNull();
    const received = hmacMatch![1];
    const body = raw.slice(0, -(hmacMatch![0].length)) + '}';
    const expected = crypto.createHmac('sha256', sessionKey).update(body).digest('hex');
    expect(received).toBe(expected);

    // Respond to unblock
    fakeProc.stdout.emit('data', Buffer.from(JSON.stringify({ success: true }) + '\n'));
    await callPromise;
  });
});

// ── dispatchResponse() HMAC verification ─────────────────────────────────────

describe('HelperDaemon – dispatchResponse() HMAC verification', () => {
  /** Helper: inject a JSON string directly into the daemon's data pipeline. */
  function feed(daemon: HelperDaemon, json: string) {
    (daemon as any).onData(Buffer.from(json + '\n'));
  }

  it('response accepted without hmac when sessionKey is null', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    daemon.start();

    const callPromise = daemon.call('', '_ping', 2000);
    await new Promise<void>(r => setImmediate(r));

    feed(daemon, JSON.stringify({ success: true, pong: true }));
    const result = await callPromise;
    expect(result.success).toBe(true);
  });

  it('response without hmac field accepted even when sessionKey is set', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    (daemon as any).sessionKey = crypto.randomBytes(32);
    daemon.start();

    const callPromise = daemon.call('', '_ping', 2000);
    await new Promise<void>(r => setImmediate(r));

    // Plain response (no hmac field) — still accepted
    feed(daemon, JSON.stringify({ success: true, pong: true }));
    const result = await callPromise;
    expect(result.success).toBe(true);
  });

  it('valid hmac in response accepted when sessionKey is set', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    const sessionKey = crypto.randomBytes(32);
    (daemon as any).sessionKey = sessionKey;
    daemon.start();

    const callPromise = daemon.call('', '_ping', 2000);
    await new Promise<void>(r => setImmediate(r));

    // Build a response with valid HMAC
    const body = JSON.stringify({ success: true, pong: true });
    const hmac = crypto.createHmac('sha256', sessionKey).update(body).digest('hex');
    const signed = body.slice(0, -1) + `,"hmac":"${hmac}"}`;

    feed(daemon, signed);
    const result = await callPromise;
    expect(result.success).toBe(true);
  });

  it('invalid hmac in response resolves with hmac_mismatch error', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    (daemon as any).sessionKey = crypto.randomBytes(32);
    daemon.start();

    const callPromise = daemon.call('', '_ping', 2000);
    await new Promise<void>(r => setImmediate(r));

    // Build a response with a BAD HMAC (64 zero hex chars)
    const body = JSON.stringify({ success: true, pong: true });
    const badHmac = '0'.repeat(64);
    const tampered = body.slice(0, -1) + `,"hmac":"${badHmac}"}`;

    feed(daemon, tampered);
    const result = await callPromise;
    expect(result.success).toBe(false);
    expect(result.error).toBe('hmac_mismatch');
  });
});

// ── shutdown() async ──────────────────────────────────────────────────────────

describe('HelperDaemon – shutdown() async', () => {
  it('resolves when process fires close event', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    daemon.start();

    const shutdownDone = daemon.shutdown();
    // Simulate the process receiving _exit and exiting
    fakeProc.emit('close', 0);

    await expect(shutdownDone).resolves.toBeUndefined();
  });

  it('resolves immediately when process is null (never started)', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    // Never called start() → proc is null
    await expect(daemon.shutdown()).resolves.toBeUndefined();
  });

  it('second shutdown() after first close resolves immediately (proc null)', async () => {
    const daemon = new HelperDaemon(FAKE_EXE, skipAuthEnv);
    daemon.start();

    const p1 = daemon.shutdown();
    fakeProc.emit('close', 0);  // proc becomes null inside close handler
    await p1;

    // proc is null now; second call should resolve immediately
    await expect(daemon.shutdown()).resolves.toBeUndefined();
  });
});

// ── extractJson static helper ─────────────────────────────────────────────────

describe('HelperDaemon.extractJson', () => {
  it('extracts a complete object', () => {
    const { json, remaining } = HelperDaemon.extractJson('{"a":1}rest');
    expect(json).toBe('{"a":1}');
    expect(remaining).toBe('rest');
  });

  it('returns null for incomplete object', () => {
    const { json } = HelperDaemon.extractJson('{"a":1');
    expect(json).toBeNull();
  });

  it('ignores leading non-JSON text', () => {
    const { json } = HelperDaemon.extractJson('garbage{"ok":true}');
    expect(json).toBe('{"ok":true}');
  });

  it('handles braces inside string values', () => {
    const { json } = HelperDaemon.extractJson('{"k":"{not:close}"}after');
    expect(json).toBe('{"k":"{not:close}"}');
  });

  it('handles nested objects', () => {
    const inner = '{"a":{"b":{"c":1}}}';
    const { json } = HelperDaemon.extractJson(inner);
    expect(json).toBe(inner);
  });

  it('handles escaped quote inside string', () => {
    const { json } = HelperDaemon.extractJson('{"k":"val\\"more"}rest');
    expect(json).toBe('{"k":"val\\"more"}');
  });

  it('empty buffer returns null', () => {
    const { json } = HelperDaemon.extractJson('');
    expect(json).toBeNull();
  });
});
