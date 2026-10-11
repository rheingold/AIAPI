/**
 * NEW-4: Built-in server-side actions.
 * These execute directly in the Node.js process — no helper .exe required.
 *
 * EXEC_CMD  — run a shell command; capture stdout / stderr
 * FS_READ   — read a file's text content (with optional attributes: hashes, dates, links)
 * FS_WRITE  — write text to a file, apply diff patches, search/replace (supports glob patterns)
 * FS_LIST   — list entries in a directory (with recursion depth and glob filtering)
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
import * as crypto from 'crypto';

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
  /** attributes for FS_READ with includeHash/includeDates options */
  attributes?: FileAttributes | FileAttributes[];
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
  /** Optional: MD5 hash of file content (for files only) */
  hash?: string;
  /** Optional: link target path (for symlinks) */
  linkTarget?: string;
  /** Optional: link type - 'symlink' or 'junction' */
  linkType?: 'symlink' | 'junction';
  /** Optional: creation time */
  created?: string;
  /** Optional: custom attributes if requested */
  attributes?: Record<string, string>;
}

/**
 * File attributes reader - gets extended file information
 */
interface FileAttributes {
  hash?: string;
  linkTarget?: string;
  linkType?: 'symlink' | 'junction';
  created?: string;
  customAttributes?: Record<string, string>;
  error?: string;
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
 * Read a file's text content with optional file attributes.
 *
 * @param filePath  Absolute or relative-to-cwd path. Supports glob patterns (*, **).
 * @param opts.encoding  Default: 'utf-8'
 * @param opts.maxBytes  Truncate to this many bytes before decode (default: 1 MB)
 * @param opts.includeHash  Include MD5 hash of file content (default: false)
 * @param opts.includeDates  Include creation/modification dates (default: false)
 * @param opts.includeLinkInfo  Include symlink/junction information (default: false)
 * @param opts.includeAttributes  Include custom file attributes with optional key filter (default: false)
 * @param opts.glob  Enable glob pattern matching (default: false)
 */
export async function fsRead(
  filePath: string,
  opts: {
    encoding?: BufferEncoding;
    maxBytes?: number;
    includeHash?: boolean;
    includeDates?: boolean;
    includeLinkInfo?: boolean;
    includeAttributes?: boolean | string[];
    glob?: boolean;
  } = {},
): Promise<BuiltinResult> {
  const encoding = opts.encoding ?? 'utf-8';
  const maxBytes = opts.maxBytes ?? 1_048_576; // 1 MB
  const includeHash = opts.includeHash ?? false;
  const includeDates = opts.includeDates ?? false;
  const includeLinkInfo = opts.includeLinkInfo ?? false;
  const includeAttributes = opts.includeAttributes ?? false;
  const useGlob = opts.glob ?? false;
  
  try {
    // Resolve glob patterns if enabled
    const pathsToRead = useGlob ? resolveGlob(filePath) : [path.resolve(process.cwd(), filePath)];
    
    if (pathsToRead.length === 0) {
      return { success: false, error: `FS_READ: No files matched pattern "${filePath}"` };
    }
    
    const results: Array<{path: string; content?: string; attrs?: FileAttributes}> = [];
    
    for (const abs of pathsToRead) {
      try {
        const stat = fs.statSync(abs);
        const fd = fs.openSync(abs, 'r');
        const buf = Buffer.alloc(Math.min(stat.size, maxBytes));
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        const content = buf.toString(encoding);
        
        const entry: typeof results[number] = { path: abs };
        entry.content = content;
        
        // Gather requested attributes
        if (includeHash || includeDates || includeLinkInfo || includeAttributes) {
          const attrs: FileAttributes = {};
          
          if (includeHash) {
            attrs.hash = computeMd5(abs);
          }
          
          if (includeDates) {
            attrs.created = stat.birthtime.toISOString();
            // Also include mtime in the main result
          }
          
          if (includeLinkInfo) {
            try {
              const lstat = fs.lstatSync(abs);
              if (lstat.isSymbolicLink()) {
                attrs.linkTarget = fs.readlinkSync(abs);
                attrs.linkType = 'symlink';
              }
            } catch {
              // Not a link or can't read
            }
          }
          
          if (includeAttributes) {
            attrs.customAttributes = getFileAttributes(abs, typeof includeAttributes === 'object' ? includeAttributes : undefined);
          }
          
          entry.attrs = attrs;
        }
        
        results.push(entry);
      } catch (e: any) {
        results.push({ path: abs, content: undefined, attrs: { error: e.message } as any });
      }
    }
    
    // If single file, return content directly for backward compatibility
    if (pathsToRead.length === 1 && !useGlob) {
      const entry = results[0];
      return {
        success: entry.content !== undefined,
        value: entry.content,
        ...(entry.attrs ? { attributes: entry.attrs } as any : {}),
        ...(results[0].attrs?.error ? { error: `FS_READ attributes error: ${results[0].attrs.error}` } : {}),
      };
    }
    
    // Multiple files - return as JSON array
    return {
      success: true,
      value: JSON.stringify(results),
      attributes: results.map(r => r.attrs).filter((a): a is FileAttributes => a !== undefined),
    };
  } catch (e: any) {
    return { success: false, error: `FS_READ failed: ${e.message}` };
  }
}

/**
 * Write text to a file with advanced operations: diff patching, search/replace, line operations.
 * Supports glob patterns for multiple files.
 *
 * @param filePath  Absolute or relative-to-cwd path. Supports glob patterns (*, **).
 * @param content   Text content to write, OR a diff patch, OR search pattern depending on mode.
 * @param opts.encoding  Default: 'utf-8'
 * @param opts.append    If true, append instead of overwrite. Default: false.
 * @param opts.mode      Operation mode: 'write' (default), 'patch', 'search_replace', 'insert_line', 'delete_lines'
 * @param opts.search    Search pattern (regex or literal) for search_replace mode
 * @param opts.replace   Replacement string for search_replace mode
 * @param opts.lineNum   Line number for insert_line/delete_lines modes (1-indexed)
 * @param opts.lines     Number of lines to delete for delete_lines mode
 * @param opts.glob      Enable glob pattern matching (default: false)
 * @param opts.recursive  For glob: enable recursive directory matching (default: false)
 * @param opts.depth      For glob: maximum recursion depth (default: unlimited)
 */
export async function fsWrite(
  filePath: string,
  content: string,
  opts: {
    encoding?: BufferEncoding;
    append?: boolean;
    mode?: 'write' | 'patch' | 'search_replace' | 'insert_line' | 'delete_lines';
    search?: string;
    replace?: string;
    lineNum?: number;
    lines?: number;
    glob?: boolean;
    recursive?: boolean;
    depth?: number;
  } = {},
): Promise<BuiltinResult> {
  const encoding = opts.encoding ?? 'utf-8';
  const mode = opts.mode ?? 'write';
  const useGlob = opts.glob ?? false;
  const recursive = opts.recursive ?? false;
  const maxDepth = opts.depth;
  
  try {
    // Resolve glob patterns if enabled
    const pathsToWrite = useGlob ? resolveGlob(filePath, recursive, maxDepth) : [path.resolve(process.cwd(), filePath)];
    
    if (pathsToWrite.length === 0) {
      return { success: false, error: `FS_WRITE: No files matched pattern "${filePath}"` };
    }
    
    const results: Array<{path: string; success: boolean; error?: string}> = [];
    
    for (const abs of pathsToWrite) {
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        
        let fileContent: string = '';
        
        // Read existing content for operations that need it
        const needsRead = mode !== 'write' || opts.append;
        if (needsRead && fs.existsSync(abs)) {
          fileContent = fs.readFileSync(abs, { encoding });
        } else if (needsRead) {
          fileContent = '';
        }
        
        switch (mode) {
          case 'write':
            if (opts.append) {
              fs.appendFileSync(abs, content, { encoding });
            } else {
              fs.writeFileSync(abs, content, { encoding });
            }
            break;
            
          case 'patch':
            // Apply unified diff patch
            fileContent = applyDiffPatch(fileContent, content);
            fs.writeFileSync(abs, fileContent, { encoding });
            break;
            
          case 'search_replace': {
            const searchPattern = opts.search;
            const replacement = opts.replace ?? content;
            if (!searchPattern) {
              throw new Error('FS_WRITE search_replace mode requires "search" parameter');
            }
            fileContent = performSearchReplace(fileContent, searchPattern, replacement);
            fs.writeFileSync(abs, fileContent, { encoding });
            break;
          }
          
          case 'insert_line': {
            const lineNum = opts.lineNum ?? 1;
            fileContent = insertAtLine(fileContent, lineNum, content);
            fs.writeFileSync(abs, fileContent, { encoding });
            break;
          }
          
          case 'delete_lines': {
            const lineNum = opts.lineNum ?? 1;
            const count = opts.lines ?? 1;
            fileContent = deleteLines(fileContent, lineNum, count);
            fs.writeFileSync(abs, fileContent, { encoding });
            break;
          }
        }
        
        results.push({ path: abs, success: true });
      } catch (e: any) {
        results.push({ path: abs, success: false, error: e.message });
      }
    }
    
    const allSuccess = results.every(r => r.success);
    const errors = results.filter(r => !r.success).map(r => `${r.path}: ${r.error}`);
    
    return {
      success: allSuccess,
      value: results.map(r => r.path).join('\n'),
      ...(errors.length > 0 ? { error: `FS_WRITE partial failure: ${errors.join('; ')}` } : {}),
    };
  } catch (e: any) {
    return { success: false, error: `FS_WRITE failed: ${e.message}` };
  }
}

/**
 * List entries in a directory with optional recursion and glob filtering.
 *
 * @param dirPath  Absolute or relative-to-cwd path. Supports glob patterns (*, **).
 * @param opts.filter  'all' | 'files' | 'directories'. Default: 'all'
 * @param opts.maxEntries  Cap returned entries. Default: 500.
 * @param opts.recursive  Enable recursive directory listing. Default: false.
 * @param opts.depth  Maximum recursion depth (only with recursive:true). Default: unlimited.
 * @param opts.glob  Glob pattern to filter entries (e.g., *.ts). Default: null.
 * @param opts.includeHash  Include MD5 hash for files. Default: false.
 * @param opts.includeDates  Include creation dates. Default: false.
 */
export async function fsList(
  dirPath: string,
  opts: {
    filter?: 'all' | 'files' | 'directories';
    maxEntries?: number;
    recursive?: boolean;
    depth?: number;
    glob?: string;
    includeHash?: boolean;
    includeDates?: boolean;
  } = {},
): Promise<BuiltinResult> {
  const filter     = opts.filter     ?? 'all';
  const maxEntries = opts.maxEntries ?? 500;
  const recursive  = opts.recursive ?? false;
  const maxDepth   = opts.depth;
  const globPattern = opts.glob;
  const includeHash = opts.includeHash ?? false;
  const includeDates = opts.includeDates ?? false;
  
  try {
    const abs = path.resolve(process.cwd(), dirPath);
    const entries: BuiltinFsEntry[] = [];
    
    const listDirectory = (dir: string, currentDepth: number = 0): void => {
      if (entries.length >= maxEntries) return;
      
      // Check depth limit
      if (maxDepth !== undefined && currentDepth > maxDepth) return;
      
      try {
        const raw = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const dirent of raw) {
          if (entries.length >= maxEntries) break;
          
          const fullPath = path.join(dir, dirent.name);
          
          // Apply glob filter if specified
          if (globPattern && !matchGlob(dirent.name, globPattern)) {
            // For directories, still recurse if pattern contains **
            if (dirent.isDirectory() && globPattern.includes('**')) {
              listDirectory(fullPath, currentDepth + 1);
            }
            continue;
          }
          
          const type: BuiltinFsEntry['type'] = dirent.isDirectory() ? 'directory'
                                              : dirent.isFile()      ? 'file'
                                              :                        'other';
          
          if (filter === 'files'       && type !== 'file')      continue;
          if (filter === 'directories' && type !== 'directory') continue;
          
          const entry: BuiltinFsEntry = {
            name: recursive && currentDepth > 0 ? path.relative(abs, fullPath) : dirent.name,
            type
          };
          
          try {
            const stat = fs.statSync(fullPath);
            entry.size     = stat.size;
            entry.modified = stat.mtime.toISOString();
            
            if (includeDates) {
              entry.created = stat.birthtime.toISOString();
            }
            
            if (includeHash && type === 'file') {
              entry.hash = computeMd5(fullPath);
            }
            
            // Check for symlinks
            try {
              const lstat = fs.lstatSync(fullPath);
              if (lstat.isSymbolicLink()) {
                entry.linkTarget = fs.readlinkSync(fullPath);
                entry.linkType = 'symlink';
              }
            } catch {
              // Not a link
            }
          } catch { /* ignore stat errors */ }
          
          entries.push(entry);
          
          // Recurse into directories if requested
          if (recursive && type === 'directory') {
            listDirectory(fullPath, currentDepth + 1);
          }
        }
      } catch {
        // Ignore directory read errors
      }
    };
    
    listDirectory(abs);
    
    return {
      success: true,
      entries,
      value: JSON.stringify(entries),
      ...(entries.length >= maxEntries ? { _truncated: true } as any : {}),
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

// ── New Helper Functions for Enhanced FS Operations ──────────────────────────

/**
 * Compute MD5 hash of a file
 */
function computeMd5(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Get file attributes (custom attributes reader)
 */
function getFileAttributes(filePath: string, attributeKeys?: string[]): Record<string, string> {
  const attrs: Record<string, string> = {};
  try {
    const stat = fs.statSync(filePath);
    
    // Always include basic attributes if no specific keys requested
    if (!attributeKeys || attributeKeys.length === 0) {
      attrs.size = stat.size.toString();
      attrs.mtime = stat.mtime.toISOString();
      attrs.birthtime = stat.birthtime.toISOString();
      attrs.isFile = stat.isFile().toString();
      attrs.isDirectory = stat.isDirectory().toString();
      attrs.isSymbolicLink = fs.lstatSync(filePath).isSymbolicLink().toString();
    } else {
      // Return only requested attributes
      for (const key of attributeKeys) {
        switch (key.toLowerCase()) {
          case 'size':
            attrs.size = stat.size.toString();
            break;
          case 'mtime':
          case 'modified':
            attrs.mtime = stat.mtime.toISOString();
            break;
          case 'birthtime':
          case 'created':
            attrs.birthtime = stat.birthtime.toISOString();
            break;
          case 'isfile':
            attrs.isFile = stat.isFile().toString();
            break;
          case 'isdirectory':
            attrs.isDirectory = stat.isDirectory().toString();
            break;
          case 'issymboliclink':
          case 'islink':
            attrs.isSymbolicLink = fs.lstatSync(filePath).isSymbolicLink().toString();
            break;
          case 'hash':
          case 'md5':
            attrs.md5 = computeMd5(filePath);
            break;
          default:
            attrs[key] = 'unknown';
        }
      }
    }
  } catch (e: any) {
    attrs.error = e.message;
  }
  return attrs;
}

/**
 * Resolve glob pattern to file paths
 */
function resolveGlob(pattern: string, recursive: boolean = false, maxDepth?: number): string[] {
  const cwd = process.cwd();
  const absPattern = path.resolve(cwd, pattern);
  const results: string[] = [];
  
  // Check if pattern contains glob characters
  if (!pattern.includes('*') && !pattern.includes('?')) {
    return [absPattern];
  }
  
  const doGlob = (dir: string, currentDepth: number = 0): void => {
    // Check depth limit
    if (maxDepth !== undefined && currentDepth > maxDepth) return;
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (recursive) {
            doGlob(fullPath, currentDepth + 1);
          }
        } else {
          if (matchGlob(entry.name, pattern)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // Ignore errors
    }
  };
  
  // Start from the directory containing the pattern
  const startDir = path.dirname(absPattern);
  doGlob(startDir);
  
  return results;
}

/**
 * Match a filename against a glob pattern (simple * and ? support)
 */
function matchGlob(filename: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(filename);
}

/**
 * Apply unified diff patch to content
 */
function applyDiffPatch(content: string, patch: string): string {
  const lines = content.split('\n');
  const patchLines = patch.split('\n');
  let result = [...lines];
  let offset = 0;
  
  let i = 0;
  while (i < patchLines.length) {
    const line = patchLines[i];
    
    // Look for @@ -X,Y +A,B @@ hunk header
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (match) {
        const oldStart = parseInt(match[1], 10);
        const oldCount = match[2] ? parseInt(match[2], 10) : 1;
        const newStart = parseInt(match[3], 10);
        const newCount = match[4] ? parseInt(match[4], 10) : 0;
        
        // Skip the hunk header
        i++;
        
        const toRemove: number[] = [];
        const toInsert: Array<{pos: number; text: string}> = [];
        
        let j = 0;
        while (i < patchLines.length && patchLines[i].startsWith('-') || patchLines[i].startsWith('+') || patchLines[i].startsWith(' ')) {
          const patchLine = patchLines[i];
          
          if (patchLine.startsWith('-')) {
            toRemove.push(oldStart + j - 1 + offset);
            j++;
          } else if (patchLine.startsWith('+')) {
            toInsert.push({ pos: newStart + toInsert.length - 1 + offset, text: patchLine.substring(1) });
          } else if (patchLine.startsWith(' ')) {
            j++;
          }
          
          i++;
        }
        
        // Apply removals (in reverse order to preserve indices)
        for (let idx = toRemove.length - 1; idx >= 0; idx--) {
          if (result[toRemove[idx]] !== undefined) {
            result.splice(toRemove[idx], 1);
          }
        }
        
        // Apply insertions
        for (const ins of toInsert) {
          if (ins.pos < result.length) {
            result.splice(ins.pos, 0, ins.text);
          } else {
            result.push(ins.text);
          }
        }
        
        continue;
      }
    }
    
    i++;
  }
  
  return result.join('\n');
}

/**
 * Perform search and replace (supports regex and literal patterns)
 */
function performSearchReplace(content: string, searchPattern: string, replacement: string): string {
  // Check if pattern is a regex (wrapped in /.../flags)
  const regexMatch = searchPattern.match(/^\/(.+)\/([gimsuy]*)$/);
  
  if (regexMatch) {
    const pattern = regexMatch[1];
    const flags = regexMatch[2];
    const regex = new RegExp(pattern, flags);
    return content.replace(regex, replacement);
  }
  
  // Check if pattern contains glob-like wildcards
  if (searchPattern.includes('*') || searchPattern.includes('?')) {
    const regexPattern = searchPattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(regexPattern, 'g');
    return content.replace(regex, replacement);
  }
  
  // Literal string replacement (case-insensitive)
  const regex = new RegExp(escapeRegExp(searchPattern), 'gi');
  return content.replace(regex, replacement);
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Insert content at a specific line number (1-indexed)
 */
function insertAtLine(content: string, lineNum: number, textToInsert: string): string {
  const lines = content.split('\n');
  const insertIndex = lineNum - 1; // Convert to 0-indexed
  
  if (insertIndex < 0) {
    return textToInsert + '\n' + content;
  }
  
  if (insertIndex >= lines.length) {
    return content + '\n' + textToInsert;
  }
  
  lines.splice(insertIndex, 0, textToInsert);
  return lines.join('\n');
}

/**
 * Delete lines from content (1-indexed)
 */
function deleteLines(content: string, startLine: number, count: number): string {
  const lines = content.split('\n');
  const startIndex = startLine - 1; // Convert to 0-indexed
  
  if (startIndex < 0 || startIndex >= lines.length) {
    return content;
  }
  
  const endIndex = Math.min(startIndex + count, lines.length);
  lines.splice(startIndex, endIndex - startIndex);
  
  return lines.join('\n');
}
