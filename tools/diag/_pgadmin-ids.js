'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
const B = 'brave.exe';
async function exec(js) {
  const r = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: js });
  if (!r?.success) throw new Error('EXEC: ' + r.result);
  return r.result;
}

(async () => {
  const csrf = (await exec('pgAdmin.csrf_token')).replace(/^"|"$/g, '');

  function xhrGet(path) {
    return `(function(){var x=new XMLHttpRequest();x.open('GET','${path}',false);x.setRequestHeader('X-pgA-CSRFToken','${csrf}');x.setRequestHeader('Accept','application/json');x.send();return x.status+':'+x.responseText.slice(0,600)})()`;
  }

  // Try obj/ with sgid/sid combos
  for (const combo of ['2/1', '2/2', '1/1', '1/2']) {
    const r = await exec(xhrGet(`/browser/server/obj/${combo}/`));
    console.log(`/browser/server/obj/${combo}/:`, r.slice(0, 200));
  }

  // Also try: pgAdmin.Browser.Nodes.server or similar
  const nodeKeys = await exec("JSON.stringify(Object.keys(pgAdmin.Browser.Nodes||{}).slice(0,30))");
  console.log('\nBrowser.Nodes keys:', nodeKeys);

  // Check pgAdmin's URL helper
  const urlKeys = await exec("typeof pgAdmin.Browser.URL==='object'?JSON.stringify(pgAdmin.Browser.URL):''+pgAdmin.Browser.URL");
  console.log('\nBrowser.URL:', urlKeys?.slice(0, 400));
})().catch(e => console.error(e.message ?? e));
