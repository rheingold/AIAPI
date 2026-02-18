// Re-sign configuration with existing keys
const fs = require('fs');
const path = require('path');
const { ConfigSigner } = require('./dist/security/ConfigSigner');

const password = 'DemoPassword123!';
const securityDir = path.join(__dirname, 'security');
const configPath = path.join(securityDir, 'config.json');

// Restore clean config
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

// Sign it
const signer = new ConfigSigner(securityDir);
signer.signConfig(password, true);

console.log('✓ Configuration restored and signed');
