const http = require('http');

// Delay helper
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// MCP JSON-RPC 2.0 call
function mcpCall(method, params = {}) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
                name: method,
                arguments: params
            }
        });

        const options = {
            hostname: 'localhost',
            port: 3457,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
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
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function testCalculatorSlowly() {
    console.log('\n🧪 Testing Calculator UI Automation - SLOW MODE\n');
    
    try {
        // Step 1: Launch Calculator
        console.log('1️⃣  Launching Calculator...');
        await mcpCall('launchProcess', { executable: 'calc.exe' });
        console.log('   ⏱️  Waiting 3 seconds for Calculator to open...\n');
        await delay(3000);

        // Step 2: List windows
        console.log('2️⃣  Finding Calculator window...');
        const windowsResult = await mcpCall('listWindows');
        console.log(`   ´┐Ż Found ${windowsResult.windows.length} windows`);
        const calcWindow = windowsResult.windows.find(w => 
            w.title.toLowerCase().includes('calc') || w.title.toLowerCase().includes('kalkula')
        );
        
        if (!calcWindow) {
            throw new Error('Calculator window not found');
        }
        console.log(`   Ôťô Found: ${calcWindow.title} (PID: ${calcWindow.pid})`);
        console.log('   ⏱️  Waiting 2 seconds...\n');
        await delay(2000);

        // Step 3: Query UI tree
        console.log('3️⃣  Querying Calculator UI tree...');
        const tree = await mcpCall('queryTree', { 
            providerName: 'windows-forms',
            targetId: 'CalculatorApp.exe',
            options: { maxDepth: 15 }
        });
        console.log('   ✓ UI tree retrieved');
        console.log('   ⏱️  Waiting 2 seconds...\n');
        await delay(2000);

        // Step 4: Type "2"
        console.log('4️⃣  Typing "2"...');
        await mcpCall('clickElement', {
            providerName: 'windows-forms',
            elementId: 'CalculatorApp.exe:2'
        });
        console.log('   ✓ Typed!');
        console.log('   ⏱️  Waiting 2 seconds...\n');
        await delay(2000);

        // Step 5: Type "+"
        console.log('5️⃣  Typing "+"...');
        await mcpCall('clickElement', {
            providerName: 'windows-forms',
            elementId: 'CalculatorApp.exe:+'
        });
        console.log('   ✓ Typed!');
        console.log('   ⏱️  Waiting 2 seconds...\n');
        await delay(2000);

        // Step 6: Type "3"
        console.log('6️⃣  Typing "3"...');
        await mcpCall('clickElement', {
            providerName: 'windows-forms',
            elementId: 'CalculatorApp.exe:3'
        });
        console.log('   Ôťô Typed!');
        console.log('   ⏱️  Waiting 2 seconds...\n');
        await delay(2000);

        // Step 7: Type "="
        console.log('7´ŞĆÔâú  Typing "="...');
        await mcpCall('clickElement', {
            providerName: 'windows-forms',
            elementId: 'CalculatorApp.exe:='
        });
        console.log('   ✓ Clicked!');
        console.log('   ⏱️  Waiting 2 seconds...\n');
        await delay(2000);

        // Step 8: Read result
        console.log('8️⃣  Reading display value...');
        const result = await mcpCall('readProperty', {
            providerName: 'windows-forms',
            elementId: 'CalculatorApp.exe',
            propertyName: 'Name'
        });
        console.log('   Result:', JSON.stringify(result, null, 2));
        console.log('   ⏱️  Waiting 3 seconds...\n');
        await delay(3000);

        // Step 9: Terminate
        console.log('9️⃣  Terminating Calculator...');
        await mcpCall('terminateProcess', { 
            processName: 'CalculatorApp.exe' 
        });
        console.log('   ✓ Process terminated\n');

        console.log('✅ Test completed successfully!\n');

    } catch (err) {
        console.error('\n❌ Test failed:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

testCalculatorSlowly();
