'use strict';
// Standalone runner for d20 against port 4457
process.env.MCP_PORT = '4457';
const { run } = require('./d20-service-mode');
run().then(r => {
  console.log(JSON.stringify(r));
  process.exit(r.failed > 0 ? 1 : 0);
}).catch(e => { console.error(e); process.exit(2); });
