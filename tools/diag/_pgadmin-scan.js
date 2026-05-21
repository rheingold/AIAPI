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

  // Scan server IDs 1..10 under sgid=2
  for (let sid = 1; sid <= 10; sid++) {
    const r = await exec(xhrGet(`/browser/server/obj/2/${sid}/`));
    const status = r.split(':')[0];
    if (status !== '404') console.log(`sid=${sid}:`, r.slice(0, 200));
  }

  // Also try DOM reading: look for tree item containing server name
  const treeItems = await exec(
    "JSON.stringify(Array.from(document.querySelectorAll('[class*=tree] [role=treeitem],.file-name,.agtree-node,li.pg-browser-tree-item,[data-label]')).slice(0,20).map(e=>e.textContent?.trim()?.slice(0,60)).filter(Boolean))"
  );
  console.log('\nTree items in DOM:', treeItems);

  // pgAdmin 4 tree is React-based - look for specific data attributes
  const nodes = await exec(
    "JSON.stringify(Array.from(document.querySelectorAll('[data-id],[data-node],.pg-el-selected,.agtree-node-row,div[class*=\"tree-item\"]')).slice(0,15).map(e=>({cls:e.className.slice(0,60),txt:e.textContent?.trim()?.slice(0,40),attr:JSON.stringify(Object.fromEntries([...e.attributes].map(a=>[a.name,a.value.slice(0,60)])))?.slice(0,120)})))"
  );
  console.log('\nData nodes:', nodes);
})().catch(e => console.error(e.message ?? e));
