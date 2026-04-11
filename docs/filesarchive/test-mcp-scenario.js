// Test MCP server scenario execution
const http = require('http');

const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
        name: 'executeScenario',
        arguments: {
            scenarioPath: 'scenarios/calculator-basic.json',
            verbose: true
        }
    }
};

const options = {
    hostname: '127.0.0.1',
    port: 3457,
    path: '/',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    }
};

const req = http.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('\n=== MCP Server Response ===');
        const response = JSON.parse(data);
        console.log(JSON.stringify(response, null, 2));
        
        if (response.result) {
            console.log('\n=== Scenario Result ===');
            console.log(`Success: ${response.result.success ? '✓' : '✗'}`);
            console.log(`Duration: ${response.result.duration}ms`);
            console.log(`Steps: ${response.result.steps?.length || 0}`);
            
            if (response.result.steps) {
                console.log('\nStep Results:');
                response.result.steps.forEach((step, i) => {
                    console.log(`  [${i + 1}] ${step.description}: ${step.success ? '✓' : '✗'}`);
                });
            }
        }
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(JSON.stringify(request));
req.end();
