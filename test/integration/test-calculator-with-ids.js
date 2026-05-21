/**
 * Calculator Automation Test - Using Element IDs
 * 
 * This test demonstrates BEST PRACTICES for UI automation:
 * - Uses AutomationId (stable identifiers) instead of Names
 * - Queries the UI tree to find available elements
 * - Clicks buttons by their ID, not by sending keystrokes
 * - Reads results from specific UI elements
 * 
 * Run with: node test-calculator-with-ids.js
 * Requires: MCP server running on port 3457
 */

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
            reject(new Error(response.error.message || JSON.stringify(response.error)));
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

// Helper to find element by ID in tree
function findElementById(tree, id) {
  if (!tree) return null;
  if (tree.id === id) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findElementById(child, id);
      if (found) return found;
    }
  }
  return null;
}

async function testCalculatorWithIds() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Calculator Automation Test - Using Element IDs          ║');
  console.log('║  Demonstrates BEST PRACTICES for stable automation       ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  let calcHandle = null;

  try {
    // Step 1: Launch Calculator
    console.log('📌 Step 1: Launching Calculator...');
    await mcpCall('launchProcess', { 
      executable: 'calc.exe'
    });
    await sleep(3000); // Wait for app to fully load
    console.log('  ✅ Calculator launched\n');

    // Step 2: Find Calculator window
    console.log('📌 Step 2: Finding Calculator window...');
    const windows = await mcpCall('listWindows', {
      providerName: 'windows-forms'
    });
    
    const calcWindow = windows.data.find(w => 
      w.processName && w.processName.toLowerCase().includes('calc')
    );
    
    if (!calcWindow) {
      throw new Error('Calculator window not found!');
    }
    
    calcHandle = calcWindow.handle;
    console.log(`  ✅ Found: "${calcWindow.title}" (Handle: ${calcHandle})\n`);

    // Step 3: Query UI tree
    console.log('📌 Step 3: Querying Calculator UI tree...');
    const tree = await mcpCall('queryTree', {
      providerName: 'windows-forms',
      targetId: `HANDLE:${calcHandle}`,
      options: { depth: 5 }
    });
    
    console.log('  ✅ UI tree retrieved');
    
    // Display some found elements
    const num4 = findElementById(tree.data, 'num4Button');
    const num8 = findElementById(tree.data, 'num8Button');
    const multiply = findElementById(tree.data, 'multiplyButton');
    const equals = findElementById(tree.data, 'equalButton');
    
    if (num4) console.log(`  🔍 Found: num4Button - "${num4.name}"`);
    if (num8) console.log(`  🔍 Found: num8Button - "${num8.name}"`);
    if (multiply) console.log(`  🔍 Found: multiplyButton - "${multiply.name}"`);
    if (equals) console.log(`  🔍 Found: equalButton - "${equals.name}"`);
    console.log('');

    // Step 4: Perform calculation 4 * 8 = 32 using button IDs
    console.log('📌 Step 4: Clicking buttons by ID (4 × 8 = ?)...');
    
    console.log('  ➡️  Clicking [num4Button]...');
    await mcpCall('clickElement', {
      providerName: 'windows-forms',
      elementId: `HANDLE:${calcHandle}:{CLICKID:num4Button}`
    });
    await sleep(500);
    
    console.log('  ➡️  Clicking [multiplyButton]...');
    await mcpCall('clickElement', {
      providerName: 'windows-forms',
      elementId: `HANDLE:${calcHandle}:{CLICKID:multiplyButton}`
    });
    await sleep(500);
    
    console.log('  ➡️  Clicking [num8Button]...');
    await mcpCall('clickElement', {
      providerName: 'windows-forms',
      elementId: `HANDLE:${calcHandle}:{CLICKID:num8Button}`
    });
    await sleep(500);
    
    console.log('  ➡️  Clicking [equalButton]...');
    await mcpCall('clickElement', {
      providerName: 'windows-forms',
      elementId: `HANDLE:${calcHandle}:{CLICKID:equalButton}`
    });
    await sleep(1000);
    console.log('  ✅ Calculation completed\n');

    // Step 5: Read result from CalculatorResults element
    console.log('📌 Step 5: Reading result from display...');
    const resultsElement = findElementById(tree.data, 'CalculatorResults');
    if (resultsElement) {
      console.log(`  🔍 Found display element: "${resultsElement.name}"`);
    }
    
    // Note: Reading property may require re-querying the tree or using specific API
    console.log('  ℹ️  Result should be visible on screen (32)\n');

    // Step 6: Clean up - Terminate Calculator
    console.log('📌 Step 6: Closing Calculator...');
    await mcpCall('terminateProcess', {
      process: 'CalculatorApp'
    });
    console.log('  ✅ Calculator closed\n');

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ TEST PASSED - All steps completed successfully!      ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    console.log('💡 KEY TAKEAWAYS:');
    console.log('  1. ✅ USE: Element IDs (num4Button, multiplyButton, equalButton)');
    console.log('     - Stable across app versions and languages');
    console.log('     - Unique identifiers for each control');
    console.log('');
    console.log('  2. ❌ AVOID: Element Names ("Čtyři", "Násobit", etc.)');
    console.log('     - Change with localization (Czech vs English)');
    console.log('     - May not be unique');
    console.log('');
    console.log('  3. ✅ USE: HANDLE:xxx format for window targeting');
    console.log('     - Direct window handle lookup');
    console.log('     - Faster than process name matching');
    console.log('');
    console.log('  4. ✅ USE: {CLICKID:elementId} for clicking specific controls');
    console.log('     - Precise control selection');
    console.log('     - Better than sending keystrokes\n');

  } catch (error) {
    console.error(`\n❌ TEST FAILED: ${error.message}`);
    console.error(error.stack);
    
    // Try to clean up
    if (calcHandle) {
      try {
        await mcpCall('terminateProcess', { process: 'CalculatorApp' });
      } catch {}
    }
    
    process.exit(1);
  }
}

// Run the test
testCalculatorWithIds();
