/**
 * filterEval.ts
 *
 * Pure, side-effect-free evaluation of the security filter rule list.
 *
 * Evaluation semantics (first-match-DENY wins):
 *   – Scan rules in order.
 *   – On the FIRST matching DENY rule:  return DENY immediately.
 *   – On a matching ALLOW rule:  record it but keep scanning (a later DENY still wins).
 *   – After all rules:  if any ALLOW was recorded, return ALLOW.
 *   – If no rule matched at all: return verdict=null (caller decides the default).
 *
 * Caller semantics:
 *   – `null`  → no rule matched, fall through to caller's built-in defaults.
 *   – `ALLOW` → at least one ALLOW matched and no DENY matched.
 *   – `DENY`  → at least one DENY matched (short-circuited).
 *
 * Rule field matching:
 *   – `process`  – wildcardMatch against processName (default '*' when absent)
 *   – `command`  – {BRACES} stripped before matching against commandType
 *   – `helper`   – wildcardMatch against helperName; SKIPPED when either the
 *                  rule's helper is absent/`*` OR helperName is empty (preserves
 *                  backward-compat with callers that don't know the helper name).
 *   – `pattern`  – wildcardMatch against parameter (default '*' when absent)
 */

import { wildcardMatch } from './wildcardMatch';

// ── Public types ──────────────────────────────────────────────────────────────

export interface FilterRule {
  id?: number | string;
  action: 'allow' | 'deny';
  /** Process name glob, e.g. "calc.exe" or "*"  */
  process: string;
  /** Helper executable glob, e.g. "KeyWin.exe" or "*" (optional)  */
  helper?: string;
  /** Command — stored as "{CLICKID}" or bare "CLICKID" or "*"  */
  command: string;
  /** Parameter / target pattern glob, e.g. "num*Button" or "*"  */
  pattern: string;
  description?: string;
}

export interface FilterEvalResult {
  /** ALLOW / DENY, or null when no rule matched.  */
  verdict: 'ALLOW' | 'DENY' | null;
  /** The first rule that determined the verdict (null when no match).  */
  matchedRule: FilterRule | null;
  reason: string;
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

/**
 * Evaluate a list of filter rules against a concrete command invocation.
 *
 * @param rules       Ordered list of filter rules to evaluate.
 * @param processName Name of the target process (e.g. "calc.exe").
 * @param helperName  Helper executable name (e.g. "KeyWin.exe").
 *                    Pass an empty string when the helper is not known at the
 *                    call site — helper-specific rules will be skipped (same
 *                    behaviour as before helper matching was added to mcpServer).
 * @param commandType The command being executed (e.g. "CLICKID").
 *                    {BRACES} are stripped automatically.
 * @param parameter   The parameter/target string (may be empty).
 */
export function evaluateFilterRules(
  rules: FilterRule[],
  processName: string,
  helperName: string,
  commandType: string,
  parameter: string,
): FilterEvalResult {
  const cmd = commandType.replace(/^\{|\}$/g, '');

  let firstAllow: FilterRule | null = null;
  let firstAllowReason = '';

  for (const rule of rules) {
    // ── Process match ──────────────────────────────────────────────────────
    if (!wildcardMatch(rule.process || '*', processName)) continue;

    // ── Command match (strip {braces} from rule side too) ──────────────────
    const ruleCmd = (rule.command || '*').replace(/^\{|\}$/g, '');
    if (ruleCmd !== '*' && !wildcardMatch(ruleCmd, cmd)) continue;

    // ── Helper match (optional; skipped when either side is absent/"*") ────
    if (rule.helper && rule.helper !== '*' && helperName !== '') {
      if (!wildcardMatch(rule.helper, helperName)) continue;
    }

    // ── Pattern/parameter match ────────────────────────────────────────────
    if (!wildcardMatch(rule.pattern || '*', parameter)) continue;

    // ── Matched ────────────────────────────────────────────────────────────
    const label = rule.description
      ?? `${rule.action} ${rule.process} → ${rule.helper ?? '*'}::${rule.command}/${rule.pattern}`;
    const idTag = rule.id != null ? ` #${rule.id}` : '';

    if (rule.action === 'deny') {
      return {
        verdict: 'DENY',
        matchedRule: rule,
        reason: `Matched DENY rule${idTag}: ${label}`,
      };
    }

    // ALLOW — record first match and keep scanning for a later DENY
    if (!firstAllow) {
      firstAllow = rule;
      firstAllowReason = `Matched ALLOW rule${idTag}: ${label}`;
    }
  }

  if (firstAllow) {
    return { verdict: 'ALLOW', matchedRule: firstAllow, reason: firstAllowReason };
  }
  return { verdict: null, matchedRule: null, reason: 'No rule matched' };
}
