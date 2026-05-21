'use strict';
const fs = require('fs');
const path = require('path');

// ── d1/scenarios.xml ─────────────────────────────────────────────────────────
const xmlPath = path.join(__dirname, '../../test/e2e/d1/scenarios.xml');
let c = fs.readFileSync(xmlPath, 'utf8');

const closeTag = '</Scenarios>';
const insertIdx = c.indexOf(closeTag);

const newScenarios = `  <!-- ── REST SMOKE ──────────────────────────────────────────────────────── -->
  <Scenario id="d1-rest-smoke" effect="read-only">
    <description lang="en">GET /health, /api/status, /api/settings — assert key fields.</description>
    <Parameters>
      <Param name="dashUrl" type="string" required="false" example="http://localhost:3458" note="dashboard base URL"/>
    </Parameters>
    <steps>
      <step action="HTTP_FETCH" proc="{{dashUrl}}/health" path="GET"
            bind="healthResult" note="GET /health"/>
      <step action="EVAL"
            path="(()=>{ const h=JSON.parse('{{healthResult}}'); if(h.status!=='ok') throw new Error('D1: /health status='+h.status); if(typeof h.version!=='string') throw new Error('D1: health.version not string'); if(typeof h.timestamp!=='string') throw new Error('D1: health.timestamp not string'); return {ok:true,version:h.version}; })()"
            bind="healthOk" note="assert /health"/>
      <step action="HTTP_FETCH" proc="{{dashUrl}}/api/status" path="GET"
            bind="statusResult" note="GET /api/status"/>
      <step action="EVAL"
            path="(()=>{ const s=JSON.parse('{{statusResult}}'); if(s.success!==true) throw new Error('D1: /api/status failed'); if(s.data.status!=='running') throw new Error('D1: status='+s.data.status); if((s.data.helpers.count??0)<1) throw new Error('D1: helpers.count='+s.data.helpers.count); return {ok:true,uptime:s.data.uptime,helpers:s.data.helpers.count}; })()"
            bind="statusOk" note="assert /api/status"/>
      <step action="HTTP_FETCH" proc="{{dashUrl}}/api/settings" path="GET"
            bind="settingsResult" note="GET /api/settings"/>
      <step action="EVAL"
            path="(()=>{ const cfg=JSON.parse('{{settingsResult}}'); if(!cfg||typeof cfg!=='object') throw new Error('D1: /api/settings not object'); if(typeof cfg.server.port!=='number') throw new Error('D1: server.port not number'); return {ok:true}; })()"
            note="assert /api/settings"/>
    </steps>
  </Scenario>

  <!-- ── D1 SUITE ──────────────────────────────────────────────────────────── -->
  <Scenario id="d1-suite" effect="test-suite">
    <description lang="en">Full D1 dashboard smoke suite — S1 REST baseline + S2-S6 UI navigation.</description>
    <Parameters>
      <Param name="dashUrl" type="string" required="false" example="http://localhost:3458" note="dashboard base URL"/>
    </Parameters>
    <steps>
      <ScenarioRef ref="d1-rest-smoke"/>
      <ScenarioRef ref="d1-page-title"/>
      <ScenarioRef ref="d1-nav-buttons"/>
      <ScenarioRef ref="d1-nav-settings"/>
      <ScenarioRef ref="d1-nav-logs"/>
      <ScenarioRef ref="d1-nav-home"/>
    </steps>
  </Scenario>

`;

c = c.slice(0, insertIdx) + newScenarios + closeTag + '\n';
fs.writeFileSync(xmlPath, c, 'utf8');
console.log('d1/scenarios.xml patched');

// ── d1-dashboard-smoke.js ─────────────────────────────────────────────────────
const jsPath = path.join(__dirname, '../../test/e2e/d1-dashboard-smoke.js');
const newJs = [
  `'use strict';`,
  `/**`,
  ` * D1 — Dashboard Smoke Test`,
  ` *`,
  ` * L3 XML : test/e2e/d1/scenarios.xml  (ALL steps — HTTP_FETCH + browser)`,
  ` * L1 JS  : this file — orchestration only`,
  ` *`,
  ` * Run:  node test/e2e/d1-dashboard-smoke.js`,
  ` */`,
  ``,
  `const { DASH_PORT, TEST_TAG, runSuite } = require('./_shared');`,
  `const { ScenarioRunner } = require('./_scenario-runner');`,
  ``,
  `const BROWSER  = process.env.BROWSER || 'chrome';`,
  "const DASH_URL = `http://localhost:${DASH_PORT}`;",
  ``,
  `async function run() {`,
  "  return runSuite(`D1 — Dashboard Smoke Test  [${TEST_TAG}]`, async () => {",
  `    const runner = new ScenarioRunner({ browser: BROWSER, dashUrl: DASH_URL });`,
  `    await runner.waitReady();`,
  `    await runner.launch();`,
  `    await runner.runOk('d1', 'd1-suite', { dashUrl: DASH_URL });`,
  `  });`,
  `}`,
  ``,
  `if (require.main === module) run();`,
  `module.exports = { run };`,
  ``
].join('\n');

fs.writeFileSync(jsPath, newJs, 'utf8');
console.log('d1-dashboard-smoke.js rewritten');
