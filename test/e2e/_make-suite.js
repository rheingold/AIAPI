'use strict';
/**
 * _make-suite.js — Parametric factory for thin dogfood bootstrap files.
 *
 * Eliminates near-identical boilerplate in D1/D2/D5/D6/D7.
 * Complex suites that need loop orchestration, var-passing or skip-on-fail
 * logic (D3, D4, D8, D9) keep their own JS files.
 *
 * Usage:
 *   const { makeSuite } = require('./_make-suite');
 *
 *   // With browser (dashboard suites):
 *   const run = makeSuite(__filename, 'd1-suite',
 *                         ({ DASH_URL }) => ({ dashUrl: DASH_URL }));
 *
 *   // Without browser (KeyWin suites):
 *   const run = makeSuite(__filename, 'd5-suite',
 *                         () => ({}), { browser: false });
 *
 * @param {string}   filename  — __filename of the calling file; used to derive
 *                               suiteId (parent dir name) and suite label (basename).
 *                               No hardcoded label strings — everything comes from the path.
 * @param {string}   scenId    — top-level scenario id to run inside the suiteId folder
 * @param {Function} makeVars  — (ctx) => vars object; ctx has { DASH_URL, DASH_PORT, TEST_TAG }
 * @param {object}   opts
 *   opts.browser    {boolean}  — false = no browser launch (default: true)
 *   opts.skipOnFail {boolean}  — skip instead of fail when browser launch fails (default: false)
 *   opts.preRun     {Function} — async (runner) => void, called after optional launch,
 *                                before runOk (optional)
 */

const path  = require('path');
const { DASH_PORT, TEST_TAG, runSuite, skip } = require('./_shared');
const { ScenarioRunner }                       = require('./_scenario-runner');

const DASH_URL = `http://localhost:${DASH_PORT}`;
const BROWSER  = process.env.BROWSER || 'chrome';

/**
 * Derive suite label from the caller's __filename.
 * e.g. "/test/e2e/d1-dashboard-smoke.js" → "d1-dashboard-smoke"
 */
function labelFrom(filename) {
  return path.basename(filename, '.js');
}

/**
 * Derive suiteId (= scenarios folder name) from the caller's __filename.
 * Looks for a sibling directory whose name is the dN prefix of the file.
 * e.g. "d1-dashboard-smoke.js" → "d1"
 */
function suiteIdFrom(filename) {
  const base = path.basename(filename, '.js');   // "d1-dashboard-smoke"
  const m    = base.match(/^(d\d+)/i);
  return m ? m[1] : base;
}

function makeSuite(filename, scenId, makeVars = () => ({}), opts = {}) {
  const suiteId    = suiteIdFrom(filename);
  const label      = `${labelFrom(filename)}  [${TEST_TAG}]`;
  const useBrowser = opts.browser !== false;
  const skipOnFail = opts.skipOnFail === true;
  const preRun     = opts.preRun ?? null;

  return async function run() {
    return runSuite(label, async () => {
      const ctx    = { DASH_URL, DASH_PORT, TEST_TAG, BROWSER };
      const vars   = makeVars(ctx);
      const runner = new ScenarioRunner({
        dashUrl: DASH_URL,
        ...(useBrowser ? { browser: BROWSER } : {}),
      });
      await runner.waitReady();
      if (useBrowser) {
        const launched = await runner.launch();
        if (skipOnFail && !launched?.success) {
          skip(`${suiteId} — ${scenId}`, 'Browser launch failed');
          return;
        }
      }
      if (preRun) await preRun(runner);
      await runner.runOk(suiteId, scenId, vars);
    });
  };
}

module.exports = { makeSuite, labelFrom, suiteIdFrom, DASH_URL, DASH_PORT, TEST_TAG, BROWSER };

