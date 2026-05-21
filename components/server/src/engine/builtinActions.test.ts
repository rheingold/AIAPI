import { execCmd, fsRead, fsWrite, fsList, splitArgs } from './builtinActions';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('splitArgs', () => {
  it('splits simple args', () => {
    expect(splitArgs('/c echo hello')).toEqual(['/c', 'echo', 'hello']);
  });
  it('respects double-quoted tokens', () => {
    expect(splitArgs('/c "hello world"')).toEqual(['/c', 'hello world']);
  });
  it('returns empty array for empty string', () => {
    expect(splitArgs('')).toEqual([]);
    expect(splitArgs('   ')).toEqual([]);
  });
});

describe('fsRead', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('reads a file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world', 'utf-8');
    const result = await fsRead(filePath);
    expect(result.success).toBe(true);
    expect(result.value).toBe('hello world');
  });

  it('returns error for missing file', async () => {
    const result = await fsRead(path.join(tmpDir, 'nonexistent.txt'));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/FS_READ failed/);
  });
});

describe('fsWrite', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('writes a file', async () => {
    const filePath = path.join(tmpDir, 'out.txt');
    const result = await fsWrite(filePath, 'test content');
    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('test content');
  });

  it('creates parent directories', async () => {
    const filePath = path.join(tmpDir, 'sub', 'dir', 'out.txt');
    const result = await fsWrite(filePath, 'nested');
    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('nested');
  });

  it('appends with opts.append=true', async () => {
    const filePath = path.join(tmpDir, 'append.txt');
    await fsWrite(filePath, 'line1\n');
    await fsWrite(filePath, 'line2\n', { append: true });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('line1\nline2\n');
  });
});

describe('fsList', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-test-'));
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), '');
    fs.mkdirSync(path.join(tmpDir, 'subdir'));
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('lists all entries', async () => {
    const result = await fsList(tmpDir);
    expect(result.success).toBe(true);
    expect(result.entries!.length).toBe(3);
  });

  it('filters files only', async () => {
    const result = await fsList(tmpDir, { filter: 'files' });
    expect(result.entries!.every(e => e.type === 'file')).toBe(true);
    expect(result.entries!.length).toBe(2);
  });

  it('filters directories only', async () => {
    const result = await fsList(tmpDir, { filter: 'directories' });
    expect(result.entries!.every(e => e.type === 'directory')).toBe(true);
    expect(result.entries!.length).toBe(1);
  });

  it('returns error for missing directory', async () => {
    const result = await fsList(path.join(tmpDir, 'nonexistent'));
    expect(result.success).toBe(false);
  });
});

describe('execCmd', () => {
  it('runs a command and captures stdout', async () => {
    // Use node itself — guaranteed to exist
    const result = await execCmd(process.execPath, '--version');
    expect(result.success).toBe(true);
    expect(result.value).toMatch(/^v\d+/);
  });

  it('returns error on non-zero exit', async () => {
    // node --eval with syntax error exits 1
    const result = await execCmd(process.execPath, '--eval "thiswillfail(("');
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });
});
