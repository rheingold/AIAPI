'use strict';
/**
 * pgadmin-inspect.js — drives BrowserWin via the running AIAPI MCP server to
 * navigate pgAdmin and expose login-form selector structure.
 *
 * Run: node tools/diag/pgadmin-inspect.js
 * Requires: MCP server running on port 3457, Chrome open with BrowserWin attached.
 */
const { mcpCall } = require('../../test/e2e/_shared');

const PGADMIN_URL = 'http://192.168.254.16:30056/';
const BROWSER     = process.env.BROWSER || 'chrome';

// Send a BrowserWin command with explicit path+value fields
function bwCmd(proc, action, path, value, timeout = 15000) {
  const args = { proc, action };
  if (path)  args.path  = String(path);
  if (value) args.value = String(value);
  return mcpCall('BrowserWin', args, timeout);
}

async function run() {
  // 1. LISTBROWSERS — discover live tab identifiers
  console.log('─── LISTBROWSERS ────────────────────────────────────────────');
  const lb = await bwCmd(BROWSER, 'LISTBROWSERS', '', '');
  console.log(JSON.stringify(lb, null, 2));

  // Try to extract first tab id from the result
  let tab = BROWSER;
  try {
    const raw = typeof lb === 'string' ? lb : (lb?.result ?? JSON.stringify(lb));
    const list = JSON.parse(raw);
    const first = Array.isArray(list) ? list[0] : null;
    if (first) tab = first.id ?? first.tabId ?? first.target ?? BROWSER;
  } catch { /* keep BROWSER default */ }
  console.log('\n→ using tab handle:', tab);

  // 2. NAVIGATE to pgAdmin login page
  console.log('\n─── NAVIGATE ────────────────────────────────────────────────');
  const nav = await bwCmd(tab, 'NAVIGATE', PGADMIN_URL, '', 15000);
  console.log(JSON.stringify(nav, null, 2));
  await sleep(3000);

  // 3. CDP — title + URL (confirm we're on the right page)
  console.log('\n─── CDP: title + URL ────────────────────────────────────────');
  const meta = await bwCmd(tab, 'CDP_EXECUTE', '',
    `JSON.stringify({title:document.title,url:location.href})`);
  console.log(JSON.stringify(meta, null, 2));

  // 4. CDP — enumerate all <input> elements (id / name / type / placeholder)
  console.log('\n─── CDP: inputs ─────────────────────────────────────────────');
  const inputs = await bwCmd(tab, 'CDP_EXECUTE', '',
    `JSON.stringify(Array.from(document.querySelectorAll('input')).map(i=>({id:i.id,name:i.name,type:i.type,placeholder:i.placeholder})))`);
  console.log(JSON.stringify(inputs, null, 2));

  // 5. CDP — enumerate buttons / submits
  console.log('\n─── CDP: buttons ────────────────────────────────────────────');
  const btns = await bwCmd(tab, 'CDP_EXECUTE', '',
    `JSON.stringify(Array.from(document.querySelectorAll('button,input[type=submit],[type=submit]')).map(b=>({tag:b.tagName,id:b.id,name:b.name,cls:b.className.split(' ').slice(0,3).join(' '),text:b.innerText?.trim().slice(0,60)})))`);
  console.log(JSON.stringify(btns, null, 2));

  // 6. PAGESOURCE — grab <form> region for deeper analysis
  console.log('\n─── PAGESOURCE (form region) ────────────────────────────────');
  const ps = await bwCmd(tab, 'PAGESOURCE', '', '', 15000);
  const src = typeof ps === 'string' ? ps : (ps?.result ?? JSON.stringify(ps));
  const fi  = src.indexOf('<form');
  console.log(fi >= 0 ? src.slice(fi, fi + 3000) : src.slice(0, 3000));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

run().catch(e => { console.error(e.message ?? e); process.exit(1); });
