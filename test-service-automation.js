// Quick test to verify service can actually perform UI automation
const http = require('http');

const SERVICE_PORT = 4457; // Production service port

function mcpCall(toolName, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    });
    const req = http.request({
      hostname: '127.0.0.1', port: SERVICE_PORT, path: '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const rpc = JSON.parse(data);
          if (rpc.error) return reject(new Error(`RPC error: ${JSON.stringify(rpc.error)}`));
          const result = rpc.result;
          if (result === undefined || result === null) return reject(new Error('Null result'));
          resolve(result);
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async function testServiceAutomation() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TESTING ACTUAL UI AUTOMATION ON DEPLOYED SERVICE');
  console.log('  Port:', SERVICE_PORT);
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    // First, list available tools
    console.log('Step 1: Listing available tools...');
    const listResult = await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        jsonrpc: '2.0', id: Date.now(),
        method: 'tools/list'
      });
      const req = http.request({
        hostname: '127.0.0.1', port: SERVICE_PORT, path: '/',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const rpc = JSON.parse(data);
            resolve(rpc.result);
          } catch (e) { reject(e); }
        });
      });
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    
    console.log('✓ Available tools:', listResult.tools?.length || 0);
    if (listResult.tools) {
      listResult.tools.forEach(t => console.log(`  - ${t.name}`));
    }
    
    // Now test LISTWINDOWS if KeyWin is available
    const hasKeyWin = listResult.tools?.some(t => t.name === 'KeyWin');
    if (!hasKeyWin) {
      console.log('\n✗ KeyWin tool NOT AVAILABLE!');
      console.log('⚠️ Helpers are NOT loaded - checking why...\n');
      
      // Call listHelpers to see what's going on
      try {
        const helpersInfo = await mcpCall('listHelpers', {});
        console.log('listHelpers result:', JSON.stringify(helpersInfo, null, 2));
      } catch (err) {
        console.log('listHelpers error:', err.message);
      }
      
      process.exit(1);
    }

    console.log('\nStep 2: Testing LISTWINDOWS (enumerate all open windows)');
    const result = await mcpCall('KeyWin', { action: 'LISTWINDOWS' });
    
    if (result && result.success !== false && !result.error) {
      console.log('✓ SUCCESS: UI automation is working!\n');
      console.log('Response type:', typeof result);
      console.log('Response keys:', Object.keys(result));
      
      const output = result.output || result.stdout || result.result || JSON.stringify(result);
      const preview = output.substring(0, 1000);
      console.log('\nFirst 1000 chars of output:');
      console.log('─'.repeat(60));
      console.log(preview);
      console.log('─'.repeat(60));
      console.log(`\nTotal output length: ${output.length} chars`);
      
      // Count windows in output
      const lineCount = output.split('\n').length;
      console.log(`Lines in output: ${lineCount}`);
      
      console.log('\n✅ SERVICE IS FULLY FUNCTIONAL - CAN PERFORM ACTUAL UI AUTOMATION!');
    } else {
      console.log('✗ FAILED:', result?.error || result?.message || JSON.stringify(result));
      console.log('\n⚠️ Service responds but may have issues with automation');
    }
  } catch (err) {
    console.error('✗ ERROR:', err.message);
    console.error(err);
    console.log('\n❌ SERVICE CANNOT PERFORM UI AUTOMATION');
    process.exit(1);
  }
})();
