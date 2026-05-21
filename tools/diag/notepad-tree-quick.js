'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
function walk(n, d) {
  if (!n) return;
  console.log(' '.repeat(d) + '[' + (n.id||'?') + '] type=' + (n.type||'?') + ' name="' + (n.name||'') + '"');
  (n.children || []).forEach(c => walk(c, d + 2));
}
mcpCall('KeyWin', { proc: 'HANDLE:4261696', action: 'QUERYTREE', value: '5' }, 12000)
  .then(r => walk(r.result || r, 0))
  .catch(e => console.log('err', e.message));
