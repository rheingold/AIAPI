'use strict';
/**
 * dogfood/index.js — Comprehensive dogfood test runner
 *
 * Runs all D2–D19 test suites sequentially. Security enforcement tests (D8)
 * run LAST to minimise interference with other tests.
 *
 * Flags:
 *   --filter=d5,d6   run only the specified suites (comma-separated, no spaces)
 *   --skip=d8        skip the specified suites
 *   --browser=msedge use a specific browser for BrowserWin tests
 *
 * Run all:
 *   node test/e2e/index.js
 *
 * Run subset:
 *   node test/e2e/index.js --filter=d5,d6
 *
 * Prerequisites:
 *   - MCP server running on port 3457 (default)
 *   - KeyWin.exe + BrowserWin.exe compiled (build-all.ps1)
 *   - Chrome/Edge installed for BrowserWin tests
 */
'use strict';
const path = require('path');

const SUITES = [
  { id: 'd1', label: 'Dashboard Smoke',          file: './d1-dashboard-smoke'    },
  { id: 'd2', label: 'Settings UI',             file: './d2-settings-ui'        },
  { id: 'd3', label: 'Auth UI',                  file: './d3-auth-ui'             },
  { id: 'd4', label: 'Scenarios Editor',         file: './d4-scenarios-editor'    },
  { id: 'd9', label: 'Helper Schema & Discovery',file: './d9-helper-schema'       },
  { id: 'd5', label: 'KeyWin + Calculator',      file: './d5-keywin-calculator'   },
  { id: 'd6', label: 'KeyWin + Notepad',         file: './d6-keywin-notepad'      },
  { id: 'd7', label: 'BrowserWin + Chrome',      file: './d7-browserwin-chrome'   },
  { id: 'd10', label: 'Server Foundations',         file: './d10-server-foundations'  },
  { id: 'd11', label: 'Security Log & Filter Dry-Run', file: './d11-security-log-filters' },
  { id: 'd12', label: 'KeyWin Extended Commands',   file: './d12-keywin-extended'     },
  { id: 'd13', label: 'BrowserWin Extended Commands',  file: './d13-browserwin-extended'  },
  { id: 'd14', label: 'MSOfficeWin',                  file: './d14-msoffice-win'          },
  { id: 'd15', label: 'Scenario Execution',           file: './d15-scenario-execution'    },
  { id: 'd16', label: 'Extended REST Coverage',       file: './d16-extended-rest'         },
  { id: 'd17', label: 'Users, Roles & Auth Backend',   file: './d17-users-roles'           },
  { id: 'd18', label: 'LibreOfficeWin',                file: './d18-libreoffice-win'        },
  { id: 'd19', label: 'Users, Roles & Auth — DB backend', file: './d19-users-roles-db'     },
  { id: 'd8',  label: 'Security Filter Enforcement',  file: './d8-security-enforcement'   }, // LAST
];

// ── CLI flag parsing ──────────────────────────────────────────────────────────

const filterArg = (process.argv.find(a => a.startsWith('--filter=')) || '').replace('--filter=', '');
const skipArg   = (process.argv.find(a => a.startsWith('--skip='))   || '').replace('--skip=',   '');
const filterSet = filterArg ? new Set(filterArg.split(',').map(s => s.trim().toLowerCase())) : null;
const skipSet   = skipArg   ? new Set(skipArg.split(',').map(s => s.trim().toLowerCase()))   : new Set();

// Forward --browser= to child suites via env.
const browserArg = process.argv.find(a => a.startsWith('--browser='));
if (browserArg) process.env.BROWSER = browserArg.replace('--browser=', '');

// ── Runner ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  AIAPI Dogfood Test Suite — Comprehensive Coverage       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  if (filterSet) console.log(`  Filter: ${[...filterSet].join(', ')}`);
  if (skipSet.size) console.log(`  Skip:   ${[...skipSet].join(', ')}`);
  console.log('');

  const results = [];
  let totalPassed = 0, totalFailed = 0;

  for (const suite of SUITES) {
    const id = suite.id.toLowerCase();
    if (filterSet && !filterSet.has(id)) continue;
    if (skipSet.has(id)) {
      console.log(`\n⊘  ${suite.id.toUpperCase()} · ${suite.label}  [SKIPPED via --skip]`);
      results.push({ id: suite.id, label: suite.label, status: 'skipped', passed: 0, failed: 0 });
      continue;
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  Running ${suite.id.toUpperCase()} · ${suite.label}`);
    console.log(`${'═'.repeat(60)}`);

    try {
      // Each suite module exports a run() → { passed, failed }.
      const mod = require(suite.file);
      const { passed = 0, failed = 0 } = await mod.run();
      totalPassed += passed;
      totalFailed += failed;
      results.push({ id: suite.id, label: suite.label, status: failed > 0 ? 'FAIL' : 'PASS', passed, failed });
    } catch (e) {
      console.error(`\nFATAL ERROR in ${suite.id}: ${e.message}`);
      totalFailed++;
      results.push({ id: suite.id, label: suite.label, status: 'ERROR', passed: 0, failed: 1, error: e.message });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  OVERALL RESULTS                                         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  const colW = 38;
  for (const r of results) {
    const status = r.status === 'PASS' ? '✅ PASS' : r.status === 'skipped' ? '⊘  skip' : r.status === 'ERROR' ? '💥 ERR ' : `❌ FAIL`;
    const label = `${r.id.toUpperCase()} · ${r.label}`;
    const padding = ' '.repeat(Math.max(1, colW - label.length));
    const detail = r.status !== 'skipped' ? `${r.passed} passed / ${r.failed} failed` : '';
    console.log(`  ${status}  ${label}${padding}${detail}`);
  }
  console.log('');
  console.log(`  Total: ${totalPassed} passed, ${totalFailed} failed`);
  console.log('');

  if (totalFailed > 0) {
    console.log('  ❌ Some suites FAILED — see details above.');
  } else {
    console.log('  ✅ All suites PASSED');
  }

  process.exitCode = totalFailed > 0 ? 1 : 0;
}

run();
