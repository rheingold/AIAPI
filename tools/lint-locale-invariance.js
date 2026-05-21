#!/usr/bin/env node
'use strict';

/**
 * G-D.12 standalone locale-invariance linter.
 * Scans all scenarios.xml files and reports ASSERT steps with locale-sensitive value= attributes.
 *
 * Usage:
 *   node tools/lint-locale-invariance.js [--strict]
 *
 * --strict: exit 1 on any 'warn' too (default: exit 1 only on 'error')
 */

const path  = require('path');
const fs    = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');

// ── Regex helpers (mirrors xmlScenarioLoader.ts) ──────────────────────────────
const NUMERIC    = /^-?\d+(\.\d+)?$/;
const PURE_VAR   = /^\{\{(\w+)(?:\|\w+)?\}\}$/;
const EXEMPT_OPS = new Set(['truthy', 'matches', '>', '<', '>=', '<=']);

function normalizeOp(raw) {
  const t = raw.trim();
  const map = { 'eq': '===', 'neq': '!==', 'ne': '!==', 'contains': 'contains',
                'startswith': 'startsWith', 'endswith': 'endsWith', 'matches': 'matches',
                'truthy': 'truthy' };
  return map[t.toLowerCase()] ?? t;
}

// ── XML helpers ───────────────────────────────────────────────────────────────
function parseXml(content) {
  return new JSDOM(content, { contentType: 'text/xml' }).window.document;
}

function attr(el, name) { return el.getAttribute(name) ?? ''; }

function extractParams(scenarioEl) {
  const paramsEl = Array.from(scenarioEl.childNodes)
    .find(n => n.nodeType === 1 && n.tagName === 'Parameters');
  if (!paramsEl) return [];
  return Array.from(paramsEl.childNodes)
    .filter(n => n.nodeType === 1 && n.tagName === 'Param')
    .map(p => ({ name: attr(p, 'name'), localeMap: attr(p, 'localeMap') || undefined }));
}

function extractSteps(scenarioEl) {
  const stepsEl = Array.from(scenarioEl.childNodes)
    .find(n => n.nodeType === 1 && n.tagName === 'Steps');
  if (!stepsEl) return [];
  return Array.from(stepsEl.childNodes)
    .filter(n => n.nodeType === 1 && n.tagName === 'Step')
    .map((el, i) => ({
      index:  i + 1,
      action: attr(el, 'action'),
      proc:   attr(el, 'proc'),
      value:  attr(el, 'value'),
      op:     attr(el, 'op'),
      note:   attr(el, 'note'),
    }));
}

function lintScenario(scenarioEl, scenarioId) {
  const params = extractParams(scenarioEl);
  const steps  = extractSteps(scenarioEl);
  const violations = [];

  for (const step of steps) {
    if (step.action !== 'ASSERT') continue;
    if (!step.proc || /^\{\{[\w|]+\}\}$/.test(step.proc.trim())) continue;

    const op = normalizeOp(step.op || '===');
    if (EXEMPT_OPS.has(op)) continue;

    const val = step.value;
    if (NUMERIC.test(val.trim())) continue;
    if (val === '' || val === 'true' || val === 'false') continue;

    const m = PURE_VAR.exec(val.trim());
    if (m) {
      const param = params.find(p => p.name === m[1]);
      if (param?.localeMap) continue;
      violations.push({ stepIndex: step.index, value: val, note: step.note, severity: 'warn',
        reason: `{{${m[1]}}} has no localeMap= on its <Param>` });
    } else {
      violations.push({ stepIndex: step.index, value: val, note: step.note, severity: 'error',
        reason: `literal string "${val}" in ASSERT value= is locale-sensitive` });
    }
  }
  return violations;
}

// ── File discovery ────────────────────────────────────────────────────────────
function findScenariosXml(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findScenariosXml(full, results);
    else if (entry.name === 'scenarios.xml') results.push(full);
  }
  return results;
}

const searchRoots = [
  path.join(ROOT, 'test', 'e2e'),
  path.join(ROOT, 'components', 'helpers'),
];

const files = searchRoots.flatMap(r => findScenariosXml(r));

// ── Lint all files ────────────────────────────────────────────────────────────
let totalErrors = 0;
let totalWarns  = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file);
  let doc;
  try { doc = parseXml(fs.readFileSync(file, 'utf-8')); }
  catch (e) { console.error(`PARSE ERROR ${rel}: ${e.message}`); continue; }

  const scenarios = Array.from(doc.querySelectorAll('Scenario'));
  for (const s of scenarios) {
    const id = attr(s, 'id');
    const viols = lintScenario(s, id);
    for (const v of viols) {
      const tag = v.severity === 'error' ? '❌ ERROR' : '⚠️  WARN ';
      console.log(`${tag} ${rel} :: ${id} :: step ${v.stepIndex}: ${v.reason}${v.note ? ' [' + v.note + ']' : ''}`);
      if (v.severity === 'error') totalErrors++;
      else totalWarns++;
    }
  }
}

console.log(`\nLocale-invariance lint: ${totalErrors} error(s), ${totalWarns} warning(s)`);

const exitCode = totalErrors > 0 || (strict && totalWarns > 0) ? 1 : 0;
process.exit(exitCode);
