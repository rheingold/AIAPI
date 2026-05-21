/**
 * xmlScenarioLoader.ts
 *
 * Loads and resolves scenario templates from apptemplates/{app}/scenarios.xml,
 * and provides a shared executor used by both the MCP server and the HTTP
 * dashboard server.
 *
 * Key concepts:
 *  - <ScenarioRef ref="..."/> is resolved recursively (with cycle detection).
 *  - {{varName}} placeholders in `target` / `parameter` attributes are substituted
 *    at call-time by XmlScenarioLoader.substitute().
 *  - The `conditional="absent"` attribute marks steps that only run when the
 *    runtime variable {{hwnd}} is not yet bound (i.e. app was not already open).
 */

import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { pathToAddress } from '../helpers/HelperRegistry';

// â”€â”€â”€ Public types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Resolved step, 1:1 with MCP tools/call argument format (CONVENTIONS.md §2.6).
 * Namespace: declared on <Scenarios xmlns="eu:plachy:sw:aiapi:builtin:{app}">.
 */
export interface XmlStep {
  // MCP-aligned (preferred)
  tool: string;
  action: string;
  proc: string;
  path: string;
  value?: string;
  /** ASSERT two-argument form: comparison operator. Default `===`.
   *  Allowed: `===` `!==` `==` `!=` `gt`(`>`) `lt`(`<`) `gte`(`>=`) `lte`(`<=`)
   *  In XML use `&gt;` / `&lt;` or the word aliases `gt` / `lt` to stay valid. */
  op?: string;
  // Backward-compat aliases
  /** @deprecated use action */ command: string;
  /** @deprecated use proc   */ target: string;
  /** @deprecated use path   */ parameter: string;
  conditional?: string;
  /** If set, bind the step result (capturedValue) to vars[bind] after execution. */
  bind?: string;
  note?: string;
  /** When true, the helper will scroll the target element into view before acting on it.
   *  Opt-in only — has no effect unless the helper supports the SCROLL_ command prefix. */
  scroll?: boolean;
}
// ── Editor types ──────────────────────────────────────────────────────────────

/** A single step as stored in the XML — before ScenarioRef resolution.
 *  Used by the dashboard step editor for read/write operations. */
export interface RawXmlStep {
  type: 'Step' | 'ScenarioRef';
  tool?: string;
  action?: string;
  proc?: string;
  path?: string;
  value?: string;
  op?: string;
  /** @deprecated use action */ command?: string;
  /** @deprecated use proc   */ target?: string;
  /** @deprecated use path   */ parameter?: string;
  conditional?: string;
  /** If set, bind the step result to vars[bind] after execution. */
  bind?: string;
  note?: string;
  /** Opt-in scroll-into-view before interacting with the element. */
  scroll?: boolean;
  ref?: string;
  ns?: string;
  app?: string;
}

/** Raw unresolved scenario — suitable for the step editor. */
export interface RawXmlScenario {
  id: string;
  label: string;
  /** Which helper exe handles this scenario (KeyWin.exe / BrowserWin.exe / *). */
  helper?: string;
  /** Target process name hint, e.g. calc.exe. */
  process?: string;
  /** Window title / app hint for LISTWINDOWS binding. */
  appTitle?: string;
  /** AI assistant identifier that should use this scenario (informational). */
  assistant?: string;
  /** Expected SHA-256 hex digest of the target binary (informational / future enforcement). */
  checksum?: string;
  steps: RawXmlStep[];
  params: XmlParam[];
}
export interface XmlParam {
  name: string;
  type: string;
  required: boolean;
  example?: string;
  /** Default value — used to pre-seed vars when caller does not supply the param. */
  default?: string;
  /** Key of the LocaleMap that provides locale-aware values for this param.
   *  Format: "{scenarioId}.{paramName}". Absent when no LocaleMap is declared. */
  localeMap?: string;
}

/** One translated value for a given language tag. */
export interface LocaleMapEntry {
  /** BCP-47 language tag, e.g. "en", "cs", "de". */
  lang: string;
  /** Display value for this language. */
  value: string;
}

/**
 * All locale-aware values for a single scenario parameter.
 * Extracted from \<LocaleMap param="X"> elements inside a \<Scenario>.
 */
export interface LocaleMapData {
  /** Parameter name this map applies to. */
  param: string;
  /** Fully-qualified key: "{scenarioId}.{param}". Matches the localeMap= attribute on XmlParam. */
  key: string;
  /** Ordered list of locale entries. */
  entries: LocaleMapEntry[];
}

export interface LocaleLintViolation {
  scenarioId: string;
  stepIndex:  number;
  value:      string;
  note?:      string;
  severity:   'error' | 'warn';
  reason:     string;
}

export interface XmlScenario {
  id: string;
  label: string;
  /** Helper exe name declared on <ScenarioLibrary helper="..."> */
  helper: string;
  /** Process name declared on <ScenarioLibrary process="..."> or derived from app */
  process: string;
  /** App name (folder key) */
  app: string;
  /** Namespace URI declared on <Scenarios xmlns="..."> (e.g. "eu:plachy:sw:aiapi:builtin:dashboard"). */
  namespace?: string;
  /** Resolved flat step list (ScenarioRef expanded, no nesting) */
  steps: XmlStep[];
  params: XmlParam[];
}

export interface AppTemplateInfo {
  app: string;
  helper: string;
  process: string;
  scenarios: Array<{ id: string; label: string }>;
}

// â”€â”€â”€ Shared executor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Invokes a single automation step.
 * Parameters mirror the MCP tools/call argument object (Â§2.6 CONVENTIONS.md):
 *   tool   = helper binary stem ("BrowserWin", "KeyWin", â€¦)
 *   proc   = target process / window / CDP connection
 *   action = command verb (CLICKID, EXEC, WAIT, NAVIGATE, LAUNCH, DIALOG â€¦)
 *   path   = element path / primary parameter
 *   value  = write payload / secondary parameter
 *
 * Two implementation strategies:
 *   - In-process (MCPServer, DashboardServer): call handleToolsCall() / helperRegistry.callCommand() directly.
 *   - Standalone (out-of-process): POST JSON-RPC 2.0 tools/call to the MCP endpoint.
 */
/**
 * Invokes a single step via the MCP tools/call dispatch path (CONVENTIONS.md §2.6).
 *   In-process : call helperRegistry.callCommand() directly.
 *   Standalone : POST JSON-RPC 2.0 tools/call on the MCP HTTP endpoint.
 */
export interface ScenarioCallFn {
  (tool: string, proc: string, action: string, path: string, value?: string, scroll?: boolean): Promise<any>;
}

export interface XmlStepResult {
  step: number;
  tool: string;
  action: string;
  proc: string;
  path: string;
  /** @deprecated use action */ command: string;
  /** @deprecated use proc   */ target: string;
  /** @deprecated use path   */ parameter: string;
  skipped?: boolean;
  waitMs?: number;
  success?: boolean;
  error?: string;
  value?: any;
}

export interface XmlScenarioResult {
  success: boolean;
  app: string;
  scenarioId: string;
  label: string;
  totalSteps: number;
  skippedSteps: number;
  failedSteps: number;
  vars: Record<string, string>;
  steps: XmlStepResult[];
}

/**
 * Execute a resolved XmlScenario using the supplied helper call function.
 *
 * Execution model:
 *  - `WAIT`        â†’ sleep for `parameter` ms (no helper call).
 *  - `LISTWINDOWS` â†’ call helper; scan `result.windows` for the app's process
 *                    window; bind {{hwnd}} to a `HANDLE:N` target if found.
 *  - `conditional="absent"` â†’ skip when {{hwnd}} is already bound.
 *  - All other commands â†’ resolve {{var}} in target + parameter, dispatch via callFn.
 */
export async function executeXmlScenario(opts: {
  scenario: XmlScenario;
  params?: Record<string, string>;
  callFn: ScenarioCallFn;
  verbose?: boolean;
  log?: (msg: string) => void;
}): Promise<XmlScenarioResult> {
  const { scenario, callFn, verbose = false } = opts;
  const log = opts.log ?? ((_m: string) => { /* no-op */ });

  // Initial variable context — scenario Param defaults first, then user params override
  const paramDefaults: Record<string, string> = {};
  for (const p of scenario.params ?? []) {
    if (p.default !== undefined) paramDefaults[p.name] = p.default;
  }
  const vars: Record<string, string> = { ...paramDefaults, ...(opts.params ?? {}) };

  const stepResults: XmlStepResult[] = [];

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const stepNum = i + 1;

    // Resolve variable substitution (MCP-aligned fields)
    const resolvedTool = step.tool || scenario.helper;
    const proc      = XmlScenarioLoader.substitute(step.proc,  vars);
    const stepPath  = XmlScenarioLoader.substitute(step.path,  vars);
    const stepValue = step.value !== undefined ? XmlScenarioLoader.substitute(step.value, vars) : undefined;
    // Legacy alias
    const parameter = stepValue !== undefined ? `${stepPath}|${stepValue}` : stepPath;

    // â”€â”€ conditional="absent": skip if {{hwnd}} already bound â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (step.conditional === 'absent' && vars['hwnd'] && vars['hwnd'] !== '') {
      if (verbose) log(`Step ${stepNum} skipped (condition=absent, hwnd="${vars['hwnd']}"): ${step.action}`);
      stepResults.push({ step: stepNum, tool: resolvedTool, action: step.action, proc, path: stepPath,
                         command: step.action, target: proc, parameter, skipped: true });
      continue;
    }

        // â”€â”€ WAIT: synthetic sleep â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (step.action === 'WAIT') {
      const ms = parseInt(stepValue ?? '', 10) || parseInt(stepPath, 10) || 0; // value= is canonical; path= is legacy fallback
      if (ms > 0) await new Promise(r => setTimeout(r, ms));
      stepResults.push({ step: stepNum, tool: resolvedTool, action: 'WAIT', proc, path: stepPath,
                         command: 'WAIT', target: proc, parameter, waitMs: ms, success: true });
      if (verbose) log(`Step ${stepNum} WAIT ${ms}ms`);
      continue;
    }

        // â”€â”€ LISTWINDOWS: discover window, bind {{hwnd}} â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (step.action === 'LISTWINDOWS') {
      let r: any;
      try {
        r = await callFn(resolvedTool, 'SYSTEM', 'LISTWINDOWS', '');
      } catch (e: any) {
        stepResults.push({ step: stepNum, tool: resolvedTool, action: 'LISTWINDOWS', proc, path: stepPath,
                           command: 'LISTWINDOWS', target: proc, parameter, success: false, error: e.message });
        continue;
      }
      if (!vars['hwnd'] || vars['hwnd'] === '') {
        const windows: Array<{ title: string; hwnd?: number }> = r?.windows ?? [];
        const processHint = scenario.process.replace(/\.exe$/i, '').toLowerCase();
        const appHint     = scenario.app.toLowerCase();
        // stepPath may carry a pipe-separated list of substrings (e.g. "calc|calculator|kalku")
        // that the scenario author supplied to override / extend the default process/app hints.
        const pathHints   = stepPath ? stepPath.toLowerCase().split('|').filter(Boolean) : [];
        const match = windows.find(w => {
          const tStr = String(w.title ?? '').toLowerCase();
          if (pathHints.length > 0) return pathHints.some(h => tStr.includes(h));
          return tStr.includes(processHint) || tStr.includes(appHint);
        });
        if (match) {
          // KeyWin returns the numeric window handle as the 'handle' field;
          // some callers may use 'hwnd' — support both.
          const numHandle = (match as any).handle ?? (match as any).hwnd;
          vars['hwnd'] = numHandle ? `HANDLE:${numHandle}` : match.title;
          if (verbose) log(`Step ${stepNum} LISTWINDOWS → hwnd bound to "${vars['hwnd']}"`);
        }
      }
      stepResults.push({ step: stepNum, tool: resolvedTool, action: 'LISTWINDOWS', proc, path: stepPath,
                         command: 'LISTWINDOWS', target: proc, parameter, success: r?.success !== false });
      continue;
    }

        // ── ASSERT: two-argument comparison
    // Form 1 — UIA/DOM path form (canonical, preferred):
    //   action="ASSERT" proc="HANDLE:N" path="AutomationId" op="eq|contains|…" value="expected"
    //   → calls helper READ (path empty) or READELEM (path non-empty) to fetch the live UI value,
    //     then compares it against value= using op=.
    //   This is the fundamental architecture: path= is always a CONTROL TREE address, never a JS expr.
    //
    // Form 2 — JS eval form (fallback, for computed comparisons with no target proc):
    //   action="ASSERT" path="<js-expr-actual>" value="<js-expr-expected>" [op="==="]
    //   → both path and value are evaluated as JS expressions ({{var}} already substituted).
    //   Use only when there is no live UI element to query.
    //
    // ASSERTPATHEVAL — legacy boolean eval (path is a full JS boolean expression):
    //   action="ASSERTPATHEVAL" path="<js-boolean-expr>"
    //   Prefer Form 2 / Form 1 for new scenarios.
    if (step.action === 'ASSERT' || step.action === 'ASSERTPATHEVAL') {
      /** Normalize op= aliases */
      const normalizeOp = (raw: string): string => {
        switch (raw.trim()) {
          case 'eq':         case '===': return '===';
          case 'neq':        case '!==': return '!==';
          case '==':  return '==';
          case '!=':  return '!=';
          case 'gt':  case '>':  return '>';
          case 'lt':  case '<':  return '<';
          case 'gte': case '>=': return '>=';
          case 'lte': case '<=': return '<=';
          case 'contains':    return 'contains';
          case 'startsWith':  case 'starts': return 'startsWith';
          case 'endsWith':    case 'ends':   return 'endsWith';
          case 'matches':     case 'regex':  return 'matches';
          case 'truthy':      return 'truthy';
          default:    return '===';
        }
      };
      let passed: boolean;
      let errMsg: string | undefined;
      const label = step.note ?? stepPath;

      // ── Form 1: UIA/DOM path form — proc is set → call helper READ to get live value ──────────────
      const isUiaForm = step.action === 'ASSERT'
                     && proc
                     && !proc.startsWith('{{')   // unresolved var → fall through to JS eval
                     && stepValue !== undefined;
      if (isUiaForm) {
        let readResult: any;
        // Use READELEM when a specific AutomationId/selector is given, READ for whole-window text
        const readAction = stepPath ? 'READELEM' : 'READ';
        try {
          readResult = await callFn(resolvedTool, proc, readAction, stepPath);
        } catch (e: any) {
          stepResults.push({ step: stepNum, tool: resolvedTool, action: 'ASSERT', proc, path: stepPath,
                             command: 'ASSERT', target: proc, parameter, success: false,
                             error: `ASSERT ${readAction} failed: ${e.message}` });
          if (verbose) log(`Step ${stepNum} ASSERT ${readAction} ERROR: ${e.message}`);
          continue;
        }
        if (readResult?.success === false) {
          stepResults.push({ step: stepNum, tool: resolvedTool, action: 'ASSERT', proc, path: stepPath,
                             command: 'ASSERT', target: proc, parameter, success: false,
                             error: readResult?.error ?? `${readAction} returned failure` });
          if (verbose) log(`Step ${stepNum} ASSERT ${readAction} FAIL: ${readResult?.error ?? '?'}`);
          continue;
        }
        const actual   = String(readResult?.value ?? '');
        const expected = stepValue; // already {{var}}-substituted
        const op = normalizeOp(step.op ?? '===');
        switch (op) {
          case '===':       passed = actual === expected; break;
          case '!==':       passed = actual !== expected; break;
          case '==':        passed = actual == expected;  break; // eslint-disable-line eqeqeq
          case '!=':        passed = actual != expected;  break; // eslint-disable-line eqeqeq
          case '>':         passed = Number(actual) >  Number(expected); break;
          case '<':         passed = Number(actual) <  Number(expected); break;
          case '>=':        passed = Number(actual) >= Number(expected); break;
          case '<=':        passed = Number(actual) <= Number(expected); break;
          case 'contains':  passed = actual.includes(expected); break;
          case 'startsWith':passed = actual.startsWith(expected); break;
          case 'endsWith':  passed = actual.endsWith(expected); break;
          case 'matches':   try { passed = new RegExp(expected).test(actual); } catch { passed = false; } break;
          case 'truthy':    passed = !!actual; break;
          default:          passed = false; errMsg = `Unknown ASSERT op: ${op}`;
        }
        if (!passed && !errMsg) errMsg = `assertion failed: "${actual}" ${op} "${expected}" — ${label}`;
        stepResults.push({ step: stepNum, tool: resolvedTool, action: 'ASSERT', proc, path: stepPath,
                           command: 'ASSERT', target: proc, parameter, success: passed,
                           ...(errMsg ? { error: errMsg } : {}) });
        if (verbose) log(`Step ${stepNum} ASSERT ${passed ? 'PASS' : 'FAIL'}: ${label}${errMsg ? ' — ' + errMsg : ''}`);
        continue;
      }

      // ── Form 2 / ASSERTPATHEVAL: JS eval form ────────────────────────────────────────────────────
      try {
        if (step.action === 'ASSERT' && stepValue !== undefined) {
          // Two-argument form: evaluate actual and expected separately, then compare
          // eslint-disable-next-line no-new-func
          const actual   = new Function('$vars', `return (${stepPath})`)(vars);
          // eslint-disable-next-line no-new-func
          const expected = new Function('$vars', `return (${stepValue})`)(vars);
          const op = normalizeOp(step.op ?? '===');
          switch (op) {
            case '===': passed = actual === expected; break;
            case '!==': passed = actual !== expected; break;
            case '==':  passed = actual == expected;  break; // eslint-disable-line eqeqeq
            case '!=':  passed = actual != expected;  break; // eslint-disable-line eqeqeq
            case '>':   passed = actual >  expected;  break;
            case '<':   passed = actual <  expected;  break;
            case '>=':  passed = actual >= expected;  break;
            case '<=':  passed = actual <= expected;  break;
            case 'contains':  passed = String(actual).includes(String(expected)); break;
            case 'startsWith':passed = String(actual).startsWith(String(expected)); break;
            case 'endsWith':  passed = String(actual).endsWith(String(expected)); break;
            case 'matches':   try { passed = new RegExp(String(expected)).test(String(actual)); } catch { passed = false; } break;
            case 'truthy':    passed = !!actual; break;
            default:    passed = false; errMsg = `Unknown ASSERT op: ${op}`;
          }
          if (!passed && !errMsg) errMsg = `assertion failed: ${String(actual)} ${op} ${String(expected)} — ${label}`;
        } else {
          // ASSERTPATHEVAL (or ASSERT without value=): path is full boolean expression
          // $vars exposes the raw variable map so expressions can use $vars.foo directly
          // eslint-disable-next-line no-new-func
          passed = !!new Function('$vars', `return (${stepPath})`)(vars);
          if (!passed) errMsg = `assertion failed: ${label}`;
        }
      } catch (e: any) {
        passed = false;
        errMsg = e.message;
      }
      stepResults.push({
        step: stepNum, tool: resolvedTool, action: step.action, proc, path: stepPath,
        command: step.action, target: proc, parameter, success: passed,
        ...(errMsg ? { error: errMsg } : {}),
      });
      if (verbose) log(`Step ${stepNum} ${step.action} ${passed ? 'PASS' : 'FAIL'}: ${label}${errMsg ? ' — ' + errMsg : ''}`);
      continue;
    }

        // ── EVAL: evaluate a JS expression (vars already substituted); bind result ──────────────────────────
    // XML step: action="EVAL" path="<js-expr>" bind="<varName>"
    // `path=` carries the JS expression (architectural rule — same convention as ASSERT).
    // The expression runs in an isolated Function — no access to node internals.
    if (step.action === 'EVAL') {
      let val: any;
      try {
        // eslint-disable-next-line no-new-func
        // $vars exposes the raw variable map so expressions can use JSON.parse($vars.foo)
        // instead of JSON.parse('{{foo}}'), which breaks on backslash-heavy values (Windows paths).
        val = new Function('$vars', `return (${stepPath})`)(vars);
      } catch (e: any) {
        stepResults.push({ step: stepNum, tool: resolvedTool, action: 'EVAL', proc, path: stepPath,
                           command: 'EVAL', target: proc, parameter, success: false, error: e.message });
        if (verbose) log(`Step ${stepNum} EVAL ERROR: ${e.message}`);
        continue;
      }
      if (step.bind) {
        vars[step.bind] = typeof val === 'string' ? val : String(val ?? '');
        if (verbose) log(`Step ${stepNum} EVAL bind="${step.bind}" → "${vars[step.bind]}"`);
      }
      stepResults.push({ step: stepNum, tool: resolvedTool, action: 'EVAL', proc, path: stepPath,
                         command: 'EVAL', target: proc, parameter, success: true, value: val });
      continue;
    }

        // ── HTTP_FETCH: route to fetch_webpage MCP tool ────────────────────────────────────────────────────
    // XML step: action="HTTP_FETCH" proc="<url>" path="<METHOD>" value="<json-body>"
    // callFn implementors must intercept tool === 'fetch_webpage' and call automationEngine.fetchWebpage.
    if (step.action === 'HTTP_FETCH') {
      let r: any;
      try {
        r = await callFn('fetch_webpage', proc, 'HTTP_FETCH', stepPath || 'GET', stepValue);
      } catch (e: any) {
        stepResults.push({ step: stepNum, tool: 'fetch_webpage', action: 'HTTP_FETCH', proc, path: stepPath,
                           command: 'HTTP_FETCH', target: proc, parameter, success: false, error: e.message });
        if (verbose) log(`Step ${stepNum} HTTP_FETCH ERROR: ${e.message}`);
        continue;
      }
      const success = r?.success !== false;
      const entry: XmlStepResult = { step: stepNum, tool: 'fetch_webpage', action: 'HTTP_FETCH', proc, path: stepPath,
                                     command: 'HTTP_FETCH', target: proc, parameter, success };
      let capturedValue: any = r?.data ?? r?.content ?? r?.text ?? r?.body ?? r;
      if (capturedValue !== undefined) entry.value = capturedValue;
      if (!success) entry.error = r?.error ?? 'HTTP_FETCH failed';
      if (step.bind && capturedValue !== undefined) {
        vars[step.bind] = typeof capturedValue === 'string' ? capturedValue : JSON.stringify(capturedValue);
        if (verbose) log(`Step ${stepNum} HTTP_FETCH bind="${step.bind}" → ${String(vars[step.bind]).slice(0, 80)}`);
      }
      stepResults.push(entry);
      if (verbose) log(`Step ${stepNum} HTTP_FETCH ${proc} success=${success}`);
      continue;
    }

    // ── EXEC_CMD: run a shell command server-side (no helper .exe needed) ──────────────────────────
    // XML step: action="EXEC_CMD" proc="<executable>" value="<args>" bind="<varName>"
    if (step.action === 'EXEC_CMD') {
      let r: any;
      try {
        const { execCmd } = await import('../engine/builtinActions');
        r = await execCmd(proc || 'cmd.exe', stepValue || '');
      } catch (e: any) {
        stepResults.push({ step: stepNum, tool: '_builtin', action: 'EXEC_CMD', proc, path: stepPath,
                           command: 'EXEC_CMD', target: proc, parameter, success: false, error: e.message });
        if (verbose) log(`Step ${stepNum} EXEC_CMD ERROR: ${e.message}`);
        continue;
      }
      const success = r.success !== false;
      const entry: XmlStepResult = { step: stepNum, tool: '_builtin', action: 'EXEC_CMD', proc, path: stepPath,
                                     command: 'EXEC_CMD', target: proc, parameter, success };
      if (r.value !== undefined) entry.value = r.value;
      if (!success) entry.error = r.error ?? 'EXEC_CMD failed';
      if (step.bind && r.value !== undefined) {
        vars[step.bind] = String(r.value);
        if (verbose) log(`Step ${stepNum} EXEC_CMD bind="${step.bind}" → ${String(r.value).slice(0, 80)}`);
      }
      stepResults.push(entry);
      if (verbose) log(`Step ${stepNum} EXEC_CMD "${proc}" success=${success}`);
      continue;
    }

    // ── FS_READ: read a file's text content server-side ───────────────────────────────────────────
    // XML step: action="FS_READ" path="<filepath>" bind="<varName>"
    if (step.action === 'FS_READ') {
      let r: any;
      try {
        const { fsRead } = await import('../engine/builtinActions');
        r = await fsRead(stepPath || '');
      } catch (e: any) {
        stepResults.push({ step: stepNum, tool: '_builtin', action: 'FS_READ', proc, path: stepPath,
                           command: 'FS_READ', target: proc, parameter, success: false, error: e.message });
        continue;
      }
      const success = r.success !== false;
      const entry: XmlStepResult = { step: stepNum, tool: '_builtin', action: 'FS_READ', proc, path: stepPath,
                                     command: 'FS_READ', target: proc, parameter, success };
      if (r.value !== undefined) entry.value = r.value;
      if (!success) entry.error = r.error ?? 'FS_READ failed';
      if (step.bind && r.value !== undefined) vars[step.bind] = String(r.value);
      stepResults.push(entry);
      if (verbose) log(`Step ${stepNum} FS_READ "${stepPath}" success=${success}`);
      continue;
    }

    // ── FS_WRITE: write text to a file server-side ────────────────────────────────────────────────
    // XML step: action="FS_WRITE" path="<filepath>" value="<content>"
    if (step.action === 'FS_WRITE') {
      let r: any;
      try {
        const { fsWrite } = await import('../engine/builtinActions');
        r = await fsWrite(stepPath || '', stepValue || '');
      } catch (e: any) {
        stepResults.push({ step: stepNum, tool: '_builtin', action: 'FS_WRITE', proc, path: stepPath,
                           command: 'FS_WRITE', target: proc, parameter, success: false, error: e.message });
        continue;
      }
      const success = r.success !== false;
      const entry: XmlStepResult = { step: stepNum, tool: '_builtin', action: 'FS_WRITE', proc, path: stepPath,
                                     command: 'FS_WRITE', target: proc, parameter, success };
      if (!success) entry.error = r.error ?? 'FS_WRITE failed';
      stepResults.push(entry);
      if (verbose) log(`Step ${stepNum} FS_WRITE "${stepPath}" success=${success}`);
      continue;
    }

    // ── FS_LIST: list directory entries server-side ───────────────────────────────────────────────
    // XML step: action="FS_LIST" path="<dirpath>" bind="<varName>"
    if (step.action === 'FS_LIST') {
      let r: any;
      try {
        const { fsList } = await import('../engine/builtinActions');
        r = await fsList(stepPath || '');
      } catch (e: any) {
        stepResults.push({ step: stepNum, tool: '_builtin', action: 'FS_LIST', proc, path: stepPath,
                           command: 'FS_LIST', target: proc, parameter, success: false, error: e.message });
        continue;
      }
      const success = r.success !== false;
      const entry: XmlStepResult = { step: stepNum, tool: '_builtin', action: 'FS_LIST', proc, path: stepPath,
                                     command: 'FS_LIST', target: proc, parameter, success };
      if (r.value !== undefined) entry.value = r.value;
      if (!success) entry.error = r.error ?? 'FS_LIST failed';
      if (step.bind && r.value !== undefined) vars[step.bind] = String(r.value);
      stepResults.push(entry);
      if (verbose) log(`Step ${stepNum} FS_LIST "${stepPath}" success=${success}`);
      continue;
    }

        // ── All other commands: dispatch to helper ────────────────────────────────────────────────────────
    // Normalise CDP_EXECUTE → EXEC (BrowserWin's actual wire command name per its schema).
    // Convention §1.1 names it CDP_EXECUTE and puts the JS code in `value`.
    // BrowserWin EXEC takes the script in `path`.  Remap here so XML authors use
    // the canonical name without knowing the helper's internal command spelling.
    let dispatchAction = step.action;
    let dispatchPath   = stepPath ? pathToAddress(stepPath) : stepPath;
    let dispatchValue  = stepValue;
    if (step.action === 'CDP_EXECUTE') {
      dispatchAction = 'EXEC';
      if (dispatchValue !== undefined) {
        // value= holds the JS expression; path is empty — send script as path
        dispatchPath  = dispatchValue;
        dispatchValue = undefined;
      }
    } else if (step.action === 'CDP_CACHE_CLEAR') {
      dispatchAction = 'CACHE_CLEAR';
    }
    let r: any;
    try {
      r = dispatchValue !== undefined
        ? await callFn(resolvedTool, proc, dispatchAction, dispatchPath, dispatchValue, step.scroll)
        : await callFn(resolvedTool, proc, dispatchAction, dispatchPath, undefined, step.scroll);
    } catch (e: any) {
      stepResults.push({ step: stepNum, tool: resolvedTool, action: step.action, proc, path: dispatchPath,
                           command: step.action, target: proc, parameter, success: false, error: e.message });
      if (verbose) log(`Step ${stepNum} ${step.command} ERROR: ${e.message}`);
      continue;
    }

    const success = r?.success !== false;
    const entry: XmlStepResult = { step: stepNum, tool: resolvedTool, action: step.action, proc, path: dispatchPath,
                                   command: step.action, target: proc, parameter, success };
    // Capture the step result value with shape-aware extraction:
    //   1. Standard helpers:              r.value = <result>
    //   2. BrowserWin EXEC (CDP envelope): r.result = {id:N, result:{type,value?,description?}}
    //   3. Generic {result:...}:           r.result = <result>
    //   4. LAUNCH / NAVIGATE extra fields: r.port, r.target, etc. (top-level)
    let capturedValue: any;
    if (r?.value !== undefined) {
      capturedValue = r.value;
    } else if (r?.result?.result !== undefined) {
      // BrowserWin CDP Runtime.evaluate envelope — unwrap to actual JS value
      const cdp = r.result.result as { type: string; value?: any; description?: string };
      if (cdp.type !== 'undefined') {
        capturedValue = 'value' in cdp ? cdp.value : cdp.description;
      }
    } else if (r?.result !== undefined) {
      capturedValue = r.result;
    } else if (r !== null && typeof r === 'object') {
      // Commands like LAUNCH that surface extra top-level fields (port, reused, …)
      const extra = Object.fromEntries(
        Object.entries(r as Record<string, unknown>).filter(([k]) => k !== 'success' && k !== 'error')
      );
      if (Object.keys(extra).length > 0) capturedValue = extra;
    }
    if (capturedValue !== undefined) entry.value = capturedValue;
    if (!success)                    entry.error = r?.error ?? 'unknown error';

    // ── LAUNCH (KeyWin only): bind HANDLE:N for Win32 targets ────────────────
    // BrowserWin LAUNCH returns port/browser — those are internal connection
    // details, NOT a valid target address (CONVENTIONS.md §2.2).  Do NOT bind
    // chrome:port here; the spec-compliant tab handle (chrome:URL:<u>) is
    // established by the subsequent NAVIGATE step instead.
    if (step.action === 'LAUNCH' && success && r?.hwnd) {
      const procVarMatch = step.proc.match(/^\{\{(\w+)\}\}$/);
      if (procVarMatch) {
        vars[procVarMatch[1]] = `HANDLE:${r.hwnd}`;
        if (verbose) log(`Step ${stepNum} LAUNCH → ${procVarMatch[1]} bound to "HANDLE:${r.hwnd}" (Win32)`);
      }
    }

    // ── NAVIGATE (BrowserWin): bind tab address to vars['tab'] ─────────────
    // Ideal spec address: chrome:URL:<url> (CONVENTIONS.md §2.2, L1+L3).
    // However BrowserWin v1.3.x tokenises the target on ':' and cannot handle
    // a URL that itself contains a colon (e.g. http://host:port).
    // Fall back to bare browser name ('chrome') which BrowserWin always resolves
    // to the most-recently-navigated tab — safe when automation owns a single tab.
    if (step.action === 'NAVIGATE' && success) {
      const browserBase = (proc.match(/^[a-zA-Z]+/)?.[0] ?? 'chrome').toLowerCase();
      vars['tab'] = browserBase;
      if (verbose) log(`Step ${stepNum} NAVIGATE → tab bound to "${vars['tab']}"`);
    }

    // ── bind= attribute: store capturedValue in a named variable ────────────
    if (step.bind && capturedValue !== undefined) {
      vars[step.bind] = typeof capturedValue === 'string' ? capturedValue : JSON.stringify(capturedValue);
      if (verbose) log(`Step ${stepNum} bind="${step.bind}" → "${vars[step.bind]}"`);
    }

    stepResults.push(entry);
    if (verbose) log(`Step ${stepNum} ${step.command} success=${success}`);
  }

  const totalSteps   = stepResults.length;
  const skippedSteps = stepResults.filter(s => s.skipped).length;
  const failedSteps  = stepResults.filter(s => !s.skipped && s.success === false).length;

  return {
    success:      failedSteps === 0,
    app:          scenario.app,
    scenarioId:   scenario.id,
    label:        scenario.label,
    totalSteps,
    skippedSteps,
    failedSteps,
    vars,
    steps:        stepResults,
  };
}

// ─── Locale-invariance linter ─────────────────────────────────────────────────

const _LINT_NUMERIC    = /^-?\d+(\.\d+)?$/;
const _LINT_PURE_VAR   = /^\{\{(\w+)(?:\|\w+)?\}\}$/;
const _LINT_NUMERIC_OPS = new Set(['>', '<', '>=', '<=']);
const _LINT_EXEMPT_OPS  = new Set(['truthy', 'matches', '>', '<', '>=', '<=']);

/**
 * Static locale-invariance linter.
 * Checks every ASSERT step (Form 1 — UIA/DOM path, proc= set) for locale-sensitive string literals
 * in value=. Numeric literals, boolean literals, empty strings, and {{varRef}} params that carry
 * a localeMap= declaration are all safe. Everything else is a violation.
 *
 * Does NOT check ASSERTPATHEVAL (Form 2 / JS eval) — those are exempt because value= is a JS
 * expression, not a display string.
 */
export function lintLocaleInvariance(
  scenarios: XmlScenario[],
  paramsByScenario: Map<string, XmlParam[]>,
): LocaleLintViolation[] {
  const violations: LocaleLintViolation[] = [];

  for (const scenario of scenarios) {
    const params = paramsByScenario.get(scenario.id) ?? scenario.params ?? [];

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];

      // Only check Form 1 ASSERT: action=ASSERT + proc= is non-empty + not a pure unresolved var
      if (step.action !== 'ASSERT') continue;
      const proc = step.proc ?? '';
      if (!proc || /^\{\{[\w|]+\}\}$/.test(proc.trim())) continue; // Form 2 or unresolved proc

      // Exempt numeric/regex/truthy operators
      const op = (step.op ?? '===').trim();
      if (_LINT_EXEMPT_OPS.has(op)) continue;

      const val = step.value ?? '';

      // Safe: numeric literal
      if (_LINT_NUMERIC.test(val.trim())) continue;
      // Safe: empty / boolean
      if (val === '' || val === 'true' || val === 'false') continue;

      // Check for pure {{varRef}}
      const m = _LINT_PURE_VAR.exec(val.trim());
      if (m) {
        const paramName = m[1];
        const param = params.find(p => p.name === paramName);
        if (param?.localeMap) continue; // properly escaped via localeMap=
        violations.push({
          scenarioId: scenario.id,
          stepIndex:  i + 1,
          value:      val,
          note:       step.note,
          severity:   'warn',
          reason:     `{{${paramName}}} has no localeMap= on its <Param> — caller must supply locale-aware value`,
        });
      } else {
        // Literal string (not a pure var ref)
        violations.push({
          scenarioId: scenario.id,
          stepIndex:  i + 1,
          value:      val,
          note:       step.note,
          severity:   'error',
          reason:     `literal string "${val}" in ASSERT value= is locale-sensitive; use AutomationId presence check or declare <LocaleMap>`,
        });
      }
    }
  }

  return violations;
}

// â"€â"€â"€ Loader class â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export class XmlScenarioLoader {
  constructor(
    private readonly appTemplatesDir: string,
    private readonly allRoots: string[] = [],
  ) {}

  /**
   * Load and fully resolve a named scenario from `apptemplates/{app}/scenarios.xml`.
   * All <ScenarioRef> elements are expanded recursively into a flat step list.
   */
  load(app: string, scenarioId: string): XmlScenario {
    const xmlPath = path.join(this.appTemplatesDir, app, 'scenarios.xml');
    if (!fs.existsSync(xmlPath)) {
      throw new Error(`scenarios.xml not found for app: "${app}"`);
    }

    const content = fs.readFileSync(xmlPath, 'utf-8');
    const doc = this.parseXml(content);

    const library = doc.querySelector('ScenarioLibrary') ?? doc.querySelector('Scenarios');
    const helperAttr  = library?.getAttribute('helper')  ?? 'KeyWin.exe';
    const processAttr = library?.getAttribute('process') ?? app;
    const namespaceAttr = library?.getAttribute('xmlns') ?? undefined;
    const defaultTool   = helperAttr; // keep full name e.g. "BrowserWin.exe" — HelperRegistry expects it

    // Build id â†’ Element map
    const scenarioMap = new Map<string, Element>();
    for (const s of Array.from(doc.querySelectorAll('Scenario'))) {
      const id = s.getAttribute('id');
      if (id) scenarioMap.set(id, s);
    }

    const target = scenarioMap.get(scenarioId);
    if (!target) {
      const available = [...scenarioMap.keys()].join(', ');
      throw new Error(`Scenario "${scenarioId}" not found in ${app}/scenarios.xml. Available: ${available}`);
    }

    const steps  = this.resolveSteps(target, scenarioMap, new Set(), defaultTool);
    const params = this.extractParams(target);
    const label  = target.getAttribute('label') ?? scenarioId;

    const scenario = { id: scenarioId, label, helper: helperAttr, process: processAttr, app,
                       namespace: namespaceAttr, steps, params };

    // Locale-invariance lint gate (skip only if explicitly disabled)
    if (process.env.AIAPI_LINT_LOCALE !== 'false') {
      const violations = lintLocaleInvariance([scenario], new Map([[scenario.id, scenario.params]]));
      const errors = violations.filter(v => v.severity === 'error');
      if (errors.length) {
        throw new Error(
          `[G-D.12] Locale-invariance violation(s) in scenario "${scenario.id}":\n` +
          errors.map(e => `  step ${e.stepIndex}: ${e.reason}`).join('\n') +
          '\n  Set AIAPI_LINT_LOCALE=false to suppress during migration.',
        );
      }
    }

    return scenario;
  }

  /**
   * Returns summary information about all scenarios in `apptemplates/{app}/scenarios.xml`
   * without fully resolving steps (cheap metadata call).
   */
  listScenarios(app: string): AppTemplateInfo {
    const xmlPath = path.join(this.appTemplatesDir, app, 'scenarios.xml');
    if (!fs.existsSync(xmlPath)) {
      throw new Error(`scenarios.xml not found for app: "${app}"`);
    }

    const content = fs.readFileSync(xmlPath, 'utf-8');
    const doc = this.parseXml(content);

    const library = doc.querySelector('ScenarioLibrary') ?? doc.querySelector('Scenarios');
    const helper  = library?.getAttribute('helper')  ?? 'KeyWin.exe';
    const process = library?.getAttribute('process') ?? app;

    const scenarios: Array<{ id: string; label: string }> = [];
    for (const s of Array.from(doc.querySelectorAll('Scenario'))) {
      const id    = s.getAttribute('id') ?? '';
      const label = s.getAttribute('label') ?? id;
      if (id) scenarios.push({ id, label });
    }

    return { app, helper, process, scenarios };
  }

  /**
   * Load the UNRESOLVED step list for a scenario  ScenarioRef nodes appear as
   * { type: 'ScenarioRef', ref: '...' } objects rather than being expanded.
   * Used by the dashboard step editor for read/write operations.
   */
  loadRaw(app: string, scenarioId: string): RawXmlScenario {
    const xmlPath = path.join(this.appTemplatesDir, app, 'scenarios.xml');
    if (!fs.existsSync(xmlPath)) throw new Error(`scenarios.xml not found for app: "${app}"`);
    const content = fs.readFileSync(xmlPath, 'utf-8');
    const doc     = this.parseXml(content);
    const scenarioEl = Array.from(doc.querySelectorAll('Scenario'))
      .find(s => s.getAttribute('id') === scenarioId);
    if (!scenarioEl) {
      const available = Array.from(doc.querySelectorAll('Scenario'))
        .map(s => s.getAttribute('id')).filter(Boolean).join(', ');
      throw new Error(`Scenario "${scenarioId}" not found. Available: ${available}`);
    }
    return {
      id:        scenarioId,
      label:     scenarioEl.getAttribute('label') ?? scenarioId,
      helper:    scenarioEl.getAttribute('helper')    ?? undefined,
      process:   scenarioEl.getAttribute('process')   ?? undefined,
      appTitle:  scenarioEl.getAttribute('app')        ?? undefined,
      assistant: scenarioEl.getAttribute('assistant') ?? undefined,
      checksum:  scenarioEl.getAttribute('checksum')  ?? undefined,
      steps:     this.extractRawSteps(scenarioEl),
      params:    this.extractParams(scenarioEl),
    };
  }

  /**
   * Extract all <LocaleMap> elements from a scenario.
   * Returns an empty array when no LocaleMap elements are present.
   *
   * XML grammar:
   * ```xml
   * <Scenario id="my-scenario">
   *   <Parameters>
   *     <Param name="modeLabel" localeMap="my-scenario.modeLabel" .../>
   *   </Parameters>
   *   <LocaleMap param="modeLabel">
   *     <Locale lang="en" value="Standard"/>
   *     <Locale lang="cs" value="Standardní"/>
   *   </LocaleMap>
   * </Scenario>
   * ```
   */
  getLocaleMaps(app: string, scenarioId: string): LocaleMapData[] {
    const xmlPath = path.join(this.appTemplatesDir, app, 'scenarios.xml');
    if (!fs.existsSync(xmlPath)) throw new Error(`scenarios.xml not found for app: "${app}"`);
    const doc = this.parseXml(fs.readFileSync(xmlPath, 'utf-8'));
    const scenarioEl = Array.from(doc.querySelectorAll('Scenario'))
      .find(s => s.getAttribute('id') === scenarioId);
    if (!scenarioEl) {
      const available = Array.from(doc.querySelectorAll('Scenario'))
        .map(s => s.getAttribute('id')).filter(Boolean).join(', ');
      throw new Error(`Scenario "${scenarioId}" not found. Available: ${available}`);
    }
    return this.extractLocaleMaps(scenarioEl, scenarioId);
  }

  /** Extract LocaleMap data from a Scenario element (shared by getLocaleMaps + extractParams). */
  private extractLocaleMaps(scenario: Element, scenarioId: string): LocaleMapData[] {
    const result: LocaleMapData[] = [];
    for (const child of Array.from(scenario.childNodes)) {
      if (child.nodeType !== 1 /* ELEMENT_NODE */) continue;
      const el = child as Element;
      if (el.tagName !== 'LocaleMap') continue;
      const param = el.getAttribute('param') ?? '';
      const key   = el.getAttribute('key')   ?? `${scenarioId}.${param}`;
      const entries: LocaleMapEntry[] = [];
      for (const lc of Array.from(el.childNodes)) {
        if (lc.nodeType !== 1) continue;
        const le = lc as Element;
        if (le.tagName !== 'Locale') continue;
        entries.push({
          lang:  le.getAttribute('lang')  ?? '',
          value: le.getAttribute('value') ?? '',
        });
      }
      result.push({ param, key, entries });
    }
    return result;
  }

  /**
   * Save a modified scenario back to its scenarios.xml file.
   * Replaces the <Steps> element; preserves all other file content.
   */
  save(
    app: string,
    scenarioId: string,
    label: string,
    steps: RawXmlStep[],
    meta?: { helper?: string; process?: string; appTitle?: string; assistant?: string; checksum?: string }
  ): void {
    const xmlPath = path.join(this.appTemplatesDir, app, 'scenarios.xml');
    if (!fs.existsSync(xmlPath)) throw new Error(`scenarios.xml not found for app: "${app}"`);
    const content = fs.readFileSync(xmlPath, 'utf-8');
    const dom     = new JSDOM(content, { contentType: 'text/xml' });
    const doc     = dom.window.document;
    const scenarioEl = Array.from(doc.querySelectorAll('Scenario'))
      .find((s: any) => s.getAttribute('id') === scenarioId) as Element | undefined;
    if (!scenarioEl) throw new Error(`Scenario "${scenarioId}" not found in ${app}/scenarios.xml`);

    scenarioEl.setAttribute('label', label);

    // Update/remove optional metadata attributes when provided
    if (meta) {
      const setOrRemove = (attr: string, val?: string) =>
        val ? scenarioEl.setAttribute(attr, val) : scenarioEl.removeAttribute(attr);
      setOrRemove('helper',    meta.helper);
      setOrRemove('process',   meta.process);
      setOrRemove('app',       meta.appTitle);
      setOrRemove('assistant', meta.assistant);
      setOrRemove('checksum',  meta.checksum);
    }

    // Find existing <Steps> or <steps> container, or create <Steps>
    let stepsEl: Element | undefined = this.findDirectChildCI(scenarioEl, 'steps');
    // Remove top-level ScenarioRef children (chrome style) that will be re-written into Steps
    const topLevelRefs = Array.from(scenarioEl.childNodes)
      .filter(n => n.nodeType === 1 && (n as Element).tagName.toLowerCase() === 'scenarioref');
    topLevelRefs.forEach(n => scenarioEl.removeChild(n));

    if (!stepsEl) {
      stepsEl = doc.createElement('Steps');
      scenarioEl.appendChild(stepsEl);
    }
    while (stepsEl.firstChild) stepsEl.removeChild(stepsEl.firstChild);

    for (const step of steps) {
      stepsEl.appendChild(doc.createTextNode('\n      '));
      if (step.type === 'ScenarioRef') {
        const el = doc.createElement('ScenarioRef');
        el.setAttribute('ref', step.ref ?? '');
        stepsEl.appendChild(el);
      } else {
        const el = doc.createElement('Step');
        if (step.command   !== undefined) el.setAttribute('command',   step.command);
        if (step.target    !== undefined) el.setAttribute('target',    step.target);
        if (step.parameter !== undefined) el.setAttribute('parameter', step.parameter);
        if (step.conditional)             el.setAttribute('conditional', step.conditional);
        if (step.note)                    el.setAttribute('note',      step.note);
        stepsEl.appendChild(el);
      }
    }
    stepsEl.appendChild(doc.createTextNode('\n    '));

    const serializer = new ((dom.window as any).XMLSerializer)();
    const xmlDecl = content.startsWith('<?xml') ? content.substring(0, content.indexOf('?>') + 2) + '\n' : '';
    const body = serializer.serializeToString(doc.documentElement);
    fs.writeFileSync(xmlPath, xmlDecl + body + '\n', 'utf-8');
  }

  // â”€â”€ Static helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Substitute {{key}} placeholders in a string with values from `vars`.
   * Unresolved placeholders are left as-is.
   */
  static substitute(s: string, vars: Record<string, string>): string {
    return s.replace(/\{\{(\w+)(?:\|(\w+))?\}\}/g, (_, k: string, filter: string | undefined) => {
      const val = vars[k] ?? `{{${k}}}`;
      if (filter === 'j') {
        // JS single-quoted string safe: escape backslashes, single-quotes, and newlines
        return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
      }
      return val;
    });
  }

  /**
   * Parse a <step> XML element into an XmlStep, reading new MCP-aligned attributes
   * (tool, action, proc, path, value) with fallback to legacy (command, target, parameter).
   */
  private parseStep(el: Element, defaultTool: string): XmlStep {
    const action = el.getAttribute('action') || el.getAttribute('command') || '';
    const proc   = el.getAttribute('proc')   || el.getAttribute('target')  || '';
    // path + value: prefer explicit attrs; fall back to splitting legacy parameter on |
    let   stepPath  = el.getAttribute('path')  ?? '';
    let   stepValue = el.getAttribute('value') ?? undefined;
    if (!stepPath && !stepValue) {
      const param = el.getAttribute('parameter') ?? '';
      const pipe  = param.indexOf('|');
      if (pipe >= 0) { stepPath = param.slice(0, pipe); stepValue = param.slice(pipe + 1); }
      else           { stepPath = param; }
    }
    const tool      = el.getAttribute('tool') || defaultTool;
    const parameter = stepValue !== undefined ? `${stepPath}|${stepValue}` : stepPath;
    return {
      tool,
      action, command: action,
      proc,   target: proc,
      path: stepPath, value: stepValue,
      op:          el.getAttribute('op')          ?? undefined,
      parameter,
      conditional: el.getAttribute('conditional') ?? undefined,
      bind:        el.getAttribute('bind')        ?? undefined,
      note:        el.getAttribute('note')        ?? undefined,
      scroll:      el.getAttribute('scroll') === 'true' || undefined,
    };
  }

  /** Load all scenarios from the first root that contains `app/scenarios.xml`. */
  private loadScenarioMapFromRoots(app: string): Map<string, Element> {
    const searchRoots = [...new Set([...this.allRoots, this.appTemplatesDir])];
    for (const root of searchRoots) {
      const xmlPath = path.join(root, app, 'scenarios.xml');
      if (!fs.existsSync(xmlPath)) continue;
      const doc = this.parseXml(fs.readFileSync(xmlPath, 'utf-8'));
      const map = new Map<string, Element>();
      for (const s of Array.from(doc.querySelectorAll('Scenario'))) {
        const id = s.getAttribute('id');
        if (id) map.set(id, s);
      }
      return map;
    }
    throw new Error(`scenarios.xml not found for cross-app ref: "${app}"`);
  }

  // â”€â”€ Private â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private parseXml(content: string): Document {
    const dom = new JSDOM(content, { contentType: 'text/xml' });
    return dom.window.document;
  }

  private resolveSteps(
    scenario: Element,
    scenarioMap: Map<string, Element>,
    visited: Set<string>,
    defaultTool: string = '',
  ): XmlStep[] {
    const id = scenario.getAttribute('id') ?? '';
    if (visited.has(id)) throw new Error(`Circular ScenarioRef detected: "${id}"`);
    const guard = new Set(visited);
    guard.add(id);

    const result: XmlStep[] = [];

    // Walk ALL direct children of <Scenario> in document order.
    // Chrome schema: <ScenarioRef> + <steps>/<step action=...>
    // Calculator schema: <Steps>/<Step command=...> (with ScenarioRef inside Steps)
    for (const child of Array.from(scenario.childNodes)) {
      if (child.nodeType !== 1 /* ELEMENT_NODE */) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (tag === 'scenarioref') {
        // Top-level ScenarioRef (chrome style) — not inside <steps>
        const ref    = el.getAttribute('ref') ?? '';
        const refApp = el.getAttribute('app');
        if (refApp) {
          const crossMap = this.loadScenarioMapFromRoots(refApp);
          const refScenario = crossMap.get(ref);
          if (!refScenario) throw new Error(`Cross-app ScenarioRef "${refApp}/${ref}" not found`);
          result.push(...this.resolveSteps(refScenario, crossMap, new Set()));
        } else {
          const refScenario = scenarioMap.get(ref);
          if (!refScenario) throw new Error(`ScenarioRef "${ref}" not found in scenarios.xml`);
          result.push(...this.resolveSteps(refScenario, scenarioMap, guard));
        }
      } else if (tag === 'steps') {
        // Steps container — iterate its children
        for (const sc of Array.from(el.childNodes)) {
          if (sc.nodeType !== 1) continue;
          const se = sc as Element;
          const stag = se.tagName.toLowerCase();
          if (stag === 'scenarioref') {
            const ref    = se.getAttribute('ref') ?? '';
            const refApp = se.getAttribute('app');
            if (refApp) {
              const crossMap = this.loadScenarioMapFromRoots(refApp);
              const refScenario = crossMap.get(ref);
              if (!refScenario) throw new Error(`Cross-app ScenarioRef "${refApp}/${ref}" not found`);
              result.push(...this.resolveSteps(refScenario, crossMap, new Set()));
            } else {
              const refScenario = scenarioMap.get(ref);
              if (!refScenario) throw new Error(`ScenarioRef "${ref}" not found in scenarios.xml`);
              result.push(...this.resolveSteps(refScenario, scenarioMap, guard));
            }
          } else if (stag === 'step') {
            result.push(this.parseStep(se, defaultTool));
          }
        }
      } else if (tag === 'step') {
        // Top-level step (unusual but tolerated)
        result.push(this.parseStep(el, defaultTool));
      }
    }
    return result;
  }

  private extractParams(scenario: Element): XmlParam[] {
    const params: XmlParam[] = [];
    const paramsEl = this.findDirectChild(scenario, 'Parameters');
    if (!paramsEl) return params;
    for (const child of Array.from(paramsEl.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.tagName === 'Param') {
        params.push({
          name:      el.getAttribute('name')      ?? '',
          type:      el.getAttribute('type')      ?? 'string',
          required:  el.getAttribute('required')  === 'true',
          example:   el.getAttribute('example')   ?? undefined,
          default:   el.getAttribute('default')   ?? undefined,
          localeMap: el.getAttribute('localeMap') ?? undefined,
        });
      }
    }
    return params;
  }

  /** Find the first direct child element with the given tag name. */
  private findDirectChild(parent: Element, tagName: string): Element | undefined {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 1 && (child as Element).tagName === tagName) {
        return child as Element;
      }
    }
    return undefined;
  }

  /** Case-insensitive variant of findDirectChild. */
  private findDirectChildCI(parent: Element, tagNameLC: string): Element | undefined {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 1 && (child as Element).tagName.toLowerCase() === tagNameLC) {
        return child as Element;
      }
    }
    return undefined;
  }

  /** Return raw (unresolved) steps from a scenario element for the step editor.
   * Handles both chrome schema (lowercase <steps>/<step action=...>, top-level <ScenarioRef>)
   * and calculator schema (<Steps>/<Step command=...>, ScenarioRef inside Steps).
   */
  private extractRawSteps(scenario: Element): RawXmlStep[] {
    const result: RawXmlStep[] = [];

    for (const child of Array.from(scenario.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (tag === 'scenarioref') {
        result.push({ type: 'ScenarioRef', ref: el.getAttribute('ref') ?? '' });
      } else if (tag === 'steps') {
        for (const sc of Array.from(el.childNodes)) {
          if (sc.nodeType !== 1) continue;
          const se = sc as Element;
          const stag = se.tagName.toLowerCase();
          if (stag === 'scenarioref') {
            result.push({ type: 'ScenarioRef', ref: se.getAttribute('ref') ?? '' });
          } else if (stag === 'step') {
            result.push({
              type:        'Step',
              command:     se.getAttribute('command') || se.getAttribute('action') || '',
              target:      se.getAttribute('target')      ?? '',
              parameter:   se.getAttribute('parameter')   ?? '',
              conditional: se.getAttribute('conditional') ?? undefined,
              note:        se.getAttribute('note')        ?? undefined,
            });
          }
        }
      } else if (tag === 'step') {
        result.push({
          type:    'Step',
          command: el.getAttribute('command') || el.getAttribute('action') || '',
          target:  el.getAttribute('target')      ?? '',
          parameter:   el.getAttribute('parameter')   ?? '',
          conditional: el.getAttribute('conditional') ?? undefined,
          note:        el.getAttribute('note')        ?? undefined,
        });
      }
    }
    return result;
  }
}

// ─── ScenarioIndex ────────────────────────────────────────────────────────────

export interface ScenarioIndexEntry {
  /** Absolute path to the scenarios.xml file. */
  file: string;
  /** Namespace URI declared on <Scenarios xmlns="...">. */
  namespace: string;
  /** App folder name (short key). */
  app: string;
  /** Scenario id within the file. */
  id: string;
}

/**
 * System-wide runtime index of all scenario files.
 * Built at startup from all configured roots and reloadable on demand.
 *
 * Lookup strategies (in order of preference):
 *   namespace + id   — "eu:plachy:sw:aiapi:builtin:dashboard" + "nav-to-settings"
 *   app + id         — "dashboard" + "nav-to-settings"
 *   id alone         — "nav-to-settings"  (ambiguous if multiple namespaces define it)
 *   file + id        — "/abs/path/to/scenarios.xml" + "nav-to-settings"
 *
 * Usage:
 *   const idx = ScenarioIndex.instance;
 *   idx.build(allRoots);
 *   const e = idx.find('nav-to-settings', 'eu:plachy:sw:aiapi:builtin:dashboard');
 */
export class ScenarioIndex {
  private static _instance: ScenarioIndex | undefined;

  static get instance(): ScenarioIndex {
    if (!ScenarioIndex._instance) ScenarioIndex._instance = new ScenarioIndex();
    return ScenarioIndex._instance;
  }

  private byNsId   = new Map<string, ScenarioIndexEntry>();   // "namespace:id" → entry
  private byAppId  = new Map<string, ScenarioIndexEntry>();   // "app:id" → entry
  private byId     = new Map<string, ScenarioIndexEntry[]>(); // "id" → entries (may be ambiguous)
  private byFileId = new Map<string, ScenarioIndexEntry>();   // "file|id" → entry

  private _built = false;

  /** Return true if the index has been built at least once. */
  get isBuilt(): boolean { return this._built; }

  /**
   * Scan all roots for `{root}/{app}/scenarios.xml` files and index their
   * scenarios by namespace, app name, and id.
   * Safe to call multiple times; previous index is cleared first.
   */
  build(allRoots: string[]): void {
    this.byNsId.clear();
    this.byAppId.clear();
    this.byId.clear();
    this.byFileId.clear();

    for (const root of allRoots) {
      if (!fs.existsSync(root)) continue;
      let entries: string[];
      try { entries = fs.readdirSync(root); } catch { continue; }
      for (const app of entries) {
        const xmlPath = path.join(root, app, 'scenarios.xml');
        if (!fs.existsSync(xmlPath)) continue;
        try {
          const content = fs.readFileSync(xmlPath, 'utf-8');
          const dom     = new JSDOM(content, { contentType: 'text/xml' });
          const doc     = dom.window.document;
          const lib     = doc.querySelector('ScenarioLibrary') ?? doc.querySelector('Scenarios');
          const ns      = lib?.getAttribute('xmlns') ?? `eu:plachy:sw:aiapi:app:${app}`;
          for (const s of Array.from(doc.querySelectorAll('Scenario'))) {
            const id = s.getAttribute('id');
            if (!id) continue;
            const entry: ScenarioIndexEntry = { file: xmlPath, namespace: ns, app, id };
            const nsKey   = `${ns}:${id}`;
            const appKey  = `${app}:${id}`;
            const fileKey = `${xmlPath}|${id}`;
            if (!this.byNsId.has(nsKey))   this.byNsId.set(nsKey, entry);
            if (!this.byAppId.has(appKey)) this.byAppId.set(appKey, entry);
            if (!this.byFileId.has(fileKey)) this.byFileId.set(fileKey, entry);
            const existing = this.byId.get(id) ?? [];
            existing.push(entry);
            this.byId.set(id, existing);
          }
        } catch {
          // Malformed XML — skip silently
        }
      }
    }
    this._built = true;
  }

  /** Alias for build() to support on-demand reload. */
  reload(allRoots: string[]): void { this.build(allRoots); }

  /**
   * Find a scenario entry by ref string and optional context hints.
   *
   * `ref` formats supported:
   *   "id"                           — system-wide first match
   *   "app:id"                       — match by app folder + id
   *   "namespace:id" (full URI)      — exact namespace match
   *   "/abs/path/to/scenarios.xml|id"— file-absolute match
   *
   * Disambiguates using contextNs when ref is a bare id with multiple matches.
   */
  find(ref: string, contextNs?: string): ScenarioIndexEntry | null {
    // File-absolute form
    if (ref.includes('|')) return this.byFileId.get(ref) ?? null;

    // Namespace:id form — check if it looks like a URN (colons, no file path seps)
    const colonIdx = ref.lastIndexOf(':');
    if (colonIdx > 0) {
      const ns = ref.slice(0, colonIdx);
      const id = ref.slice(colonIdx + 1);
      // Prefer full namespace match
      const byNs = this.byNsId.get(`${ns}:${id}`);
      if (byNs) return byNs;
      // Fall back to app short-name match
      const byApp = this.byAppId.get(`${ns}:${id}`);
      if (byApp) return byApp;
    }

    // Bare id — try context namespace first, then unique, then first
    const candidates = this.byId.get(ref) ?? [];
    if (candidates.length === 0) return null;
    if (contextNs) {
      const match = candidates.find(e => e.namespace === contextNs);
      if (match) return match;
    }
    if (candidates.length === 1) return candidates[0];
    // Ambiguous — caller must qualify the ref
    return candidates[0]; // return first; log warning if needed
  }

  /** Returns all entries for a given scenario id (may be from multiple files). */
  findAll(id: string): ScenarioIndexEntry[] {
    return this.byId.get(id) ?? [];
  }
}

