'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
const B = 'brave.exe';
async function exec(js) {
  const r = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: js });
  if (!r?.success) throw new Error('EXEC: ' + JSON.stringify(r));
  return r.result;
}

(async () => {
  // Get CSRF token from pgAdmin global
  const csrf = await exec("pgAdmin.csrf_token");
  console.log('CSRF token:', csrf);

  const csrfVal = csrf.replace(/^"|"$/g, '');

  function xhrGet(path) {
    return `(function(){var x=new XMLHttpRequest();x.open('GET','${path}',false);x.setRequestHeader('X-pgA-CSRFToken','${csrfVal}');x.send();return x.status+':'+x.responseText.slice(0,600)})()`;
  }

  // List server groups
  const sg = await exec(xhrGet('/browser/server-group/obj/'));
  console.log('\n/server-group/obj/:', sg);

  // Try REST API
  const api = await exec(xhrGet('/api/v1/servers/'));
  console.log('\n/api/v1/servers/:', api);

  // Try alternate paths
  for (const p of ['/browser/server/nodes/', '/browser/server/obj/', '/browser/server/obj/1/']) {
    const r = await exec(xhrGet(p));
    console.log(`\n${p}:`, r);
  }
})().catch(e => console.error(e.message ?? e));
