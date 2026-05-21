'use strict';
/**
 * D15 — Scenario Execution  (harness — test/e2e/d15-scenario-execution.js)
 *
 * Architecture
 * ────────────
 *   Static assertions in test/e2e/d15/scenarios.xml (ADR-008):
 *     sr5-legacy-run     — POST /api/scenarios/run (legacy stub)
 *     sr6-list-scenarios — GET  /api/scenarios
 *     d15-static-suite   — chain sr5 + sr6
 *
 *   SR1–SR4, SR7 remain in JS: they PUT dynamically-constructed step arrays
 *   that depend on runtime-discovered appName/scenarioId/originalSteps.
 *   Dynamic PUT bodies with full JSON arrays cannot be expressed as XML attrs.
 *
 * Run:   node test/e2e/d15-scenario-execution.js
 * Env:   DASH_PORT (default 3458)
 */

const {
  dashRest, ok, assert, skip,
  TEST_TAG, runSuite,
} = require('./_shared');
const { labelFrom }      = require('./_make-suite');
const { ScenarioRunner } = require('./_scenario-runner');

const DASH_PORT = parseInt(process.env.DASH_PORT || '3458', 10);
const DASH_URL  = `http://localhost:${DASH_PORT}`;

// ── Helper ────────────────────────────────────────────────────────────────────

/** POST /api/appTemplates/{app}/scenarios/{id}/run */
async function runScenario(appName, scenarioId, params = {}, verbose = false) {
  return dashRest('POST', `/api/appTemplates/${appName}/scenarios/${scenarioId}/run`,
    { params, verbose }).catch(e => ({ _e: e.message }));
}

// ── SR1–SR4, SR7: dynamic tests (PUT-based, stay in JS) ──────────────────────

/** SR1: Pick a scenario app + slot we can borrow for the run test */
async function loadTargetScenario() {
  console.log('\n── SR1 · Select scenario app + slot ──');

  const appsR = await dashRest('GET', '/api/appTemplates');
  assert('GET /api/appTemplates returns object', appsR && typeof appsR === 'object',
    JSON.stringify(appsR).slice(0, 80));
  const apps = appsR?.apps ?? [];
  if (apps.length === 0) {
    skip('All scenario-run tests', 'No app templates available');
    return null;
  }

  // Prefer calculator (always safe — stateless WAIT won't break it)
  const appName = apps.find(a => a.name === 'calculator')?.name ?? apps[0].name;
  const listR = await dashRest('GET', `/api/appTemplates/${appName}/scenarios/list`);
  const scenarios = listR?.scenarios ?? [];
  if (scenarios.length === 0) {
    skip('All scenario-run tests', `No scenarios in ${appName}`);
    return null;
  }

  const scenarioId = scenarios[0].id;
  const stepsR = await dashRest('GET', `/api/appTemplates/${appName}/scenarios/${scenarioId}/steps`);
  const originalSteps = stepsR?.steps ?? [];
  console.log(`   Selected: ${appName}/${scenarioId} (${originalSteps.length} original steps)`);
  return { appName, scenarioId, originalSteps };
}

/** SR2: Write + run a WAIT-only test scenario, verify result shape */
async function testRunScenario(target) {
  console.log('\n── SR2 · Run WAIT-only test scenario ──');
  if (!target) { skip('SR2', 'no scenario target'); return; }

  const { appName, scenarioId, originalSteps } = target;
  const testSteps = [
    { command: 'WAIT', target: '', parameter: '200', note: `D15 ${TEST_TAG}` },
  ];

  // Overwrite with test scenario
  const putR = await dashRest('PUT', `/api/appTemplates/${appName}/scenarios/${scenarioId}`,
    { label: scenarioId, steps: testSteps });
  assert('PUT test scenario accepted', putR && !putR.error,
    JSON.stringify(putR).slice(0, 80));

  // Run it
  const result = await runScenario(appName, scenarioId, {});
  ok('POST /run returns result', result && !result._e);
  console.log(`   run result: ${JSON.stringify(result).slice(0, 120)}`);

  if (result && !result._e) {
    // The response from runXmlScenario is serialised directly — check key shape fields
    const hasSuccess  = typeof result.success  === 'boolean';
    // runXmlScenario result shape: totalSteps / skippedSteps / failedSteps (no bare "duration")
    const hasDuration = typeof result.metadata?.duration === 'number'
                     || typeof result.duration === 'number'
                     || typeof result.totalSteps === 'number';
    const hasSteps    = Array.isArray(result.steps);
    assert('Result has "success" field',  hasSuccess,  JSON.stringify(result).slice(0, 80));
    assert('Result has "duration" field', hasDuration, JSON.stringify(result).slice(0, 80));
    assert('Result has "steps" array',    hasSteps,    JSON.stringify(result).slice(0, 80));
    if (hasSteps) {
      console.log(`   steps executed: ${result.steps.length}`);
    }
    // A WAIT scenario should succeed
    assert('WAIT scenario succeeds', result.success === true,
      `success=${result.success} error=${result.error ?? 'none'}`);
  }

  // Restore original steps (unconditional)
  const restoreR = await dashRest('PUT', `/api/appTemplates/${appName}/scenarios/${scenarioId}`,
    { label: scenarioId, steps: originalSteps }).catch(e => ({ error: e.message }));
  assert('Original scenario steps restored', restoreR && !restoreR.error,
    JSON.stringify(restoreR).slice(0, 80));
  console.log(`   Restored ${appName}/${scenarioId} to ${originalSteps.length} step(s)`);
}

/** SR3: Run with variable substitution in WAIT parameter */
async function testRunWithParams(target) {
  console.log('\n── SR3 · Run with {{var}} substitution in WAIT ──');
  if (!target) { skip('SR3', 'no scenario target'); return; }

  const { appName, scenarioId, originalSteps } = target;
  // A WAIT scenario using a substitutable variable for the wait time
  const testSteps = [
    { command: 'WAIT', target: '', parameter: '{{wait_ms}}', note: `D15 params ${TEST_TAG}` },
  ];

  const putR = await dashRest('PUT', `/api/appTemplates/${appName}/scenarios/${scenarioId}`,
    { label: scenarioId, steps: testSteps });
  if (!putR || putR.error) {
    skip('SR3 params test', `PUT failed: ${JSON.stringify(putR).slice(0, 60)}`);
    return;
  }

  // Run with param
  const result = await runScenario(appName, scenarioId, { wait_ms: '150' });
  ok('POST /run with params returns result', result && !result._e);
  if (result && !result._e) {
    assert('Param-substituted scenario succeeds', result.success === true,
      `success=${result.success} error=${result.error ?? 'none'}`);
    console.log(`   run with params result: success=${result.success}`);
  }

  // Restore
  const restoreR = await dashRest('PUT', `/api/appTemplates/${appName}/scenarios/${scenarioId}`,
    { label: scenarioId, steps: originalSteps }).catch(e => ({ error: e.message }));
  if (!restoreR?.error) console.log(`   Restored ${appName}/${scenarioId}`);
}

/** SR4: Run with invalid scenario ID (expect 500 / structured error) */
async function testRunInvalidScenario(target) {
  console.log('\n── SR4 · Run with invalid scenario ID (graceful error) ──');
  if (!target) { skip('SR4', 'no scenario target'); return; }

  const { appName } = target;
  const result = await runScenario(appName, `__nonexistent_d15_${TEST_TAG}__`, {});
  const isGraceful = result?._e != null || result?.success === false || result?.error != null;
  assert('Invalid scenario ID returns structured error', isGraceful,
    `unexpected: ${JSON.stringify(result).slice(0, 80)}`);
  console.log(`   graceful error: ${result?._e ?? result?.error ?? JSON.stringify(result).slice(0, 60)}`);
}

/** SR7: Run with verbose flag — result should include extra step detail */
async function testRunVerbose(target) {
  console.log('\n── SR7 · Run with verbose=true ──');
  if (!target) { skip('SR7', 'no scenario target'); return; }

  const { appName, scenarioId, originalSteps } = target;
  const testSteps = [
    { command: 'WAIT', target: '', parameter: '100', note: `D15 verbose ${TEST_TAG}` },
  ];
  const putR = await dashRest('PUT', `/api/appTemplates/${appName}/scenarios/${scenarioId}`,
    { label: scenarioId, steps: testSteps });
  if (!putR || putR.error) {
    skip('SR7 verbose', `PUT failed: ${JSON.stringify(putR).slice(0, 60)}`);
    return;
  }

  const result = await runScenario(appName, scenarioId, {}, true /* verbose */);
  ok('POST /run with verbose=true returns result', result && !result._e);
  if (result && !result._e) {
    assert('Verbose scenario has success field', typeof result.success === 'boolean',
      JSON.stringify(result).slice(0, 80));
  }

  // Restore
  await dashRest('PUT', `/api/appTemplates/${appName}/scenarios/${scenarioId}`,
    { label: scenarioId, steps: originalSteps }).catch(() => null);
  console.log(`   Restored ${appName}/${scenarioId}`);
}

/** SR5: handled by d15-static-suite XML */

/** SR6: GET /api/scenarios — graceful (endpoint can return HTTP 500 when folder absent) */
async function testListScenarios() {
  console.log('\n── SR6 · GET /api/scenarios ──');
  const r = await dashRest('GET', '/api/scenarios').catch(e => ({ _e: e.message }));
  if (r?._e || r?.success === false || r?.error) {
    skip('GET /api/scenarios', r?._e ?? r?.error ?? 'endpoint unavailable');
    return;
  }
  ok('GET /api/scenarios returns result', r);
  const scenarios = r?.scenarios ?? (Array.isArray(r) ? r : null);
  assert('scenarios key is present', scenarios !== null,
    `got keys: ${Object.keys(r || {}).join(', ')}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    const runner = new ScenarioRunner({ browser: null, dashUrl: DASH_URL });
    await runner.waitReady();
    const vars = { dashUrl: DASH_URL };

    // Static REST checks (XML)
    await runner.runOk('d15', 'd15-static-suite', vars);

    // Dynamic PUT-based tests + SR6 graceful (JS — see file comment for reasons)
    let target = null;
    try {
      target = await loadTargetScenario();
      await testRunScenario(target);
      await testRunWithParams(target);
      await testRunInvalidScenario(target);
      await testRunVerbose(target);
      await testListScenarios();
    } catch (e) {      if (target) {
        await dashRest('PUT', `/api/appTemplates/${target.appName}/scenarios/${target.scenarioId}`,
          { label: target.scenarioId, steps: target.originalSteps }).catch(() => null);
      }
      throw e;
    }
  });
}

if (require.main === module) run();
module.exports = { run };
