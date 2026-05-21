#!/usr/bin/env node
/**
 * patch-xmlloader-v2.js
 * Uses regex replacements to handle files with special UTF chars.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '../components/server/src/scenario/xmlScenarioLoader.ts');
let t = fs.readFileSync(FILE, 'utf8');
const hasCRLF = t.includes('\r\n');
if (hasCRLF) t = t.replace(/\r\n/g, '\n');

let changed = 0;
function rep(pattern, newStr, label, flags = 's') {
  const re = new RegExp(pattern, flags);
  if (!re.test(t)) { console.error('MISS:', label); return; }
  t = t.replace(re, newStr);
  console.log('OK  :', label);
  changed++;
}

// ── 1: XmlStep interface ───────────────────────────────────────────────────────
rep(
  /export interface XmlStep \{[\s\S]*?^  note\?: string;\n\}/m,
  `/**
 * Resolved executable step, 1:1 with the MCP tools/call argument format.
 * Namespace declared on <Scenarios xmlns="eu:plachy:sw:aiapi:builtin:{app}">.
 *
 * XML attr mapping (new attr \u2192 legacy alias):
 *   tool    = helper binary stem ("BrowserWin","KeyWin",\u2026); inherited from Scenarios/@helper
 *   action  = command verb (CLICKID, EXEC, WAIT, NAVIGATE, LAUNCH, DIALOG, LISTWINDOWS\u2026)
 *   proc    = target process / window / CDP connection string
 *   path    = element path / JS expression / primary parameter
 *   value   = write payload / secondary parameter
 * Legacy aliases set at parse-time:
 *   command \u2261 action  |  target \u2261 proc  |  parameter \u2261 path["|"value]
 */
export interface XmlStep {
  // MCP-aligned (preferred)
  /** Helper binary stem, e.g. "BrowserWin","KeyWin". Inherited from Scenarios/@helper. */
  tool: string;
  /** MCP action verb \u2013 CLICKID, EXEC, WAIT, NAVIGATE, LAUNCH, DIALOG, LISTWINDOWS\u2026 */
  action: string;
  /** MCP proc \u2013 target process / window / CDP connection string. */
  proc: string;
  /** MCP path \u2013 element id / JS expression / primary parameter. */
  path: string;
  /** MCP value \u2013 write payload / secondary parameter. */
  value?: string;
  // Backward-compat aliases (= action / proc / path+value)
  /** @deprecated use action */ command: string;
  /** @deprecated use proc   */ target: string;
  /** @deprecated use path   */ parameter: string;
  // Common
  conditional?: string;
  note?: string;
}`,
  'XmlStep interface',
);

// ── 2: RawXmlStep interface ────────────────────────────────────────────────────
rep(
  /export interface RawXmlStep \{[\s\S]*?  \/\*\* ScenarioRef field[^\n]+\n  ref\?: string;\n\}/m,
  `export interface RawXmlStep {
  type: 'Step' | 'ScenarioRef';
  // MCP-aligned step fields
  tool?: string;
  action?: string;
  proc?: string;
  path?: string;
  value?: string;
  // Backward-compat aliases
  /** @deprecated use action */ command?: string;
  /** @deprecated use proc   */ target?: string;
  /** @deprecated use path   */ parameter?: string;
  conditional?: string;
  note?: string;
  // ScenarioRef fields
  ref?: string;
  /** Cross-namespace reference \u2013 namespace URI (e.g. "eu:plachy:sw:aiapi:builtin:dashboard"). */
  ns?: string;
  /** Cross-app shorthand (app folder name). */
  app?: string;
}`,
  'RawXmlStep interface',
);

// ── 3: XmlScenario: add namespace field ───────────────────────────────────────
rep(
  /(  \/\*\* App name[^\n]+\n  app: string;\n)(  \/\*\* Resolved flat)/m,
  `$1  /** Namespace URI declared on <Scenarios xmlns="...">
   *  e.g. "eu:plachy:sw:aiapi:builtin:dashboard". Used by ScenarioIndex. */
  namespace?: string;
  $2`,
  'XmlScenario.namespace',
);

// ── 4: ScenarioCallFn: MCP-aligned signature ──────────────────────────────────
rep(
  /export interface ScenarioCallFn \{[\s\S]*?Promise<any>;\n\}/m,
  `/**
 * Invokes a single step via the MCP tools/call dispatch path (CONVENTIONS.md \u00a72.6).
 *   In-process : call helperRegistry.callCommand() directly.
 *   Standalone : POST JSON-RPC 2.0 tools/call on the MCP HTTP endpoint.
 */
export interface ScenarioCallFn {
  (tool: string, proc: string, action: string, path: string, value?: string): Promise<any>;
}`,
  'ScenarioCallFn interface',
);

// ── 5: XmlStepResult: add MCP-aligned fields ──────────────────────────────────
rep(
  /export interface XmlStepResult \{[\s\S]*?^  value\?: any;\n\}/m,
  `export interface XmlStepResult {
  step: number;
  // MCP-aligned
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
}`,
  'XmlStepResult interface',
);

// ── 6: executeXmlScenario loop body ───────────────────────────────────────────
rep(
  /( +\/\/ Resolve variable substitution\n    const target +=[^\n]+\n    const parameter +=[^\n]+\n)/m,
  `    // Resolve variable substitution (MCP-aligned fields)
    const resolvedTool = step.tool || scenario.helper;
    const proc      = XmlScenarioLoader.substitute(step.proc,  vars);
    const stepPath  = XmlScenarioLoader.substitute(step.path,  vars);
    const stepValue = step.value !== undefined ? XmlScenarioLoader.substitute(step.value, vars) : undefined;
    // Legacy alias
    const parameter = stepValue !== undefined ? \`\${stepPath}|\${stepValue}\` : stepPath;
`,
  'executor var substitution',
);

// conditional=absent skip block
rep(
  /( +if \(step\.conditional === 'absent' && vars\['hwnd'\] && vars\['hwnd'\] !== ''\) \{[\s\S]*?continue;\n    \})\n+( +\/\/ .+ WAIT)/m,
  `    if (step.conditional === 'absent' && vars['hwnd'] && vars['hwnd'] !== '') {
      if (verbose) log(\`Step \${stepNum} skipped (condition=absent, hwnd="\${vars['hwnd']}"): \${step.action}\`);
      stepResults.push({ step: stepNum, tool: resolvedTool, action: step.action, proc, path: stepPath,
                         command: step.action, target: proc, parameter, skipped: true });
      continue;
    }

    $2`,
  'executor conditional=absent',
);

// WAIT block
rep(
  /( +if \(step\.command === 'WAIT'\) \{[\s\S]*?continue;\n    \})\n+( +\/\/ .+LISTWINDOWS)/m,
  `    if (step.action === 'WAIT') {
      const ms = parseInt(stepPath, 10) || parseInt(stepValue ?? '', 10) || 0;
      if (ms > 0) await new Promise(r => setTimeout(r, ms));
      stepResults.push({ step: stepNum, tool: resolvedTool, action: 'WAIT', proc, path: stepPath,
                         command: 'WAIT', target: proc, parameter, waitMs: ms, success: true });
      if (verbose) log(\`Step \${stepNum} WAIT \${ms}ms\`);
      continue;
    }

    $2`,
  'executor WAIT',
);

// LISTWINDOWS block
rep(
  /( +if \(step\.command === 'LISTWINDOWS'\) \{[\s\S]*?continue;\n    \})\n+( +\/\/ .+All other commands)/m,
  `    if (step.action === 'LISTWINDOWS') {
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
        const processHint = scenario.process.replace(/\\.exe$/i, '').toLowerCase();
        const appHint     = scenario.app.toLowerCase();
        const match = windows.find(w => {
          const tStr = String(w.title ?? '').toLowerCase();
          return tStr.includes(processHint) || tStr.includes(appHint);
        });
        if (match) {
          vars['hwnd'] = match.hwnd ? \`HANDLE:\${match.hwnd}\` : match.title;
          if (verbose) log(\`Step \${stepNum} LISTWINDOWS \u2192 hwnd bound to "\${vars['hwnd']}"\`);
        }
      }
      stepResults.push({ step: stepNum, tool: resolvedTool, action: 'LISTWINDOWS', proc, path: stepPath,
                         command: 'LISTWINDOWS', target: proc, parameter, success: r?.success !== false });
      continue;
    }

    $2`,
  'executor LISTWINDOWS',
);

// General dispatch callFn call
rep(
  /( +r = await callFn\(scenario\.helper, target, step\.command, parameter\);)/m,
  `      r = await callFn(resolvedTool, proc, step.action, stepPath, stepValue);`,
  'executor callFn dispatch',
);

// entry push — replace old push with new MCP-aligned fields
rep(
  /( +const entry: XmlStepResult = \{ step: stepNum, command: step\.command, target, parameter, success \};)/m,
  `    const entry: XmlStepResult = { step: stepNum, tool: resolvedTool, action: step.action, proc, path: stepPath,
                                   command: step.action, target: proc, parameter, success };`,
  'executor entry push',
);

// error push in general block
rep(
  /( +stepResults\.push\(\{ step: stepNum, command: step\.command, target, parameter, success: false, error: e\.message \}\);)/m,
  `      stepResults.push({ step: stepNum, tool: resolvedTool, action: step.action, proc, path: stepPath,
                           command: step.action, target: proc, parameter, success: false, error: e.message });`,
  'executor error push',
);

// ── 7: load() – extract namespace, pass defaultTool ───────────────────────────
rep(
  /( +const helperAttr += +library\?\.getAttribute\('helper'\)[^\n]+\n +const processAttr[^\n]+\n)/m,
  `$1    const namespaceAttr = library?.getAttribute('xmlns') ?? undefined;
    const defaultTool   = helperAttr.replace(/\\.exe$/i, '');
`,
  'load() namespace + defaultTool attrs',
);

rep(
  /(    const steps += +this\.resolveSteps\(target, scenarioMap, new Set\(\)\);)/m,
  `    const steps  = this.resolveSteps(target, scenarioMap, new Set(), defaultTool);`,
  'load() resolveSteps defaultTool',
);

rep(
  /(    return \{ id: scenarioId, label, helper: helperAttr, process: processAttr, app, steps, params \};)/m,
  `    return { id: scenarioId, label, helper: helperAttr, process: processAttr, app,
             namespace: namespaceAttr, steps, params };`,
  'load() return namespace',
);

// ── 8: Write ──────────────────────────────────────────────────────────────────
if (changed > 0) {
  if (hasCRLF) t = t.replace(/\n/g, '\r\n');
  fs.writeFileSync(FILE, t, 'utf8');
  console.log(`\nWritten: ${FILE}  (${changed} replacements)`);
} else {
  console.log('\nNo changes made.');
}
process.exitCode = changed > 0 ? 0 : 1;
