import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
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
  /** MCP tool name — binary name without .exe, e.g. "KeyWin", "MSOfficeWin", "BrowserWin" */
  toolName: string;
}

// ---------------------------------------------------------------------------
// Universal call argument model  (CONVENTIONS.md §2.6)
// ---------------------------------------------------------------------------

/**
 * Structured MCP call arguments accepted by every helper tool.
 *
 * Five orthogonal fields forming a hierarchical address (CONVENTIONS.md §2.0):
 *   helper  → L0: WHICH automation domain (MSOfficeWin / KeyWin / BrowserWin)
 *   proc    → L1–L3: WHICH container chain (OS process // sub-window // document)
 *   action  → WHAT to do  (command verb: FORMAT / READ / WRITE / CLICKID / …)
 *   path    → L4+: WHERE inside the document / element tree (XPath-style)
 *   value   → payload / value to write or send
 *
 * The full conceptual address is:
 *   //[helper:X] //[L1-OS]//[L2-subwin]//[L3-doc]  //element-path
 *    ↑ tool name   ↑————— proc —————↑   ↑——— path ———↑
 */
export interface HelperCallArgs {
  /**
   * C# helper binary name.  The implicit **L0** container of the address grammar.
   * (CONVENTIONS.md §2.0: helper = outermost level; tool name pre-fills it.)
   *
   * Normally implicit in the MCP tool name — only set this explicitly when using
   * a generic dispatcher tool.
   * Values: "MSOfficeWin" | "KeyWin" | "BrowserWin" | any registered helper.
   */
  helper?: string;

  /**
   * Container hierarchy filter: L1 (OS process) → L2 (sub-window) → L3 (document/tab).
   * Levels are separated by `//`.  Each level is a `[key:val;key:val]` bracket
   * using the same syntax as security firewall rules (CONVENTIONS.md §2.0/§2.4).
   * Omit entirely → helper uses its active/foreground instance.
   *
   * Level keys:
   *   L1 OS:      pid  handle  hwnd  procname  sha256  sha512  title
   *   L2 subwin:  subwindowhandle  frame  pane
   *   L3 doc/tab: docname  url  tabid  page
   *
   * Examples:
   *   "WINWORD.EXE"                                       bare name → L1 procname
   *   "[pid:1234]"                                        L1 only
   *   "[procname:WINWORD.EXE]//[docname:Budget.xlsx]"     L1 + L3
   *   "[pid:8800]//[url:https://github.com/pulls]"        L1 + L3 (URL with slashes: safe inside [])
   *   "[pid:123]//[subwindowhandle:0x2A4]//[tabid:3]"     L1 + L2 + L3
   *
   * Note: `helper` (the tool name) is **L0** — it is never written inside `proc`.
   * Firewall rule `proc-filter` column mirrors this syntax exactly.
   */
  proc?: string;

  /**
   * Command / action name.  E.g. FORMAT  READ  WRITE  CLICKID  SENDKEYS.
   */
  action?: string;

  /**
   * Element address within the already-identified container (pure XPath / CSS style).
   * No container information here — that all lives in `helper` (L0) and `proc` (L1–L3).
   * Leading `//` is optional.
   *
   * Examples:
   *   Word:        //body/para[20]          //body/bookmark[@name='Summary']
   *   Excel:       //sheet[@name='Q1']/cell[@addr='B2:D5']
   *   PowerPoint:  //slide[2]/shape[@name='Title']
   *   UIA Win32:   //Button[@id='num1Button']
   *   Browser:     //*[@id='compose']
   *
   * Relative (planned): prefix with `.//` to continue from caller context:
   *   .//Edit[@name='username']
   */
  path?: string;

  /**
   * Payload / value to write, apply, or send to the addressed element.
   */
  value?: string;
}

// ---------------------------------------------------------------------------
// Path / proc normalisation  (CONVENTIONS.md §2.6)
// ---------------------------------------------------------------------------

/** Parse a [key:val;key:val] filter string into a map. */
function parseFilterBracket(bracket: string): Record<string, string> {
  const fmap: Record<string, string> = {};
  bracket.split(';').filter(Boolean).forEach(f => {
    const colon = f.indexOf(':');
    if (colon > 0) fmap[f.slice(0, colon).trim().toLowerCase()] = f.slice(colon + 1).trim();
  });
  return fmap;
}

/**
 * Split a `proc` string into its `//`-separated container levels and parse each
 * level's `[key:val;key:val]` bracket.
 *
 * Splitting on `//` is safe because `//` can only appear at the outer level —
 * between `]` (end of one level) and `[` (start of next). Slashes inside a
 * bracket value are inert because the value terminates at `]`.
 *
 * A bare string with no `[` brackets is treated as L1 `procname`.
 */
function parseProcLevels(proc: string): Record<string, string>[] {
  // Strip any leading // — the grammar allows proc to start with '//['
  // e.g. "//[procname:WINWORD.EXE]//[docname:Budget.xlsx]"
  const raw = proc.trim().replace(/^\/\//, '');
  if (!raw.startsWith('[')) {
    // Legacy address forms passed through as-is from scenarios/vars:
    //   chrome:URL:<u> — BrowserWin tab by URL prefix
    //   chrome:TITLE:<t> — BrowserWin tab by title
    //   PAGE:<id> — BrowserWin tab by CDP id
    //   HANDLE:<n>, PID:<n>, SYSTEM, chrome, …
    // Return as synthetic { _legacy: raw } so procFilterToTarget can pass through.
    return [{ _legacy: raw }];
  }

  // Split on // that appears between ] and [
  return raw.split(/\]\s*\/\/\s*\[/).map((seg, i, arr) => {
    // First segment: strip leading [; last segment already lost trailing ]; middle: both gone
    const inner = (i === 0 ? seg.slice(1) : seg).replace(/\]$/, '');
    return parseFilterBracket(inner);
  });
}

/**
 * Translate a `proc` field (multi-level `//`-separated container hierarchy) to
 * the single target string the current C# helper wire protocol expects.
 *
 * Levels are walked from innermost (rightmost) to outermost.  The first level
 * that yields a recognised key wins, so the most specific container takes
 * precedence over the OS-level identity — which is what C# needs as `target`.
 *
 * Level key groups (see CONVENTIONS.md §2.0):
 *   L3 doc/tab      docname → DOCNAME:x  |  url → chrome:URL:x  |  tabid/page → PAGE:n
 *   L2 sub-window   subwindowhandle → HANDLE:x
 *   L1 OS process   handle/hwnd → HANDLE:x  |  pid → PID:n  |  sha256 → SHA256:x
 *                   sha512 → SHA512:x  |  title (window title)  |  procname (glob)
 */
function procFilterToTarget(raw: string): string {
  const levels = parseProcLevels(raw);
  for (let i = levels.length - 1; i >= 0; i--) {
    const f = levels[i];
    // Legacy address string (chrome:URL:..., PAGE:..., HANDLE:..., etc.) — pass through
    if (f['_legacy'] !== undefined)      return f['_legacy'];
    // L3 — document / tab (most app-specific, highest priority for current wire)
    if (f['docname'])          return `DOCNAME:${f['docname']}`;
    if (f['url'])              return `chrome:URL:${f['url']}`;
    if (f['tabid'])            return `PAGE:${f['tabid']}`;
    if (f['page'])             return `PAGE:${f['page']}`;
    // L2 — sub-window
    if (f['subwindowhandle'])  return `HANDLE:${f['subwindowhandle']}`;
    // L1 — OS process
    if (f['handle'])           return `HANDLE:${f['handle']}`;
    if (f['hwnd'])             return `HANDLE:${f['hwnd']}`;
    if (f['pid'])              return `PID:${f['pid']}`;
    if (f['sha256'])           return `SHA256:${f['sha256']}`;
    if (f['sha512'])           return `SHA512:${f['sha512']}`;
    if (f['title'])            return f['title'];     // OS window-title substring
    if (f['procname']) {
      // Translate well-known Office exe names to their MSOfficeWin short aliases
      const pn = f['procname'].toUpperCase();
      if (pn.includes('EXCEL'))                         return 'excel';
      if (pn.includes('WINWORD') || pn.includes('WORD')) return 'word';
      if (pn.includes('POWERPNT') || pn.includes('PPT')) return 'powerpoint';
      return f['procname']; // general procname pass-through (KeyWin/BrowserWin)
    }
  }
  return ''; // unrecognised / no levels — helper uses its default instance
}

/**
 * Normalise the `path` field for the helper wire protocol.
 *
 * - Office (MSOfficeWin): canonical XPath-like paths pass through as-is.
 *   ComPathWalker in C# evaluates them directly — no TS-side translation needed.
 * - UIA (KeyWin): `Button[@id='X']` or `*[@id='X']` → bare AutomationId.
 * - Browser (BrowserWin): `*[@id='X']` → `#X`,  `*[@class='X']` → `.X`.
 * - Everything else passes through unchanged.
 *
 * Returns '' if path is empty/whitespace.
 */
export function pathToAddress(segments: string): string {
  const s = segments.replace(/^\/+/, '').trim(); // strip leading slashes
  if (!s) return '';

  // ── UIA (KeyWin) ──────────────────────────────────────────────────────────
  // Button[@id='X'] or *[@id='X']  → bare AutomationId
  const uiaId = s.match(/^[\w*]+\[@id='([^']+)'\]$/);
  if (uiaId)                                 return uiaId[1];

  // *[@name='X']  → Name fallback
  const uiaName = s.match(/^\*\[@name='([^']+)'\]$/);
  if (uiaName)                               return uiaName[1];

  // ── Browser CSS shortcuts ─────────────────────────────────────────────────
  // *[@id='X']   → #X  (note: already matched by uiaId above; kept for clarity)
  const cssId = s.match(/^\*\[@id='([^']+)'\]$/);
  if (cssId)                                 return `#${cssId[1]}`;

  // *[@class='X'] → .X
  const cssClass = s.match(/^\*\[@class='([^']+)'\]$/);
  if (cssClass)                              return `.${cssClass[1]}`;

  // *[@data-attr='X'] → [data-attr='X']  (standard CSS attribute selector)
  const cssDataAttr = s.match(/^\*\[@(data-[\w-]+)='([^']+)'\]$/);
  if (cssDataAttr)                           return `[${cssDataAttr[1]}='${cssDataAttr[2]}']`;

  // ── All other helpers (MSOfficeWin, etc.) — pass canonical path through ──
  // ComPathWalker and similar C# walkers evaluate the canonical form directly.
  return s;
}

/**
 * Translate HelperCallArgs into the {target, command, parameter} triple that
 * callCommand() / the C# helper wire protocol expects.
 *
 * Mapping (see CONVENTIONS.md §2.0 and §2.7):
 *   proc   → target   (innermost proc level wins; via parseProcLevels + procFilterToTarget)
 *   action → command  (verb, passed through)
 *   path   → address  (pure element XPath; via pathToAddress abbreviation layer)
 *   value  → sent as separate JSON "value" field
 *
 * ⟹ { target, command, path, value }  → callCommand()  → C# wire (§2.7)
 */
export function resolveCallArgs(args: HelperCallArgs): { target: string; command: string; path: string; value: string } {
  // ── target from proc ──────────────────────────────────────────────────
  const target = args.proc ? procFilterToTarget(args.proc) : '';

  // ── command from action ───────────────────────────────────────────────
  const command = (args.action ?? '').trim();

  // ── path: address from path field ────────────────────────────────────
  let addrPath = '';
  if (args.path) {
    const p = args.path.replace(/^\/+/, ''); // strip leading slashes
    const converted = pathToAddress(p);
    if (converted) addrPath = converted;
  }

  // ── value: passed through separately ─────────────────────────────────
  const value = args.value ?? '';

  return { target, command, path: addrPath, value };
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
export class HelperDaemon {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pendingResolve: ((v: any) => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** Promise chain used to serialise concurrent callCommand() calls */
  private queueTail: Promise<void> = Promise.resolve();
  private shuttingDown = false;
  /** Monotonically-incrementing request sequence — echoed by HelperCommon as "id" */
  private requestSeq = 0;
  /** Auth startup phase.  'skip' only when SKIP_SESSION_AUTH=true is explicitly inherited from the environment. */
  private startupPhase: 'skip' | 'awaiting_hello' | 'awaiting_ok' | 'ready' = 'skip';
  /** Resolved immediately (SKIP_SESSION_AUTH=true) or after _auth_ok is received. */
  private readyPromise: Promise<void> = Promise.resolve();
  private startupResolve: (() => void) | null = null;
  private startupReject: ((e: Error) => void) | null = null;
  /** PKCS#8 DER private key bytes supplied by HelperRegistry; forwarded in _auth and used for HKDF. */
  pkBytes: Buffer | null = null;
  /** Absolute path to config/security/config.json; forwarded in _auth. */
  securityConfigPath: string = '';
  /** Per-message HMAC-SHA256 session key derived after _auth_ok; null until handshake completes. */
  private sessionKey: Buffer | null = null;
  /** Server nonce (base64) generated during awaiting_hello; retained for HKDF derivation. */
  private pendingServerNonce: string | null = null;
  /** Helper nonce (base64) received in _auth_hello; retained for HKDF derivation. */
  private pendingHelperNonce: string | null = null;
  /** Resolved when the daemon process fires its close event during shutdown. */
  private shutdownResolve: (() => void) | null = null;

  constructor(
    public readonly exePath: string,
    private buildEnv: () => NodeJS.ProcessEnv,
  ) {}

  // -- Lifecycle --------------------------------------------------------------

  start(): void {
    if (this.proc && !this.proc.killed) return;
    this.buffer = '';
    // Determine auth mode and set up readyPromise before spawning so that
    // onData() routes correctly from the first byte received.
    const env = this.buildEnv();
    const skipAuth = env['SKIP_SESSION_AUTH'] === 'true';
    if (skipAuth) {
      this.startupPhase = 'skip';
      this.readyPromise = Promise.resolve();
    } else {
      this.startupPhase = 'awaiting_hello';
      this.readyPromise = new Promise<void>((resolve, reject) => {
        this.startupResolve = resolve;
        this.startupReject  = reject;
      });
    }
    const proc = spawn(this.exePath, ['--listen-stdin', '--persistent'], {
      env,
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
      // Resolve the shutdown promise if one is waiting
      const sr = this.shutdownResolve;
      this.shutdownResolve = null;
      sr?.();
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

  shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (!this.proc) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.shutdownResolve = resolve;
      try { this.proc!.stdin?.write(JSON.stringify({ action: '_exit' }) + '\n'); } catch { /* ignore */ }
      // Force-kill safety net in case _exit is not acknowledged within 1 s
      setTimeout(() => { try { this.proc?.kill(); } catch { /* ignore */ } }, 1000);
    });
  }

  /** Send _ping and verify the daemon is alive. Returns true if pong received within timeoutMs. */
  async ping(timeoutMs = 3000): Promise<boolean> {
    try {
      const result = await this.call('', '_ping', '', '', timeoutMs);
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
      if (this.startupPhase === 'awaiting_hello' || this.startupPhase === 'awaiting_ok') {
        this.handleStartupMessage(json);
      } else {
        this.dispatchResponse(json);
      }
    }
  }

  /**
   * Handle the _auth_hello / _auth_ok exchange on the TypeScript (server) side.
   * Active whenever SKIP_SESSION_AUTH is absent from the daemon environment,
   * which is now always the case — buildEnv() strips the variable unconditionally.
   * When no crypto credentials are present the server sends pk:'' and the helper
   * completes the exchange without HKDF derivation (graceful no-key path).
   *
   * Protocol:
   *   Helper sends: {"action":"_auth_hello","helperNonce":"<b64>","exeHash":"<hex>", ...}
   *   Server sends: {"action":"_auth","pk":"<b64|''>","serverNonce":"<b64>","securityConfig":"<path|''>"}
   *   Helper sends: {"action":"_auth_ok"}
   *   → readyPromise resolves; normal command traffic begins (with HMAC signing when key present).
   */
  private handleStartupMessage(json: string): void {
    try {
      const msg = JSON.parse(json);
      if (this.startupPhase === 'awaiting_hello') {
        if (msg.action !== '_auth_hello') {
          this.startupPhase = 'ready';
          this.startupReject?.(new Error(`auth_protocol: expected _auth_hello, got action=${msg.action}`));
          return;
        }
        // Verify msg.exeHash against security/config.json binaryHashes.
        const exeHash: string = typeof msg.exeHash === 'string' ? msg.exeHash.toLowerCase() : '';
        if (exeHash && this.securityConfigPath) {
          try {
            const cfgRaw = fs.readFileSync(this.securityConfigPath, 'utf8');
            const cfg = JSON.parse(cfgRaw) as Record<string, unknown>;
            const bh = ((cfg?.binaryHashes ?? {}) as Record<string,
              { path?: string; sha256?: string }>);
            const exeBasename = path.basename(this.exePath).toLowerCase();
            let expectedHash: string | null = null;
            for (const entry of Object.values(bh)) {
              const entryBasename = entry?.path
                ? path.basename(entry.path).toLowerCase() : '';
              if (entryBasename === exeBasename) {
                expectedHash = (entry.sha256 ?? '').toLowerCase();
                break;
              }
            }
            if (expectedHash) {
              if (exeHash !== expectedHash) {
                globalLogger.warn('HelperDaemon',
                  `[${path.basename(this.exePath)}] ⚠ exeHash MISMATCH — ` +
                  `expected ${expectedHash.slice(0, 16)}... ` +
                  `got ${exeHash.slice(0, 16)}...`);
                this.startupPhase = 'ready';
                this.startupReject?.(new Error(
                  `security: exeHash mismatch for ${path.basename(this.exePath)}`));
                return;
              }
              globalLogger.debug('HelperDaemon',
                `[${path.basename(this.exePath)}] exeHash verified ✓`);
            } else {
              globalLogger.debug('HelperDaemon',
                `[${path.basename(this.exePath)}] exeHash not in config — unregistered helper`);
            }
          } catch (e) {
            globalLogger.debug('HelperDaemon',
              `[${path.basename(this.exePath)}] exeHash config read error: ${e}`);
          }
        }
        this.pendingHelperNonce = (msg.helperNonce as string) ?? null;
        const serverNonce = crypto.randomBytes(32).toString('base64');
        this.pendingServerNonce = serverNonce;
        const pkB64 = this.pkBytes ? this.pkBytes.toString('base64') : '';
        const authMsg = JSON.stringify({
          action: '_auth',
          pk: pkB64,
          serverNonce,
          securityConfig: this.securityConfigPath,
          helperExePath: this.exePath,
        });
        this.proc!.stdin!.write(authMsg + '\n');
        this.startupPhase = 'awaiting_ok';
        globalLogger.debug('HelperDaemon', `[${path.basename(this.exePath)}] _auth sent to helper`);
      } else if (this.startupPhase === 'awaiting_ok') {
        if (msg.action !== '_auth_ok') {
          this.startupPhase = 'ready';
          this.startupReject?.(new Error(`auth_protocol: expected _auth_ok, got action=${msg.action}`));
          return;
        }
        this.startupPhase = 'ready';
        // Derive per-session HMAC key via HKDF-SHA256 when pkBytes are available.
        if (this.pkBytes && this.pkBytes.length > 0 && this.pendingServerNonce && this.pendingHelperNonce) {
          try {
            const srvNonce = Buffer.from(this.pendingServerNonce, 'base64');
            const hlpNonce = Buffer.from(this.pendingHelperNonce, 'base64');
            const saltSrc  = Buffer.concat([srvNonce, hlpNonce]);
            const salt     = crypto.createHash('sha256').update(saltSrc).digest();
            this.sessionKey = Buffer.from(
              crypto.hkdfSync('sha256', this.pkBytes, salt, Buffer.from('AIAPI-v1-session'), 32)
            );
            globalLogger.debug('HelperDaemon',
              `[${path.basename(this.exePath)}] HKDF session key derived (32 bytes)`);
          } catch (e) {
            globalLogger.warn('HelperDaemon',
              `[${path.basename(this.exePath)}] HKDF derivation failed: ${e}`);
          }
        }
        this.pendingServerNonce = null;
        this.pendingHelperNonce = null;
        this.startupResolve?.();
        globalLogger.info('HelperDaemon', `[${path.basename(this.exePath)}] auth handshake complete`);
      }
    } catch (e) {
      this.startupPhase = 'ready';
      this.startupReject?.(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private dispatchResponse(json: string): void {
    const pr = this.pendingResolve;
    if (!pr) return;
    this.pendingResolve = null;
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
    // Verify HMAC signature if the session key has been established.
    if (this.sessionKey) {
      const hmacMatch = /,"hmac":"([0-9a-f]{64})"\}$/.exec(json);
      if (hmacMatch) {
        const received = hmacMatch[1];
        // Strip the trailing ,"hmac":"..."} to reconstruct the original signed body.
        const body = json.slice(0, -(hmacMatch[0].length)) + '}';
        const expected = crypto.createHmac('sha256', this.sessionKey).update(body).digest('hex');
        if (received !== expected) {
          pr({ success: false, error: 'hmac_mismatch' });
          return;
        }
      }
    }
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

  /**
   * Send one request to the daemon and wait for the response.
   * Calls are serialised via a promise queue (one in-flight at a time).
   *
   * Wire format (new — §2.7 target format):
   *   { id, proc, action, path?, value? }
   * `proc` carries the resolved target string (pre-translated by procFilterToTarget).
   * `action` is the bare command verb.
   * `path` and `value` are omitted from JSON when empty.
   *
   * Internal commands (_ping, _schema, _exit) pass empty proc/path/value;
   * C# handles them before any reassembly.
   */
  call(target: string, command: string, elemPath: string = '', value: string = '', timeoutMs: number = 20000,
       callerUser: string = '', callerRoles: string = '', scroll: boolean = false): Promise<any> {
    // Append to the serial queue
    let releaseQueue!: () => void;
    const mySlot = this.queueTail;
    this.queueTail = new Promise<void>(r => { releaseQueue = r; });

    return mySlot.then(async () => {
      // Ensure daemon is alive (also resets readyPromise+startupPhase when restarting).
      if (!this.proc || this.proc.killed) this.start();

      // Wait for auth handshake (resolves immediately when SKIP_SESSION_AUTH=true).
      await this.readyPromise;

      return new Promise<any>((resolve) => {
        this.pendingResolve = (v: any) => { releaseQueue(); resolve(v); };
        this.pendingTimer = setTimeout(() => {
          const pr = this.pendingResolve;
          this.pendingResolve = null;
          this.pendingTimer = null;
          if (pr) { releaseQueue(); pr({ success: false, error: `helper_timeout: no response after ${timeoutMs}ms` }); }
        }, timeoutMs);

        const reqId = String(++this.requestSeq);
        // Build the wire JSON with separate fields (§2.7 target wire format).
        // Omit empty path / value to keep messages compact.
        const reqObj: Record<string, string> = { id: reqId, proc: target, action: command };
        if (elemPath)   reqObj.path          = elemPath;
        if (value)      reqObj.value         = value;
        if (scroll)     reqObj.scroll        = 'true';
        if (callerUser)  reqObj._caller_user  = callerUser;
        if (callerRoles) reqObj._caller_roles = callerRoles;
        const body = JSON.stringify(reqObj);
        // Append HMAC field when the session key has been established.
        const wireMsg = this.sessionKey
          ? body.slice(0, -1) + ',"hmac":"' +
            crypto.createHmac('sha256', this.sessionKey).update(body).digest('hex') + '"}'
          : body;
        try {
          this.proc!.stdin!.write(wireMsg + '\n');
        } catch (e) {
          const pr = this.pendingResolve;
          this.pendingResolve = null;
          if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
          if (pr) { releaseQueue(); pr({ success: false, error: `write_error: ${e}` }); }
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// HelperRegistry
// ---------------------------------------------------------------------------

/** One row written to session.log (JSONL) per helper call. */
interface SessionLogEntry {
  ts: string;
  seq: number;
  helper: string;
  target: string;
  command: string;
  parameter: string;
  success: boolean;
  durationMs: number;
  error?: string;
  screenshotFile?: string;
}

/** State kept for the currently-open test session. */
interface ActiveSession {
  name: string;
  dir: string;
  logPath: string;
  logFd: number;        // open file descriptor → JSONL append
  startTime: number;
  commandCount: number;
  failCount: number;
}

/**
 * Discovers .exe helpers via {"action":"_schema"} stdin wire protocol, registers them as MCP tools,
 * and routes tool calls to persistent daemon processes.
 */
export class HelperRegistry {
  private schemas: Map<string, HelperSchema> = new Map();
  private daemons: Map<string, HelperDaemon> = new Map();
  private searchPaths: string[] = [];
  /** Active test-session recording state; null when no session is open. */
  private activeSession: ActiveSession | null = null;
  /** Base directory where session folders are created. */
  private sessionBaseDir: string = './test/sessionlogs';
  /** PKCS#8 DER private key bytes (from CertificateManager); forwarded to daemons for HKDF. */
  private pkBytes: Buffer | null = null;
  /** Absolute path to config/security/config.json; forwarded to daemons during _auth. */
  private securityConfigPath: string = path.resolve('config/security/config.json');

  constructor() {}

  /**
   * Supply PKCS#8 DER private key bytes (from `CertificateManager.getRawPrivateKeyBytes(password)`)
   * and an optional security config path so that HelperDaemon instances can complete the _auth
   * handshake and derive per-session HMAC keys for authenticated stdin traffic.
   *
   * Call before `discoverHelpers()` for best effect; also propagates immediately to any daemons
   * already running (they will use the new credentials on the next restart / handshake).
   */
  setCryptoCredentials(pkBytes: Buffer, configPath?: string): void {
    this.pkBytes = pkBytes;
    if (configPath) this.securityConfigPath = path.resolve(configPath);
    // Propagate to any already-running daemons.
    for (const daemon of this.daemons.values()) {
      daemon.pkBytes = pkBytes;
      if (configPath) daemon.securityConfigPath = path.resolve(configPath);
    }
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  async discoverHelpers(searchPaths: string[]): Promise<void> {
    this.searchPaths = searchPaths;  // remember for reloadHelpers()
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
            // Tool name = binary stem (no .exe, no prefix).
            // Non-alphanumeric chars replaced with _ to keep a valid MCP identifier.
            schema.toolName = schema.helper
              .replace(/\.exe$/i, '')
              .replace(/[^a-zA-Z0-9]/g, '_');
            this.schemas.set(schema.helper, schema);

            // Start persistent daemon immediately after discovery
            const daemon = new HelperDaemon(exePath, () => this.buildEnv());
            daemon.pkBytes = this.pkBytes;
            daemon.securityConfigPath = this.securityConfigPath;
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

  /** Query the helper's JSON schema via the unified stdin wire protocol (`{"action":"_schema"}`). */
  private querySchema(exePath: string): Promise<HelperSchema | null> {
    return new Promise((resolve) => {
      // Schema probing is a one-shot capability query, NOT a session.
      // Always bypass the auth handshake here — the persistent daemon (started
      // separately with buildEnv()) is where the full handshake runs.
      const env = { ...process.env, SKIP_SESSION_AUTH: 'true' };
      // Use --listen-stdin (one-shot) + {"action":"_schema"} — same wire protocol as commands,
      // eliminates the need for a separate --api-schema code path in helpers.
      const proc = spawn(exePath, ['--listen-stdin'], { env, timeout: 5000 });
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
      // Send _schema request and close stdin — one-shot mode exits after first command
      proc.stdin.write('{"action":"_schema"}\n');
      proc.stdin.end();
    });
  }

  /** Gracefully shut down all daemon processes. Returns when all have exited. */
  async shutdownAll(): Promise<void> {
    const promises = Array.from(this.daemons.values()).map((d) => d.shutdown());
    this.daemons.clear();
    await Promise.all(promises);
  }

  /**
   * Hot-reload: shutdown all daemons, clear schema registry, re-discover.
   * Useful after rebuilding helper .exe files without restarting the server.
   */
  async reloadHelpers(): Promise<{ reloaded: number; helpers: string[] }> {
    await this.shutdownAll();
    this.schemas.clear();
    await this.discoverHelpers(this.searchPaths);
    const helpers = this.getAll().map(s => s.helper);
    return { reloaded: helpers.length, helpers };
  }

  // ---------------------------------------------------------------------------
  // Test-Session Recording
  // ---------------------------------------------------------------------------

  /** Override the base directory where session folders are created. */
  setSessionBaseDir(dir: string): void {
    this.sessionBaseDir = dir;
  }

  /**
   * Open a new test session.  All subsequent `callCommand()` calls will be
   * logged to `<sessionDir>/session.log` (JSONL, one entry per call).
   * If a session is already open it is finished first.
   *
   * @param name       Short label embedded in the folder name.
   * @param overrideDir  Override the base directory for this session only.
   */
  startSession(name: string, overrideDir?: string): { sessionDir: string } {
    if (this.activeSession) this.finishSession();

    const base = path.resolve(overrideDir || this.sessionBaseDir);
    const ts   = new Date().toISOString().replace(/[:.TZ]/g, (c) =>
      c === 'T' ? '_' : c === 'Z' ? '' : '-').slice(0, 19);      // YYYY-MM-DD_HH-mm-ss
    const safeName   = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const sessionDir = path.join(base, `${ts}_${safeName}`);

    fs.mkdirSync(sessionDir, { recursive: true });
    const logPath = path.join(sessionDir, 'session.log');
    const logFd   = fs.openSync(logPath, 'a');

    this.activeSession = { name, dir: sessionDir, logPath, logFd,
                           startTime: Date.now(), commandCount: 0, failCount: 0 };

    globalLogger.info('Session', `Started "${name}" → ${sessionDir}`);
    return { sessionDir };
  }

  /**
   * Close the active test session, flush logs, and write `summary.json`.
   * Returns null if no session was open.
   */
  finishSession(): { sessionDir: string; logLines: number; durationMs: number; passed: number; failed: number } | null {
    const s = this.activeSession;
    if (!s) return null;
    this.activeSession = null;

    const durationMs = Date.now() - s.startTime;
    const passed     = s.commandCount - s.failCount;
    const summary    = {
      name: s.name, passed, failed: s.failCount,
      total: s.commandCount, durationMs,
      startTime: new Date(s.startTime).toISOString(),
      endTime:   new Date().toISOString(),
    };

    try {
      fs.writeFileSync(path.join(s.dir, 'summary.json'), JSON.stringify(summary, null, 2));
      fs.closeSync(s.logFd);
    } catch { /* best-effort */ }

    globalLogger.info('Session',
      `Finished "${s.name}": ${passed}/${s.commandCount} ok, ${s.failCount} fail, ${durationMs}ms → ${s.dir}`);
    return { sessionDir: s.dir, logLines: s.commandCount, durationMs, passed, failed: s.failCount };
  }

  /** Return the currently-active session dir (or null). */
  getActiveSessionDir(): string | null {
    return this.activeSession?.dir ?? null;
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
    return this.getAll().map(schema => ({
      name: schema.toolName,
      description:
        `[${schema.helper} v${schema.version}] Direct access. ` +
        `Commands: ${schema.commands.map(c => c.name).join(', ')}. ` +
        `Call getHelperSchema for per-command docs, or use AutomateUI for routing.`,
      inputSchema: {
        type: 'object',
        properties: {
          helper: {
            type: 'string',
            description: `Helper binary — normally omitted. Maps to "${schema.helper}".`,
          },
          proc: {
            type: 'string',
            description:
              'Target: "[pid:N]" "[procname:X]" "[handle:H]". ' +
              'Multi-level: "[procname:WINWORD.EXE]//[docname:Budget.xlsx]". ' +
              'L1 keys: pid handle hwnd procname title. ' +
              'L3 keys: docname url tabid. Omit = foreground.',
          },
          action: {
            type: 'string',
            enum: schema.commands.map(c => c.name),
            description: 'Command. Call getHelperSchema for details.',
          },
          path: { type: 'string', description: 'XPath/CSS element address.' },
          value: { type: 'string', description: 'Payload to write/send.' },
        },
        required: ['action'],
      },
    }));
  }

  /**
   * Execute a command via the correct helper's persistent daemon.
   *
   * Wire format (§2.7 target format — separate fields):
   *   { id, proc, action, path?, value? }
   */
  async callCommand(
    helperName: string,
    target: string,
    command: string,
    elemPath: string = '',
    value: string = '',
    timeoutMs = 20000,
    callerUser: string = '',
    callerRoles: string = '',
    scroll: boolean = false,
  ): Promise<any> {
    const schema = this.schemas.get(helperName);
    if (!schema) throw new Error(`Helper not found: ${helperName}`);

    // Reconstruct abbreviated parameter string for logging only
    const parameter = elemPath && value ? `${elemPath}|${value}` : (elemPath || value);
    globalLogger.info('keywin', `>> ${helperName}  proc="${target}"  action=${command}  path=${elemPath}  value=${value}`);

    const daemon = this.daemons.get(helperName);
    if (!daemon) throw new Error(`No daemon for helper: ${helperName}`);

    const t0     = Date.now();
    const result = await daemon.call(target, command, elemPath, value, timeoutMs, callerUser, callerRoles, scroll);
    const durationMs = Date.now() - t0;

    globalLogger.info('keywin', `<< ${helperName}  success=${result?.success}`);
    globalLogger.logJSON('debug', 'keywin', 'Response', result);

    // ── Session recording ──────────────────────────────────────────────────
    const s = this.activeSession;
    if (s) {
      const success = result?.success !== false;
      const entry: SessionLogEntry = {
        ts: new Date().toISOString(),
        seq: ++s.commandCount,
        helper: helperName, target, command, parameter,
        success, durationMs,
        ...(success ? {} : { error: String(result?.error ?? 'unknown') }),
      };
      if (!success) s.failCount++;

      // Write JSONL line
      try { fs.writeSync(s.logFd, JSON.stringify(entry) + '\n'); } catch { /* best-effort */ }

      // Auto-screenshot on failure for BrowserWin calls when we can infer the CDP target
      if (!success && helperName === 'BrowserWin.exe' && /:\d+/.test(target)) {
        try {
          const safeName = command.replace(/[^a-zA-Z0-9_]/g, '_');
          const ssTs     = entry.ts.replace(/[:.]/g, '-').slice(0, 19);
          const ssFile   = path.join(s.dir, `fail_${ssTs}_${safeName}.png`);
          const ss       = await daemon.call(target, 'CDP_SCREENSHOT', ssFile, '', 15000).catch(() => null);
          if (ss?.success) {
            entry.screenshotFile = ssFile;
            globalLogger.info('Session', `Auto-screenshot: ${ssFile}`);
            // Patch the JSONL line with the screenshot path (best-effort append note)
            try { fs.writeSync(s.logFd, JSON.stringify({ seq: entry.seq, screenshotFile: ssFile }) + '\n'); } catch { /* ignore */ }
          }
        } catch { /* best-effort */ }
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildEnv(): NodeJS.ProcessEnv {
    // Pass SKIP_SESSION_AUTH=true **only** when no crypto credentials are
    // available (no KEY_PASSWORD supplied at startup).  When pkBytes is set
    // both the TS startup code and the C# daemon run the full
    // _auth_hello → _auth → _auth_ok handshake with HKDF session-key derivation.
    // Without credentials the one-shot guard is still enforced via the env var
    // so that direct CLI invocations (not --listen-stdin) are blocked in
    // production.
    const env = { ...process.env };
    if (!this.pkBytes || this.pkBytes.length === 0) {
      env['SKIP_SESSION_AUTH'] = 'true';
    }
    return env;
  }
}
