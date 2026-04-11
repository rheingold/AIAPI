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
// ── Editor types ──────────────────────────────────────────────────────────────

/** A single step as stored in the XML — before ScenarioRef resolution.
 *  Used by the dashboard step editor for read/write operations. */
export interface RawXmlStep {
  type: 'Step' | 'ScenarioRef';
  /** Step fields (when type === 'Step') */
  command?: string;
  target?: string;
  parameter?: string;
  conditional?: string;
  note?: string;
  /** ScenarioRef field (when type === 'ScenarioRef') */
  ref?: string;
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

    const library = doc.querySelector('ScenarioLibrary') ?? doc.querySelector('Scenarios');
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

    // Walk ALL direct children of <Scenario> in document order.
    // Chrome schema: <ScenarioRef> + <steps>/<step action=...>
    // Calculator schema: <Steps>/<Step command=...> (with ScenarioRef inside Steps)
    for (const child of Array.from(scenario.childNodes)) {
      if (child.nodeType !== 1 /* ELEMENT_NODE */) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (tag === 'scenarioref') {
        // Top-level ScenarioRef (chrome style) — not inside <steps>
        const ref = el.getAttribute('ref') ?? '';
        const refScenario = scenarioMap.get(ref);
        if (!refScenario) throw new Error(`ScenarioRef "${ref}" not found in scenarios.xml`);
        result.push(...this.resolveSteps(refScenario, scenarioMap, guard));
      } else if (tag === 'steps') {
        // Steps container — iterate its children
        for (const sc of Array.from(el.childNodes)) {
          if (sc.nodeType !== 1) continue;
          const se = sc as Element;
          const stag = se.tagName.toLowerCase();
          if (stag === 'scenarioref') {
            const ref = se.getAttribute('ref') ?? '';
            const refScenario = scenarioMap.get(ref);
            if (!refScenario) throw new Error(`ScenarioRef "${ref}" not found in scenarios.xml`);
            result.push(...this.resolveSteps(refScenario, scenarioMap, guard));
          } else if (stag === 'step') {
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
