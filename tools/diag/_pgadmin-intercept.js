'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
const B = 'brave.exe';
async function exec(js) {
  const r = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: js });
  if (!r?.success) throw new Error('EXEC: ' + JSON.stringify(r));
  return r.result;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const csrfRaw = await exec('pgAdmin.csrf_token');
  const csrf = csrfRaw.replace(/^"|"$/g, '');
  console.log('CSRF:', csrf.slice(0, 20) + '...');

  // Intercept XHR to capture pgAdmin's own API calls
  await exec("window.__xhrLog=[];var _orig=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){window.__xhrLog.push(m+' '+u);return _orig.apply(this,arguments)};'patched'");
  console.log('XHR patched');

  // Click on Servers node in the tree to trigger tree-loading XHR calls
  await mcpCall('BrowserWin', { proc: B, action: 'CLICKNAME', path: 'Servers', value: '' });
  await sleep(2000);

  // Get intercepted calls
  const calls = await exec('JSON.stringify(window.__xhrLog.slice(0,30))');
  console.log('\nXHR calls after clicking Servers:', calls);
})().catch(e => console.error(e.message ?? e));
