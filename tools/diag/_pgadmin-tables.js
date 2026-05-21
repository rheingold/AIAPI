'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
const B = 'brave.exe';

// Helper: synchronous XHR-based GET via EXEC (EXEC has no awaitPromise)
function xhrGet(path) {
  return `(function(){var x=new XMLHttpRequest();x.open('GET','${path}',false);x.send();return x.responseText})()`;
}

async function exec(js) {
  const r = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: js });
  if (!r?.success) throw new Error('EXEC failed: ' + JSON.stringify(r));
  try { return JSON.parse(r.result); } catch { return r.result; }
}

(async () => {
  // Verify we're logged in
  const url = await exec('location.href');
  if (String(url).includes('login')) throw new Error('Not logged in — run _pgadmin-login-test.js first');
  console.log('Page:', url);

  // Use synchronous XHR (EXEC has no awaitPromise)
  const xhr = p => `(function(){var x=new XMLHttpRequest();x.open('GET','${p}',false);x.send();return x.responseText})()`;

  // List servers
  const servers = await exec(xhr('/browser/server/children/0'));
  console.log('\n─── Servers ──────────────────────────────────────────');
  const srvList = JSON.parse(servers);
  for (const s of srvList) {
    console.log(`  [${s.id}] ${s.label} — ${s._type}`);
  }

  if (!srvList.length) { console.log('No servers registered'); return; }
  const sid = srvList[0].id;

  // Connect to first server
  const conRes = await exec(`(function(){var x=new XMLHttpRequest();x.open('POST','/browser/server/connect/${sid}',false);x.setRequestHeader('Content-Type','application/json');x.send('{}');return x.responseText})()`);
  console.log('\n─── Connect ───────────────────────────────────────────');
  console.log(conRes);

  // List databases
  const dbs = await exec(xhr(`/browser/database/children/${sid}`));
  console.log('\n─── Databases ─────────────────────────────────────────');
  const dbList = JSON.parse(dbs);
  for (const d of dbList) console.log(`  [${d.id}] ${d.label}`);

  // Find aiapi_test
  const testDb = dbList.find(d => d.label === 'aiapi_test');
  if (!testDb) { console.log('\nWARNING: aiapi_test not found in list'); return; }
  console.log('\n─── aiapi_test found (id=' + testDb.id + ') ───────────────────');

  // List schemas
  const schemas = await exec(xhr(`/browser/schema/children/${sid}/${testDb.id}`));
  console.log('\n─── Schemas ───────────────────────────────────────────');
  const schList = JSON.parse(schemas);
  for (const sc of schList) console.log(`  [${sc.id}] ${sc.label}`);

  const pub = schList.find(s => s.label === 'public');
  if (!pub) { console.log('No public schema'); return; }

  // List tables
  const tables = await exec(xhr(`/browser/table/children/${sid}/${testDb.id}/${pub.id}`));
  console.log('\n─── Tables in public ──────────────────────────────────');
  const tblList = JSON.parse(tables);
  for (const t of tblList) console.log(`  ${t.label}`);

  const expected = ['aiapi_users','aiapi_roles','aiapi_user_roles','aiapi_apikeys','aiapi_settings'];
  const found    = tblList.map(t => t.label);
  const missing  = expected.filter(e => !found.includes(e));
  const extra    = found.filter(f => !expected.includes(f));
  console.log('\n─── Verification ──────────────────────────────────────');
  if (missing.length) console.log('MISSING:', missing.join(', '));
  else console.log('✅ All expected tables present:', expected.join(', '));
  if (extra.length) console.log('Extra tables:', extra.join(', '));
})().catch(e => { console.error(e.message ?? e); process.exit(1); });
