param()
$f = "components/server/src/scenario/xmlScenarioLoader.ts"
$t = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
$orig = $t

# ── 1: XmlStep interface ───────────────────────────────────────────────────────
$old1 = "export interface XmlStep {
  command: string;
  target: string;
  parameter: string;
  /** If set, step only runs under this condition.
   *  Currently supported: `"absent`" â†' skip when {{hwnd}} is already bound. */
  conditional?: string;
  note?: string;
}"
$new1 = @'
/**
 * Resolved executable step, aligned 1:1 with the MCP tools/call argument format.
 * Namespace URN is declared on <Scenarios xmlns="eu:plachy:sw:aiapi:builtin:{app}">.
 *
 * XML attr mapping (new → legacy alias):
 *   tool    = helper binary stem ("BrowserWin", "KeyWin", …); inherited if absent
 *   action  = command verb  (CLICKID, EXEC, WAIT, NAVIGATE, LAUNCH, DIALOG, LISTWINDOWS …)
 *   proc    = target process / window / CDP connection
 *   path    = element path / JS expression / primary parameter
 *   value   = write payload / secondary parameter
 * Legacy BC aliases set at parse-time:
 *   command === action  |  target === proc  |  parameter === path [ "|" value ]
 */
export interface XmlStep {
  // MCP-aligned (preferred)
  /** Helper binary stem, e.g. "BrowserWin", "KeyWin". Inherited from Scenarios/@helper. */
  tool: string;
  /** MCP action verb – CLICKID, EXEC, WAIT, NAVIGATE, LAUNCH, DIALOG, LISTWINDOWS … */
  action: string;
  /** MCP proc – target process/window/CDP connection. */
  proc: string;
  /** MCP path – element id / JS expression / primary parameter. */
  path: string;
  /** MCP value – write payload / secondary parameter. */
  value?: string;
  // Backward-compat aliases (= action / proc / path+value)
  /** @deprecated use action */ command: string;
  /** @deprecated use proc   */ target: string;
  /** @deprecated use path   */ parameter: string;
  // Common
  conditional?: string;
  note?: string;
}
'@

# ── 2: RawXmlStep interface ───────────────────────────────────────────────────
$old2 = @'
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
'@
$new2 = @'
export interface RawXmlStep {
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
  /** Cross-namespace reference – namespace URI (e.g. "eu:plachy:sw:aiapi:builtin:dashboard"). */
  ns?: string;
  /** Cross-app shorthand (app folder name). */
  app?: string;
}
'@

# ── 3: XmlScenario interface – add namespace field ────────────────────────────
$old3 = '  /** App name (folder key) */
  app: string;
  /** Resolved flat step list (ScenarioRef expanded, no nesting) */
  steps: XmlStep[];'
$new3 = '  /** App name (folder key) */
  app: string;
  /** Namespace URI declared on <Scenarios xmlns="..."> (e.g. "eu:plachy:sw:aiapi:builtin:dashboard"). */
  namespace?: string;
  /** Resolved flat step list (ScenarioRef expanded, no nesting) */
  steps: XmlStep[];'

# ── 4: ScenarioCallFn signature – MCP-aligned ─────────────────────────────────
$old4 = 'export interface ScenarioCallFn {
  (helperName: string, target: string, command: string, parameter: string): Promise<any>;
}'
$new4 = @'
/**
 * Invokes a single automation step.
 * Parameters mirror the MCP tools/call argument object (§2.6 CONVENTIONS.md):
 *   tool   = helper binary stem ("BrowserWin", "KeyWin", …)
 *   proc   = target process / window / CDP connection
 *   action = command verb (CLICKID, EXEC, WAIT, NAVIGATE, LAUNCH, DIALOG …)
 *   path   = element path / primary parameter
 *   value  = write payload / secondary parameter
 *
 * Two implementation strategies:
 *   - In-process (MCPServer, DashboardServer): call handleToolsCall() / helperRegistry.callCommand() directly.
 *   - Standalone (out-of-process): POST JSON-RPC 2.0 tools/call to the MCP endpoint.
 */
export interface ScenarioCallFn {
  (tool: string, proc: string, action: string, path: string, value?: string): Promise<any>;
}
'@

# ── 5: XmlStepResult interface – add MCP-aligned fields ──────────────────────
$old5 = 'export interface XmlStepResult {
  step: number;
  command: string;
  target: string;
  parameter: string;
  skipped?: boolean;
  waitMs?: number;
  success?: boolean;
  error?: string;
  value?: any;
}'
$new5 = 'export interface XmlStepResult {
  step: number;
  // MCP-aligned fields
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
}'

# Apply replacements
foreach ($pair in @(
  [pscustomobject]@{ old=$old1; new=$new1; name="XmlStep" },
  [pscustomobject]@{ old=$old2; new=$new2; name="RawXmlStep" },
  [pscustomobject]@{ old=$old3; new=$new3; name="XmlScenario.namespace" },
  [pscustomobject]@{ old=$old4; new=$new4; name="ScenarioCallFn" },
  [pscustomobject]@{ old=$old5; new=$new5; name="XmlStepResult" }
)) {
  if ($t.Contains($pair.old)) {
    $t = $t.Replace($pair.old, $pair.new)
    Write-Host "OK: $($pair.name)"
  } else {
    Write-Host "MISS: $($pair.name)"
  }
}

if ($t -ne $orig) {
  [System.IO.File]::WriteAllText($f, $t, [System.Text.Encoding]::UTF8)
  Write-Host "Written: $f"
} else {
  Write-Host "No changes made"
}
