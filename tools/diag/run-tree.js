'use strict';
// Direct diagnostic using MCP JSON-RPC (same as test/_shared.js kw())
const http = require('http');
const PORT = 3457; // MCP port

function rpc(toolName, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name: toolName, arguments: args } });
    const req = http.request({ hostname:'127.0.0.1', port: PORT, path:'/', method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e){ reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
function result(r) {
  const t = r?.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return t; }
}

(async () => {
  // 0. Launch Notepad fresh
  console.log('Launching Notepad...');
  await rpc('KeyWin', { action:'LAUNCH', proc:'notepad.exe', path:'' }).catch(()=>null);
  await new Promise(r => setTimeout(r, 9000));

  // 1. LISTWINDOWS — find Notepad hwnd (no filter = all windows)
  const lwRaw = await rpc('KeyWin', { action:'LISTWINDOWS', proc:'SYSTEM', path:'' });
  const lw = result(lwRaw);
  console.log('All windows:', JSON.stringify(lw?.windows?.map(w=>({h:w.handle,t:w.title})))); 
  const entry = (lw?.windows||[]).find(w => /notepad|pozn|textov/i.test(w.title||''));
  const hwnd = entry?.handle;
  console.log('hwnd:', hwnd, '  title:', entry?.title);
  if (!hwnd) { console.log('No Notepad window found'); process.exit(1); }

  // 2. QUERYTREE depth 5 on the hwnd
  const tree = result(await rpc('KeyWin', { action:'QUERYTREE', proc: hwnd, path:'5' }));
  const s = JSON.stringify(tree, null, 2);
  require('fs').writeFileSync('docs/filesarchive/notepad-tree.json', s);
  console.log('Written notepad-tree.json (' + s.length + ' bytes)');
  const ids = (s.match(/"id"\s*:\s*"([^"]+)"/g)||[]).map(x=>x.replace(/.*"/, '').replace(/"$/, '')).filter(Boolean);
  console.log('IDs:', ids.join(', '));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
