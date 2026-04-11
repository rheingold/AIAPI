// Setup security configuration with real binary hashes
const fs = require('fs');
const path = require('path');
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const { CertificateManager } = require('./dist/security/CertificateManager');

async function setupSecurity() {
    console.log('\n=== Security Setup ===\n');
    
    const password = 'DemoPassword123!';
    const securityDir = path.join(__dirname, 'security');
    
    // Step 1: Generate certificates
    console.log('1. Generating RSA-4096 certificates...');
    const certManager = new CertificateManager(securityDir);
    await certManager.initialize(password, password);
    console.log('   ✓ Private key: security/private.key.enc');
    console.log('   ✓ Public key: security/public.key.enc');
    
    // Step 2: Create config
    console.log('\n2. Creating configuration...');
    const configPath = path.join(securityDir, 'config.json');
    const config = {
        version: '1.0',
        security: {
            defaultPolicy: 'DENY_UNLISTED',
            requireTargetSignature: true
        },
        processes: {
            whitelist: ['notepad.exe', 'calc.exe'],
            blacklist: ['cmd.exe', 'powershell.exe']
        },
        developmentMode: {
            enabled: false
        }
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('   ✓ Configuration created');
    
    // Step 3: Sign config and add binary hashes
    console.log('\n3. Signing configuration and adding binary hashes...');
    const signer = new ConfigSigner(securityDir);
    const result = await signer.signConfig(password, true);
    
    console.log('   ✓ Configuration signed with RSA-SHA256');
    console.log(`   ✓ Signature: ${result.signature.substring(0, 32)}...`);
    console.log(`   ✓ Config hash: ${result.configHash.substring(0, 16)}...`);
    
    // Read the updated config to show binary hashes
    const finalConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (finalConfig.binaryHashes) {
        console.log(`   ✓ Binary hashes added: ${Object.keys(finalConfig.binaryHashes).length} files`);
        Object.entries(finalConfig.binaryHashes).forEach(([key, info]) => {
            console.log(`     - ${key}: ${info.sha256.substring(0, 16)}...`);
        });
    }
    
    console.log('\n=== Setup Complete ===');
    console.log('Password: DemoPassword123!');
    console.log('\nStart server with:');
    console.log('  $env:SECURITY_PASSWORD = "DemoPassword123!"');
    console.log('  node dist/start-mcp-server.js');
}

setupSecurity().catch(err => {
    console.error('Setup failed:', err.message);
    process.exit(1);
});
