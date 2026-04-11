const http = require('http');

async function mcpCall(method, args) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: { name: method, arguments: args }
        });

        const req = http.request({
            hostname: 'localhost',
            port: 3457,
            path: '/',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                const result = JSON.parse(body);
                if (result.error) reject(new Error(result.error.message));
                else resolve(result.result);
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

(async () => {
    try {
        console.log('Querying Calculator UI tree...\n');
        
        const tree = await mcpCall('queryTree', {
            providerName: 'windows-forms',
            targetId: 'CalculatorApp.exe',
            options: { maxDepth: 15 }
        });
        
        console.log(JSON.stringify(tree, null, 2));
        
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
})();
