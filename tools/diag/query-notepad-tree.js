'use strict';
/**
 * Diagnostic: capture Notepad UIA tree via QUERYTREE.
 * Run: node tools/diag/query-notepad-tree.js
 */
const { kw, sleep } = require('../../test/e2e/_shared');

(async () => {
  process.stdout.write('Launching Notepad...\n');
  await kw({ action: 'LAUNCH', proc: 'notepad.exe', path: '' }).catch(() => null);
  await sleep(8000);

  const lw = await kw({ action: 'LISTWINDOWS', proc: 'SYSTEM', path: 'notepad|pozn|textov' });
  const entry = lw?.windows?.[0];
  const hwnd = entry?.handle;
  process.stdout.write('hwnd: ' + hwnd + '  title: ' + entry?.title + '\n');
  if (!hwnd) { console.log('FULL LW:', JSON.stringify(lw)); process.exit(1); }

  const tree = await kw({ action: 'QUERYTREE', proc: hwnd, path: '5' }).catch(e => ({ _e: e.message }));
  const s = JSON.stringify(tree, null, 2);
  require('fs').writeFileSync('docs/filesarchive/notepad-tree.json', s);
  process.stdout.write('Written docs/filesarchive/notepad-tree.json  (' + s.length + ' bytes)\n');

  const ids = (s.match(/"id"\s*:\s*"([^"]+)"/g) || []).map(x => x.replace(/.*"id"\s*:\s*"/, '').replace(/"$/, ''));
  process.stdout.write('AutomationIds:\n  ' + ids.join('\n  ') + '\n');
})().catch(e => { console.error(e); process.exit(1); });
