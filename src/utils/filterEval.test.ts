import { evaluateFilterRules, FilterRule } from './filterEval';

// ── Helpers ───────────────────────────────────────────────────────────────────

function rule(
  action: 'allow' | 'deny',
  process: string,
  command: string,
  pattern: string,
  opts: Partial<FilterRule> = {},
): FilterRule {
  return { id: Math.random(), action, process, command, pattern, ...opts };
}

function allow(process: string, command: string, pattern: string, opts: Partial<FilterRule> = {}) {
  return rule('allow', process, command, pattern, opts);
}
function deny(process: string, command: string, pattern: string, opts: Partial<FilterRule> = {}) {
  return rule('deny', process, command, pattern, opts);
}

// ── No rules / empty list ─────────────────────────────────────────────────────

describe('evaluateFilterRules — no rules', () => {
  it('returns verdict=null when rule list is empty', () => {
    const { verdict } = evaluateFilterRules([], 'calc.exe', 'KeyWin.exe', 'CLICKID', 'btn1');
    expect(verdict).toBeNull();
  });

  it('reason reports "No rule matched"', () => {
    const { reason } = evaluateFilterRules([], 'calc.exe', '', 'READ', '');
    expect(reason).toMatch(/no rule matched/i);
  });
});

// ── Basic ALLOW and DENY verdicts ─────────────────────────────────────────────

describe('evaluateFilterRules — basic verdicts', () => {
  it('returns ALLOW when a single ALLOW rule matches', () => {
    const rules = [allow('calc.exe', 'CLICKID', '*')];
    const result = evaluateFilterRules(rules, 'calc.exe', '', 'CLICKID', 'anyParam');
    expect(result.verdict).toBe('ALLOW');
    expect(result.matchedRule).toBe(rules[0]);
  });

  it('returns DENY when a single DENY rule matches', () => {
    const rules = [deny('calc.exe', 'KILL', '*')];
    const result = evaluateFilterRules(rules, 'calc.exe', '', 'KILL', '');
    expect(result.verdict).toBe('DENY');
  });

  it('returns null when nothing matches', () => {
    const rules = [allow('notepad.exe', 'READ', '*')];
    const result = evaluateFilterRules(rules, 'calc.exe', '', 'READ', '');
    expect(result.verdict).toBeNull();
  });
});

// ── First-DENY-wins semantics ─────────────────────────────────────────────────

describe('evaluateFilterRules — DENY wins over ALLOW', () => {
  it('DENY after ALLOW: DENY wins', () => {
    const rules = [
      allow('*', 'CLICKID', '*'),
      deny ('*', 'CLICKID', '*'),
    ];
    const result = evaluateFilterRules(rules, 'calc.exe', '', 'CLICKID', 'p');
    expect(result.verdict).toBe('DENY');
    expect(result.matchedRule).toBe(rules[1]);
  });

  it('DENY before ALLOW: DENY wins (short-circuit, ALLOW rule never evaluated)', () => {
    const rules = [
      deny ('*', 'KILL', '*'),
      allow('*', 'KILL', '*'),
    ];
    const result = evaluateFilterRules(rules, 'x.exe', '', 'KILL', '');
    expect(result.verdict).toBe('DENY');
    expect(result.matchedRule).toBe(rules[0]);
  });

  it('multiple ALLOWs, no DENY: first ALLOW reported', () => {
    const rules = [
      allow('calc.exe', 'READ',  '*', { id: 1 }),
      allow('calc.exe', 'QUERYTREE', '*', { id: 2 }),
    ];
    const result = evaluateFilterRules(rules, 'calc.exe', '', 'READ', '');
    expect(result.verdict).toBe('ALLOW');
    expect(result.matchedRule).toBe(rules[0]);
  });
});

// ── Process matching ──────────────────────────────────────────────────────────

describe('evaluateFilterRules — process matching', () => {
  it('exact process name match is case-insensitive', () => {
    const rules = [deny('CALC.EXE', 'KILL', '*')];
    expect(evaluateFilterRules(rules, 'calc.exe', '', 'KILL', '').verdict).toBe('DENY');
    expect(evaluateFilterRules(rules, 'CALC.EXE', '', 'KILL', '').verdict).toBe('DENY');
  });

  it('wildcard * matches any process', () => {
    const rules = [deny('*', 'KILL', '*')];
    expect(evaluateFilterRules(rules, 'notepad.exe', '', 'KILL', '').verdict).toBe('DENY');
    expect(evaluateFilterRules(rules, 'mspaint.exe', '', 'KILL', '').verdict).toBe('DENY');
  });

  it('glob pattern matches partial process name', () => {
    const rules = [allow('note*', 'READ', '*')];
    expect(evaluateFilterRules(rules, 'notepad.exe', '', 'READ', '').verdict).toBe('ALLOW');
    expect(evaluateFilterRules(rules, 'notething.exe', '', 'READ', '').verdict).toBe('ALLOW');
    expect(evaluateFilterRules(rules, 'calc.exe', '', 'READ', '').verdict).toBeNull();
  });
});

// ── Command matching ──────────────────────────────────────────────────────────

describe('evaluateFilterRules — command matching', () => {
  it('strips {braces} from rule command before matching', () => {
    const rules = [deny('*', '{CLICKID}', '*')];
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKID', '').verdict).toBe('DENY');
  });

  it('strips {braces} from command argument too', () => {
    const rules = [deny('*', 'CLICKID', '*')];
    expect(evaluateFilterRules(rules, 'x', '', '{CLICKID}', '').verdict).toBe('DENY');
  });

  it('command "*" in rule matches any command', () => {
    const rules = [deny('*', '*', '*')];
    expect(evaluateFilterRules(rules, 'x', '', 'READ', '').verdict).toBe('DENY');
    expect(evaluateFilterRules(rules, 'x', '', 'SENDKEYS', '').verdict).toBe('DENY');
  });

  it('specific command does not match a different one', () => {
    const rules = [deny('*', 'KILL', '*')];
    expect(evaluateFilterRules(rules, 'x', '', 'READ', '').verdict).toBeNull();
  });

  it('glob in command e.g. "CLICK*" matches CLICKID and CLICKNAME', () => {
    const rules = [allow('*', 'CLICK*', '*')];
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKID', '').verdict).toBe('ALLOW');
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKNAME', '').verdict).toBe('ALLOW');
    expect(evaluateFilterRules(rules, 'x', '', 'READ', '').verdict).toBeNull();
  });
});

// ── Pattern (parameter) matching ──────────────────────────────────────────────

describe('evaluateFilterRules — pattern matching', () => {
  it('wildcard * in pattern matches any parameter', () => {
    const rules = [allow('*', 'CLICKID', '*')];
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKID', 'anything').verdict).toBe('ALLOW');
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKID', '').verdict).toBe('ALLOW');
  });

  it('literal pattern only matches that exact value (case-insensitive)', () => {
    const rules = [allow('*', 'CLICKID', 'btnOk')];
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKID', 'btnOk').verdict).toBe('ALLOW');
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKID', 'BTNOK').verdict).toBe('ALLOW');
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKID', 'btnCancel').verdict).toBeNull();
  });

  it('glob pattern e.g. "num*Button" matches numericButton but not closeBtn', () => {
    const rules = [allow('*', 'CLICKID', 'num*Button')];
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKID', 'num1Button').verdict).toBe('ALLOW');
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKID', 'numZeroButton').verdict).toBe('ALLOW');
    expect(evaluateFilterRules(rules, 'x', '', 'CLICKID', 'closeButton').verdict).toBeNull();
  });

  it('/regex/ pattern in pattern field', () => {
    const rules = [deny('*', 'SENDKEYS', '/^\\{.*\\}/')];
    // Sends that look like key combos e.g. {CTRL+A}
    expect(evaluateFilterRules(rules, 'x', '', 'SENDKEYS', '{CTRL+A}').verdict).toBe('DENY');
    expect(evaluateFilterRules(rules, 'x', '', 'SENDKEYS', 'hello').verdict).toBeNull();
  });
});

// ── Helper matching ───────────────────────────────────────────────────────────

describe('evaluateFilterRules — helper matching', () => {
  it('rule with specific helper only matches that helper', () => {
    const rules = [deny('*', 'KILL', '*', { helper: 'KeyWin.exe' })];
    expect(evaluateFilterRules(rules, 'x', 'KeyWin.exe', 'KILL', '').verdict).toBe('DENY');
    expect(evaluateFilterRules(rules, 'x', 'BrowserWin.exe', 'KILL', '').verdict).toBeNull();
  });

  it('rule with helper="*" matches any helper', () => {
    const rules = [deny('*', 'KILL', '*', { helper: '*' })];
    expect(evaluateFilterRules(rules, 'x', 'KeyWin.exe', 'KILL', '').verdict).toBe('DENY');
    expect(evaluateFilterRules(rules, 'x', 'BrowserWin.exe', 'KILL', '').verdict).toBe('DENY');
  });

  it('rule with no helper field matches regardless of helperName', () => {
    // helper absent → no helper restriction
    const rules = [allow('*', 'READ', '*')];
    expect(evaluateFilterRules(rules, 'x', 'KeyWin.exe', 'READ', '').verdict).toBe('ALLOW');
    expect(evaluateFilterRules(rules, 'x', 'BrowserWin.exe', 'READ', '').verdict).toBe('ALLOW');
  });

  it('when helperName is empty, helper field on rule is ignored (backward-compat with mcpServer)', () => {
    // mcpServer doesn't pass a helper name — the helper field on rules is skipped,
    // so ALL rules (including helper-scoped ones) are evaluated as if helper=*.
    const rules = [deny('*', 'KILL', '*', { helper: 'KeyWin.exe' })];
    // helperName='' → helper check skipped → rule still fires (conservative/backward-compat)
    expect(evaluateFilterRules(rules, 'x', '', 'KILL', '').verdict).toBe('DENY');
  });
});

// ── Rule id and reason string ─────────────────────────────────────────────────

describe('evaluateFilterRules — reason and matchedRule', () => {
  it('reason includes rule id when present', () => {
    const rules = [deny('*', 'KILL', '*', { id: 7 })];
    const { reason } = evaluateFilterRules(rules, 'x', '', 'KILL', '');
    expect(reason).toContain('#7');
  });

  it('reason includes description when present', () => {
    const rules = [deny('*', 'KILL', '*', { description: 'No killing' })];
    const { reason } = evaluateFilterRules(rules, 'x', '', 'KILL', '');
    expect(reason).toContain('No killing');
  });

  it('matchedRule is the first matched ALLOW rule', () => {
    const r1 = allow('*', 'READ', '*', { id: 1 });
    const r2 = allow('*', 'READ', '*', { id: 2 });
    const { matchedRule } = evaluateFilterRules([r1, r2], 'x', '', 'READ', '');
    expect(matchedRule).toBe(r1);
  });

  it('matchedRule is the first DENY rule that triggered', () => {
    const r1 = deny('*', 'KILL', '*', { id: 1 });
    const r2 = deny('*', 'KILL', '*', { id: 2 });
    const { matchedRule } = evaluateFilterRules([r1, r2], 'x', '', 'KILL', '');
    expect(matchedRule).toBe(r1);
  });
});

// ── Real-world filter scenarios ───────────────────────────────────────────────

describe('evaluateFilterRules — real-world scenarios', () => {
  const calcRules: FilterRule[] = [
    allow('calc.exe', '{CLICKID}', 'num*'),           // number buttons
    allow('calc.exe', '{READ}',    '*'),               // read anything
    deny ('*',        '{KILL}',    '*'),               // never kill anything
    deny ('*',        '{SENDKEYS}', '/^\\{CTRL\\+./i'), // no Ctrl+shortcuts
  ];

  it('allows clicking a numeric button on calc', () => {
    expect(evaluateFilterRules(calcRules, 'calc.exe', '', 'CLICKID', 'num1Button').verdict).toBe('ALLOW');
  });

  it('allows reading from calc', () => {
    expect(evaluateFilterRules(calcRules, 'calc.exe', '', 'READ', '').verdict).toBe('ALLOW');
  });

  it('denies KILL on any process', () => {
    expect(evaluateFilterRules(calcRules, 'calc.exe', '', 'KILL', '').verdict).toBe('DENY');
    expect(evaluateFilterRules(calcRules, 'notepad.exe', '', 'KILL', '').verdict).toBe('DENY');
  });

  it('returns null for unmatched command (no rule covers it)', () => {
    expect(evaluateFilterRules(calcRules, 'calc.exe', '', 'LAUNCH', '').verdict).toBeNull();
  });

  it('returns null for unmatched non-num button (ALLOW rule is scoped to num*)', () => {
    expect(evaluateFilterRules(calcRules, 'calc.exe', '', 'CLICKID', 'clearButton').verdict).toBeNull();
  });
});
