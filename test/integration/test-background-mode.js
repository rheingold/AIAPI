// test-background-mode.js
// Quick integration test for Session 0 background mode flag

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.argv[2] || 3457; // Default to dev port, can pass 4457 for service
const HOST = 'localhost';

console.log(`\n=== Testing Background Mode on port ${PORT} ===\n`);

async function testBackgroundMode() {
  const scenarioPath = path.join(__dirname, 'test-background-mode.xml');
  const scenarioXml = fs.readFileSync(scenarioPath, 'utf8');

  const postData = JSON.stringify({
    scenarioXml,
    verbose: true
  });

  const options = {
    hostname: HOST,
    port: PORT,
    path: '/api/scenario/execute-xml',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}\nRaw: ${data.slice(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  try {
    const result = await testBackgroundMode();
    
    console.log('Scenario execution result:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Steps: ${result.results?.length || 0}`);
    
    if (result.results) {
      result.results.forEach((step, idx) => {
        const icon = step.success ? '✓' : '✗';
        console.log(`  ${icon} Step ${idx + 1}: ${step.action} ${step.proc || ''} - ${step.success ? 'OK' : step.error || 'FAIL'}`);
      });
    }
    
    if (result.variables) {
      console.log('\nVariables captured:');
      Object.keys(result.variables).forEach(key => {
        const val = String(result.variables[key]).slice(0, 80);
        console.log(`  ${key} = ${val}`);
      });
    }
    
    const allPassed = result.success && result.results?.every(s => s.success);
    console.log(`\n${allPassed ? '✓ PASS' : '✗ FAIL'} Background mode test\n`);
    process.exit(allPassed ? 0 : 1);
    
  } catch (err) {
    console.error(`✗ ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
