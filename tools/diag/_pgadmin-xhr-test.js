'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
const B = 'brave.exe';
(async () => {
  // Check raw XHR response for server list
  const r = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value:
    "(function(){var x=new XMLHttpRequest();x.open('GET','/browser/server/children/0',false);x.send();return x.status+':'+x.responseText.slice(0,300)})()"
  });
  console.log('raw result:', JSON.stringify(r));

  // Also check if the /browser/ path gives a list endpoint
  const r2 = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value:
    "(function(){var x=new XMLHttpRequest();x.open('GET','/browser/server_group/obj/',false);x.send();return x.status+':'+x.responseText.slice(0,300)})()"
  });
  console.log('server_group:', JSON.stringify(r2));
})().catch(e => console.error(e.message ?? e));
