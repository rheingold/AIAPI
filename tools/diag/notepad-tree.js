// Quick diagnostic: launch Notepad, QUERYTREE, find text area name
const { mcpCall, sleep } = require('../test/e2e/runner.js');
(async () => {
  await mcpCall('KeyWin', { action: 'LAUNCH', value: 'notepad.exe' }, 10000).catch(() => null);
  await sleep(1800);
  const lw = await mcpCall('KeyWin', { action: 'LISTWINDOWS' }, 8000).catch(e => ({ _e: e.message }));
  const np = (lw?.windows || []).find(w => (w.title || '').toLowerCase().includes('notepad'));
  if (!np) { console.log('No Notepad window:', JSON.stringify(lw?.windows?.map(w=>w.title))); process.exit(1); }
  console.log('Handle:', np.handle, '  Title:', np.title);
  const tree = await mcpCall('KeyWin', { action: 'QUERYTREE', proc: np.handle }, 12000).catch(e => ({ _e: e.message }));
  console.log(JSON.stringify(tree).substring(0, 3000));
})();
