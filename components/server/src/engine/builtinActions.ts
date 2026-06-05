/**
 * NEW-4: Built-in server-side actions.
 * These execute directly in the Node.js process — no helper .exe required.
 *
 * EXEC_CMD  — run a shell command; capture stdout / stderr
 * FS_READ   — read a file's text content
 * FS_WRITE  — write text to a file (creates or overwrites)
 * FS_LIST   — list entries in a directory
 *
 * Security note: callers must enforce their own security policy before
 * invoking these functions. EXEC_CMD is always high-risk. FS_WRITE is
 * high-risk. FS_READ / FS_LIST are read-only (low-risk).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Resolve the path to WinSvcBridge.exe relative to this module at runtime.
// In pkg-bundled exe, __dirname is the snapshot root; we look in the real
// executable's directory (process.execPath) for helpers.
function _findBridgeExe(): string | null {
  if (os.platform() !== 'win32') return null;
  // Candidates: same dir as the running exe (service layout) or dev dist/helpers/
  const candidates = [
    path.join(path.dirname(process.execPath), 'dist', 'helpers', 'WinSvcBridge.exe'),
    path.join(path.dirname(process.execPath), 'helpers', 'WinSvcBridge.exe'),
    path.join(path.dirname(process.execPath), 'WinSvcBridge.exe'),
    // Dev-mode: relative to this source file's compiled output
    path.resolve(__dirname, '..', '..', '..', 'dist', 'helpers', 'WinSvcBridge.exe'),
    path.resolve(__dirname, '..', '..', '..', '..', 'dist', 'helpers', 'WinSvcBridge.exe'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}
let _bridgeExeCache: string | null | undefined = undefined;
function getBridgeExe(): string | null {
  if (_bridgeExeCache === undefined) _bridgeExeCache = _findBridgeExe();
  return _bridgeExeCache;
}

const execFileAsync = promisify(execFile);

export interface BuiltinResult {
  success: boolean;
  value?: string;
  error?: string;
  /** stdout for EXEC_CMD */
  stdout?: string;
  /** stderr for EXEC_CMD */
  stderr?: string;
  /** exit code for EXEC_CMD */
  exitCode?: number;
  /** entries for FS_LIST */
  entries?: BuiltinFsEntry[];
  /** QA-3: present when running in Windows Session 0 and the command may have no visible effect */
  _sessionWarning?: string;
}

// ── QA-3: Session 0 detection (Windows only) ─────────────────────────────────

/**
 * Returns true when the Node.js server process is running in Windows Session 0
 * (i.e. launched as a Windows Service). Synchronous — reads process session ID
 * from WMI via a small PowerShell query. Cached after first call.
 */
let _session0Cache: boolean | null = null;
function isSession0(): boolean {
  if (!(_session0Cache === null)) return _session0Cache!;
  if (os.platform() !== 'win32') { _session0Cache = false; return false; }
  try {
    // Use synchronous execFileSync for the one-time session ID probe.
    const { execFileSync } = require('child_process');
    const out: string = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-WmiObject Win32_Process -Filter 'ProcessId=${process.pid}').SessionId`,
    ], { timeout: 5000, encoding: 'utf8' });
    _session0Cache = parseInt(out.trim(), 10) === 0;
  } catch {
    _session0Cache = false; // safe default — assume not Session 0
  }
  return _session0Cache!;
}

/** Simple heuristic: if the executable name is not a known console tool, flag as GUI. */
const CONSOLE_TOOLS = new Set([
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'node', 'node.exe', 'python', 'python.exe', 'python3', 'python3.exe',
  'wscript', 'cscript', 'bash', 'bash.exe', 'sh', 'sh.exe',
]);
function looksLikeGuiProcess(executable: string): boolean {
  const base = path.basename(executable).toLowerCase();
  return !CONSOLE_TOOLS.has(base);
}

export interface BuiltinFsEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
  size?: number;
  modified?: string;
}

/**
 * Run a shell command and capture output.
 *
 * @param executable  Path or name of the executable (e.g. "cmd.exe", "powershell", "node")
 * @param args        Argument string — split on spaces (simple split, not shell-aware).
 *                    Pass an empty string for no args.
 * @param opts.cwd    Working directory (default: process.cwd())
 * @param opts.timeoutMs  Max execution time in ms (default: 30 000)
 * @param opts.env    Additional env vars to merge with process.env
 * @param opts.backgroundMode  If true, skip WinSvcBridge in Session 0 (for headless/console commands)
 */
export async function execCmd(
  executable: string,
  args: string,
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string>; backgroundMode?: boolean } = {},
): Promise<BuiltinResult> {
  const cwd     = opts.cwd      ?? process.cwd();
  const timeout = opts.timeoutMs ?? 30_000;
  const env     = opts.env ? { ...process.env, ...opts.env } : process.env;
  const background = opts.backgroundMode ?? false;

  // When running in Windows Session 0 (as a service), route exec_cmd calls
  // through WinSvcBridge --exec so they run in the active user session with the
  // user's identity, environment, drives and profile — not as NT AUTHORITY\SYSTEM.
  // Skip bridge if backgroundMode: true (for headless operations that don't need desktop).
  if (isSession0() && !background && os.platform() === 'win32') {
    const bridgeExe = getBridgeExe();
    if (bridgeExe) {
      try {
        // Build arg array: ["--exec", executable, ...splitArgs(args)]
        const userArgs = args.trim() ? splitArgs(args) : [];
        const bridgeArgArray = ['--exec', executable, ...userArgs];
        const { stdout: rawOut, stderr: rawErr } = await execFileAsync(bridgeExe, bridgeArgArray, {
          cwd,
          timeout,
          env,
          maxBuffer: 1024 * 1024 * 4,
        });
        // WinSvcBridge --exec emits exactly one JSON line on stdout then exits.
        // Parse it; fall back to raw output if unparsable.
        let parsed: { exitCode?: number; stdout?: string; stderr?: string } = {};
        try { parsed = JSON.parse(rawOut.trim()); } catch {
          // Bridge output was not JSON — treat raw stdout as command output
          return {
            success:  true,
            value:    rawOut.trim(),
            stdout:   rawOut,
            stderr:   rawErr || undefined,
            exitCode: 0,
            _bridge:  'exec' as any,
          } as BuiltinResult;
        }
        const exitCode = typeof parsed.exitCode === 'number' ? parsed.exitCode : 0;
        return {
          success:  exitCode === 0,
          value:    (parsed.stdout ?? '').trim(),
          stdout:   parsed.stdout ?? '',
          stderr:   parsed.stderr || undefined,
          exitCode,
          _bridge:  'exec' as any,
        } as BuiltinResult;
      } catch (bridgeErr: any) {
        // Bridge itself failed (not the child command) — fall through to direct exec
        // and attach a warning so the caller knows the user-session route failed.
        const fallbackResult = await execCmdDirect(executable, args, { cwd, timeout, env });
        (fallbackResult as any)._bridgeError =
          `WinSvcBridge --exec failed (${bridgeErr?.message ?? bridgeErr}); fell back to Session-0 direct exec`;
        return fallbackResult;
      }
    }
  }

  return execCmdDirect(executable, args, { cwd, timeout, env });
}

/** Internal: run executable directly in the current process context (Session 0 when service). */
async function execCmdDirect(
  executable: string,
  args: string,
  opts: { cwd: string; timeout: number; env: NodeJS.ProcessEnv },
): Promise<BuiltinResult> {
  const argArray = args.trim() ? splitArgs(args) : [];
  try {
    const { stdout, stderr } = await execFileAsync(executable, argArray, {
      cwd:       opts.cwd,
      timeout:   opts.timeout,
      env:       opts.env,
      maxBuffer: 1024 * 1024 * 4,
    });
    const result: BuiltinResult = {
      success:  true,
      value:    stdout.trim(),
      stdout:   stdout,
      stderr:   stderr || undefined,
      exitCode: 0,
    };
    // QA-3: warn when running in Session 0 and the command likely spawns a GUI app
    if (isSession0() && looksLikeGuiProcess(executable)) {
      result._sessionWarning = 'exec_cmd launched a process in Session 0 which has no interactive desktop. '
        + 'GUI windows will not be visible to users. '
        + 'Use launchProcess for GUI automation. '
        + 'See docs/specs/SESSION0_ISOLATION.md for details.';
    }
    return result;
  } catch (e: any) {
    const exitCode = typeof e.code === 'number' ? e.code : undefined;
    return {
      success:  exitCode === 0,
      value:    e.stdout ?? '',
      stdout:   e.stdout ?? '',
      stderr:   e.stderr ?? String(e.message),
      exitCode,
      error:    `EXEC_CMD failed (exit ${exitCode ?? '?'}): ${e.message}`,
    };
  }
}

/**
 * Read a file's text content.
 *
 * @param filePath  Absolute or relative-to-cwd path.
 * @param opts.encoding  Default: 'utf-8'
 * @param opts.maxBytes  Truncate to this many bytes before decode (default: 1 MB)
 */
export async function fsRead(
  filePath: string,
  opts: { encoding?: BufferEncoding; maxBytes?: number } = {},
): Promise<BuiltinResult> {
  const encoding = opts.encoding ?? 'utf-8';
  const maxBytes = opts.maxBytes ?? 1_048_576; // 1 MB
  try {
    const abs = path.resolve(process.cwd(), filePath);
    const stat = fs.statSync(abs);
    const fd   = fs.openSync(abs, 'r');
    const buf  = Buffer.alloc(Math.min(stat.size, maxBytes));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const value = buf.toString(encoding);
    return {
      success: true,
      value,
      ...(stat.size > maxBytes ? { _truncated: true, _hint: `File is ${stat.size} bytes; only first ${maxBytes} returned.` } as any : {}),
    };
  } catch (e: any) {
    return { success: false, error: `FS_READ failed: ${e.message}` };
  }
}

/**
 * Write text to a file. Creates the file (and parent directories) if needed.
 *
 * @param filePath  Absolute or relative-to-cwd path.
 * @param content   Text content to write.
 * @param opts.encoding  Default: 'utf-8'
 * @param opts.append    If true, append instead of overwrite. Default: false.
 */
export async function fsWrite(
  filePath: string,
  content: string,
  opts: { encoding?: BufferEncoding; append?: boolean } = {},
): Promise<BuiltinResult> {
  const encoding = opts.encoding ?? 'utf-8';
  try {
    const abs = path.resolve(process.cwd(), filePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (opts.append) {
      fs.appendFileSync(abs, content, { encoding });
    } else {
      fs.writeFileSync(abs, content, { encoding });
    }
    return { success: true, value: abs };
  } catch (e: any) {
    return { success: false, error: `FS_WRITE failed: ${e.message}` };
  }
}

/**
 * List entries in a directory.
 *
 * @param dirPath  Absolute or relative-to-cwd path.
 * @param opts.filter  'all' | 'files' | 'directories'. Default: 'all'
 * @param opts.maxEntries  Cap returned entries. Default: 500.
 */
export async function fsList(
  dirPath: string,
  opts: { filter?: 'all' | 'files' | 'directories'; maxEntries?: number } = {},
): Promise<BuiltinResult> {
  const filter     = opts.filter     ?? 'all';
  const maxEntries = opts.maxEntries ?? 500;
  try {
    const abs = path.resolve(process.cwd(), dirPath);
    const raw = fs.readdirSync(abs, { withFileTypes: true });
    const entries: BuiltinFsEntry[] = [];
    for (const dirent of raw) {
      if (entries.length >= maxEntries) break;
      const type: BuiltinFsEntry['type'] = dirent.isDirectory() ? 'directory'
                                          : dirent.isFile()      ? 'file'
                                          :                        'other';
      if (filter === 'files'       && type !== 'file')      continue;
      if (filter === 'directories' && type !== 'directory') continue;
      const entry: BuiltinFsEntry = { name: dirent.name, type };
      try {
        const stat = fs.statSync(path.join(abs, dirent.name));
        entry.size     = stat.size;
        entry.modified = stat.mtime.toISOString();
      } catch { /* ignore stat errors */ }
      entries.push(entry);
    }
    return {
      success: true,
      entries,
      value: JSON.stringify(entries),
      ...(raw.length > maxEntries ? { _truncated: true } as any : {}),
    };
  } catch (e: any) {
    return { success: false, error: `FS_LIST failed: ${e.message}` };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Naive argument splitter — respects "double quoted" tokens but not single quotes.
 * Not a full POSIX shell parser.
 */
export function splitArgs(s: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ' ' && !inQuote) {
      if (current) { result.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) result.push(current);
  return result;
}
