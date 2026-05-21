const fs = require('fs');
const raw = fs.readFileSync('components/server/src/scenario/xmlScenarioLoader.ts');
const hasCRLF = raw.includes(Buffer.from('\r\n'));
let t = raw.toString('utf8').replace(/\r\n/g, '\n');
let changed = 0;

function rep(pattern, replacement, label) {
  const t2 = t.replace(pattern, replacement);
  if (t2 === t) { console.log('MISS:', label); }
  else { console.log('OK  :', label); changed++; t = t2; }
}

rep(
  /export interface XmlStep \{[^}]+\}/,
  `/**
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
  // Backward-compat aliases
  /** @deprecated use action */ command: string;
  /** @deprecated use proc   */ target: string;
  /** @deprecated use path   */ parameter: string;
  conditional?: string;
  note?: string;
}`,
  'XmlStep'
);

rep(
  /export interface RawXmlStep \{[^}]+\}/,
  `export interface RawXmlStep {
  type: 'Step' | 'ScenarioRef';
  tool?: string;
  action?: string;
  proc?: string;
  path?: string;
  value?: string;
  /** @deprecated use action */ command?: string;
  /** @deprecated use proc   */ target?: string;
  /** @deprecated use path   */ parameter?: string;
  conditional?: string;
  note?: string;
  ref?: string;
  ns?: string;
  app?: string;
}`,
  'RawXmlStep'
);

rep(
  /(  \/\*\* App name[^\n]+\n  app: string;\n)(  \/\*\* Resolved flat)/,
  '$1  /** Namespace URI on <Scenarios xmlns="..."> */\n  namespace?: string;\n  $2',
  'XmlScenario.namespace'
);

rep(
  /export interface XmlStepResult \{[^}]+\}/,
  `export interface XmlStepResult {
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
}`,
  'XmlStepResult'
);

console.log('Total changed:', changed);
if (hasCRLF) t = t.replace(/\n/g, '\r\n');
fs.writeFileSync('components/server/src/scenario/xmlScenarioLoader.ts', t, 'utf8');
console.log('Written');
