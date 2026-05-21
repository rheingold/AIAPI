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
    return `(function(){var x=new XMLHttpRequest();x.open('GET','${path}',false);x.setRequestHeader('X-pgA-CSRFToken','${csrf}');x.setRequestHeader('Accept','application/json');x.send();return x.status+':'+x.responseText.slice(0,800)})()`;
  }
  function xhrPost(path, body) {
    return `(function(){var x=new XMLHttpRequest();x.open('POST','${path}',false);x.setRequestHeader('Content-Type','application/json');x.setRequestHeader('X-pgA-CSRFToken','${csrf}');x.send('${body}');return x.status+':'+x.responseText.slice(0,800)})()`;
  }

  // sgid=2 exists. Try listing servers with sgid=2
  console.log('--- server obj with sgid=2 ---');
  console.log(await exec(xhrGet('/browser/server/obj/2/')));

  // Try pgAdmin.Browser.tree to get tree
  console.log('\n--- pgAdmin.Browser.tree type ---');
  console.log(await exec("typeof pgAdmin.Browser.tree"));

  // Try to find servers via pgAdmin internals
  console.log('\n--- Nodes.server ---');
  const ns = await exec("JSON.stringify(Object.keys(pgAdmin.Browser.Nodes['server']||{}))");
  console.log(ns.slice(0, 400));

  // Try browser tree state (node paths stored client-side)
  console.log('\n--- browserTreeState ---');
  const ts = await exec("typeof pgAdmin.Browser.browserTreeState==='object'?JSON.stringify(Object.keys(pgAdmin.Browser.browserTreeState)).slice(0,300):String(pgAdmin.Browser.browserTreeState)");
  console.log(ts);
})().catch(e => console.error(e.message ?? e));
