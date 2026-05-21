#!/usr/bin/env node
/**
 * patch-xmlloader.js
 * Rewrites the interface and executor sections of xmlScenarioLoader.ts to the
 * new MCP-aligned design with namespace support and ScenarioIndex.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '../components/server/src/scenario/xmlScenarioLoader.ts');
let t = fs.readFileSync(FILE, 'utf8');

// Normalise to LF for replacement, re-add CRLF at the end
const hasCRLF = t.includes('\r\n');
if (hasCRLF) t = t.replace(/\r\n/g, '\n');

let changed = 0;
function rep(oldStr, newStr, label) {
  if (!t.includes(oldStr)) { console.error('MISS:', label); return; }
  t = t.replace(oldStr, newStr);
  console.log('OK  :', label);
  changed++;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1 — XmlStep interface
// ═══════════════════════════════════════════════════════════════════════════════
rep(
`export interface XmlStep {
  command: string;
  target: string;
  parameter: string;
  /** If set, step only runs under this condition.
   *  Currently supported: "absent" \u2192 skip when {{hwnd}} is already bound. */
  conditional?: string;
  note?: string;
}`,
`/**
 * Resolved executable step, 1:1 with the MCP tools/call argument format.
 * Namespace is declared on <Scenarios xmlns="eu:plachy:sw:aiapi:builtin:{app}">.
 *
 * XML attr mapping (new attribute \u2192 legacy alias):
 *   tool    = helper binary stem ("BrowserWin", "KeyWin", \u2026); inherited from Scenarios/@helper if absent
 *   action  = command verb (CLICKID, EXEC, WAIT, NAVIGATE, LAUNCH, DIALOG, LISTWINDOWS \u2026)
 *   proc    = target process / window / CDP connection string
 *   path    = element path / JS expression / primary parameter
 *   value   = write payload / secondary parameter
 *
 * Legacy backward-compat aliases (set identically at parse-time):
 *   command \u2261 action  |  target \u2261 proc  |  parameter \u2261 path [ "|" value ]
 */
export interface XmlStep {
  // \u2500 MCP-aligned (preferred) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  /** Helper binary stem \u2013 e.g. "BrowserWin", "KeyWin". Inherited from Scenarios/@helper. */
  tool: string;
  /** MCP action verb \u2013 CLICKID, EXEC, WAIT, NAVIGATE, LAUNCH, DIALOG, LISTWINDOWS \u2026 */
  action: string;
  /** MCP proc \u2013 target process / window / CDP connection string. */
  proc: string;
  /** MCP path \u2013 element id / JS expression / primary parameter. */
  path: string;
  /** MCP value \u2013 write payload / secondary parameter. */
  value?: string;
  // \u2500 Backward-compat aliases (= action / proc / path+value) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  /** @deprecated use action */ command: string;
  /** @deprecated use proc   */ target: string;
  /** @deprecated use path   */ parameter: string;
  // \u2500 Common \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  conditional?: string;
  note?: string;
}`,
  'XmlStep',
);

// ═══════════════════════════════════════════════════════════════════════════════
// 2 — RawXmlStep interface
// ═══════════════════════════════════════════════════════════════════════════════
rep(
`export interface RawXmlStep {
  type: 'Step' | 'ScenarioRef';
  /** Step fields (when type === 'Step') */
  command?: string;
  target?: string;
  parameter?: string;
  conditional?: string;
  note?: string;
  /** ScenarioRef field (when type === 'ScenarioRef') */
  ref?: string;
}`,
`export interface RawXmlStep {
  type: 'Step' | 'ScenarioRef';
  // \u2500 MCP-aligned step fields \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  tool?: string;
  action?: string;
  proc?: string;
  path?: string;
  value?: string;
  // \u2500 Backward-compat aliases \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  /** @deprecated use action */ command?: string;
  /** @deprecated use proc   */ target?: string;
  /** @deprecated use path   */ parameter?: string;
  conditional?: string;
  note?: string;
  // \u2500 ScenarioRef fields \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  ref?: string;
  /** Cross-namespace reference – namespace URI (e.g. "eu:plachy:sw:aiapi:builtin:dashboard"). */
  ns?: string;
  /** Cross-app shorthand (app folder name). */
  app?: string;
}`,
  'RawXmlStep',
);

// ═══════════════════════════════════════════════════════════════════════════════
// 3 — XmlScenario: add namespace field
// ═══════════════════════════════════════════════════════════════════════════════
rep(
`  /** App name (folder key) */
  app: string;
  /** Resolved flat step list (ScenarioRef expanded, no nesting) */
  steps: XmlStep[];`,
`  /** App name (folder key) */
  app: string;
  /** Namespace URI declared on <Scenarios xmlns="...">
   *  e.g. "eu:plachy:sw:aiapi:builtin:dashboard".
   *  Used by ScenarioIndex for system-wide lookup. */
  namespace?: string;
  /** Resolved flat step list (ScenarioRef expanded, no nesting) */
  steps: XmlStep[];`,
  'XmlScenario.namespace',
);

// ═══════════════════════════════════════════════════════════════════════════════
// 4 — ScenarioCallFn: MCP-aligned signature
// ═══════════════════════════════════════════════════════════════════════════════
rep(
`export interface ScenarioCallFn {
  (helperName: string, target: string, command: string, parameter: string): Promise<any>;
}`,
`/**
 * Invokes a single automation step via the MCP tools/call dispatch path.
 * Parameters map directly to the MCP tools/call argument object (CONVENTIONS.md §2.6).
 *
 * Two execution strategies:
 *   In-process  \u2014 MCPServer / DashboardServer: call helperRegistry.callCommand() directly.
 *   Standalone  \u2014 call POST JSON-RPC 2.0 \`tools/call\` on the MCP HTTP endpoint.
 */
export interface ScenarioCallFn {
  (tool: string, proc: string, action: string, path: string, value?: string): Promise<any>;
}`,
  'ScenarioCallFn',
);

// ═══════════════════════════════════════════════════════════════════════════════
// 5 — XmlStepResult: add MCP-aligned fields
// ═══════════════════════════════════════════════════════════════════════════════
rep(
`export interface XmlStepResult {
  step: number;
  command: string;
  target: string;
  parameter: string;
  skipped?: boolean;
  waitMs?: number;
  success?: boolean;
  error?: string;
  value?: any;
}`,
`export interface XmlStepResult {
  step: number;
  // \u2500 MCP-aligned
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
  'XmlStepResult',
);

// ═══════════════════════════════════════════════════════════════════════════════
// 6 — executeXmlScenario: update executor to use new field names + callFn sig
// ═══════════════════════════════════════════════════════════════════════════════
rep(
`  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const stepNum = i + 1;

    // Resolve variable substitution
    const target    = XmlScenarioLoader.substitute(step.target,    vars);
    const parameter = XmlScenarioLoader.substitute(step.parameter, vars);

    // \u2500\u2500 conditional="absent": skip if {{hwnd}} already bound \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (step.conditional === 'absent' && vars['hwnd'] && vars['hwnd'] !== '') {
      if (verbose) log(\`Step \${stepNum} skipped (condition=absent, hwnd="\${vars['hwnd']}"): \${step.command}\`);
      stepResults.push({ step: stepNum, command: step.command, target, parameter, skipped: true });
      continue;
    }

    // \u2500\u2500 WAIT: synthetic sleep \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (step.command === 'WAIT') {
      const ms = parseInt(parameter, 10) || 0;
      if (ms > 0) await new Promise(r => setTimeout(r, ms));
      stepResults.push({ step: stepNum, command: 'WAIT', target, parameter, waitMs: ms, success: true });
      if (verbose) log(\`Step \${stepNum} WAIT \${ms}ms\`);
      continue;
    }

    // \u2500\u2500 LISTWINDOWS: discover window, bind {{hwnd}} \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (step.command === 'LISTWINDOWS') {
      let r: any;
      try {
        r = await callFn(scenario.helper, 'SYSTEM', 'LISTWINDOWS', '');
      } catch (e: any) {
        stepResults.push({ step: stepNum, command: 'LISTWINDOWS', target, parameter, success: false, error: e.message });
        continue;
      }

      // Bind hwnd if not yet resolved
      if (!vars['hwnd'] || vars['hwnd'] === '') {
        const windows: Array<{ title: string; hwnd?: number }> = r?.windows ?? [];
        const processHint = scenario.process.replace(/\\.exe$/i, '').toLowerCase();
        const appHint     = scenario.app.toLowerCase();
        const match = windows.find(w => {
          const t = String(w.title ?? '').toLowerCase();
          return t.includes(processHint) || t.includes(appHint);
        });
        if (match) {
          vars['hwnd'] = match.hwnd ? \`HANDLE:\${match.hwnd}\` : match.title;
          if (verbose) log(\`Step \${stepNum} LISTWINDOWS \u2192 hwnd bound to "\${vars['hwnd']}"\`);
        }
      }

      stepResults.push({ step: stepNum, command: 'LISTWINDOWS', target, parameter, success: r?.success !== false });
      continue;
    }

    // \u2500\u2500 All other commands: dispatch to helper \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    let r: any;
    try {
      r = await callFn(scenario.helper, target, step.command, parameter);
    } catch (e: any) {
      stepResults.push({ step: stepNum, command: step.command, target, parameter, success: false, error: e.message });
      if (verbose) log(\`Step \${stepNum} \${step.command} ERROR: \${e.message}\`);
      continue;
    }

    const success = r?.success !== false;
    const entry: XmlStepResult = { step: stepNum, command: step.command, target, parameter, success };`,
`  for (let i = 0; i < scenario.steps.length; i++) {
    const step    = scenario.steps[i];
    const stepNum = i + 1;

    // Resolve variable substitution in proc and path (MCP-aligned fields)
    const resolvedTool = step.tool || scenario.helper;
    const proc      = XmlScenarioLoader.substitute(step.proc,  vars);
    const stepPath  = XmlScenarioLoader.substitute(step.path,  vars);
    const stepValue = step.value !== undefined ? XmlScenarioLoader.substitute(step.value, vars) : undefined;
    // Legacy aliases for backward compat
    const parameter = stepValue !== undefined ? \`\${stepPath}|\${stepValue}\` : stepPath;

    // \u2500\u2500 conditional="absent": skip if {{hwnd}} already bound \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (step.conditional === 'absent' && vars['hwnd'] && vars['hwnd'] !== '') {
      if (verbose) log(\`Step \${stepNum} skipped (condition=absent, hwnd="\${vars['hwnd']}"): \${step.action}\`);
      stepResults.push({ step: stepNum, tool: resolvedTool, action: step.action, proc, path: stepPath,
                         command: step.action, target: proc, parameter, skipped: true });
      continue;
    }

    // \u2500\u2500 WAIT: synthetic sleep \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (step.action === 'WAIT') {
      const ms = parseInt(stepPath, 10) || parseInt(stepValue ?? '', 10) || 0;
      if (ms > 0) await new Promise(r => setTimeout(r, ms));
      stepResults.push({ step: stepNum, tool: resolvedTool, action: 'WAIT', proc, path: stepPath,
                         command: 'WAIT', target: proc, parameter, waitMs: ms, success: true });
      if (verbose) log(\`Step \${stepNum} WAIT \${ms}ms\`);
      continue;
    }

    // \u2500\u2500 LISTWINDOWS: discover window, bind {{hwnd}} \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (step.action === 'LISTWINDOWS') {
      let r: any;
      try {
        r = await callFn(resolvedTool, 'SYSTEM', 'LISTWINDOWS', '');
      } catch (e: any) {
        stepResults.push({ step: stepNum, tool: resolvedTool, action: 'LISTWINDOWS', proc, path: stepPath,
                           command: 'LISTWINDOWS', target: proc, parameter, success: false, error: e.message });
        continue;
      }

      // Bind hwnd if not yet resolved
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

    // \u2500\u2500 All other commands: dispatch through MCP tool call \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    let r: any;
    try {
      r = await callFn(resolvedTool, proc, step.action, stepPath, stepValue);
    } catch (e: any) {
      stepResults.push({ step: stepNum, tool: resolvedTool, action: step.action, proc, path: stepPath,
                         command: step.action, target: proc, parameter, success: false, error: e.message });
      if (verbose) log(\`Step \${stepNum} \${step.action} ERROR: \${e.message}\`);
      continue;
    }

    const success = r?.success !== false;
    const entry: XmlStepResult = { step: stepNum, tool: resolvedTool, action: step.action, proc, path: stepPath,
                                   command: step.action, target: proc, parameter, success };`,
  'executeXmlScenario executor loop',
);

// ═══════════════════════════════════════════════════════════════════════════════
// 7 — resolveSteps: parse new XML attrs (proc, path, value) with old fallbacks
// ═══════════════════════════════════════════════════════════════════════════════
rep(
`          } else if (stag === 'step') {
            result.push({
              command:     se.getAttribute('command') || se.getAttribute('action') || '',
              target:      se.getAttribute('target')      ?? '',
              parameter:   se.getAttribute('parameter')   ?? '',
              conditional: se.getAttribute('conditional') ?? undefined,
              note:        se.getAttribute('note')        ?? undefined,
            });
          }
        }
      } else if (tag === 'step') {
        // Top-level step (unusual but tolerated)
        result.push({
          command:     el.getAttribute('command') || el.getAttribute('action') || '',
          target:      el.getAttribute('target')      ?? '',
          parameter:   el.getAttribute('parameter')   ?? '',
          conditional: el.getAttribute('conditional') ?? undefined,
          note:        el.getAttribute('note')        ?? undefined,
        });
      }`,
`          } else if (stag === 'step') {
            result.push(this.parseStep(se, defaultTool));
          }
        }
      } else if (tag === 'step') {
        // Top-level step (unusual but tolerated)
        result.push(this.parseStep(el, defaultTool));
      }`,
  'resolveSteps step parsing',
);

// ═══════════════════════════════════════════════════════════════════════════════
// 8 — resolveSteps: pass defaultTool down from scenario helper
// ═══════════════════════════════════════════════════════════════════════════════
rep(
`  private resolveSteps(
    scenario: Element,
    scenarioMap: Map<string, Element>,
    visited: Set<string>,
  ): XmlStep[] {`,
`  private resolveSteps(
    scenario: Element,
    scenarioMap: Map<string, Element>,
    visited: Set<string>,
    defaultTool: string = '',
  ): XmlStep[] {`,
  'resolveSteps signature defaultTool',
);

// ═══════════════════════════════════════════════════════════════════════════════
// 9 — load(): extract namespace from <Scenarios> and pass defaultTool
// ═══════════════════════════════════════════════════════════════════════════════
rep(
`    const library = doc.querySelector('ScenarioLibrary') ?? doc.querySelector('Scenarios');
    const helperAttr  = library?.getAttribute('helper')  ?? 'KeyWin.exe';
    const processAttr = library?.getAttribute('process') ?? app;

    // Build id \u2192 Element map
    const scenarioMap = new Map<string, Element>();
    for (const s of Array.from(doc.querySelectorAll('Scenario'))) {
      const id = s.getAttribute('id');
      if (id) scenarioMap.set(id, s);
    }

    const target = scenarioMap.get(scenarioId);
    if (!target) {
      const available = [...scenarioMap.keys()].join(', ');
      throw new Error(\`Scenario "\${scenarioId}" not found in \${app}/scenarios.xml. Available: \${available}\`);
    }

    const steps  = this.resolveSteps(target, scenarioMap, new Set());
    const params = this.extractParams(target);
    const label  = target.getAttribute('label') ?? scenarioId;

    return { id: scenarioId, label, helper: helperAttr, process: processAttr, app, steps, params };`,
`    const library = doc.querySelector('ScenarioLibrary') ?? doc.querySelector('Scenarios');
    const helperAttr    = library?.getAttribute('helper')  ?? 'KeyWin.exe';
    const processAttr   = library?.getAttribute('process') ?? app;
    const namespaceAttr = library?.getAttribute('xmlns')   ?? undefined;
    // Helper stem without .exe for use as default MCP tool name
    const defaultTool   = helperAttr.replace(/\\.exe$/i, '');

    // Build id \u2192 Element map
    const scenarioMap = new Map<string, Element>();
    for (const s of Array.from(doc.querySelectorAll('Scenario'))) {
      const id = s.getAttribute('id');
      if (id) scenarioMap.set(id, s);
    }

    const target = scenarioMap.get(scenarioId);
    if (!target) {
      const available = [...scenarioMap.keys()].join(', ');
      throw new Error(\`Scenario "\${scenarioId}" not found in \${app}/scenarios.xml. Available: \${available}\`);
    }

    const steps  = this.resolveSteps(target, scenarioMap, new Set(), defaultTool);
    const params = this.extractParams(target);
    const label  = target.getAttribute('label') ?? scenarioId;

    return { id: scenarioId, label, helper: helperAttr, process: processAttr, app,
             namespace: namespaceAttr, steps, params };`,
  'load() namespace + defaultTool',
);

// ═══════════════════════════════════════════════════════════════════════════════
// 10 — Add parseStep helper + ScenarioIndex after substitute()
// ═══════════════════════════════════════════════════════════════════════════════
rep(
`  static substitute(s: string, vars: Record<string, string>): string {
    return s.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => vars[k] ?? \`{{\${k}}}\`);
  }

  /** Load all scenarios from the first root that contains \`app/scenarios.xml\`. */
  private loadScenarioMapFromRoots(app: string): Map<string, Element> {`,
`  static substitute(s: string, vars: Record<string, string>): string {
    return s.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => vars[k] ?? \`{{\${k}}}\`);
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
    const parameter = stepValue !== undefined ? \`\${stepPath}|\${stepValue}\` : stepPath;
    return {
      tool,
      action, command: action,
      proc,   target: proc,
      path: stepPath, value: stepValue,
      parameter,
      conditional: el.getAttribute('conditional') ?? undefined,
      note:        el.getAttribute('note')        ?? undefined,
    };
  }

  /** Load all scenarios from the first root that contains \`app/scenarios.xml\`. */
  private loadScenarioMapFromRoots(app: string): Map<string, Element> {`,
  'parseStep helper',
);

// ═══════════════════════════════════════════════════════════════════════════════
// 11 — Add ScenarioIndex class after XmlScenarioLoader class closing brace
//      (append at end of file)
// ═══════════════════════════════════════════════════════════════════════════════
const indexClass = `\n
// \u2500\u2500\u2500 ScenarioIndex \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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
 *   namespace + id   \u2014 "eu:plachy:sw:aiapi:builtin:dashboard" + "nav-to-settings"
 *   app + id         \u2014 "dashboard" + "nav-to-settings"
 *   id alone         \u2014 "nav-to-settings"  (ambiguous if multiple namespaces define it)
 *   file + id        \u2014 "/abs/path/to/scenarios.xml" + "nav-to-settings"
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

  private byNsId   = new Map<string, ScenarioIndexEntry>();   // "namespace:id" \u2192 entry
  private byAppId  = new Map<string, ScenarioIndexEntry>();   // "app:id" \u2192 entry
  private byId     = new Map<string, ScenarioIndexEntry[]>(); // "id" \u2192 entries (may be ambiguous)
  private byFileId = new Map<string, ScenarioIndexEntry>();   // "file|id" \u2192 entry

  private _built = false;

  /** Return true if the index has been built at least once. */
  get isBuilt(): boolean { return this._built; }

  /**
   * Scan all roots for \`{root}/{app}/scenarios.xml\` files and index their
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
          const ns      = lib?.getAttribute('xmlns') ?? \`eu:plachy:sw:aiapi:app:\${app}\`;
          for (const s of Array.from(doc.querySelectorAll('Scenario'))) {
            const id = s.getAttribute('id');
            if (!id) continue;
            const entry: ScenarioIndexEntry = { file: xmlPath, namespace: ns, app, id };
            const nsKey   = \`\${ns}:\${id}\`;
            const appKey  = \`\${app}:\${id}\`;
            const fileKey = \`\${xmlPath}|\${id}\`;
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
   * \`ref\` formats supported:
   *   "id"                           \u2014 system-wide first match
   *   "app:id"                       \u2014 match by app folder + id
   *   "namespace:id" (full URI)      \u2014 exact namespace match
   *   "/abs/path/to/scenarios.xml|id"\u2014 file-absolute match
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
      const byNs = this.byNsId.get(\`\${ns}:\${id}\`);
      if (byNs) return byNs;
      // Fall back to app short-name match
      const byApp = this.byAppId.get(\`\${ns}:\${id}\`);
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
`;

// Append ScenarioIndex at end of file
if (!t.includes('export class ScenarioIndex')) {
  t = t.trimEnd() + indexClass + '\n';
  console.log('OK  : ScenarioIndex appended');
  changed++;
} else {
  console.log('SKIP: ScenarioIndex already present');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Write file
// ═══════════════════════════════════════════════════════════════════════════════
if (changed > 0) {
  if (hasCRLF) t = t.replace(/\n/g, '\r\n');
  fs.writeFileSync(FILE, t, 'utf8');
  console.log(`\nWritten: ${FILE}  (${changed} replacements)`);
} else {
  console.log('\nNo changes made.');
}
