import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { globalLogger } from '../utils/Logger';

export interface HelperCommandParam {
  name: string;
  type: string;
  required: boolean;
  default?: any;
}

export interface HelperCommand {
  name: string;
  description: string;
  parameters: HelperCommandParam[];
  examples: string[];
}

export interface WindowMode {
  mode: string;
  description: string;
  examples: string[];
}

export interface HelperSchema {
  /** Helper executable name, e.g. "KeyWin.exe" */
  helper: string;
  version: string;
  description: string;
  /** Optional override for the 'target' parameter description in MCP tools. */
  targetDescription?: string;
  /** Window management modes declared by the helper */
  window_modes?: WindowMode[];
  /** Teardown policies supported by this helper */
  teardown_policies?: string[];
  commands: HelperCommand[];
  /** Absolute path to the .exe -- set by registry after discovery */
  filePath: string;
  /** MCP tool name derived from helper name, e.g. "helper_KeyWin" */
  toolName: string;
}

// ---------------------------------------------------------------------------
// HelperDaemon -- persistent child process with sequential request queue
// ---------------------------------------------------------------------------

/**
 * Keeps one helper process alive between calls (--listen-stdin --persistent).
 *
 * All calls are serialised (one in-flight at a time) so both sides stay in
 * lock-step without needing response-ID correlation.
 *
 * Response parsing uses a string-aware JSON object detector so it correctly
 * handles `{` / `}` characters that appear inside JSON string values.
 */
class HelperDaemon {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pendingResolve: ((v: any) => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** Promise chain used to serialise concurrent callCommand() calls */
  private queueTail: Promise<void> = Promise.resolve();
  private shuttingDown = false;

  constructor(
    public readonly exePath: string,
    private buildEnv: () => NodeJS.ProcessEnv,
  ) {}

  // -- Lifecycle --------------------------------------------------------------

  start(): void {
    if (this.proc && !this.proc.killed) return;
    this.buffer = '';
    const proc = spawn(this.exePath, ['--listen-stdin', '--persistent'], {
      env: this.buildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;

    proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    proc.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf8').trim();
      if (msg) globalLogger.warn('HelperDaemon', `[${path.basename(this.exePath)}] stderr: ${msg}`);
    });
    proc.on('close', (code) => {
      globalLogger.debug('HelperDaemon', `[${path.basename(this.exePath)}] exited code=${code}`);
      this.proc = null;
      if (this.pendingResolve) {
        const pr = this.pendingResolve;
        this.pendingResolve = null;
        if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
        pr({ success: false, error: `daemon_exited: helper process exited with code=${code}` });
      }
      // Auto-restart unless we are shutting down
      if (!this.shuttingDown) {
        globalLogger.info('HelperDaemon', `[${path.basename(this.exePath)}] restarting daemon...`);
        setTimeout(() => this.start(), 1000);
      }
    });
    proc.on('error', (e) => {
      globalLogger.error('HelperDaemon', `[${path.basename(this.exePath)}] spawn error: ${e.message}`);
      if (this.pendingResolve) {
        const pr = this.pendingResolve;
        this.pendingResolve = null;
        if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
        pr({ success: false, error: `daemon_spawn_error: ${e.message}` });
      }
    });

    globalLogger.debug('HelperDaemon', `[${path.basename(this.exePath)}] persistent daemon started`);
  }

  shutdown(): void {
    this.shuttingDown = true;
    if (this.proc) {
      try { this.proc.stdin?.write(JSON.stringify({ action: '_exit' }) + '\n'); } catch { /* ignore */ }
      setTimeout(() => { try { this.proc?.kill(); } catch { /* ignore */ } }, 500);
    }
  }

  /** Send _ping and verify the daemon is alive. Returns true if pong received within timeoutMs. */
  async ping(timeoutMs = 3000): Promise<boolean> {
    try {
      const result = await this.call('', '_ping', timeoutMs);
      return result?.pong === true || result?.success === true;
    } catch {
      return false;
    }
  }

  // -- Data processing --------------------------------------------------------

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    // Try to extract a complete JSON object from the accumulated buffer
    const { json, remaining } = HelperDaemon.extractJson(this.buffer);
    if (json !== null) {
      this.buffer = remaining;
      this.dispatchResponse(json);
    }
  }

  private dispatchResponse(json: string): void {
    const pr = this.pendingResolve;
    if (!pr) return;
    this.pendingResolve = null;
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
    try {
      pr(JSON.parse(json));
    } catch {
      pr({ success: false, error: 'parse_error', raw: json.slice(0, 200) });
    }
  }

  /**
   * String-aware JSON object extractor.
   * Correctly handles `{` / `}` inside JSON string values.
   * Returns the first complete JSON object found in `buf` and the remainder.
   */
  static extractJson(buf: string): { json: string | null; remaining: string } {
    let depth = 0;
    let inString = false;
    let escape = false;
    let start = -1;

    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];

      if (escape)       { escape = false; continue; }
      if (inString) {
        if (c === '\\') { escape = true; continue; }
        if (c === '"')  { inString = false; continue; }
        continue;
      }

      if (c === '"')    { inString = true; continue; }
      if (c === '{')    { if (depth === 0) start = i; depth++; }
      else if (c === '}') {
        if (depth > 0) depth--;
        if (depth === 0 && start >= 0) {
          return { json: buf.slice(start, i + 1), remaining: buf.slice(i + 1) };
        }
      }
    }
    return { json: null, remaining: buf };
  }

  // -- Call -------------------------------------------------------------------

  /**
   * Send one request to the daemon and wait for the response.
   * Calls are serialised via a promise queue (one in-flight at a time).
   */
  call(target: string, action: string, timeoutMs: number): Promise<any> {
    // Append to the serial queue
    let releaseQueue!: () => void;
    const mySlot = this.queueTail;
    this.queueTail = new Promise<void>(r => { releaseQueue = r; });

    return mySlot.then(() =>
      new Promise<any>((resolve) => {
        // Ensure daemon is alive
        if (!this.proc || this.proc.killed) this.start();

        this.pendingResolve = (v: any) => { releaseQueue(); resolve(v); };
        this.pendingTimer = setTimeout(() => {
          const pr = this.pendingResolve;
          this.pendingResolve = null;
          this.pendingTimer = null;
          if (pr) { releaseQueue(); pr({ success: false, error: `helper_timeout: no response after ${timeoutMs}ms` }); }
        }, timeoutMs);

        const msg = JSON.stringify({ id: '1', target, action }) + '\n';
        try {
          this.proc!.stdin!.write(msg);
        } catch (e) {
          const pr = this.pendingResolve;
          this.pendingResolve = null;
          if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
          if (pr) { releaseQueue(); pr({ success: false, error: `write_error: ${e}` }); }
        }
      })
    );
  }
}

// ---------------------------------------------------------------------------
// HelperRegistry
// ---------------------------------------------------------------------------

/**
 * Discovers .exe helpers via --api-schema, registers them as MCP tools,
 * and routes tool calls to persistent daemon processes.
 */
export class HelperRegistry {
  private schemas: Map<string, HelperSchema> = new Map();
  private daemons: Map<string, HelperDaemon> = new Map();
  private sessionToken: string | undefined;
  private sessionSecret: string | undefined;

  constructor(sessionToken?: string, sessionSecret?: string) {
    this.sessionToken = sessionToken;
    this.sessionSecret = sessionSecret;
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  async discoverHelpers(searchPaths: string[]): Promise<void> {
    for (const dir of searchPaths) {
      if (!fs.existsSync(dir)) continue;
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { continue; }

      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.exe')) continue;
        const exePath = path.join(dir, entry);
        try {
          const schema = await this.querySchema(exePath);
          if (schema) {
            schema.filePath = exePath;
            schema.toolName = 'helper_' + schema.helper
              .replace(/\.exe$/i, '')
              .replace(/[^a-zA-Z0-9]/g, '_');
            this.schemas.set(schema.helper, schema);

            // Start persistent daemon immediately after discovery
            const daemon = new HelperDaemon(exePath, () => this.buildEnv());
            daemon.start();
            this.daemons.set(schema.helper, daemon);

            globalLogger.info('HelperRegistry',
              `Discovered: ${schema.helper} v${schema.version} (${schema.commands.length} commands)`);
          }
        } catch (e) {
          globalLogger.debug('HelperRegistry', `Skipping ${entry}: ${e}`);
        }
      }
    }
  }

  /** Run --api-schema (one-shot) to get the helper's JSON schema. */
  private querySchema(exePath: string): Promise<HelperSchema | null> {
    return new Promise((resolve) => {
      const env = this.buildEnv();
      const proc = spawn(exePath, ['--api-schema'], { env, timeout: 5000 });
      let out = '';
      proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
      proc.on('close', () => {
        try {
          const start = out.indexOf('{');
          const end   = out.lastIndexOf('}');
          if (start === -1 || end === -1) { resolve(null); return; }
          resolve(JSON.parse(out.substring(start, end + 1)) as HelperSchema);
        } catch { resolve(null); }
      });
      proc.on('error', () => resolve(null));
    });
  }

  /** Gracefully shut down all daemon processes. */
  shutdownAll(): void {
    for (const daemon of this.daemons.values()) daemon.shutdown();
    this.daemons.clear();
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getAll(): HelperSchema[] { return [...this.schemas.values()]; }
  get(helperName: string): HelperSchema | undefined { return this.schemas.get(helperName); }
  getByToolName(toolName: string): HelperSchema | undefined {
    return [...this.schemas.values()].find(s => s.toolName === toolName);
  }

  // ---------------------------------------------------------------------------
  // MCP integration
  // ---------------------------------------------------------------------------

  toMcpTools(): any[] {
    return this.getAll().map(schema => {
      const modeSummary = schema.window_modes && schema.window_modes.length
        ? ' Window modes: ' +
          schema.window_modes.map(m => `${m.mode} (${m.description}; e.g. ${m.examples.join(', ')})`)
            .join(' | ') + '.'
        : '';
      const teardownSummary = schema.teardown_policies && schema.teardown_policies.length
        ? ' Teardown policies: ' + schema.teardown_policies.join(', ') +
          '. Default is leave_open (non-destructive). ' +
          'Ask the user before using discard_doc/discard_tab or close_app.'
        : '';
      const cmdHints = schema.commands.map(c => `${c.name}: ${c.description}`).join('; ');

      return {
        name: schema.toolName,
        description:
          `[${schema.helper} v${schema.version}] ${schema.description}` +
          modeSummary + teardownSummary +
          ` Available commands: ${schema.commands.map(c => c.name).join(', ')}.`,
        inputSchema: {
          type: 'object',
          properties: {
            target: {
              type: 'string',
              description: schema.targetDescription ??
                'Target window or process. ' +
                'First call LISTWINDOWS to find existing instances and reuse them. ' +
                'Formats: window title substring, process name, "PID:<n>", "HANDLE:<n>".',
            },
            command: {
              type: 'string',
              enum: schema.commands.map(c => c.name),
              description: 'Command to execute. ' + cmdHints,
            },
            parameter: {
              type: 'string',
              description:
                'Optional command parameter. AutomationId for CLICKID; depth for QUERYTREE; ' +
                'text/special-keys for SENDKEYS ({CTRL+C}, {CTRL+V}, {ENTER}, {TAB}, {ESC}); ' +
                'CSS selector for browser CLICKID; selector:value for browser FILL.',
            },
          },
          required: ['target', 'command'],
        },
      };
    });
  }

  /**
   * Execute a command via the correct helper's persistent daemon.
   *
   * Wire format (one JSON line to stdin):
   *   {"id":"1","target":"<target>","action":"{COMMAND:param}"}
   */
  async callCommand(
    helperName: string,
    target: string,
    command: string,
    parameter: string = '',
    timeoutMs = 20000,
  ): Promise<any> {
    const schema = this.schemas.get(helperName);
    if (!schema) throw new Error(`Helper not found: ${helperName}`);

    const action = parameter ? `{${command}:${parameter}}` : `{${command}}`;
    globalLogger.info('keywin', `>> ${helperName}  target="${target}"  action=${action}`);

    const daemon = this.daemons.get(helperName);
    if (!daemon) throw new Error(`No daemon for helper: ${helperName}`);

    const result = await daemon.call(target, action, timeoutMs);
    globalLogger.info('keywin', `<< ${helperName}  success=${result?.success}`);
    globalLogger.logJSON('debug', 'keywin', 'Response', result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...(this.sessionToken  ? { MCP_SESSION_TOKEN:  this.sessionToken  } : {}),
      ...(this.sessionSecret ? { MCP_SESSION_SECRET: this.sessionSecret } : {}),
      SKIP_SESSION_AUTH: 'true',
    };
  }
}
