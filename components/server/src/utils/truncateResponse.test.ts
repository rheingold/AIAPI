import { truncateResponse, slimHelperSummary, DEFAULT_MAX_CHARS } from './truncateResponse';

describe('truncateResponse', () => {
  it('returns object unchanged when under budget', () => {
    const obj = { success: true, data: 'hello' };
    const { data, truncated } = truncateResponse(obj, { maxChars: 1000 });
    expect(truncated).toBe(false);
    expect(data).toBe(obj);
  });

  it('trims array field when over budget', () => {
    const arr = Array.from({ length: 100 }, (_, i) => ({ name: `cmd${i}`, description: 'x'.repeat(100) }));
    const obj = { success: true, commands: arr };
    const { data, truncated } = truncateResponse(obj, { maxChars: 2000, arrayFields: ['commands'] });
    expect(truncated).toBe(true);
    expect((data as any).commands.length).toBeLessThan(100);
    expect((data as any)._truncated).toBe(true);
    expect((data as any)._hint).toBeTruthy();
  });

  it('falls back to error envelope when still over after array trim', () => {
    // Single-element array that is still huge
    const obj = { success: true, blob: 'x'.repeat(50_000) };
    const { data, truncated } = truncateResponse(obj, { maxChars: 1000 });
    expect(truncated).toBe(true);
    expect((data as any)._truncated).toBe(true);
  });

  it('respects custom maxChars', () => {
    const obj = { success: true, data: 'a'.repeat(100) };
    const { truncated: t1 } = truncateResponse(obj, { maxChars: 50 });
    const { truncated: t2 } = truncateResponse(obj, { maxChars: 500 });
    expect(t1).toBe(true);
    expect(t2).toBe(false);
  });

  it('uses DEFAULT_MAX_CHARS when no opts provided', () => {
    const small = { success: true, data: 'x' };
    const { truncated } = truncateResponse(small);
    expect(truncated).toBe(false);
  });
});

describe('slimHelperSummary', () => {
  it('returns compact summary without inputSchema', () => {
    const schema = {
      helper: 'KeyWin.exe',
      version: '1.0',
      description: 'test',
      toolName: 'KeyWin',
      filePath: 'C:/KeyWin.exe',
      commands: [
        { name: 'SENDKEYS', description: 'Send keys', inputSchema: { type: 'object', properties: { huge: true } } },
        { name: 'READ', description: 'Read text', inputSchema: {} },
      ],
    };
    const slim = slimHelperSummary(schema);
    expect(slim.commandCount).toBe(2);
    expect(slim.commands[0]).toEqual({ name: 'SENDKEYS', description: 'Send keys' });
    expect(slim.commands[1]).toEqual({ name: 'READ', description: 'Read text' });
    expect((slim as any).inputSchema).toBeUndefined();
  });
});
