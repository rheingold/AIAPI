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

// â”€â”€â”€ Public types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface XmlStep {
  command: string;
  target: string;
  parameter: string;
  /** If set, step only runs under this condition.
   *  Currently supported: "absent" â†’ skip when {{hwnd}} is already bound. */
  conditional?: string;
  note?: string;
}

export interface XmlParam {
  name: string;
  type: string;
  required: boolean;
  example?: string;
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

export interface ScenarioCallFn {
  (helperName: string, target: string, command: string, parameter: string): Promise<any>;
}

export interface XmlStepResult {
  step: number;
  command: string;
  target: string;
  parameter: string;
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

  // Initial variable context â€” user params override defaults
  const vars: Record<string, string> = { ...(opts.params ?? {}) };

  const stepResults: XmlStepResult[] = [];

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const stepNum = i + 1;

    // Resolve variable substitution
    const target    = XmlScenarioLoader.substitute(step.target,    vars);
    const parameter = XmlScenarioLoader.substitute(step.parameter, vars);

    // â”€â”€ conditional="absent": skip if {{hwnd}} already bound â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (step.conditional === 'absent' && vars['hwnd'] && vars['hwnd'] !== '') {
      if (verbose) log(`Step ${stepNum} skipped (condition=absent, hwnd="${vars['hwnd']}"): ${step.command}`);
      stepResults.push({ step: stepNum, command: step.command, target, parameter, skipped: true });
      continue;
    }

    // â”€â”€ WAIT: synthetic sleep â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (step.command === 'WAIT') {
      const ms = parseInt(parameter, 10) || 0;
      if (ms > 0) await new Promise(r => setTimeout(r, ms));
      stepResults.push({ step: stepNum, command: 'WAIT', target, parameter, waitMs: ms, success: true });
      if (verbose) log(`Step ${stepNum} WAIT ${ms}ms`);
      continue;
    }

    // â”€â”€ LISTWINDOWS: discover window, bind {{hwnd}} â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        const processHint = scenario.process.replace(/\.exe$/i, '').toLowerCase();
        const appHint     = scenario.app.toLowerCase();
        const match = windows.find(w => {
          const t = String(w.title ?? '').toLowerCase();
          return t.includes(processHint) || t.includes(appHint);
        });
        if (match) {
          vars['hwnd'] = match.hwnd ? `HANDLE:${match.hwnd}` : match.title;
          if (verbose) log(`Step ${stepNum} LISTWINDOWS â†’ hwnd bound to "${vars['hwnd']}"`);
        }
      }

      stepResults.push({ step: stepNum, command: 'LISTWINDOWS', target, parameter, success: r?.success !== false });
      continue;
    }

    // â”€â”€ All other commands: dispatch to helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let r: any;
    try {
      r = await callFn(scenario.helper, target, step.command, parameter);
    } catch (e: any) {
      stepResults.push({ step: stepNum, command: step.command, target, parameter, success: false, error: e.message });
      if (verbose) log(`Step ${stepNum} ${step.command} ERROR: ${e.message}`);
      continue;
    }

    const success = r?.success !== false;
    const entry: XmlStepResult = { step: stepNum, command: step.command, target, parameter, success };
    if (r?.value !== undefined) entry.value = r.value;
    if (!success)               entry.error = r?.error ?? 'unknown error';
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

// â”€â”€â”€ Loader class â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class XmlScenarioLoader {
  constructor(private readonly appTemplatesDir: string) {}

  /**
   * Load and fully resolve a named scenario from `apptemplates/{app}/scenarios.xml`.
   * All <ScenarioRef> elements are expanded recursively into a flat step list.
   */
  load(app: string, scenarioId: string): XmlScenario {
    const xmlPath = path.join(this.appTemplatesDir, app, 'scenarios.xml');
    if (!fs.existsSync(xmlPath)) {
      throw new Error(`scenarios.xml not found for app: "${app}" (expected ${xmlPath})`);
    }

    const content = fs.readFileSync(xmlPath, 'utf-8');
    const doc = this.parseXml(content);

    const library = doc.querySelector('ScenarioLibrary');
    const helperAttr  = library?.getAttribute('helper')  ?? 'KeyWin.exe';
    const processAttr = library?.getAttribute('process') ?? app;

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

    const steps  = this.resolveSteps(target, scenarioMap, new Set());
    const params = this.extractParams(target);
    const label  = target.getAttribute('label') ?? scenarioId;

    return { id: scenarioId, label, helper: helperAttr, process: processAttr, app, steps, params };
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

    const library = doc.querySelector('ScenarioLibrary');
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

  // â”€â”€ Static helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Substitute {{key}} placeholders in a string with values from `vars`.
   * Unresolved placeholders are left as-is.
   */
  static substitute(s: string, vars: Record<string, string>): string {
    return s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
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
  ): XmlStep[] {
    const id = scenario.getAttribute('id') ?? '';
    if (visited.has(id)) throw new Error(`Circular ScenarioRef detected: "${id}"`);
    const guard = new Set(visited);
    guard.add(id);

    const result: XmlStep[] = [];
    const stepsEl = this.findDirectChild(scenario, 'Steps');
    if (!stepsEl) return result;

    for (const child of Array.from(stepsEl.childNodes)) {
      if (child.nodeType !== 1 /* ELEMENT_NODE */) continue;
      const el = child as Element;

      if (el.tagName === 'ScenarioRef') {
        const ref = el.getAttribute('ref') ?? '';
        const refScenario = scenarioMap.get(ref);
        if (!refScenario) throw new Error(`ScenarioRef "${ref}" not found in scenarios.xml`);
        result.push(...this.resolveSteps(refScenario, scenarioMap, guard));
      } else if (el.tagName === 'Step') {
        result.push({
          command:     el.getAttribute('command')     ?? '',
          target:      el.getAttribute('target')      ?? '',
          parameter:   el.getAttribute('parameter')   ?? '',
          conditional: el.getAttribute('conditional') ?? undefined,
          note:        el.getAttribute('note')        ?? undefined,
        });
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
          name:     el.getAttribute('name')     ?? '',
          type:     el.getAttribute('type')     ?? 'string',
          required: el.getAttribute('required') === 'true',
          example:  el.getAttribute('example')  ?? undefined,
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
}

