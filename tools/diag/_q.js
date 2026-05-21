'use strict';
// One-shot MCP query helper — edit `js` below and run: node tools/diag/_q.js
const { mcpCall } = require('../../test/e2e/_shared');
const js = process.argv[2] || 'location.href';
mcpCall('BrowserWin', { proc: 'brave.exe', action: 'EXEC', path: '', value: js })
  .then(r => console.log(r?.result ?? JSON.stringify(r)))
  .catch(e => console.error(e.message ?? e));
