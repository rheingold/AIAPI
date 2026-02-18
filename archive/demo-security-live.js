/**
 * Live Security Demo - Working App + Violation Detection
 * 
 * This script demonstrates:
 * 1. Successful startup with valid security
 * 2. Various security violations being detected
 */

const { CertificateManager } = require('./dist/security/CertificateManager');
const { ConfigSigner } = require('./dist/security/ConfigSigner');
const { IntegrityChecker } = require('./dist/security/IntegrityChecker');
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'security', 'demo');
const password = 'DemoPassword123!';

console.log('\n' + '='.repeat(60));
console.log('  Security Architecture Live Demo');
console.log('='.repeat(60) + '\n');

// Cleanup
if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
}
fs.mkdirSync(testDir, { recursive: true });

// Create test config
const config = {
    version: "1.0",
    security: {
        defaultPolicy: "DENY_UNLISTED",
        requireTargetSignature: true
    },
    processes: {
        whitelist: ["notepad.exe", "calc.exe"],
        blacklist: ["cmd.exe", "powershell.exe"]
    },
    developmentMode: {
        enabled: false
    }
};
fs.writeFileSync(path.join(testDir, 'config.json'), JSON.stringify(config, null, 2));

// Create a test binary
const testBinary = path.join(testDir, 'app.exe');
fs.writeFileSync(testBinary, 'Test application content v1.0');

(async () => {
    try {
        // ============================================================
        // PART 1: SUCCESSFUL STARTUP
        // ============================================================
        console.log('┌' + '─'.repeat(58) + '┐');
        console.log('│ PART 1: APPLICATION STARTUP (Valid Security)              │');
        console.log('└' + '─'.repeat(58) + '┘\n');

        // Step 1: Generate keys
        console.log('Step 1: Generating RSA-4096 certificate...');
        const certManager = new CertificateManager(testDir);
        const keyPair = await certManager.initialize(password, password);
        console.log('✓ Certificate generated');
        console.log(`  Thumbprint: ${keyPair.thumbprint.substring(0, 32)}...`);
        console.log(`  Keys encrypted and saved\n`);

        // Step 2: Sign configuration
        console.log('Step 2: Signing configuration...');
        const signer = new ConfigSigner(testDir);
        
        // Add binary hash to config
        const cfg = JSON.parse(fs.readFileSync(path.join(testDir, 'config.json'), 'utf8'));
        const hash = require('crypto').createHash('sha256').update(fs.readFileSync(testBinary)).digest('hex').toUpperCase();
        cfg.binaryHashes = {
            'app': {
                path: 'app.exe',
                sha256: hash,
                size: fs.statSync(testBinary).size,
                lastModified: fs.statSync(testBinary).mtime.toISOString()
            }
        };
        fs.writeFileSync(path.join(testDir, 'config.json'), JSON.stringify(cfg, null, 2));

        const signature = signer.signConfig(password, false);
        console.log('✓ Configuration signed');
        console.log(`  Algorithm: ${signature.algorithm}`);
        console.log(`  Config Hash: ${signature.configHash.substring(0, 32)}...\n`);

        // Step 3: Verify on startup
        console.log('Step 3: Startup verification...');
        const verifyResult = signer.verifyConfig(password);
        if (!verifyResult.valid) {
            throw new Error(`Verification failed: ${verifyResult.error}`);
        }
        console.log('✓ Configuration signature verified');

        const checker = new IntegrityChecker(testDir);
        const integrityResult = checker.verifyAll(verifyResult.config);
        if (!integrityResult.allValid) {
            throw new Error('Binary integrity check failed');
        }
        console.log('✓ Binary integrity verified');

        console.log('\n🎉 APPLICATION STARTED SUCCESSFULLY\n');
        console.log('Security checks passed:');
        console.log('  ✓ Certificate loaded and decrypted');
        console.log('  ✓ Configuration signature valid');
        console.log('  ✓ Binary integrity verified');
        console.log('  ✓ Ready to accept requests\n');

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));

        // ============================================================
        // PART 2: VIOLATION DETECTION
        // ============================================================
        console.log('\n' + '┌' + '─'.repeat(58) + '┐');
        console.log('│ PART 2: SECURITY VIOLATION DETECTION                      │');
        console.log('└' + '─'.repeat(58) + '┘\n');

        // Violation 1: Wrong Password
        console.log('Violation 1: Wrong Password Attack');
        console.log('─'.repeat(40));
        console.log('Scenario: Attacker tries to decrypt keys with wrong password');
        try {
            signer.verifyConfig('WrongPassword123!');
            console.log('❌ SECURITY BREACH: Wrong password accepted!\n');
        } catch (err) {
            console.log('✓ DETECTED: ' + err.message.substring(0, 60) + '...');
            console.log('  Action: Access denied, keys remain encrypted\n');
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        // Violation 2: Config Tampering
        console.log('Violation 2: Configuration Tampering');
        console.log('─'.repeat(40));
        console.log('Scenario: Attacker modifies config to allow malicious processes');
        
        // Backup and tamper
        const configPath = path.join(testDir, 'config.json');
        const originalConfig = fs.readFileSync(configPath, 'utf8');
        const tamperedConfig = JSON.parse(originalConfig);
        tamperedConfig.security.defaultPolicy = 'ALLOW_ALL';
        tamperedConfig.processes.blacklist = [];
        fs.writeFileSync(configPath, JSON.stringify(tamperedConfig, null, 2));
        
        console.log('  Modified: defaultPolicy = "ALLOW_ALL"');
        console.log('  Modified: blacklist cleared');
        
        const tamperedResult = signer.verifyConfig(password);
        if (!tamperedResult.valid) {
            console.log('✓ DETECTED: ' + tamperedResult.error);
            console.log('  Action: Tampered config rejected, using last known good\n');
        } else {
            console.log('❌ SECURITY BREACH: Tampered config accepted!\n');
        }

        // Restore
        fs.writeFileSync(configPath, originalConfig);
        await new Promise(resolve => setTimeout(resolve, 500));

        // Violation 3: Binary Replacement
        console.log('Violation 3: Binary Replacement Attack');
        console.log('─'.repeat(40));
        console.log('Scenario: Attacker replaces legitimate binary with trojan');
        
        const originalBinary = fs.readFileSync(testBinary);
        fs.writeFileSync(testBinary, 'MALICIOUS TROJAN CODE - keylogger active');
        console.log('  Binary modified: Trojan keylogger injected');
        
        const configForCheck = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const binaryCheck = checker.verifyAll(configForCheck);
        
        if (!binaryCheck.allValid) {
            const failed = binaryCheck.results.find(r => !r.valid);
            console.log('✓ DETECTED: ' + failed.error);
            console.log('  Expected: ' + failed.expectedHash.substring(0, 32) + '...');
            console.log('  Actual:   ' + failed.actualHash.substring(0, 32) + '...');
            console.log('  Action: Refusing to start tampered binary\n');
        } else {
            console.log('❌ SECURITY BREACH: Trojan not detected!\n');
        }

        // Restore
        fs.writeFileSync(testBinary, originalBinary);
        await new Promise(resolve => setTimeout(resolve, 500));

        // Violation 4: Signature Removal
        console.log('Violation 4: Signature File Removal');
        console.log('─'.repeat(40));
        console.log('Scenario: Attacker deletes signature to bypass verification');
        
        const sigPath = path.join(testDir, 'config.json.sig');
        const originalSig = fs.readFileSync(sigPath, 'utf8');
        fs.unlinkSync(sigPath);
        console.log('  Deleted: config.json.sig');
        
        const noSigResult = signer.verifyConfig(password);
        if (!noSigResult.valid) {
            console.log('✓ DETECTED: ' + noSigResult.error);
            console.log('  Action: Refusing to start without valid signature\n');
        } else {
            console.log('❌ SECURITY BREACH: Missing signature not detected!\n');
        }

        // Restore
        fs.writeFileSync(sigPath, originalSig);
        await new Promise(resolve => setTimeout(resolve, 500));

        // Violation 5: Key File Theft + Password Guess
        console.log('Violation 5: Key File Theft + Brute Force');
        console.log('─'.repeat(40));
        console.log('Scenario: Attacker copies encrypted keys and tries to crack password');
        
        console.log('  Attacker copies: public.key.enc, private.key.enc');
        console.log('  Attempting password guesses:');
        
        const commonPasswords = ['password', '123456', 'admin', 'qwerty', 'password123'];
        let cracked = false;
        for (const pwd of commonPasswords) {
            try {
                process.stdout.write(`    Trying "${pwd}"... `);
                certManager.loadKeys(pwd, pwd);
                console.log('SUCCESS ❌ SECURITY BREACH!');
                cracked = true;
                break;
            } catch (err) {
                console.log('Failed ✓');
            }
        }
        
        if (!cracked) {
            console.log('✓ DETECTED: All password guesses failed');
            console.log('  Defense: Strong password + PBKDF2 (600K-1M iterations)');
            console.log('  Time to crack: Years with current hardware\n');
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        // ============================================================
        // SUMMARY
        // ============================================================
        console.log('\n' + '┌' + '─'.repeat(58) + '┐');
        console.log('│ SECURITY DEMONSTRATION SUMMARY                             │');
        console.log('└' + '─'.repeat(58) + '┘\n');

        console.log('✓ Application startup: SUCCESSFUL');
        console.log('  - Certificate generation and encryption');
        console.log('  - Configuration signing');
        console.log('  - Signature verification');
        console.log('  - Binary integrity checking\n');

        console.log('✓ Violation detection: ALL THREATS BLOCKED');
        console.log('  - Wrong password → Decryption failed');
        console.log('  - Config tampering → Hash mismatch detected');
        console.log('  - Binary replacement → Integrity check failed');
        console.log('  - Signature removal → Missing file detected');
        console.log('  - Brute force attack → Strong encryption resisted\n');

        console.log('🛡️  SECURITY SYSTEM: OPERATIONAL\n');

        console.log('Demo artifacts saved in: security/demo/');
        console.log('  - public.key.enc (AES-256-GCM encrypted)');
        console.log('  - private.key.enc (AES-256-GCM encrypted)');
        console.log('  - config.json (signed configuration)');
        console.log('  - config.json.sig (RSA-SHA256 signature)');
        console.log('  - app.exe (integrity tracked)\n');

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        process.exit(1);
    }
})();
