'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
const B = 'brave.exe';
async function exec(js) {
  const r = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: js });
  if (!r?.success) throw new Error('EXEC: ' + JSON.stringify(r));
  return r.result;
}
function xhrGet(path, token) {
  return `(function(){var x=new XMLHttpRequest();x.open('GET','${path}',false);${token?`x.setRequestHeader('X-pgA-CSRFToken','${token}');`:''}x.send();return x.status+':'+x.responseText.slice(0,400)})()`;
}

(async () => {
  // 1. Check CSRF cookie / meta
  const csrf = await exec("document.cookie.split(';').find(c=>c.trim().startsWith('pgA_CSRF_TOKEN'))?.split('=')[1]?.trim()||''");
  console.log('CSRF cookie:', csrf);

  // 2. Try server_group list with CSRF
  const sg = await exec(xhrGet('/browser/server_group/obj/', csrf));
  console.log('/server_group/obj/:', sg);

  // 3. Try /browser/ tree root
  const root = await exec(xhrGet('/browser/', csrf));
  console.log('/browser/:', root?.slice(0, 300));

  // 4. Intercept: what XHR calls does pgAdmin make in the page?
  // List all XHR requests made after page load via pgAdmin's internals
  const routes = await exec(
    "JSON.stringify(Object.keys(window).filter(k=>k.toLowerCase().includes('url')||k.toLowerCase().includes('api')||k.toLowerCase().includes('route')).slice(0,30))"
  );
  console.log('API-related globals:', routes);

  // 5. Check pgAdmin's url_for or URLS object
  const pgUrls = await exec("typeof pgAdmin!=='undefined'?JSON.stringify(Object.keys(pgAdmin).slice(0,30)):'no pgAdmin'");
  console.log('pgAdmin keys:', pgUrls);
})().catch(e => console.error(e.message ?? e));
