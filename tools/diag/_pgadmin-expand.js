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
  function xhrGet(path) {
    return `(function(){var x=new XMLHttpRequest();x.open('GET','${path}',false);x.setRequestHeader('X-pgA-CSRFToken','${csrf}');x.setRequestHeader('Accept','application/json');x.send();return x.status+':'+x.responseText})()`;
  }

  // Find the Servers tree node in DOM and click it
  const serversEl = await exec(
    "JSON.stringify(Array.from(document.querySelectorAll('*')).filter(e=>e.children.length===0&&e.textContent.trim()==='Servers').slice(0,3).map(e=>({tag:e.tagName,cls:e.className.slice(0,80),pid:e.parentElement?.className?.slice(0,60)})))"
  );
  console.log('Servers elements:', serversEl);

  // Click via CLICKID with CSS (find element with text Servers and click its parent)
  const clicked = await exec(
    "(function(){var els=Array.from(document.querySelectorAll('*')).filter(e=>e.children.length===0&&e.textContent.trim()==='Servers');if(els.length){var p=els[0].closest('[role=treeitem],[class*=tree],[class*=node]')||els[0].parentElement;p.click();return 'clicked:'+p.className.slice(0,60);}return 'not found'})()"
  );
  console.log('Click result:', clicked);
  await sleep(2000);

  // Read tree items after expanding
  const items = await exec(
    "JSON.stringify(Array.from(document.querySelectorAll('[class*=tree] *,[role=treeitem]')).filter(e=>e.children.length===0&&e.textContent.trim().length>0&&e.textContent.trim().length<60).map(e=>e.textContent.trim()).filter((t,i,a)=>a.indexOf(t)===i).slice(0,30))"
  );
  console.log('Tree items after click:', items);

  // Also check if any XHR to /browser/server/ happened
  await sleep(1000);
  // Try to intercept what URL was called by scanning the XHR log we set up
  const sgid = 2;
  // Try different server IDs that might have been created
  for (let sid = 1; sid <= 5; sid++) {
    const r = await exec(xhrGet(`/browser/server/obj/${sgid}/${sid}/`));
    const status = parseInt(r.split(':')[0]);
    if (status !== 404) console.log(`\nserver obj sgid=${sgid} sid=${sid}:`, r.slice(0, 300));
  }
})().catch(e => console.error(e.message ?? e));
