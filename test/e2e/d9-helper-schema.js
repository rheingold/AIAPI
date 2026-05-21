'use strict';
/**
 * D9 — Helper Schema & Discovery  (harness — test/e2e/d9-helper-schema.js)
 *
 * Architecture
 * ────────────
 *   All assertions live in test/e2e/d9/scenarios.xml (ADR-008).
 *   This file is a thin bootstrap: run XML scenarios in order.
 *   No browser required — all scenarios use HTTP_FETCH + MCP JSON-RPC.
 *
 *   Scenarios (d9/scenarios.xml):
 *     hs1-list-helpers-rest      — GET /api/listHelpers structural + content check
 *     hs2-keywin-schema-rest     — GET /api/getHelperSchema?name=KeyWin.exe
 *     hs3-browserwin-schema-rest — GET /api/getHelperSchema?name=BrowserWin.exe
 *     hs4-mcp-tools-list         — JSON-RPC tools/list → required tools exposed
 *     hs5-mcp-list-helpers       — JSON-RPC tools/call listHelpers
 *     hs6-mcp-get-schema         — JSON-RPC tools/call getHelperSchema(KeyWin.exe)
 *     hs7-helpers-reload         — POST /api/helpers/reload + verify helpers still up
 *     hs8-helper-toggle          — disable KeyWin, assert disabled, re-enable
 *
 * Run:   node test/e2e/d9-helper-schema.js
 * Env:   DASH_PORT (default 3458)  MCP_PORT (default 3457)
 */

const { DASH_PORT, TEST_TAG, runSuite } = require('./_shared');
const { labelFrom }      = require('./_make-suite');
const { ScenarioRunner } = require('./_scenario-runner');

const MCP_PORT = parseInt(process.env.MCP_PORT || '3457', 10);
const DASH_URL = `http://localhost:${DASH_PORT}`;
const MCP_URL  = `http://localhost:${MCP_PORT}`;

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    const runner = new ScenarioRunner({ browser: null, dashUrl: DASH_URL });
    await runner.waitReady();

    const vars = { dashUrl: DASH_URL, mcpUrl: MCP_URL, helperName: 'KeyWin.exe' };

    await runner.runOk('d9', 'hs1-list-helpers-rest',      vars);
    await runner.runOk('d9', 'hs2-keywin-schema-rest',     vars);
    await runner.runOk('d9', 'hs3-browserwin-schema-rest', vars);
    await runner.runOk('d9', 'hs4-mcp-tools-list',         vars);
    await runner.runOk('d9', 'hs5-mcp-list-helpers',       vars);
    await runner.runOk('d9', 'hs6-mcp-get-schema',         vars);
    await runner.runOk('d9', 'hs7-helpers-reload',         vars);
    await runner.runOk('d9', 'hs8-helper-toggle',          { ...vars, testTag: TEST_TAG });
  });
}

if (require.main === module) run();
module.exports = { run };


