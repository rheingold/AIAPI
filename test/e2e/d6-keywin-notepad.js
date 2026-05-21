'use strict';
/**
 * D6 — KeyWin + Notepad Dogfood  (bootstrap — ADR-010)
 * All assertions live in d6/scenarios.xml (ASSERTPATHEVAL steps).
 * NO dashRest() — ADR-008 Rule 1.
 * Run:  node test/e2e/d6-keywin-notepad.js
 *
 * n0-pre-kill is intentionally called before d6-suite (not inside it):
 * failure is ignored so a fresh Notepad is always guaranteed.
 */
const { makeSuite } = require('./_make-suite');

const run = makeSuite(
  __filename,
  'd6-suite',
  () => ({ content: 'Hello Dogfood', newContent: 'Overwrite Test' }),
  {
    browser: false,
    preRun:  async (runner) => runner.run('d6', 'n0-pre-kill'), // ignore failure by design
  },
);

if (require.main === module) run();
module.exports = { run };
