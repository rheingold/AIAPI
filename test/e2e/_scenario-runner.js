'use strict';
/**
 * _scenario-runner.js — Structured harness for XML app-template scenario tests.
 *
 * Instead of hand-coding raw mcpCall() / dashRest() sequences, dogfood tests
 * should call POST /api/appTemplates/{app}/scenarios/{id}/run and assert on the
 * structured result.  This module provides the class that makes that clean.
 *
 * Architecture:
 *   scenarios.xml  — atomic + composite steps, assembled via <ScenarioRef>
 *   ScenarioRunner — thin client: POST run, assert shape, surface step values
 *   d*.js harness  — orchestrates: run scenario → REST-assert server side-effect
 *                    → run restore scenario → REST-assert restored state
 *
 * Usage:
 *   const { ScenarioRunner } = require('./_scenario-runner');
 *   const runner = new ScenarioRunner({ browser: 'chrome', dashUrl: 'http://localhost:3458' });
 *   await runner.waitReady();
 *   const r = await runner.run('dashboard', 'test-nav-to-settings');
 *   runner.assertSuccess(r, 'nav to settings');
 *   runner.assertLastStepTruthy(r, 'settings section active');
 */

const { dashRest, ok, assert, skip, pollUntilMcpReady, sleep } = require('./_shared');

// ──────────────────────────────────────────────────────────────────────────────

class ScenarioRunner {
  /**
   * @param {object} defaults  Default params injected into every run() call.
   *   browser  {string}  BrowserWin target, e.g. 'chrome'  (default: 'chrome')
   *   dashUrl  {string}  Dashboard URL  (default: 'http://localhost:3458')
   */
  constructor(defaults = {}) {
    this.defaults = {
      browser: 'chrome',
      dashUrl: `http://localhost:${process.env.DASH_PORT || 3458}`,
      ...defaults,
    };
  }

  // ── Core runner ─────────────────────────────────────────────────────────────

  /**
   * Execute a named scenario via the dashboard REST API.
   * All `this.defaults` are merged with the provided params (params win).
   *
   * @param {string}  app         App template name, e.g. 'dashboard'
   * @param {string}  scenarioId  Scenario id from scenarios.xml
   * @param {object}  [params]    Variable overrides
   * @param {boolean} [verbose]   Pass verbose=true to get per-step logs
   * @returns {Promise<object>}   Raw server result (see XmlScenarioResult shape)
   */
  async run(app, scenarioId, params = {}, verbose = false) {
    const merged = { ...this.defaults, ...params };
    const result = await dashRest(
      'POST',
      `/api/appTemplates/${app}/scenarios/${scenarioId}/run`,
      { params: merged, verbose },
      120000,
    ).catch(e => ({ _networkError: e.message }));

    if (result?._networkError) {
      console.error(`   [runner] Network error running ${app}/${scenarioId}: ${result._networkError}`);
    }
    return result;
  }

  // ── Assertions ──────────────────────────────────────────────────────────────

  /**
   * Assert the scenario completed with success:true.
   * Prints a clear failure message including which steps failed.
   */
  assertSuccess(result, label) {
    if (result?._networkError) {
      assert(`${label}: no network error`, false, result._networkError);
      return false;
    }
    const passed = result?.success === true;
    if (!passed) {
      const failed = (result?.steps ?? []).filter(s => !s.skipped && s.success === false);
      const details = failed.map(s => `step ${s.step} ${s.action ?? s.command}: ${s.error ?? '?'}`).join('; ');
      assert(`${label}: scenario success`, false, details || JSON.stringify(result).slice(0, 120));
    } else {
      ok(`${label}: scenario success`, true);
    }
    return passed;
  }

  /**
   * Assert the scenario completed with success:false (negative path test).
   */
  assertFailed(result, label) {
    const passed = result?.success === false;
    assert(`${label}: scenario expected to fail`, passed, JSON.stringify(result).slice(0, 80));
    return passed;
  }

  // ── Step value access ────────────────────────────────────────────────────────

  /**
   * Get all step results from the scenario result.
   */
  steps(result) {
    return result?.steps ?? [];
  }

  /**
   * Get the `value` returned by the last EXEC step.
   * (Scenario runner captures `r.value` for EXEC steps.)
   */
  lastExecValue(result) {
    // Match both 'EXEC' (legacy) and 'CDP_EXECUTE' (current XML action name)
    const steps = this.steps(result).filter(s => {
      const a = s.action ?? s.command;
      return (a === 'EXEC' || a === 'CDP_EXECUTE') && !s.skipped;
    });
    return steps.length ? steps[steps.length - 1].value : undefined;
  }

  /**
   * Get the value of the first step whose `note` contains the given substring.
   */
  stepValueByNote(result, noteSubstring) {
    const step = this.steps(result).find(s => (s.note ?? '').includes(noteSubstring));
    return step?.value;
  }

  /**
   * Assert that the last EXEC step returned a truthy value.
   */
  assertLastExecTruthy(result, label) {
    const v = this.lastExecValue(result);
    assert(`${label}: last EXEC value truthy`, !!v, `got: ${JSON.stringify(v)}`);
    return !!v;
  }

  /**
   * Assert that the last EXEC step returned an expected value.
   */
  assertLastExecEquals(result, expected, label) {
    const v = this.lastExecValue(result);
    // EXEC steps may return value as a JSON-serialised string from CDP.
    // Accept both the raw value and its JSON-stringified form.
    const match = v === expected
      || v === String(expected)
      || (typeof expected === 'boolean' && v === JSON.stringify(expected));
    assert(`${label}: last EXEC value === ${JSON.stringify(expected)}`,
      match, `got: ${JSON.stringify(v)}`);
    return match;
  }

  // ── Composite convenience ────────────────────────────────────────────────────

  /**
   * Run a scenario and immediately assert success.  Returns the result.
   */
  async runOk(app, scenarioId, params = {}, verbose = false) {
    const label = `${app}/${scenarioId}`;
    const r = await this.run(app, scenarioId, params, verbose);
    this.assertSuccess(r, label);
    return r;
  }

  /**
   * Launch the browser and navigate to the dashboard.
   * Returns the scenario result.
   */
  async launch(params = {}) {
    console.log('   [runner] Closing any existing browser for clean CDP start...');
    const { execSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    // Kill Chrome before launching — avoids BrowserWin "reused:true" CDP target
    // reconnection failures when the page reloads during NAVIGATE.
    try { execSync('taskkill /IM chrome.exe /F', { stdio: 'ignore' }); } catch (_) {}
    await sleep(4000); // let BrowserWin drain stale queued commands (they fail fast with Chrome dead)

    // Clear BrowserWin Chrome profile dirs (%TEMP%\aiapi-chrome-*).
    // Re-using a crashed profile causes Chrome to show "Restore pages?" even with
    // --no-session-restore.  Deleting the dir before launch gives Chrome a
    // fresh profile → no restore dialog.
    try {
      const tmp = process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp';
      for (const d of fs.readdirSync(tmp)) {
        if (/^aiapi-chrome-/i.test(d)) {
          fs.rmSync(path.join(tmp, d), { recursive: true, force: true });
          console.log(`   [runner] Cleared Chrome profile: ${d}`);
        }
      }
    } catch (_) {}

    console.log('   [runner] Launching browser → dashboard...');
    const r = await this.run('dashboard', 'launch', params);
    this.assertSuccess(r, 'launch dashboard');

    // The executor auto-binds vars.tab = chrome:URL:<dashUrl> after NAVIGATE
    // (CONVENTIONS.md §1.1, §2.2).  Pick it up from the scenario result so all
    // subsequent CLICKID/READ/SENDKEYS/CDP_EXECUTE steps get an explicit,
    // URL-discriminated tab address instead of the fuzzy process name.
    if (r?.vars?.tab) {
      this.defaults.tab = r.vars.tab;
      console.log(`   [runner] Tab target: ${this.defaults.tab}`);
    }

    await sleep(400); // extra settle time
    return r;
  }

  // ── Utility ──────────────────────────────────────────────────────────────────

  /** Wait until the MCP server is ready. */
  async waitReady() {
    return pollUntilMcpReady();
  }

  /**
   * Execute arbitrary JS in the browser page via the d2/diag-exec scenario.
   * Returns the raw CDP result value (string / primitive / object).
   */
  async rawExec(js) {
    const r = await this.run('d2', 'diag-exec', { jsCode: js });
    if (!r?.success) throw new Error(`rawExec failed: ${r?.error || JSON.stringify(r)}`);
    // lastExecValue only matches 'EXEC'; our step stores 'CDP_EXECUTE' — read directly
    const steps = (r?.steps ?? []).filter(s => !s.skipped);
    const last  = steps[steps.length - 1];
    return last?.value;
  }

  /**
   * Summarise a result for console output.
   * @returns {string}
   */
  static summary(result) {
    if (result?._networkError) return `network error: ${result._networkError}`;
    return `success=${result?.success} total=${result?.totalSteps} failed=${result?.failedSteps} skipped=${result?.skippedSteps}`;
  }
}

// ──────────────────────────────────────────────────────────────────────────────

module.exports = { ScenarioRunner };
