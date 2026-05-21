/**
 * bookmarks-cdp.js
 * Reads Brave/Chrome bookmarks directly from the profile Bookmarks JSON file.
 * No browser tabs are opened or navigated — zero side-effects.
 *
 * Usage: node tools/diag/bookmarks-cdp.js [port] [action] [arg]
 *   port   - CDP debug port used to discover the profile dir (default 9223)
 *            Pass 0 to skip discovery and use --profile flag directly.
 *   action - list | folders | folder <name> | search <query> | open <title>
 *   arg    - query string for search/folder/open actions
 *
 * Optional flags:
 *   --profile <dir>   Explicit profile directory (e.g. C:\Temp\brave-acc-profile)
 *
 * Examples:
 *   node tools/diag/bookmarks-cdp.js 9223 list
 *   node tools/diag/bookmarks-cdp.js 9223 folders
 *   node tools/diag/bookmarks-cdp.js 9223 folder "PROTOCOLS"
 *   node tools/diag/bookmarks-cdp.js 9223 search "kafka"
 *   node tools/diag/bookmarks-cdp.js 9223 open "PostgreSQL"
 *   node tools/diag/bookmarks-cdp.js 0 folder "PROTOCOLS" --profile "C:\Temp\brave-acc-profile"
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Parse args ──────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const PORT   = args[0] && !args[0].startsWith('--') ? args[0] : '9223';
const ACTION = args[1] && !args[1].startsWith('--') ? args[1] : 'list';
const ARG    = args[2] && !args[2].startsWith('--') ? args[2] : '';

let explicitProfile = null;
const pfIdx = args.indexOf('--profile');
if (pfIdx !== -1 && args[pfIdx + 1]) explicitProfile = args[pfIdx + 1];

// ── Locate profile dir ───────────────────────────────────────────────────────

/**
 * Discover profile dir by scanning the brave.exe process command line for
 * --remote-debugging-port=<port> then extracting --user-data-dir.
 * Falls back to common known paths.
 */
function discoverProfileDir(port) {
  try {
    const wmicOut = execSync(
      `wmic process where "name='brave.exe'" get CommandLine /format:list`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    for (const line of wmicOut.split(/\r?\n/)) {
      const cl = line.replace(/^CommandLine=/, '');
      if (!cl.includes(`--remote-debugging-port=${port}`)) continue;
      const m = cl.match(/--user-data-dir=([^\s"]+|"[^"]+")/);
      if (m) return m[1].replace(/^"|"$/g, '');
    }
  } catch (_) { /* WMIC unavailable */ }

  // Fallback: try common locations
  const candidates = [
    'C:\\Temp\\brave-acc-profile',
    path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware\\Brave-Browser\\User Data'),
    path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware\\Brave-Browser-Nightly\\User Data'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'Default', 'Bookmarks'))) return c;
  }
  return null;
}

// ── Read bookmarks file ──────────────────────────────────────────────────────

function loadBookmarks(profileDir) {
  const bkFile = path.join(profileDir, 'Default', 'Bookmarks');
  if (!fs.existsSync(bkFile)) throw new Error(`Bookmarks file not found: ${bkFile}`);
  return JSON.parse(fs.readFileSync(bkFile, 'utf8'));
}

// ── Tree utilities ───────────────────────────────────────────────────────────

function flatten(nodes, depth, parentId, results) {
  for (const n of (nodes || [])) {
    results.push({ id: n.id, parentId, depth, title: n.name || '', url: n.url || null });
    if (n.children) flatten(n.children, depth + 1, n.id, results);
  }
  return results;
}

function flattenRoot(data) {
  const results = [];
  for (const r of Object.values(data.roots || {})) {
    if (r && r.children) flatten(r.children, 0, r.id, results);
  }
  return results;
}

function bestMatch(nodes, q, wantUrl) {
  const matches = nodes.filter(n =>
    (wantUrl ? !!n.url : !n.url) && n.title.toLowerCase().includes(q)
  );
  if (!matches.length) return null;
  return matches.reduce((a, b) => a.title.length <= b.title.length ? a : b);
}

function printTree(nodes, depth) {
  for (const n of (nodes || [])) {
    const indent = '  '.repeat(depth);
    const icon   = n.url ? '🔗' : '📁';
    const url    = n.url ? ` → ${n.url.substring(0, 90)}` : '';
    console.log(`${indent}${icon} [${n.id}] ${n.title}${url}`);
    if (n.children) printTree(n.children, depth + 1);
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

function doList(data) {
  for (const r of Object.values(data.roots || {})) {
    if (r && r.children) printTree(r.children, 0);
  }
  const all = flattenRoot(data);
  console.log(`\nTotal: ${all.length} entries (${all.filter(n=>n.url).length} links, ${all.filter(n=>!n.url).length} folders)`);
}

function doFolders(data) {
  const all = flattenRoot(data);
  const folders = all.filter(n => !n.url);
  console.log(`\n=== Folders (${folders.length}) ===`);
  for (const f of folders) console.log('  '.repeat(f.depth) + `📁 [${f.id}] ${f.title}`);
}

function doFolder(data, arg) {
  const q = arg.toLowerCase();
  const all = flattenRoot(data);
  const folder = bestMatch(all, q, false);
  if (!folder) { console.log(`No folder found matching "${arg}"`); return; }
  const children = all.filter(n => n.parentId === folder.id);
  console.log(`\n📁 ${folder.title} (${children.length} items):`);
  for (const c of children) {
    const icon = c.url ? '🔗' : '📁';
    console.log(`  ${icon} [${c.id}] ${c.title}${c.url ? ' → ' + c.url.substring(0, 80) : ''}`);
  }
}

function doSearch(data, arg) {
  const q = arg.toLowerCase();
  const all = flattenRoot(data);
  const matches = all.filter(n =>
    n.title.toLowerCase().includes(q) || (n.url || '').toLowerCase().includes(q)
  );
  console.log(`\nSearch "${arg}" → ${matches.length} results:`);
  for (const m of matches) {
    const icon = m.url ? '🔗' : '📁';
    console.log('  '.repeat(m.depth) + `${icon} [${m.id}] ${m.title}${m.url ? ' → ' + m.url.substring(0,80) : ''}`);
  }
}

async function doOpen(data, arg) {
  const q   = arg.toLowerCase();
  const all = flattenRoot(data);
  let match = bestMatch(all, q, true);
  if (!match) {
    const folder = bestMatch(all, q, false);
    match = folder ? all.find(n => n.url && n.parentId === folder.id) : null;
  }
  if (!match) { console.log(`No bookmark found matching "${arg}"`); return; }
  console.log(`Opening: [${match.id}] ${match.title}`);
  console.log(`  URL: ${match.url}`);

  if (PORT === '0') { console.log('(No CDP port — cannot auto-navigate. Copy URL above.)'); return; }

  try {
    const res  = await fetch(`http://127.0.0.1:${PORT}/json`);
    const tabs = await res.json();
    // Navigate the most recently used non-chrome-internal tab
    const tab  = tabs.find(t => t.type === 'page' && !t.url.startsWith('chrome://'))
              || tabs.find(t => t.type === 'page');
    if (!tab) { console.log('No suitable tab found.'); return; }
    console.log(`Navigating tab: ${tab.title} (${tab.id})`);
    const WebSocket = require('ws');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: match.url } }));
    await new Promise(r => setTimeout(r, 800));
    ws.close();
    console.log('Done.');
  } catch (e) {
    console.log(`Cannot auto-navigate (${e.message}). URL: ${match.url}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let profileDir = explicitProfile;

  if (!profileDir) {
    process.stdout.write(`Locating profile (CDP port ${PORT})... `);
    profileDir = PORT !== '0' ? discoverProfileDir(PORT) : null;
    console.log(profileDir ? `found: ${profileDir}` : 'not found, trying known paths...');
    if (!profileDir) profileDir = discoverProfileDir('0');  // run fallback alone
  }

  if (!profileDir) {
    console.error('ERROR: Could not locate Brave profile directory. Use --profile <dir>.');
    process.exit(1);
  }

  let data;
  try {
    data = loadBookmarks(profileDir);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }

  console.log(`Bookmarks loaded from disk: ${path.join(profileDir, 'Default', 'Bookmarks')}`);

  if      (ACTION === 'list')    doList(data);
  else if (ACTION === 'folders') doFolders(data);
  else if (ACTION === 'folder')  doFolder(data, ARG);
  else if (ACTION === 'search')  doSearch(data, ARG);
  else if (ACTION === 'open')    await doOpen(data, ARG);
  else console.log('Unknown action. Use: list | folders | folder <name> | search <query> | open <title>');
}

main().catch(e => { console.error(e); process.exit(1); });
