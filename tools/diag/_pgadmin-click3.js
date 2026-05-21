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
  // Check performance entries BEFORE click (baseline)
  const before = await exec('JSON.stringify(performance.getEntriesByType("resource").slice(-5).map(e=>e.name.replace(location.origin,"")))');
  console.log('Network entries before:', before);

  // Use BrowserWin CLICKID with CSS to click 'Servers' tree item
  const r1 = await bw('CLICKID', 'span.file-name', '');
  console.log('CLICKID result:', JSON.stringify(r1));
  await sleep(2500);

  // Check performance entries AFTER click
  const after = await exec('JSON.stringify(performance.getEntriesByType("resource").slice(-10).map(e=>e.name.replace(location.origin,"")))');
  console.log('Network entries after:', after);

  // Check tree spans now
  const spans = await exec('JSON.stringify(Array.from(document.querySelectorAll("span.file-name")).map(e=>e.textContent.trim()).filter(Boolean))');
  console.log('Tree spans:', spans);
})().catch(e => console.error(e.message ?? e));
