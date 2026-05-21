'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
const B = 'brave.exe';
async function exec(js) {
  const r = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: js });
  if (!r?.success) throw new Error('EXEC: ' + r.result);
  return r.result;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const csrfRaw = await exec('pgAdmin.csrf_token');
  const csrf = csrfRaw.replace(/^"|"$/g, '');
  console.log('CSRF:', csrf.slice(0, 20) + '...');

  function xhrGet(path) {
    return `(function(){var x=new XMLHttpRequest();x.open('GET','${path}',false);x.setRequestHeader('X-pgA-CSRFToken','${csrf}');x.setRequestHeader('Accept','application/json');x.send();return x.status+':'+x.responseText.slice(0,500)})()`;
  }

  // Try underscore variant WITH CSRF
  for (const path of [
    '/browser/server_group/obj/',
    '/browser/server_group/nodes/1/',
    '/browser/server/nodes/1/',
    '/browser/server/obj/1/',
    '/browser/server/obj/1/1/',
  ]) {
    const r = await exec(xhrGet(path));
    console.log(`${path}:`, r.slice(0, 200));
  }

  // Try pgAdmin's Browser API → list everything
  const keys = await exec("JSON.stringify(Object.keys(pgAdmin.Browser).slice(0,30))");
  console.log('\npgAdmin.Browser keys:', keys);
})().catch(e => console.error(e.message ?? e));
