'use strict';
const { mcpCall, kw, sleep } = require('./_shared');
(async () => {
  // Kill any existing notepad first
  await kw('notepad.exe', 'KILL', '', 5000).catch(() => null);
  await sleep(500);
  // Launch notepad
  const lr = await kw('notepad.exe', 'LAUNCH', '', 12000).catch(e => ({ _e: e.message }));
  console.log('LAUNCH:', JSON.stringify(lr));
  await sleep(2000);
  // List windows
  const lw = await mcpCall('KeyWin', { action: 'LISTWINDOWS' }, 8000).catch(e => ({ _e: e.message }));
  const handles = (lw?.windows || []);
  console.log('Windows:', JSON.stringify(handles.map(w => ({ h: w.handle, t: w.title, p: w.process }))));
  // Find notepad
  const np = handles.find(w =>
    /notepad|pozn[aá]mkov/i.test(w.title || '') ||
    (w.process || '').toLowerCase().includes('notepad')
  );
  if (!np) { console.log('No Notepad found'); process.exit(1); }
  console.log('Notepad handle:', np.handle, '  Title:', np.title);
  // QUERYTREE
  const tree = await mcpCall('KeyWin', { action: 'QUERYTREE', proc: np.handle }, 20000).catch(e => ({ _e: e.message }));
  console.log('QUERYTREE result:');
  console.log(JSON.stringify(tree, null, 2).substring(0, 6000));
})();
