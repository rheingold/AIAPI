/**
 * securityFilter.test.ts
 *
 * Unit tests for the runSecurityFilter pipeline extracted from MCPServer.
 * 38 tests covering all five evaluation stages:
 *   1. Admin token bypass
 *   2. Advanced filter evaluation
 *   3. Read-only command exemption
 *   4. System process protection
 *   5. Permissive default
 */

import { runSecurityFilter, READ_ONLY_COMMANDS, SYSTEM_PROCESSES, IAdminTokenValidator } from './securityFilter';
import { FilterRule } from '../utils/filterEval';

// ── helpers ────────────────────────────────────────────────────────────────

/** Build a stub IAdminTokenValidator. */
function makeTokenValidator(
  result: { valid: boolean; expired: boolean },
): IAdminTokenValidator {
  return {
    validateAdminToken: jest.fn().mockReturnValue(result),
  };
}

const VALID_TOKEN_VALIDATOR = makeTokenValidator({ valid: true, expired: false });
const EXPIRED_TOKEN_VALIDATOR = makeTokenValidator({ valid: false, expired: true });
const INVALID_TOKEN_VALIDATOR = makeTokenValidator({ valid: false, expired: false });

/** FilterRule that ALLOWs everything. */
const ALLOW_ALL: FilterRule = {
  action: 'allow', process: '*', command: '*', pattern: '*',
};

/** FilterRule that DENYs everything. */
const DENY_ALL: FilterRule = {
  action: 'deny', process: '*', command: '*', pattern: '*',
};

/** FilterRule that DENYs CLICKID on calc.exe. */
const DENY_CALC_CLICK: FilterRule = {
  action: 'deny', process: 'calc.exe', command: 'CLICKID', pattern: '*',
};

/** FilterRule that ALLOWs SENDKEYS on notepad.exe. */
const ALLOW_NOTEPAD_SEND: FilterRule = {
  action: 'allow', process: 'notepad.exe', command: 'SENDKEYS', pattern: '*',
};

// ─── 1. Admin token bypass ─────────────────────────────────────────────────

describe('runSecurityFilter — admin token bypass (step 1)', () => {
  it('valid admin token → ALLOW regardless of destructive command on system process', async () => {
    const result = await runSecurityFilter(
      [DENY_ALL], VALID_TOKEN_VALIDATOR, 'lsass.exe', 'SENDKEYS', 'rm -rf',
      { adminToken: 'tok' },
    );
    expect(result).toBe('ALLOW');
  });

  it('valid admin token → calls validateAdminToken with the supplied token string', async () => {
    const validator = makeTokenValidator({ valid: true, expired: false });
    await runSecurityFilter([], validator, 'notepad.exe', 'SENDKEYS', 'hello', { adminToken: 'abc123' });
    expect(validator.validateAdminToken).toHaveBeenCalledWith('abc123');
  });

  it('valid admin token → ALLOW even when advanced filters would DENY', async () => {
    const result = await runSecurityFilter(
      [DENY_ALL], VALID_TOKEN_VALIDATOR, 'calc.exe', 'CLICKID', 'btn1',
      { adminToken: 'tok' },
    );
    expect(result).toBe('ALLOW');
  });

  it('expired admin token → falls through to normal evaluation (read-only → ALLOW)', async () => {
    const result = await runSecurityFilter(
      [], EXPIRED_TOKEN_VALIDATOR, 'calc.exe', 'READ', 'file.txt',
      { adminToken: 'expired-tok' },
    );
    expect(result).toBe('ALLOW');
  });

  it('expired admin token → falls through; non-readonly non-system → ALLOW (permissive default)', async () => {
    const result = await runSecurityFilter(
      [], EXPIRED_TOKEN_VALIDATOR, 'calc.exe', 'SENDKEYS', 'hello',
      { adminToken: 'expired-tok' },
    );
    expect(result).toBe('ALLOW');
  });

  it('expired admin token → falls through; system process → DENY', async () => {
    const result = await runSecurityFilter(
      [], EXPIRED_TOKEN_VALIDATOR, 'lsass.exe', 'SENDKEYS', 'x',
      { adminToken: 'expired-tok' },
    );
    expect(result).toBe('DENY');
  });

  it('invalid admin token → falls through; system process → DENY', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, 'winlogon.exe', 'CLICKID', 'id1',
      { adminToken: 'bad' },
    );
    expect(result).toBe('DENY');
  });

  it('no context → no token check; permissive default', async () => {
    const validator = makeTokenValidator({ valid: true, expired: false });
    const result = await runSecurityFilter([], validator, 'calc.exe', 'SENDKEYS', 'x');
    expect(validator.validateAdminToken).not.toHaveBeenCalled();
    expect(result).toBe('ALLOW');
  });

  it('context present but adminToken undefined → no token check', async () => {
    const validator = makeTokenValidator({ valid: true, expired: false });
    const result = await runSecurityFilter([], validator, 'calc.exe', 'SENDKEYS', 'x', {});
    expect(validator.validateAdminToken).not.toHaveBeenCalled();
    expect(result).toBe('ALLOW');
  });
});

// ─── 2. Advanced filter evaluation (step 2) ────────────────────────────────

describe('runSecurityFilter — advanced filters (step 2)', () => {
  it('empty filter list → no filter check; falls through to defaults', async () => {
    const result = await runSecurityFilter([], INVALID_TOKEN_VALIDATOR, 'calc.exe', 'SENDKEYS', 'x');
    expect(result).toBe('ALLOW');
  });

  it('DENY_ALL rule → DENY for any process/command', async () => {
    const result = await runSecurityFilter(
      [DENY_ALL], INVALID_TOKEN_VALIDATOR, 'calc.exe', 'SENDKEYS', 'x',
    );
    expect(result).toBe('DENY');
  });

  it('DENY_CALC_CLICK matches calc.exe + CLICKID → DENY', async () => {
    const result = await runSecurityFilter(
      [DENY_CALC_CLICK], INVALID_TOKEN_VALIDATOR, 'calc.exe', 'CLICKID', 'btn1',
    );
    expect(result).toBe('DENY');
  });

  it('DENY_CALC_CLICK does NOT match notepad.exe + CLICKID → falls through to default ALLOW', async () => {
    const result = await runSecurityFilter(
      [DENY_CALC_CLICK], INVALID_TOKEN_VALIDATOR, 'notepad.exe', 'CLICKID', 'btn1',
    );
    expect(result).toBe('ALLOW');
  });

  it('DENY_CALC_CLICK does NOT match calc.exe + SENDKEYS → falls through to default ALLOW', async () => {
    const result = await runSecurityFilter(
      [DENY_CALC_CLICK], INVALID_TOKEN_VALIDATOR, 'calc.exe', 'SENDKEYS', 'hello',
    );
    expect(result).toBe('ALLOW');
  });

  it('ALLOW_ALL rule → ALLOW result (no DENY rule; continue → read-only not needed → permissive)', async () => {
    const result = await runSecurityFilter(
      [ALLOW_ALL], INVALID_TOKEN_VALIDATOR, 'calc.exe', 'SENDKEYS', 'x',
    );
    expect(result).toBe('ALLOW');
  });

  it('ALLOW rule match but system process → DENY (built-in step 4 still applies)', async () => {
    // ALLOW_NOTEPAD_SEND applies to notepad; but we pass lsass which is system
    // We use ALL_ALLOW so any process gets ALLOW from filter, including lsass.
    // After ALLOW from advanced filter, execution continues to step 4.
    const result = await runSecurityFilter(
      [ALLOW_ALL], INVALID_TOKEN_VALIDATOR, 'lsass.exe', 'SENDKEYS', 'x',
    );
    expect(result).toBe('DENY');
  });

  it('ALLOW rule match + read-only command → ALLOW (step 3 fires first)', async () => {
    const result = await runSecurityFilter(
      [ALLOW_NOTEPAD_SEND], INVALID_TOKEN_VALIDATOR, 'notepad.exe', 'READ', 'file.txt',
    );
    // notepad matches ALLOW_NOTEPAD_SEND only for SENDKEYS — READ doesn't match that rule
    // so fall-through to step 3 (READ is read-only) → ALLOW
    expect(result).toBe('ALLOW');
  });

  it('DENY rule fires BEFORE read-only step — advanced filter wins', async () => {
    // Even though READ is read-only (step 3), deny-all fires earlier at step 2
    const result = await runSecurityFilter(
      [DENY_ALL], INVALID_TOKEN_VALIDATOR, 'calc.exe', 'READ', 'x',
    );
    expect(result).toBe('DENY');
  });

  it('{CLICKID} with braces stripped matches rule with bare CLICKID command', async () => {
    const denyBraced: FilterRule = { action: 'deny', process: '*', command: 'CLICKID', pattern: '*' };
    const result = await runSecurityFilter(
      [denyBraced], INVALID_TOKEN_VALIDATOR, 'calc.exe', '{CLICKID}', 'id1',
    );
    expect(result).toBe('DENY');
  });
});

// ─── 3. Read-only commands (step 3) ───────────────────────────────────────

describe('runSecurityFilter — read-only commands (step 3)', () => {
  const readOnlyCases: string[] = [...READ_ONLY_COMMANDS];

  it.each(readOnlyCases)(
    '%s → ALLOW (no filters, non-system process)',
    async (cmd) => {
      const result = await runSecurityFilter(
        [], INVALID_TOKEN_VALIDATOR, 'calc.exe', cmd, '',
      );
      expect(result).toBe('ALLOW');
    },
  );

  it('read-only command on system process → ALLOW (step 3 fires before step 4)', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, 'explorer.exe', 'QUERYTREE', '',
    );
    expect(result).toBe('ALLOW');
  });

  it('SENDKEYS is NOT read-only → normal evaluation applies', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, 'calc.exe', 'SENDKEYS', 'x',
    );
    expect(result).toBe('ALLOW'); // permissive default for non-system
  });
});

// ─── 4. System process protection (step 4) ────────────────────────────────

describe('runSecurityFilter — system process protection (step 4)', () => {
  const systemCases: string[] = [...SYSTEM_PROCESSES];

  it.each(systemCases)(
    'process containing "%s" + SENDKEYS → DENY',
    async (proc) => {
      const result = await runSecurityFilter(
        [], INVALID_TOKEN_VALIDATOR, proc, 'SENDKEYS', 'x',
      );
      expect(result).toBe('DENY');
    },
  );

  it('full path containing "lsass" → DENY (substring match)', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, 'C:\\Windows\\System32\\lsass.exe', 'CLICKID', 'btn',
    );
    expect(result).toBe('DENY');
  });

  it('case-insensitive: "LSASS.EXE" → DENY', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, 'LSASS.EXE', 'SENDKEYS', 'x',
    );
    expect(result).toBe('DENY');
  });

  it('case-insensitive: "EXPLORER.EXE" → DENY', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, 'EXPLORER.EXE', 'SENDKEYS', 'x',
    );
    expect(result).toBe('DENY');
  });

  it('"calc.exe" is NOT a system process → ALLOW (default)', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, 'calc.exe', 'SENDKEYS', 'x',
    );
    expect(result).toBe('ALLOW');
  });

  it('"notepad.exe" is NOT a system process → ALLOW (default)', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, 'notepad.exe', 'CLICKID', 'id1',
    );
    expect(result).toBe('ALLOW');
  });
});

// ─── 5. Permissive default (step 5) ───────────────────────────────────────

describe('runSecurityFilter — permissive default (step 5)', () => {
  it('no filters, no token, non-system, non-readonly → ALLOW', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, 'mspaint.exe', 'CLICKID', 'btn_color',
    );
    expect(result).toBe('ALLOW');
  });

  it('ALLOW rule match → continues; non-system + non-readonly → ALLOW', async () => {
    const result = await runSecurityFilter(
      [ALLOW_NOTEPAD_SEND], INVALID_TOKEN_VALIDATOR, 'notepad.exe', 'SENDKEYS', 'hello',
    );
    expect(result).toBe('ALLOW');
  });

  it('empty process name, no filter → ALLOW (edge case)', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, '', 'CLICKID', '',
    );
    expect(result).toBe('ALLOW');
  });

  it('empty command, no filter → ALLOW (edge case)', async () => {
    const result = await runSecurityFilter(
      [], INVALID_TOKEN_VALIDATOR, 'calc.exe', '', '',
    );
    expect(result).toBe('ALLOW');
  });
});
