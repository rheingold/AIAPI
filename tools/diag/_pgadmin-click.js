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
  const csrf = (await exec('pgAdmin.csrf_token')).replace(/^"|"$/g, '');

  // Install XHR interceptor
  await exec("window.__xlog=[];(function(){var o=XMLHttpRequest.prototype.open,s=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){this.__u=m+' '+u;return o.apply(this,arguments)};XMLHttpRequest.prototype.send=function(b){window.__xlog.push(this.__u+(b?'|'+String(b).slice(0,80):''));return s.apply(this,arguments)};return 'ok'})()");
  console.log('XHR interceptor installed');

  // Click directly on the SPAN.file-name that says 'Servers'
  const clickResult = await exec(
    "(function(){var el=Array.from(document.querySelectorAll('span.file-name')).find(e=>e.textContent.trim()==='Servers');if(!el)return 'not found';el.click();return 'clicked '+el.className})()"
  );
  console.log('Direct span click:', clickResult);
  await sleep(2000);

  // Read intercepted XHR calls
  const xhr1 = await exec('JSON.stringify(window.__xlog.slice(0,20))');
  console.log('XHR calls 1:', xhr1);

  // If no calls, try double-click or click the parent
  if (xhr1 === '[]' || xhr1 === 'null') {
    await exec("(function(){var el=Array.from(document.querySelectorAll('span.file-name')).find(e=>e.textContent.trim()==='Servers');if(!el)return 'x';var p=el.parentElement;if(p)p.click();return 'parent clicked'})()");
    await sleep(2000);
    const xhr2 = await exec('JSON.stringify(window.__xlog.slice(0,20))');
    console.log('XHR calls 2 (after parent click):', xhr2);
  }

  // Read tree items now
  const items = await exec(
    "JSON.stringify(Array.from(document.querySelectorAll('span.file-name')).map(e=>e.textContent.trim()).filter(t=>t.length))"
  );
  console.log('All tree file-name spans:', items);
})().catch(e => console.error(e.message ?? e));
