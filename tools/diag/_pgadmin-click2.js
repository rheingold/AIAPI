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
  // Intercept fetch
  await exec("window.__flog=[];var _f=window.fetch;window.fetch=function(){window.__flog.push([].slice.call(arguments,0,1).join('|').slice(0,100));return _f.apply(this,arguments)};'ok'");

  // Also intercept XHR
  await exec("window.__xlog=[];var _o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){window.__xlog.push(m+' '+u);return _o.apply(this,arguments)};'ok2'");

  console.log('Interceptors installed');

  // Synthesize a proper MouseEvent click on the Servers span
  const clickResult = await exec(
    "(function(){var el=Array.from(document.querySelectorAll('span.file-name')).find(e=>e.textContent.trim()==='Servers');if(!el)return 'not found';var ev=new MouseEvent('click',{bubbles:true,cancelable:true,view:window});el.dispatchEvent(ev);return 'dispatched'})()"
  );
  console.log('Click dispatched:', clickResult);
  await sleep(3000);

  // Check logs
  const fl = await exec('JSON.stringify(window.__flog.slice(0,20))');
  const xl = await exec('JSON.stringify(window.__xlog.slice(0,20))');
  console.log('fetch calls:', fl);
  console.log('XHR calls:', xl);

  // Check tree items now  
  const items = await exec('JSON.stringify(Array.from(document.querySelectorAll("span.file-name")).map(e=>e.textContent.trim()).filter(Boolean))');
  console.log('Tree spans after click:', items);
})().catch(e => console.error(e.message ?? e));
