const http = require('http');

// Helper to make MCP JSON-RPC calls
function mcpCall(method, params = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 10000),
      method: 'tools/call',
      params: {
        name: method,
        arguments: params
      }
    });

    const options = {
      hostname: '127.0.0.1',
      port: 3457,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testCalculatorAutomation() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  MCP Server UI Automation Test             ║');
  console.log('║  Testing: Calculator automation           ║');
  console.log('╚════════════════════════════════════════════╝\n');

  try {
    // Step 1: Launch Calculator
    console.log('→ Step 1: Launching Calculator...');
    await mcpCall('launchProcess', { 
      executable: 'calc.exe'
    });
    await sleep(2000);
    console.log('  ✓ Calculator launched\n');

    // Step 2: List all windows
    console.log('→ Step 2: Listing all windows...');
    const windows = await mcpCall('listWindows');
    console.log(`  ✓ Found ${windows.data.length} windows`);
    const calcWindow = windows.data.find(w => w.processName === 'CalculatorApp');
    if (calcWindow) {
      console.log(`  ✓ Calculator found: PID=${calcWindow.processId}, Title="${calcWindow.title}"\n`);
    }

    // Step 3: Query Calculator UI tree
    console.log('→ Step 3: Querying Calculator UI tree...');
    const tree = await mcpCall('queryTree', {
      providerName: 'windowsForms',
      targetId: 'CalculatorApp',
      options: { depth: 3 }
    });
    console.log(`  ✓ UI tree retrieved (${JSON.stringify(tree.data).length} bytes)\n`);

    // Step 4: Send keystrokes - Calculate 8 * 7
    console.log('→ Step 4: Sending keystrokes "8*7="...');
    await mcpCall('clickElement', {
      providerName: 'windowsForms',
      elementId: 'CalculatorApp:8*7='
    });
    await sleep(1000);
    console.log('  ✓ Keystrokes sent\n');

    // Step 5: Read the result
    console.log('→ Step 5: Reading display value...');
    const result = await mcpCall('readProperty', {
      providerName: 'windowsForms',
      elementId: 'CalculatorApp',
      property: 'Text'
    });
    console.log(`  ✓ Result: "${result.data}"\n`);

    // Step 6: Clear and do another calculation
    console.log('→ Step 6: Clearing and calculating 15 + 25...');
    await mcpCall('clickElement', {
      providerName: 'windowsForms',
      elementId: 'CalculatorApp:{ESC}15+25='
    });
    await sleep(1000);
    
    const result2 = await mcpCall('readProperty', {
      providerName: 'windowsForms',
      elementId: 'CalculatorApp',
      property: 'Text'
    });
    console.log(`  ✓ Result: "${result2.data}"\n`);

    // Step 7: Terminate Calculator
    console.log('→ Step 7: Terminating Calculator...');
    await mcpCall('terminateProcess', {
      process: 'CalculatorApp'
    });
    console.log('  ✓ Calculator closed\n');

    console.log('╔════════════════════════════════════════════╗');
    console.log('║  ✓ All automation steps completed!        ║');
    console.log('╚════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error(`\n✗ Test failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

testCalculatorAutomation();
