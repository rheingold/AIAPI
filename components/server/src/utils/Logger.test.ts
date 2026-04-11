import { Logger, globalLogger, LogLevel, LogCallback } from './Logger';

// Silence console output for all Logger tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {/* silent */});
});
afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger();
  });

  // ── onLog callback registration ──────────────────────────────────────────

  it('calls a registered callback on every log()', () => {
    const calls: Array<[LogLevel, string, string]> = [];
    logger.onLog((level, source, message) => calls.push([level, source, message]));

    logger.log('info', 'TestSrc', 'hello world');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['info', 'TestSrc', 'hello world']);
  });

  it('calls ALL registered callbacks', () => {
    const a: string[] = [];
    const b: string[] = [];
    logger.onLog((_l, _s, m) => a.push(m));
    logger.onLog((_l, _s, m) => b.push(m));

    logger.log('debug', 'src', 'msg');

    expect(a).toEqual(['msg']);
    expect(b).toEqual(['msg']);
  });

  it('passes the correct level to callback', () => {
    const levels: LogLevel[] = [];
    logger.onLog((level) => levels.push(level));

    logger.log('debug',  'S', 'm');
    logger.log('info',   'S', 'm');
    logger.log('warn',   'S', 'm');
    logger.log('error',  'S', 'm');

    expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('passes the correct source to callback', () => {
    const sources: string[] = [];
    logger.onLog((_l, source) => sources.push(source));

    logger.log('info', 'SourceA', 'm');
    logger.log('info', 'SourceB', 'm');

    expect(sources).toEqual(['SourceA', 'SourceB']);
  });

  it('logs to console.log on every call', () => {
    logger.log('warn', 'ConsoleTest', 'check output');
    expect(console.log).toHaveBeenCalled();
    const arg = (console.log as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(arg).toContain('WARN');
    expect(arg).toContain('ConsoleTest');
    expect(arg).toContain('check output');
  });

  it('fires no callbacks when none are registered', () => {
    // Should not throw
    expect(() => logger.log('error', 'src', 'msg')).not.toThrow();
  });

  // ── Convenience wrappers ─────────────────────────────────────────────────

  it('debug() calls log with level="debug"', () => {
    const calls: Array<[LogLevel, string, string]> = [];
    logger.onLog((l, s, m) => calls.push([l, s, m]));
    logger.debug('S', 'a debug message');
    expect(calls[0][0]).toBe('debug');
    expect(calls[0][2]).toBe('a debug message');
  });

  it('info() calls log with level="info"', () => {
    const calls: Array<[LogLevel, string, string]> = [];
    logger.onLog((l, s, m) => calls.push([l, s, m]));
    logger.info('S', 'an info message');
    expect(calls[0][0]).toBe('info');
  });

  it('warn() calls log with level="warn"', () => {
    const calls: Array<[LogLevel, string, string]> = [];
    logger.onLog((l, s, m) => calls.push([l, s, m]));
    logger.warn('S', 'a warning');
    expect(calls[0][0]).toBe('warn');
  });

  it('error() calls log with level="error"', () => {
    const calls: Array<[LogLevel, string, string]> = [];
    logger.onLog((l, s, m) => calls.push([l, s, m]));
    logger.error('S', 'an error');
    expect(calls[0][0]).toBe('error');
  });

  // ── logJSON ──────────────────────────────────────────────────────────────

  it('logJSON formats data as indented JSON in the message', () => {
    const messages: string[] = [];
    logger.onLog((_l, _s, m) => messages.push(m));

    logger.logJSON('info', 'Src', 'MyLabel', { a: 1, b: [2, 3] });

    expect(messages[0]).toContain('MyLabel');
    expect(messages[0]).toContain('"a": 1');
    expect(messages[0]).toContain('"b":');
  });

  it('logJSON is skipped when verboseMode=false', () => {
    const silentLogger = new Logger(false);
    const messages: string[] = [];
    silentLogger.onLog((_l, _s, m) => messages.push(m));

    silentLogger.logJSON('info', 'Src', 'Label', { x: 42 });

    expect(messages).toHaveLength(0);
  });

  it('logJSON emits an error log when data is not serialisable', () => {
    const calls: Array<[LogLevel, string, string]> = [];
    logger.onLog((l, s, m) => calls.push([l, s, m]));

    // Circular reference triggers JSON.stringify to throw
    const circular: any = {};
    circular.self = circular;
    logger.logJSON('info', 'Src', 'Circular', circular);

    expect(calls[0][0]).toBe('error');
    expect(calls[0][2]).toContain('Circular');
  });

  it('logJSON passes the supplied level when serialisation succeeds', () => {
    const calls: Array<[LogLevel, string, string]> = [];
    logger.onLog((l) => calls.push([l, '', '']));

    logger.logJSON('warn', 'Src', 'Label', { ok: true });

    expect(calls[0][0]).toBe('warn');
  });

  // ── verboseMode constructor default ─────────────────────────────────────

  it('verboseMode defaults to true (logJSON fires callbacks)', () => {
    const defaultLogger = new Logger();
    const messages: string[] = [];
    defaultLogger.onLog((_l, _s, m) => messages.push(m));

    defaultLogger.logJSON('debug', 'S', 'L', { v: 1 });

    expect(messages).toHaveLength(1);
  });

  it('verboseMode=true logs JSON normally', () => {
    const verboseLogger = new Logger(true);
    const messages: string[] = [];
    verboseLogger.onLog((_l, _s, m) => messages.push(m));

    verboseLogger.logJSON('info', 'S', 'Label', [1, 2, 3]);

    expect(messages[0]).toContain('[');
    expect(messages[0]).toContain('1');
  });
});

// ── globalLogger singleton ───────────────────────────────────────────────────

describe('globalLogger', () => {
  it('is an instance of Logger', () => {
    expect(globalLogger).toBeInstanceOf(Logger);
  });

  it('supports onLog registration without throwing', () => {
    const called: boolean[] = [];
    const unsub = (cb: LogCallback) => cb;
    globalLogger.onLog((_l, _s, _m) => called.push(true));
    // globalLogger.log would call console.log — already mocked above, but
    // globalLogger is the shared singleton so check that a fresh callback
    // registered in this test receives at least one call.
    globalLogger.info('TestSuite', 'globalLogger smoke test');
    // The callback was pushed; it WILL have been called.
    expect(called.length).toBeGreaterThanOrEqual(1);
  });
});
