const { ConfigSigner } = require('./dist/security/ConfigSigner');
const path = require('path');
const testDir = path.join(process.cwd(), 'security/test-integration');
const signer = new ConfigSigner(testDir);
const signature = signer.signConfig('TestPassword123!', true);
console.log('Config signed. Hash:', signature.configHash.substring(0, 16) + '...');
