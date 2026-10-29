// Smoke test: MCP search/fetch tools
// Run: node smoke-search-fetch.js
const http = require('http');

const BASE = 'http://127.0.0.1:3457';

function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Date.now();
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id });
    const req = http.request({
      hostname: '127.0.0.1', port: 3457,
      path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`Bad JSON: ${data.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('=== MCP Search/Fetch Smoke Tests ===\n');
  let passCount = 0;
  let failCount = 0;

  function report(name, ok) {
    if (ok) { passCount++; console.log(`    PASS\n`); }
    else { failCount++; console.log(`    FAIL\n`); }
  }

  // 1. _System SEARCH_WEB
  console.log('[1] _System SEARCH_WEB ...');
  try {
    const srch = await rpc('tools/call', {
      name: '_System',
      arguments: { action: 'SEARCH_WEB', query: 'Node.js TypeScript MCP server' }
    });
    // Result is wrapped in content[0].text as JSON string
    const text = srch?.result?.content?.[0]?.text || '';
    const parsed = JSON.parse(text);
    report('SEARCH_WEB', parsed.success === true);
    if (parsed.success) console.log(`    Engine: ${parsed.engine}, results: ${parsed.results?.length || 0}`);
  } catch(e) {
    report('SEARCH_WEB', false);
    console.log(`    Error: ${e.message}\n`);
  }

  // 2. _System FETCH_MARKDOWN
  console.log('[2] _System FETCH_MARKDOWN ...');
  try {
    const fm = await rpc('tools/call', {
      name: '_System',
      arguments: { action: 'FETCH_MARKDOWN', proc: 'https://example.com' }
    });
    const text = fm?.result?.content?.[0]?.text || '';
    const parsed = JSON.parse(text);
    report('FETCH_MARKDOWN', parsed.success === true && parsed.content?.length > 0);
    if (parsed.success) console.log(`    Content length: ${parsed.content.length}`);
  } catch(e) {
    report('FETCH_MARKDOWN', false);
    console.log(`    Error: ${e.message}\n`);
  }

  // 3. _System FETCH_JSON
  console.log('[3] _System FETCH_JSON ...');
  try {
    const fj = await rpc('tools/call', {
      name: '_System',
      arguments: { action: 'FETCH_JSON', proc: 'https://jsonplaceholder.typicode.com/posts/1' }
    });
    const text = fj?.result?.content?.[0]?.text || '';
    const parsed = JSON.parse(text);
    report('FETCH_JSON', parsed.success === true && parsed.json !== undefined);
    if (parsed.success) console.log(`    JSON keys: ${Object.keys(parsed.json).join(', ')}`);
  } catch(e) {
    report('FETCH_JSON', false);
    console.log(`    Error: ${e.message}\n`);
  }

  // 4. _System FETCH_TXT
  console.log('[4] _System FETCH_TXT ...');
  try {
    const ft = await rpc('tools/call', {
      name: '_System',
      arguments: { action: 'FETCH_TXT', proc: 'https://example.com' }
    });
    const text = ft?.result?.content?.[0]?.text || '';
    const parsed = JSON.parse(text);
    report('FETCH_TXT', parsed.success === true && parsed.content?.length > 0);
  } catch(e) {
    report('FETCH_TXT', false);
    console.log(`    Error: ${e.message}\n`);
  }

  // 5. _System FETCH_HTML
  console.log('[5] _System FETCH_HTML ...');
  try {
    const fh = await rpc('tools/call', {
      name: '_System',
      arguments: { action: 'FETCH_HTML', proc: 'https://example.com' }
    });
    const text = fh?.result?.content?.[0]?.text || '';
    const parsed = JSON.parse(text);
    report('FETCH_HTML', parsed.success === true && parsed.content?.toLowerCase().includes('<!doctype'));
  } catch(e) {
    report('FETCH_HTML', false);
    console.log(`    Error: ${e.message}\n`);
  }

  // 6. getHelperSchema - verify _System has SEARCH_WEB + FETCH_* commands
  console.log('[6] getHelperSchema _System ...');
  try {
    const schema = await rpc('tools/call', {
      name: 'getHelperSchema',
      arguments: { helperName: '_System' }
    });
    const text = schema?.result?.content?.[0]?.text || '';
    const parsed = JSON.parse(text);
    const cmds = parsed.schema?.commands || [];
    const hasSearch = cmds.includes('search_web');
    const hasFetchMd = cmds.includes('fetch_markdown');
    const hasFetchJson = cmds.includes('fetch_json');
    report('getHelperSchema', hasSearch && hasFetchMd && hasFetchJson);
    console.log(`    search_web: ${hasSearch}, fetch_markdown: ${hasFetchMd}, fetch_json: ${hasFetchJson}`);
  } catch(e) {
    report('getHelperSchema', false);
    console.log(`    Error: ${e.message}\n`);
  }

  console.log(`\n=== Smoke tests complete: ${passCount} passed, ${failCount} failed ===`);
})().catch(e => console.error('Fatal:', e));
