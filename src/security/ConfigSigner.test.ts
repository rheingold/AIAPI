/**
 * ConfigSigner Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigSigner } from './ConfigSigner';
import { CertificateManager } from './CertificateManager';

describe('ConfigSigner', () => {
    const testDir = path.join(__dirname, '../../security/test-config-signing');
    const configPath = path.join(testDir, 'config.json');
    const signaturePath = path.join(testDir, 'config.json.sig');
    const testPassword = 'test-password-123';
    let signer: ConfigSigner;
    let certManager: CertificateManager;

    beforeAll(async () => {
        // Create test directory
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }

        // Initialize certificate manager and generate keys
        certManager = new CertificateManager(testDir);
        
        // Use lower iteration counts for faster tests
        const keyPair = certManager.generateKeyPair();
        const encryptedPublic = certManager.encryptKey(keyPair.publicKey, testPassword, 10000);
        const encryptedPrivate = certManager.encryptKey(keyPair.privateKey, testPassword, 10000);
        
        certManager.saveEncryptedKey(encryptedPublic, path.join(testDir, 'public.key.enc'));
        certManager.saveEncryptedKey(encryptedPrivate, path.join(testDir, 'private.key.enc'));

        // Create test config
        const testConfig = {
            version: "1.0",
            security: {
                defaultPolicy: "DENY_UNLISTED",
                requireTargetSignature: true
            },
            processes: {
                whitelist: ["notepad.exe", "calc.exe"]
            }
        };
        fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), 'utf8');

        signer = new ConfigSigner(testDir);
    });

    afterAll(() => {
        // Clean up test directory
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe('Configuration Signing', () => {
        it('should sign config file', () => {
            const signature = signer.signConfig(testPassword, false);

            expect(signature.signature).toBeTruthy();
            expect(signature.algorithm).toBe('RSA-SHA256');
            expect(signature.configHash).toBeTruthy();
            expect(signature.thumbprint).toBeTruthy();
            expect(signature.timestamp).toBeTruthy();
        });

        it('should create signature file', () => {
            expect(fs.existsSync(signaturePath)).toBe(true);
        });

        it('should verify valid signature', () => {
            const result = signer.verifyConfig(testPassword);

            expect(result.valid).toBe(true);
            expect(result.config).toBeTruthy();
            expect(result.error).toBeUndefined();
        });

        it('should detect config tampering', () => {
            // Tamper with config
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config.security.defaultPolicy = "ALLOW_ALL";
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

            const result = signer.verifyConfig(testPassword);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('hash mismatch');

            // Restore config
            config.security.defaultPolicy = "DENY_UNLISTED";
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        });

        it('should detect missing signature file', () => {
            // Remove signature
            fs.unlinkSync(signaturePath);

            const result = signer.verifyConfig(testPassword);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Signature file not found');

            // Re-sign
            signer.signConfig(testPassword, false);
        });

        it('should check if config is signed', () => {
            expect(signer.isSigned()).toBe(true);

            signer.removeSignature();
            expect(signer.isSigned()).toBe(false);

            signer.signConfig(testPassword, false);
            expect(signer.isSigned()).toBe(true);
        });
    });

    describe('Binary Hash Management', () => {
        it('should get binary hashes', () => {
            const hashes = signer.getBinaryHashes();

            // May or may not have binaries depending on build state
            expect(typeof hashes).toBe('object');
            
            // If KeyWin.exe exists, verify structure
            if (hashes['keywin']) {
                expect(hashes['keywin'].path).toBeTruthy();
                expect(hashes['keywin'].sha256).toMatch(/^[A-F0-9]{64}$/);
                expect(hashes['keywin'].size).toBeGreaterThan(0);
                expect(hashes['keywin'].lastModified).toBeTruthy();
            }
        });

        it('should add binary hashes to config when signing', () => {
            // Sign with binary hashes
            signer.signConfig(testPassword, true);

            // Read config
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

            // Should have binaryHashes section (even if empty)
            expect(config.binaryHashes).toBeDefined();
        });

        it('should verify binary integrity', () => {
            // Sign config with binary hashes
            signer.signConfig(testPassword, true);

            // Verify config
            const verifyResult = signer.verifyConfig(testPassword);
            expect(verifyResult.valid).toBe(true);

            // Verify binaries
            const binaryResults = signer.verifyBinaries(verifyResult.config!);

            // All existing binaries should be valid
            for (const [key, result] of Object.entries(binaryResults)) {
                if (result.valid !== undefined) {
                    expect(result.valid).toBe(true);
                }
            }
        });

        it('should update binary hashes', () => {
            const beforeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const beforeHashes = beforeConfig.binaryHashes;

            signer.updateBinaryHashes();

            const afterConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const afterHashes = afterConfig.binaryHashes;

            expect(afterHashes).toBeDefined();
            // Hashes may be same or different depending on build state
        });
    });

    describe('Development Bypasses', () => {
        it('should bypass signature verification in dev mode', () => {
            // Remove signature
            signer.removeSignature();

            // Enable bypass
            process.env.SKIP_CONFIG_SIGNATURE = 'true';

            const result = signer.verifyConfig(testPassword);

            expect(result.valid).toBe(true);
            expect(result.config).toBeTruthy();

            // Disable bypass
            delete process.env.SKIP_CONFIG_SIGNATURE;

            // Re-sign for other tests
            signer.signConfig(testPassword, false);
        });

        it('should bypass binary integrity check in dev mode', () => {
            const config = { binaryHashes: {} };

            process.env.SKIP_INTEGRITY_CHECK = 'true';

            const results = signer.verifyBinaries(config);

            expect(Object.keys(results).length).toBe(0);

            delete process.env.SKIP_INTEGRITY_CHECK;
        });
    });

    describe('Error Handling', () => {
        it('should handle missing config file', () => {
            const tempSigner = new ConfigSigner(path.join(testDir, 'nonexistent'));

            expect(() => {
                tempSigner.signConfig(testPassword);
            }).toThrow('Config file not found');
        });

        it('should handle wrong password', () => {
            expect(() => {
                signer.verifyConfig('wrong-password');
            }).toThrow();
        });

        it('should handle corrupted signature file', () => {
            // Corrupt signature
            fs.writeFileSync(signaturePath, 'invalid json', 'utf8');

            expect(() => {
                signer.verifyConfig(testPassword);
            }).toThrow();

            // Re-sign
            signer.signConfig(testPassword, false);
        });
    });

    describe('Hash Calculation', () => {
        it('should calculate consistent file hashes', () => {
            // Create temp file
            const tempFile = path.join(testDir, 'test-hash.txt');
            fs.writeFileSync(tempFile, 'test content', 'utf8');

            const hash1 = (signer as any).calculateFileHash(tempFile);
            const hash2 = (signer as any).calculateFileHash(tempFile);

            expect(hash1).toBe(hash2);
            expect(hash1).toMatch(/^[A-F0-9]{64}$/);

            fs.unlinkSync(tempFile);
        });

        it('should detect file changes', () => {
            const tempFile = path.join(testDir, 'test-change.txt');
            
            fs.writeFileSync(tempFile, 'original', 'utf8');
            const hash1 = (signer as any).calculateFileHash(tempFile);

            fs.writeFileSync(tempFile, 'modified', 'utf8');
            const hash2 = (signer as any).calculateFileHash(tempFile);

            expect(hash1).not.toBe(hash2);

            fs.unlinkSync(tempFile);
        });
    });
});
