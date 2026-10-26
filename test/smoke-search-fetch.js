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

  // 1. tools/list - verify new tools exist
  console.log('[1] tools/list ...');
  const tools = await rpc('tools/list');
  const toolNames = tools.result.tools.map(t => t.name);
  const expected = ['brave_search', 'local_search', 'fetch_markdown', 'fetch_txt', 'fetch_html', 'fetch_json'];
  const found = expected.filter(n => toolNames.includes(n));
  console.log(`    Expected tools: ${expected.join(', ')}`);
  console.log(`    Found: ${found.join(', ')}`);
  console.log(`    ${found.length === expected.length ? 'PASS' : 'FAIL'}\n`);

  // 2. _System SEARCH_WEB
  console.log('[2] _System SEARCH_WEB ...');
  try {
    const srch = await rpc('tools/call', {
      name: '_System',
      arguments: { action: 'SEARCH_WEB', query: 'Node.js TypeScript MCP server' }
    });
    if (srch.result && srch.result.items && srch.result.items.length > 0) {
      console.log(`    Got ${srch.result.items.length} results`);
      console.log(`    First: ${srch.result.items[0].title}`);
      console.log('    PASS\n');
    } else {
      console.log('    No results returned\n');
    }
  } catch(e) {
    console.log(`    FAIL: ${e.message}\n`);
  }

  // 3. brave_search standalone
  console.log('[3] brave_search ...');
  try {
    const bs = await rpc('tools/call', {
      name: 'brave_search',
      arguments: { query: 'AIAPI MCP server' }
    });
    if (bs.result && bs.result.items) {
      console.log(`    Got ${bs.result.items.length} results`);
      console.log('    PASS\n');
    } else {
      console.log('    No results\n');
    }
  } catch(e) {
    console.log(`    FAIL: ${e.message}\n`);
  }

  // 4. fetch_markdown
  console.log('[4] fetch_markdown ...');
  try {
    const fm = await rpc('tools/call', {
      name: 'fetch_markdown',
      arguments: { url: 'https://example.com' }
    });
    if (fm.result && fm.result.content) {
      console.log(`    Content length: ${fm.result.content.length}`);
      console.log('    PASS\n');
    } else {
      console.log('    No content\n');
    }
  } catch(e) {
    console.log(`    FAIL: ${e.message}\n`);
  }

  // 5. fetch_json
  console.log('[5] fetch_json ...');
  try {
    const fj = await rpc('tools/call', {
      name: 'fetch_json',
      arguments: { url: 'https://jsonplaceholder.typicode.com/posts/1' }
    });
    if (fj.result && fj.result.data) {
      console.log(`    Got JSON: ${JSON.stringify(fj.result.data).slice(0,100)}...`);
      console.log('    PASS\n');
    } else {
      console.log('    No JSON data\n');
    }
  } catch(e) {
    console.log(`    FAIL: ${e.message}\n`);
  }

  // 6. getHelperSchema - _System shows new commands
  console.log('[6] getHelperSchema _System ...');
  try {
    const schema = await rpc('tools/call', {
      name: 'getHelperSchema',
      arguments: { helperName: '_System' }
    });
    if (schema.result && schema.result.inputSchema) {
      const actions = schema.result.inputSchema.properties.action.enum;
      const hasSearch = actions.includes('SEARCH_WEB');
      const hasFetch = actions.includes('FETCH_MARKDOWN');
      console.log(`    SEARCH_WEB in schema: ${hasSearch}`);
      console.log(`    FETCH_MARKDOWN in schema: ${hasFetch}`);
      console.log(`    ${hasSearch && hasFetch ? 'PASS' : 'FAIL'}\n`);
    }
  } catch(e) {
    console.log(`    FAIL: ${e.message}\n`);
  }

  console.log('=== Smoke tests complete ===');
})().catch(e => console.error('Fatal:', e));
