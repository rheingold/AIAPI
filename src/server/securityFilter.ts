/**
 * securityFilter.ts
 *
 * Pure function that encapsulates the validateSecurityFilter pipeline used by
 * MCPServer.  Extracted here so it can be unit-tested without spinning up the
 * full HTTP server or touching the file system.
 *
 * Evaluation order (first matching rule wins):
 *   1. Admin token present & valid         → ALLOW immediately (audit logged)
 *   2. Admin token present but expired     → fall-through to normal rules
 *   3. Admin token present but invalid     → fall-through to normal rules
 *   4. advancedFilters DENY match          → DENY
 *   5. advancedFilters ALLOW match         → continue to built-in rules
 *   6. Read-only command                   → ALLOW
 *   7. Protected system process            → DENY
 *   8. Default (permissive)               → ALLOW
 */

import { FilterRule, evaluateFilterRules } from '../utils/filterEval';
import { globalLogger } from '../utils/Logger';

/** Minimal interface so tests can inject a stub without the full class. */
export interface IAdminTokenValidator {
  validateAdminToken(token: string): { valid: boolean; expired: boolean; data?: unknown };
}

/**
 * Read-only commands that are always permitted regardless of filters.
 * Exposed for use in tests and documentation.
 */
export const READ_ONLY_COMMANDS = ['QUERYTREE', 'READ', 'LISTWINDOWS', 'GETPROVIDERS'] as const;

/**
 * System processes that must never be modified.
 * Exposed for use in tests and documentation.
 */
export const SYSTEM_PROCESSES = ['explorer', 'winlogon', 'csrss', 'lsass', 'services', 'svchost'] as const;

/**
 * Run the full security-filter pipeline.
 *
 * @param advancedFilters  The current in-memory filter rules list.
 * @param tokenValidator   Object that can validate admin tokens.
 * @param processName      Target process name (e.g. "calc.exe").
 * @param commandType      Raw command string (e.g. "CLICKID" or "{CLICKID}").
 * @param parameter        Command parameter value (may be empty string).
 * @param context          Optional request context carrying an admin token.
 */
export async function runSecurityFilter(
  advancedFilters: FilterRule[],
  tokenValidator: IAdminTokenValidator,
  processName: string,
  commandType: string,
  parameter: string,
  context?: { adminToken?: string },
): Promise<'ALLOW' | 'DENY'> {
  // ── Step 1: Admin token bypass ──────────────────────────────────────────
  if (context?.adminToken) {
    const validation = tokenValidator.validateAdminToken(context.adminToken);
    if (validation.valid && !validation.expired) {
      globalLogger.warn('Security', `Admin token bypass: ${commandType} on ${processName}`);
      return 'ALLOW';
    } else if (validation.expired) {
      globalLogger.warn('Security', 'Expired admin token attempted');
      // fall-through to normal rules
    } else {
      globalLogger.warn('Security', 'Invalid admin token attempted');
      // fall-through to normal rules
    }
  }

  // ── Step 2: Dashboard-managed advanced filters ──────────────────────────
  if (advancedFilters.length > 0) {
    // helperName is unavailable at this call-site; '' causes evaluateFilterRules
    // to skip the optional helper field check (backward-compat with mcpServer).
    const { verdict } = evaluateFilterRules(
      advancedFilters, processName, '', commandType, parameter,
    );
    if (verdict === 'DENY') {
      globalLogger.warn(
        'Security',
        `Advanced filter DENY: ${commandType} on ${processName} (param: ${parameter})`,
      );
      return 'DENY';
    }
    if (verdict === 'ALLOW') {
      globalLogger.info('Security', `Advanced filter ALLOW: ${commandType} on ${processName}`);
      // Continue — built-in rules still apply
    }
  }

  // ── Step 3: Read-only commands are always allowed ───────────────────────
  if ((READ_ONLY_COMMANDS as readonly string[]).includes(commandType)) {
    return 'ALLOW';
  }

  // ── Step 4: Block destructive operations on protected system processes ──
  const lowerProcess = processName.toLowerCase();
  if (SYSTEM_PROCESSES.some(proc => lowerProcess.includes(proc))) {
    globalLogger.warn(
      'Security',
      `Security filter blocked ${commandType} on system process ${processName}`,
    );
    return 'DENY';
  }

  // ── Step 5: Permissive default (tighten via advancedFilters in prod) ────
  return 'ALLOW';
}
