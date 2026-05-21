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
 */
export async function execCmd(
  executable: string,
  args: string,
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<BuiltinResult> {
  const cwd    = opts.cwd      ?? process.cwd();
  const timeout = opts.timeoutMs ?? 30_000;
  const env    = opts.env ? { ...process.env, ...opts.env } : process.env;

  // Simple argument split — handles quoted strings naively; not a full shell parser
  const argArray = args.trim() ? splitArgs(args) : [];

  try {
    const { stdout, stderr } = await execFileAsync(executable, argArray, {
      cwd,
      timeout,
      env,
      maxBuffer: 1024 * 1024 * 4, // 4 MB
    });
    return {
      success: true,
      value:   stdout.trim(),
      stdout:  stdout,
      stderr:  stderr || undefined,
      exitCode: 0,
    };
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
