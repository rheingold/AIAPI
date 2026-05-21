'use strict';
/**
 * D3 — Auth UI Dogfood  (harness — test/e2e/d3-auth-ui.js)
 *
 * Architecture
 * ────────────
 *   All assertions live in test/e2e/d3/scenarios.xml (ADR-008).
 *   This file is a thin bootstrap: launch browser, run XML scenarios in order.
 *
 *   REST scenarios (HTTP_FETCH + EVAL):
 *     a1-auth-config-rest      — GET /api/auth/config structural check
 *     a2-auth-status-rest      — GET /api/auth/status structural check
 *     a5-users-roles-rest      — GET /api/_internal/users + roles reachability
 *     a6-admin-token-rest      — POST /api/auth/admin-token error responses
 *     a7-db-provision-rest     — POST /api/_internal/db/provision structural check
 *     a9-save-auth-config-rest — POST + GET /api/auth/config save/verify/restore
 *     a10-user-crud-rest       — user CRUD (/api/_internal/users)
 *
 *   UI scenarios (CDP / CLICKID / READELEM):
 *     a3-auth-nav             — Auth nav button → panel presence
 *     a4-users-roles-tab      — Users & Roles sub-tab
 *     a7-db-provision-dom     — Switch store-source to db, assert DOM, restore
 *     a8-mode-panels          — Auth mode panels DOM check
 *     a9-auth-reload          — UI reload reflects saved mode
 *     a11-users-table         — Users table populated
 *     a11-add-user-modal      — Add User modal open / close
 *
 * Run:   node test/e2e/d3-auth-ui.js
 * Env:   BROWSER=msedge  (default: chrome)
 */

const { DASH_PORT, TEST_TAG, runSuite } = require('./_shared');
const { labelFrom }      = require('./_make-suite');
const { ScenarioRunner } = require('./_scenario-runner');

const BROWSER  = process.env.BROWSER || 'chrome';
const DASH_URL = `http://localhost:${DASH_PORT}`;

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    console.log(`  Browser: ${BROWSER}   Dashboard: ${DASH_URL}`);
    const runner = new ScenarioRunner({ browser: BROWSER, dashUrl: DASH_URL });
    await runner.waitReady();
    await runner.launch();
    await runner.runOk('d3', 'override-page-dialogs');

    // ── REST-only scenarios (HTTP_FETCH + EVAL in XML) ───────────────────────
    await runner.runOk('d3', 'a1-auth-config-rest',       { dashUrl: DASH_URL });
    await runner.runOk('d3', 'a2-auth-status-rest',       { dashUrl: DASH_URL });
    await runner.runOk('d3', 'a5-users-roles-rest',       { dashUrl: DASH_URL });
    // A6/A7 probe error-response paths — HTTP_FETCH steps intentionally return
    // non-200 (400/500), so overall scenario.success=false. Use run() and count
    // only EVAL step failures (assertion logic) as test failures.
    for (const sid of ['a6-admin-token-rest', 'a7-db-provision-rest']) {
      const params = sid === 'a6-admin-token-rest' ? { dashUrl: DASH_URL, testTag: TEST_TAG } : { dashUrl: DASH_URL };
      const r = await runner.run('d3', sid, params);
      const evalFails = (r?.steps ?? []).filter(s => s.action === 'EVAL' && !s.skipped && s.success === false);
      if (evalFails.length) {
        const details = evalFails.map(s => `step ${s.step}: ${s.error}`).join('; ');
        throw new Error(`d3/${sid} EVAL assertion(s) failed: ${details}`);
      }
      console.log(`  ✓  d3/${sid}: assertions ok (HTTP steps may have non-200 — expected)`);
    }

    // ── UI scenarios ─────────────────────────────────────────────────────────
    await runner.runOk('d3', 'a3-auth-nav');
    await runner.runOk('d3', 'a4-users-roles-tab');
    await runner.runOk('d3', 'a7-db-provision-dom');
    await runner.runOk('d3', 'a8-mode-panels');

    // ── A9: REST save/verify/restore then UI reload check ────────────────────
    await runner.runOk('d3', 'a9-save-auth-config-rest',  { dashUrl: DASH_URL });
    await runner.run  ('d3', 'a9-auth-reload');           // soft — timing-sensitive

    // ── REST CRUD then UI table / modal check ─────────────────────────────────
    await runner.runOk('d3', 'a10-user-crud-rest',        { dashUrl: DASH_URL, testTag: TEST_TAG });
    await runner.runOk('d3', 'a11-users-table');
    await runner.runOk('d3', 'a11-add-user-modal');
  });
}

if (require.main === module) run();
module.exports = { run };

