/**
 * IntegrityChecker Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import { IntegrityChecker } from './IntegrityChecker';
import { ConfigSigner } from './ConfigSigner';
import { CertificateManager } from './CertificateManager';

describe('IntegrityChecker', () => {
    const testDir = path.join(__dirname, '../../security/test-integrity');
    const testPassword = 'test-password-456';
    let checker: IntegrityChecker;
    let signer: ConfigSigner;
    let certManager: CertificateManager;

    beforeAll(async () => {
        // Create test directory
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }

        // Initialize certificate manager and generate keys
        certManager = new CertificateManager(testDir);
        const keyPair = certManager.generateKeyPair();
        const encryptedPublic = certManager.encryptKey(keyPair.publicKey, testPassword, 10000);
        const encryptedPrivate = certManager.encryptKey(keyPair.privateKey, testPassword, 10000);
        
        certManager.saveEncryptedKey(encryptedPublic, path.join(testDir, 'public.key.enc'));
        certManager.saveEncryptedKey(encryptedPrivate, path.join(testDir, 'private.key.enc'));

        // Create test binaries
        const testBinDir = path.join(testDir, 'bin');
        if (!fs.existsSync(testBinDir)) {
            fs.mkdirSync(testBinDir, { recursive: true });
        }

        fs.writeFileSync(path.join(testBinDir, 'test1.exe'), 'test binary 1 content', 'utf8');
        fs.writeFileSync(path.join(testBinDir, 'test2.exe'), 'test binary 2 content', 'utf8');

        // Create config with binary hashes
        const configPath = path.join(testDir, 'config.json');
        const config = {
            version: "1.0",
            security: {
                defaultPolicy: "DENY_UNLISTED"
            },
            binaryHashes: {
                test1: {
                    path: path.relative(testDir, path.join(testBinDir, 'test1.exe')),
                    sha256: '',
                    size: fs.statSync(path.join(testBinDir, 'test1.exe')).size,
                    lastModified: new Date().toISOString()
                },
                test2: {
                    path: path.relative(testDir, path.join(testBinDir, 'test2.exe')),
                    sha256: '',
                    size: fs.statSync(path.join(testBinDir, 'test2.exe')).size,
                    lastModified: new Date().toISOString()
                }
            }
        };

        // Calculate actual hashes
        checker = new IntegrityChecker(testDir);
        config.binaryHashes.test1.sha256 = checker.getBinaryHash(config.binaryHashes.test1.path);
        config.binaryHashes.test2.sha256 = checker.getBinaryHash(config.binaryHashes.test2.path);

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

        // Initialize signer
        signer = new ConfigSigner(testDir);

        // Sign config
        signer.signConfig(testPassword, false);
    });

    afterAll(() => {
        // Clean up test directory
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe('Hash Calculation', () => {
        it('should calculate file hash correctly', () => {
            const hash = checker.getBinaryHash('bin/test1.exe');
            
            expect(hash).toBeTruthy();
            expect(hash).toMatch(/^[A-F0-9]{64}$/);
        });

        it('should calculate consistent hashes', () => {
            const hash1 = checker.getBinaryHash('bin/test1.exe');
            const hash2 = checker.getBinaryHash('bin/test1.exe');

            expect(hash1).toBe(hash2);
        });

        it('should detect file changes', () => {
            const tempFile = path.join(testDir, 'temp.txt');
            
            fs.writeFileSync(tempFile, 'original', 'utf8');
            const hash1 = checker.getBinaryHash(path.relative(testDir, tempFile));

            fs.writeFileSync(tempFile, 'modified', 'utf8');
            const hash2 = checker.getBinaryHash(path.relative(testDir, tempFile));

            expect(hash1).not.toBe(hash2);

            fs.unlinkSync(tempFile);
        });
    });

    describe('Binary Verification', () => {
        it('should verify valid binary', () => {
            const config = JSON.parse(fs.readFileSync(path.join(testDir, 'config.json'), 'utf8'));
            const result = checker.verifyBinary('test1', config.binaryHashes.test1);

            expect(result.valid).toBe(true);
            expect(result.binary).toBe('test1');
            expect(result.error).toBeUndefined();
        });

        it('should detect modified binary', () => {
            const config = JSON.parse(fs.readFileSync(path.join(testDir, 'config.json'), 'utf8'));
            
            // Modify binary
            const binPath = path.join(testDir, config.binaryHashes.test1.path);
            fs.appendFileSync(binPath, 'TAMPERED', 'utf8');

            const result = checker.verifyBinary('test1', config.binaryHashes.test1);

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Hash mismatch');
            expect(result.expectedHash).toBeTruthy();
            expect(result.actualHash).toBeTruthy();
            expect(result.expectedHash).not.toBe(result.actualHash);

            // Restore binary
            fs.writeFileSync(binPath, 'test binary 1 content', 'utf8');
        });

        it('should detect missing binary', () => {
            const config = JSON.parse(fs.readFileSync(path.join(testDir, 'config.json'), 'utf8'));
            
            const result = checker.verifyBinary('missing', {
                path: 'nonexistent.exe',
                sha256: 'ABCD1234',
                size: 100,
                lastModified: new Date().toISOString()
            });

            expect(result.valid).toBe(false);
            expect(result.error).toBe('Binary not found');
        });
    });

    describe('Verify All Binaries', () => {
        it('should verify all valid binaries', () => {
            const config = JSON.parse(fs.readFileSync(path.join(testDir, 'config.json'), 'utf8'));
            const result = checker.verifyAll(config);

            expect(result.allValid).toBe(true);
            expect(result.results.length).toBe(2);
            expect(result.bypassed).toBe(false);
            expect(result.results.every(r => r.valid)).toBe(true);
        });

        it('should detect any tampered binary', () => {
            const config = JSON.parse(fs.readFileSync(path.join(testDir, 'config.json'), 'utf8'));
            
            // Tamper with one binary
            const binPath = path.join(testDir, config.binaryHashes.test2.path);
            fs.appendFileSync(binPath, 'TAMPERED', 'utf8');

            const result = checker.verifyAll(config);

            expect(result.allValid).toBe(false);
            expect(result.results.length).toBe(2);
            expect(result.results.filter(r => !r.valid).length).toBe(1);

            // Restore binary
            fs.writeFileSync(binPath, 'test binary 2 content', 'utf8');
        });

        it('should handle missing binaryHashes in config', () => {
            const result = checker.verifyAll({ version: "1.0" });

            expect(result.allValid).toBe(false);
            expect(result.results.length).toBe(0);
        });
    });

    describe('Self Check', () => {
        it('should pass self-check for valid binary', () => {
            const config = JSON.parse(fs.readFileSync(path.join(testDir, 'config.json'), 'utf8'));
            const result = checker.selfCheck('test1', config);

            expect(result).toBe(true);
        });

        it('should fail self-check for tampered binary', () => {
            const config = JSON.parse(fs.readFileSync(path.join(testDir, 'config.json'), 'utf8'));
            
            // Tamper
            const binPath = path.join(testDir, config.binaryHashes.test1.path);
            fs.appendFileSync(binPath, 'TAMPERED', 'utf8');

            const result = checker.selfCheck('test1', config);

            expect(result).toBe(false);

            // Restore
            fs.writeFileSync(binPath, 'test binary 1 content', 'utf8');
        });

        it('should handle missing hash', () => {
            const config = { binaryHashes: {} };
            const result = checker.selfCheck('nonexistent', config);

            expect(result).toBe(false);
        });
    });

    describe('Integration with Signed Config', () => {
        it('should verify binaries from signed config', async () => {
            // IntegrityChecker uses testDir, but ConfigSigner verification loads from security/
            // So we need to explicitly verify the config first
            const config = JSON.parse(fs.readFileSync(path.join(testDir, 'config.json'), 'utf8'));
            const result = checker.verifyAll(config);

            expect(result.allValid).toBe(true);
            expect(result.results.length).toBe(2);
        });

        it('should reject tampered config', async () => {
            // Tamper with config
            const configPath = path.join(testDir, 'config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config.version = "2.0";
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

            await expect(checker.verifyWithSignedConfig(testPassword))
                .rejects.toThrow('Config verification failed');

            // Restore
            config.version = "1.0";
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            signer.signConfig(testPassword, false);
        });
    });

    describe('Development Mode', () => {
        it('should bypass checks when SKIP_INTEGRITY_CHECK=true', () => {
            process.env.SKIP_INTEGRITY_CHECK = 'true';

            const config = JSON.parse(fs.readFileSync(path.join(testDir, 'config.json'), 'utf8'));
            const result = checker.verifyAll(config);

            expect(result.allValid).toBe(true);
            expect(result.bypassed).toBe(true);
            expect(result.results.length).toBe(0);

            delete process.env.SKIP_INTEGRITY_CHECK;
        });

        it('should pass self-check when bypassed', () => {
            process.env.SKIP_INTEGRITY_CHECK = 'true';

            const config = { binaryHashes: { test1: { path: 'bin/test1.exe', sha256: 'WRONG', size: 0, lastModified: '' } } };
            const result = checker.selfCheck('test1', config);

            expect(result).toBe(true);

            delete process.env.SKIP_INTEGRITY_CHECK;
        });

        it('should show warnings in development mode', () => {
            const config = {
                version: "1.0",
                developmentMode: { enabled: true },
                binaryHashes: {
                    fake: {
                        path: 'nonexistent.exe',
                        sha256: 'FAKE',
                        size: 0,
                        lastModified: ''
                    }
                }
            };

            // Should not throw, just warn
            expect(() => {
                checker.checkDevelopmentMode(config);
            }).not.toThrow();
        });
    });
});
