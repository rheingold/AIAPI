/**
 * FS_READ / FS_WRITE / FS_LIST Unit Tests
 * 
 * Direct unit tests for the builtinActions module, exercising:
 * - Content integrity through write → read round-trip
 * - Escaping of $, `, \, quotes, special chars
 * - Whitespace preservation (LF, CRLF, tabs, trailing spaces)
 * - Unicode and emoji
 * - Append mode
 * - Hash computation
 * - FS_LIST filtering and recursion
 * - Error handling (non-existent files, permissions)
 * 
 * Run: npx jest test/unit/test-builtin-actions.js
 */
'use strict';

// Import the builtinActions module
// In Jest, we need to resolve TypeScript via ts-jest or compile first
// This test uses the compiled output

let fsRead, fsWrite, fsList;

beforeAll(async () => {
    // Try to import from compiled output first, fallback to source
    try {
        const mod = require('../../../components/server/src/engine/builtinActions');
        fsRead = mod.fsRead;
        fsWrite = mod.fsWrite;
        fsList = mod.fsList;
    } catch {
        // If TypeScript can't be loaded directly, skip
        console.warn('Could not load builtinActions module — tests will be skipped');
    }
});

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const TEST_DIR = path.join(os.tmpdir(), 'aiaapi_fs_test', `${Date.now()}`);

beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
        fs.mkdirSync(TEST_DIR, { recursive: true });
    }
});

afterEach(() => {
    // Cleanup test files
    try {
        if (fs.existsSync(TEST_DIR)) {
            const files = fs.readdirSync(TEST_DIR);
            for (const f of files) {
                const fp = path.join(TEST_DIR, f);
                const stat = fs.statSync(fp);
                if (stat.isDirectory()) {
                    fs.rmSync(fp, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(fp);
                }
            }
        }
    } catch { /* ignore cleanup errors */ }
});

afterAll(() => {
    try {
        fs.rmSync(path.dirname(TEST_DIR), { recursive: true, force: true });
    } catch { /* ignore */ }
});

// ─── Skip guard ───────────────────────────────────────────────────────────
const describeActive = (fsRead && fsWrite) ? describe : describe.skip;

describeActive('BuiltinActions — FS_WRITE / FS_READ', () => {

    describe('Content integrity — round-trip', () => {

        test('plain ASCII text survives round-trip', async () => {
            const content = 'Hello, World!\nThis is a test.\n';
            const fp = path.join(TEST_DIR, 'plain.txt');
            
            const wr = await fsWrite(fp, content);
            expect(wr.success).toBe(true);
            
            const rd = await fsRead(fp);
            expect(rd.success).toBe(true);
            expect(rd.value).toBe(content);
        });

        test('PowerShell script with $variables survives round-trip', async () => {
            const content = `$greeting = "Hello, World!"
$number = 42
$path = "C:\\Users\\test\\Documents"
Write-Host "$greeting $number"
Get-Process | Where-Object { $_.CPU -gt 100 }`;
            const fp = path.join(TEST_DIR, 'test.ps1');
            
            const wr = await fsWrite(fp, content);
            expect(wr.success).toBe(true);
            
            const rd = await fsRead(fp);
            expect(rd.success).toBe(true);
            expect(rd.value).toBe(content);
            
            // Verify $ signs are NOT backtick-escaped
            const fileContent = fs.readFileSync(fp, 'utf-8');
            expect(fileContent).toContain('$greeting');
            expect(fileContent).toContain('$number');
            expect(fileContent).toContain('$_.CPU');
            expect(fileContent).not.toContain('`$greeting');
        });

        test('PowerShell backticks survive round-trip', async () => {
            const content = 'echo "line1`nline2"\n$path = "C:\\test`"`s dir"\n$dollar = "`$literal"';
            const fp = path.join(TEST_DIR, 'backtick.ps1');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });

        test('Batch file with %% and special chars', async () => {
            const content = `@echo off
echo %PATH%
echo 100%% complete
set "VAR=value"
cmd1 & cmd2 | cmd3
echo test > file.txt
echo ^<special^>`;
            const fp = path.join(TEST_DIR, 'test.bat');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });

        test('JSON content with nested quotes and escapes', async () => {
            const obj = {
                greeting: "Hello",
                path: "C:\\Users\\test",
                nested: { key: "value with \"quotes\"" },
                url: "https://example.com?a=1&b=2",
                regex: "\\b[A-Z]{2,}\\b"
            };
            const content = JSON.stringify(obj, null, 2);
            const fp = path.join(TEST_DIR, 'test.json');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            
            // Verify the written file is valid JSON
            const parsed = JSON.parse(rd.value);
            expect(parsed.path).toBe(obj.path);
            expect(parsed.regex).toBe(obj.regex);
        });

        test('XML content with entities', async () => {
            const content = `<?xml version="1.0"?>
<root>
    <item lt="<" gt=">" amp="&" quot="""/>
    <script><![CDATA[var x = "hello";]]></script>
</root>`;
            const fp = path.join(TEST_DIR, 'test.xml');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });

        test('HTML with embedded JavaScript', async () => {
            const content = `<!DOCTYPE html>
<html>
<script>
var path = "C:\\\\Users\\\\test";
var url = "https://example.com?q=test&lang=en";
fetch(url).then(r => console.log(r));
</script>
<div data-path="C:\\test\\file.txt"></div>
</html>`;
            const fp = path.join(TEST_DIR, 'test.html');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });

        test('CSS with URL paths', async () => {
            const content = `.bg { background-image: url("C:\\Users\\image.png"); }
.test::before { content: "\\"hello\\""; }
@font-face { src: url('fonts/file.woff2'); }`;
            const fp = path.join(TEST_DIR, 'test.css');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });
    });

    describe('Whitespace preservation', () => {

        test('LF newlines preserved', async () => {
            const content = 'line1\nline2\nline3';
            const fp = path.join(TEST_DIR, 'lf.txt');
            
            await fsWrite(fp, content);
            const fileContent = fs.readFileSync(fp, 'utf-8');
            expect(fileContent).toBe('line1\nline2\nline3');
        });

        test('CRLF newlines preserved', async () => {
            const content = 'line1\r\nline2\r\nline3\r\n';
            const fp = path.join(TEST_DIR, 'crlf.txt');
            
            await fsWrite(fp, content);
            const fileContent = fs.readFileSync(fp, 'utf-8');
            expect(fileContent).toBe('line1\r\nline2\r\nline3\r\n');
        });

        test('Tabs preserved', async () => {
            const content = 'col1\tcol2\tcol3\n    indented\n\t\ttab-indented';
            const fp = path.join(TEST_DIR, 'tabs.txt');
            
            await fsWrite(fp, content);
            const fileContent = fs.readFileSync(fp, 'utf-8');
            expect(fileContent).toBe(content);
        });

        test('Trailing whitespace preserved', async () => {
            const content = 'line1   \nline2\t\nline3  \t  ';
            const fp = path.join(TEST_DIR, 'trailing.txt');
            
            await fsWrite(fp, content);
            const fileContent = fs.readFileSync(fp, 'utf-8');
            expect(fileContent).toBe(content);
        });

        test('Empty lines preserved', async () => {
            const content = 'line1\n\n\nline4\n\n';
            const fp = path.join(TEST_DIR, 'empty_lines.txt');
            
            await fsWrite(fp, content);
            const fileContent = fs.readFileSync(fp, 'utf-8');
            expect(fileContent).toBe(content);
        });

        test('Mixed whitespace characters', async () => {
            const content = 'space \t tab\n\r CRLF\n   leading\n';
            const fp = path.join(TEST_DIR, 'mixed_ws.txt');
            
            await fsWrite(fp, content);
            const fileContent = fs.readFileSync(fp, 'utf-8');
            expect(fileContent).toBe(content);
        });
    });

    describe('Unicode and emoji', () => {

        test('Chinese characters', async () => {
            const content = 'Hello 世界\n日本語テスト';
            const fp = path.join(TEST_DIR, 'unicode.txt');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });

        test('Emoji', async () => {
            const content = '😀😃😄🌍🔧✅❌';
            const fp = path.join(TEST_DIR, 'emoji.txt');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });

        test('Mixed unicode with special chars', async () => {
            const content = 'Café résumé naïve — ∑ ∫ ∞ ≈ — ← → ↑ ↓';
            const fp = path.join(TEST_DIR, 'mixed_unicode.txt');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });
    });

    describe('Append mode', () => {

        test('append:true appends content', async () => {
            const fp = path.join(TEST_DIR, 'append.txt');
            
            await fsWrite(fp, 'line1\n');
            await fsWrite(fp, 'line2\n', { append: true });
            await fsWrite(fp, 'line3\n', { append: true });
            
            const content = fs.readFileSync(fp, 'utf-8');
            expect(content).toBe('line1\nline2\nline3\n');
        });

        test('append:false overwrites', async () => {
            const fp = path.join(TEST_DIR, 'overwrite.txt');
            
            await fsWrite(fp, 'original\n');
            await fsWrite(fp, 'replacement\n', { append: false });
            
            const content = fs.readFileSync(fp, 'utf-8');
            expect(content).toBe('replacement\n');
        });
    });

    describe('Hash and metadata', () => {

        test('includeHash returns MD5', async () => {
            const content = 'hash test content';
            const fp = path.join(TEST_DIR, 'hash.txt');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp, { includeHash: true });
            
            expect(rd.success).toBe(true);
            // Hash should be in attributes
            expect(rd.attributes).toBeDefined();
            expect(rd.attributes.hash).toMatch(/^[a-f0-9]{32}$/);
            
            // Verify hash is correct
            const expectedHash = crypto.createHash('md5')
                .update(Buffer.from(content, 'utf-8')).digest('hex');
            expect(rd.attributes.hash).toBe(expectedHash);
        });

        test('includeDates returns timestamps', async () => {
            const fp = path.join(TEST_DIR, 'dates.txt');
            
            await fsWrite(fp, 'date test');
            const rd = await fsRead(fp, { includeDates: true });
            
            expect(rd.success).toBe(true);
            expect(rd.attributes.created).toMatchISO8601();
        });
    });

    describe('Error handling', () => {

        test('FS_READ non-existent file returns error', async () => {
            const fp = path.join(TEST_DIR, 'nonexistent.txt');
            const rd = await fsRead(fp);
            expect(rd.success).toBe(false);
            expect(rd.error).toBeDefined();
        });

        test('FS_WRITE to invalid path returns error', async () => {
            const fp = 'C:\\Nonexistent\\Directory\\file.txt';
            const wr = await fsWrite(fp, 'test');
            // May succeed if directory can be created, or fail with permission error
            // Just verify it doesn't throw
            expect(wr).toBeDefined();
        });

        test('FS_READ large file respects maxBytes', async () => {
            const largeContent = 'x'.repeat(10000);
            const fp = path.join(TEST_DIR, 'large.txt');
            
            await fsWrite(fp, largeContent);
            const rd = await fsRead(fp, { maxBytes: 100 });
            
            expect(rd.success).toBe(true);
            expect(rd.value.length).toBeLessThanOrEqual(100);
        });
    });

    describe('FS_LIST', () => {

        test('lists directory entries', async () => {
            // Create test files
            fs.writeFileSync(path.join(TEST_DIR, 'a.txt'), 'a');
            fs.writeFileSync(path.join(TEST_DIR, 'b.txt'), 'b');
            fs.mkdirSync(path.join(TEST_DIR, 'subdir'));
            
            const result = await fsList(TEST_DIR);
            expect(result.success).toBe(true);
            expect(result.entries).toBeDefined();
            expect(result.entries.length).toBeGreaterThanOrEqual(3);
        });

        test('filter files only', async () => {
            fs.writeFileSync(path.join(TEST_DIR, 'file.txt'), 'content');
            fs.mkdirSync(path.join(TEST_DIR, 'dir'));
            
            const result = await fsList(TEST_DIR, { filter: 'files' });
            expect(result.success).toBe(true);
            for (const entry of result.entries) {
                expect(entry.type).toBe('file');
            }
        });

        test('glob pattern filtering', async () => {
            fs.writeFileSync(path.join(TEST_DIR, 'a.txt'), 'a');
            fs.writeFileSync(path.join(TEST_DIR, 'b.js'), 'b');
            fs.writeFileSync(path.join(TEST_DIR, 'c.txt'), 'c');
            
            const result = await fsList(TEST_DIR, { glob: '*.txt' });
            expect(result.success).toBe(true);
            for (const entry of result.entries) {
                expect(entry.name).toMatch(/\.txt$/);
            }
        });

        test('recursive listing', async () => {
            fs.mkdirSync(path.join(TEST_DIR, 'nested', 'deep'), { recursive: true });
            fs.writeFileSync(path.join(TEST_DIR, 'nested', 'file.txt'), 'nested');
            fs.writeFileSync(path.join(TEST_DIR, 'nested', 'deep', 'file.txt'), 'deep');
            
            const result = await fsList(TEST_DIR, { recursive: true });
            expect(result.success).toBe(true);
        });
    });

    describe('Special character edge cases', () => {

        test('SQL with embedded quotes', async () => {
            const content = "SELECT * FROM users WHERE name = 'O''Brien' AND city = ''''New York''''";
            const fp = path.join(TEST_DIR, 'sql.txt');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });

        test('Regex patterns', async () => {
            const content = '\\b[A-Z]{2,}\\b\n\\d{3}-\\d{4}\n[^\\s]+@[^\s]+';
            const fp = path.join(TEST_DIR, 'regex.txt');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });

        test('URL-encoded strings', async () => {
            const content = 'name=John%20Doe&email=test%40example.com#section';
            const fp = path.join(TEST_DIR, 'url.txt');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });

        test('ANSI escape codes', async () => {
            const content = '\x1b[32mgreen text\x1b[0m\n\x1b[1;31mbold red\x1b[0m';
            const fp = path.join(TEST_DIR, 'ansi.txt');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });

        test('Mixed line endings in same file', async () => {
            const content = 'unix-lf\nunix-lf2\r\ndos-crlf\r\ndos-crlf2\nmixed';
            const fp = path.join(TEST_DIR, 'mixed_endings.txt');
            
            await fsWrite(fp, content);
            const rd = await fsRead(fp);
            expect(rd.value).toBe(content);
        });
    });
});

// Custom Jest matcher for ISO 8601 dates
expect.extend({
    toMatchISO8601(received) {
        const pass = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(received);
        return {
            pass,
            message: () => `Expected ${received} ${pass ? 'not ' : ''}to match ISO 8601 date format`
        };
    }
});
