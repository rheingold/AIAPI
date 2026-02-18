const { IntegrityChecker } = require('./dist/security/IntegrityChecker');
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const path = require('path');
const testDir = path.join(process.cwd(), 'security/test-integration');
const checker = new IntegrityChecker(testDir);
const signer = new ConfigSigner(testDir);
const configResult = signer.verifyConfig('TestPassword123!');
const integrityResult = checker.verifyAll(configResult.config);
console.log('Integrity check. Binaries checked:', integrityResult.results.length);
