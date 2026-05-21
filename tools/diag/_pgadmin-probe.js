'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
const B   = 'brave.exe';                           // process — for NAVIGATE
const TAB = 'chrome:TITLE:pgAdmin 4';              // CDP tab — for JS/DOM ops
function bwCmd(proc, action, path, value, t = 15000) {
  const a = { proc, action };
  if (path)  a.path  = String(path);
  if (value) a.value = String(value);
  return mcpCall('BrowserWin', a, t);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log('─── NAVIGATE ───────────────────────────────────────────────');
  console.log(JSON.stringify(
    await bwCmd(B, 'NAVIGATE', 'http://192.168.254.16:30056/', ''), null, 2));
  await sleep(3500);

  console.log('\n─── title + url ─────────────────────────────────────────────');
  console.log(JSON.stringify(
    await bwCmd(B, 'EXEC', '', 'JSON.stringify({title:document.title,url:location.href})'), null, 2));

  console.log('\n─── inputs ──────────────────────────────────────────────────');
  console.log(JSON.stringify(
    await bwCmd(B, 'EXEC', '',
      `JSON.stringify(Array.from(document.querySelectorAll('input')).map(i=>({id:i.id,name:i.name,type:i.type,ph:i.placeholder})))`),
    null, 2));

  console.log('\n─── buttons ─────────────────────────────────────────────────');
  console.log(JSON.stringify(
    await bwCmd(B, 'EXEC', '',
      `JSON.stringify(Array.from(document.querySelectorAll('button,input[type=submit]')).map(b=>({tag:b.tagName,id:b.id,cls:b.className.slice(0,80),txt:b.innerText?.trim().slice(0,60)})))`),
    null, 2));

  console.log('\n─── PAGESOURCE (form slice) ─────────────────────────────────');
  const ps  = await bwCmd(B, 'PAGESOURCE', '', '', 20000);
  const src = typeof ps === 'string' ? ps : (ps?.result ?? JSON.stringify(ps));
  const fi  = src.indexOf('<form');
  console.log(fi >= 0 ? src.slice(fi, fi + 3000) : src.slice(0, 3000));
})().catch(e => { console.error(e.message ?? e); process.exit(1); });
