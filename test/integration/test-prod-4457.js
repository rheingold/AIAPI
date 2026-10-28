/**
 * Quick smoke test against production server (port 4457)
 */
'use strict';

const http = require('http');
const fs = require('fs');

const MCP_PORT = 4457;
const TEST_FILE = 'C:\\Users\\plachy\\AppData\\Local\\Temp\\aia_test_ps.ps1';

function mcpCall(args) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
                name: 'AutomateUI',
                arguments: args
            }
        });
        const req = http.request({
            hostname: '127.0.0.1',
            port: MCP_PORT,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const rpc = JSON.parse(data);
                    if (rpc.error) return reject(new Error(JSON.stringify(rpc.error)));
                    const text = rpc.result?.content?.[0]?.text;
                    if (text) {
                        try { resolve(JSON.parse(text)); } catch { resolve(text); }
                    } else { resolve(rpc.result); }
                } catch (e) { reject(e); }
            });
        });
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function main() {
    console.log('Testing against production server (port', MCP_PORT, ')\n');
    
    // Test 1: Write PowerShell with $, backticks, quotes
    const psContent = `$greeting = "Hello, World!"
$number = 42
$path = "C:\\Users\\test\\Documents"
\$escaped = "not a variable"
Write-Host "$greeting $number"
echo "line1\`nline2"
$doubleQuoted = "She said ""hello"""
Get-Process | Where-Object { \$_.CPU -gt 100 }`;

    console.log('1. Writing PowerShell content with $, \`, quotes...');
    const writeResult = await mcpCall({
        helper: '_System',
        action: 'FS_WRITE',
        path: TEST_FILE,
        value: psContent
    });
    console.log('   Write result:', writeResult.success ? 'OK' : writeResult);
    
    // Test 2: Read back and verify
    console.log('2. Reading back...');
    const readResult = await mcpCall({
        helper: '_System',
        action: 'FS_READ',
        path: TEST_FILE
    });
    
    const returned = readResult.value;
    console.log('3. Verifying content integrity...');
    
    let passed = 0, failed = 0;
    const checks = [
        ['$greeting', returned.includes('$greeting')],
        ['$number', returned.includes('$number')],
        ['$_.CPU', returned.includes('$_.CPU')],
        ['Not backtick-escaped', !returned.includes('`\$greeting')],
        ['Backtick n', returned.includes('`n')],
        ['Nested quotes', returned.includes('""hello""')],
        ['Path preserved', returned.includes('C:\\Users\\test\\Documents')],
    ];
    
    for (const [name, ok] of checks) {
        if (ok) { console.log(`   ✅ ${name}`); passed++; }
        else { console.log(`   ❌ ${name}`); failed++; }
    }
    
    // Cleanup
    try { fs.unlinkSync(TEST_FILE); } catch {}
    
    console.log(`\nResult: ${passed}/${checks.length} checks passed`);
    if (failed > 0) {
        console.log('\nReturned content:');
        console.log(returned);
        process.exit(1);
    }
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
