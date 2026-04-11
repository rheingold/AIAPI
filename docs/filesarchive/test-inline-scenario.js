const http = require('http');

// Simple inline scenario - Calculator test
const scenario = {
  "name": "Quick Calculator Test",
  "steps": [
    {
      "action": "launchProcess",
      "params": {
        "executable": "calc.exe",
        "waitSeconds": 2
      }
    },
    {
      "action": "findWindow",
      "params": {
        "processName": "CalculatorApp",
        "storeAs": "calcWindow"
      }
    },
    {
      "action": "sendKeys",
      "params": {
        "target": "$calcWindow",
        "keys": "5+3="
      }
    },
    {
      "action": "readValue",
      "params": {
        "target": "$calcWindow",
        "storeAs": "result"
      }
    },
    {
      "action": "log",
      "params": {
        "message": "Calculator result: $result"
      }
    }
  ]
};

console.log('\n=== Testing MCP Server with Inline Scenario ===\n');

const postData = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'executeScenario',
    arguments: {
      scenarioJson: scenario,
      verbose: true
    }
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
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('\nMCP Server Response:');
    console.log(JSON.stringify(JSON.parse(data), null, 2));
    console.log('\n✓ Test complete!');
  });
});

req.on('error', (e) => {
  console.error(`Request error: ${e.message}`);
});

req.write(postData);
req.end();
