'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
const B = 'brave.exe';
async function exec(js) {
  const r = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: js });
  if (!r?.success) throw new Error('EXEC: ' + r.result);
  return r.result;
}
function bw(action, path, value) {
  return mcpCall('BrowserWin', { proc: B, action, path: String(path||''), value: String(value||'') });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const csrf = (await exec('pgAdmin.csrf_token')).replace(/^"|"$/g, '');
  function xhrGet(path) {
    return `(function(){var x=new XMLHttpRequest();x.open('GET','${path}',false);x.setRequestHeader('X-pgA-CSRFToken','${csrf}');x.setRequestHeader('Accept','application/json');x.send();return x.status+':'+x.responseText})()`;
  }

  // Record baseline performance entries count
  const baseCount = await exec('performance.getEntriesByType("resource").length');
  console.log('Baseline network entry count:', baseCount);

  // Focus the browser tree panel and click it to focus
  // The object explorer panel has id "objectexplorer" or similar
  const panels = await exec('JSON.stringify(Array.from(document.querySelectorAll("[id],[data-testid]")).slice(0,30).map(e=>({id:e.id,dt:e.dataset?.testid,tag:e.tagName,cls:e.className.slice(0,40)})).filter(e=>e.id||e.dt))');
  console.log('Panels with IDs:', panels.slice(0, 600));

  // Try to focus the tree panel and navigate with keyboard
  await exec("(function(){var el=Array.from(document.querySelectorAll('[class*=file-tree],[class*=tree-container],[class*=objectexplorer]')).find(e=>e.textContent.includes('Servers'));if(el){el.focus();el.click();}return el?'focused':'not found'})()");
  await sleep(500);

  // Try arrow key to expand via SENDKEYS on the browser window
  // First CLICKID to focus the file-tree container
  const fc = await exec("(function(){var el=document.querySelector('.file-tree,.ReactVirtualized__List,[role=tree]');if(el){el.setAttribute('tabindex',0);el.focus();el.click();return el.tagName+'.'+el.className.slice(0,40);}return 'not found'})()");
  console.log('Tree focused:', fc);
  await sleep(500);

  // Send Right Arrow key via SENDKEYS (to expand the focused tree node)
  const sk = await bw('SENDKEYS', B, '{RIGHT}');
  console.log('SENDKEYS RIGHT:', JSON.stringify(sk));
  await sleep(2000);

  // Check performance entries for new calls
  const newEntries = await exec(`JSON.stringify(performance.getEntriesByType("resource").slice(${parseInt(baseCount)}).map(e=>e.name.replace(location.origin,"")));`);
  console.log('New network calls:', newEntries);

  // Check tree spans now
  const spans = await exec('JSON.stringify(Array.from(document.querySelectorAll("span.file-name")).map(e=>e.textContent.trim()).filter(Boolean))');
  console.log('Tree spans:', spans);

  // --- Now try to directly GET server obj with correct IDs using CSRF token ---
  // We know sgid=2 from /browser/server_group/obj/
  const sgid = 2;
  for (let sid = 1; sid <= 10; sid++) {
    const r = await exec(xhrGet(`/browser/server/obj/${sgid}/${sid}/`));
    const status = parseInt(r.split(':')[0]);
    if (status !== 404) {
      console.log(`\n✅ server sid=${sid} status=${status}:`, r.slice(0, 300));
    }
  }
})().catch(e => console.error(e.message ?? e));
