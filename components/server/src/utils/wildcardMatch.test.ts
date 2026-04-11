import { wildcardMatch } from './wildcardMatch';

describe('wildcardMatch', () => {
  // ── Trivial / empty ─────────────────────────────────────────────────────────

  it('always matches bare * pattern', () => {
    expect(wildcardMatch('*', 'anything')).toBe(true);
    expect(wildcardMatch('*', '')).toBe(true);
  });

  it('always matches empty pattern', () => {
    expect(wildcardMatch('', 'anything')).toBe(true);
    expect(wildcardMatch('', '')).toBe(true);
  });

  // ── Glob: literal matching ───────────────────────────────────────────────────

  it('matches exact text (case-insensitive)', () => {
    expect(wildcardMatch('calc.exe', 'calc.exe')).toBe(true);
    expect(wildcardMatch('calc.exe', 'CALC.EXE')).toBe(true);
    expect(wildcardMatch('Calc.exe', 'calc.exe')).toBe(true);
  });

  it('does not match different text', () => {
    expect(wildcardMatch('calc.exe', 'notepad.exe')).toBe(false);
    expect(wildcardMatch('calc.exe', 'calc')).toBe(false);
  });

  // ── Glob: * (zero or more chars) ─────────────────────────────────────────────

  it('* at the end matches suffix', () => {
    expect(wildcardMatch('num*', 'num0Button')).toBe(true);
    expect(wildcardMatch('num*', 'num')).toBe(true);
    expect(wildcardMatch('num*', 'button')).toBe(false);
  });

  it('* at the start matches prefix', () => {
    expect(wildcardMatch('*.exe', 'calc.exe')).toBe(true);
    expect(wildcardMatch('*.exe', 'KeyWin.exe')).toBe(true);
    expect(wildcardMatch('*.exe', 'calc.dll')).toBe(false);
  });

  it('* in the middle matches inner sequence', () => {
    expect(wildcardMatch('num*Button', 'num0Button')).toBe(true);
    expect(wildcardMatch('num*Button', 'num1Button')).toBe(true);
    expect(wildcardMatch('num*Button', 'numPlusButton')).toBe(true);
    expect(wildcardMatch('num*Button', 'numButton')).toBe(true); // zero chars
    expect(wildcardMatch('num*Button', 'clearButton')).toBe(false);
  });

  it('multiple * wildcards', () => {
    expect(wildcardMatch('Key*.*', 'KeyWin.exe')).toBe(true);
    expect(wildcardMatch('Key*.*', 'KeyBrowser.dll')).toBe(true);
    expect(wildcardMatch('Key*.*', 'KeyWin')).toBe(false);
  });

  // ── Glob: ? (exactly one char) ───────────────────────────────────────────────

  it('? matches exactly one character', () => {
    expect(wildcardMatch('num?Button', 'num0Button')).toBe(true);
    expect(wildcardMatch('num?Button', 'num1Button')).toBe(true);
    expect(wildcardMatch('num?Button', 'numButton')).toBe(false);   // 0 chars
    expect(wildcardMatch('num?Button', 'num10Button')).toBe(false); // 2 chars
  });

  it('multiple ? wildcards', () => {
    expect(wildcardMatch('?a?c', 'calc')).toBe(true);
    expect(wildcardMatch('?a?c', 'abc')).toBe(false);
  });

  // ── Glob: special regex chars are properly escaped ───────────────────────────

  it('dots in pattern are treated as literal dots', () => {
    expect(wildcardMatch('calc.exe', 'calcXexe')).toBe(false); // . is literal, not regex wildcard
  });

  it('other regex metacharacters are escaped', () => {
    expect(wildcardMatch('my.app+test', 'my.app+test')).toBe(true);
    expect(wildcardMatch('(group)', '(group)')).toBe(true);
    expect(wildcardMatch('(group)', 'group')).toBe(false);
  });

  // ── Regex syntax: /pattern/ ──────────────────────────────────────────────────

  it('/pattern/ applies a real regex', () => {
    expect(wildcardMatch('/num\\dButton/', 'num5Button')).toBe(true);
    expect(wildcardMatch('/num\\dButton/', 'numPlusButton')).toBe(false);
  });

  it('/pattern/ is case-insensitive by default (no flag)', () => {
    // When no flag is specified, the utility still passes 'i' flag
    expect(wildcardMatch('/calc\\.exe/', 'CALC.EXE')).toBe(true);
  });

  it('/pattern/i explicit flag still works', () => {
    expect(wildcardMatch('/calc\\.exe/i', 'CALC.EXE')).toBe(true);
  });

  it('/pattern/ with anchors', () => {
    expect(wildcardMatch('/^(calc|notepad)\\.exe$/', 'calc.exe')).toBe(true);
    expect(wildcardMatch('/^(calc|notepad)\\.exe$/', 'notepad.exe')).toBe(true);
    expect(wildcardMatch('/^(calc|notepad)\\.exe$/', 'winword.exe')).toBe(false);
  });

  it('invalid /regex/ returns false without throwing', () => {
    expect(wildcardMatch('/[invalid regex/', 'anything')).toBe(false);
    expect(wildcardMatch('/(?P<bad>/', 'anything')).toBe(false);
  });

  // ── Command pattern matching (real-world cases) ───────────────────────────────

  it('security filter command pattern: {CLICKID}', () => {
    expect(wildcardMatch('{CLICKID}', 'CLICKID')).toBe(false); // braces are literals in glob
    // The filter evaluation strips braces before calling wildcardMatch, but the
    // pattern field itself may also be stored without braces — test both:
    expect(wildcardMatch('CLICKID', 'CLICKID')).toBe(true);
    expect(wildcardMatch('CLICK*', 'CLICKID')).toBe(true);
    expect(wildcardMatch('CLICK*', 'CLICKNAME')).toBe(true);
    expect(wildcardMatch('CLICK*', 'SENDKEYS')).toBe(false);
  });

  it('process name wildcard patterns', () => {
    expect(wildcardMatch('calc*', 'Calculator.exe')).toBe(true);
    expect(wildcardMatch('notepad*', 'notepad.exe')).toBe(true);
    expect(wildcardMatch('notepad*', 'notepad++.exe')).toBe(true);
    expect(wildcardMatch('calc*', 'winword.exe')).toBe(false);
  });
});
