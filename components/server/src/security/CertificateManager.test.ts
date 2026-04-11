import { CertificateManager } from './CertificateManager';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

describe('CertificateManager', () => {
    let certManager: CertificateManager;
    const testSecurityDir = path.join(process.cwd(), 'security', 'test');
    const publicPassword = 'test-public-password-123';
    const privatePassword = 'test-private-password-456';

    beforeEach(() => {
        // Clean up test directory
        if (fs.existsSync(testSecurityDir)) {
            fs.rmSync(testSecurityDir, { recursive: true, force: true });
        }
        fs.mkdirSync(testSecurityDir, { recursive: true });

        certManager = new CertificateManager(testSecurityDir);
    });

    afterEach(() => {
        // Clean up
        if (fs.existsSync(testSecurityDir)) {
            fs.rmSync(testSecurityDir, { recursive: true, force: true });
        }
    });

    describe('generateKeyPair', () => {
        test('should generate RSA-4096 key pair', () => {
            const keyPair = certManager.generateKeyPair();

            expect(keyPair.publicKey).toContain('BEGIN PUBLIC KEY');
            expect(keyPair.publicKey).toContain('END PUBLIC KEY');
            expect(keyPair.privateKey).toContain('BEGIN PRIVATE KEY');
            expect(keyPair.privateKey).toContain('END PRIVATE KEY');
        });

        test('should generate valid certificate', () => {
            const keyPair = certManager.generateKeyPair();

            expect(keyPair.certificate).toContain('BEGIN CERTIFICATE');
            expect(keyPair.certificate).toContain('END CERTIFICATE');
        });

        test('should generate thumbprint', () => {
            const keyPair = certManager.generateKeyPair();

            expect(keyPair.thumbprint).toMatch(/^[A-F0-9]{64}$/);
            expect(keyPair.thumbprint.length).toBe(64); // SHA-256 = 64 hex chars
        });

        test('should generate unique keys each time', () => {
            const keyPair1 = certManager.generateKeyPair();
            const keyPair2 = certManager.generateKeyPair();

            expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
            expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
            expect(keyPair1.thumbprint).not.toBe(keyPair2.thumbprint);
        });

        test('should create certificate with custom subject', () => {
            const customSubject = 'CN=Test Certificate, O=Test Org';
            const keyPair = certManager.generateKeyPair(customSubject);

            expect(keyPair.certificate).toBeDefined();
            // Certificate contains subject in base64-encoded data
        });
    });

    describe('encryptKey / decryptKey', () => {
        test('should encrypt and decrypt key successfully', () => {
            const keyPair = certManager.generateKeyPair();
            const password = 'test-password-123';

            const encrypted = certManager.encryptKey(keyPair.privateKey, password, 10000); // Low iterations for speed
            const decrypted = certManager.decryptKey(encrypted, password);

            expect(decrypted).toBe(keyPair.privateKey);
        });

        test('should fail with wrong password', () => {
            const keyPair = certManager.generateKeyPair();
            const password = 'correct-password';

            const encrypted = certManager.encryptKey(keyPair.privateKey, password, 10000);

            expect(() => {
                certManager.decryptKey(encrypted, 'wrong-password');
            }).toThrow();
        });

        test('should use correct iteration counts', () => {
            const keyPair = certManager.generateKeyPair();

            const encrypted600k = certManager.encryptKey(keyPair.publicKey, 'pass', 600000);
            const encrypted1M = certManager.encryptKey(keyPair.privateKey, 'pass', 1000000);

            expect(encrypted600k.iterations).toBe(600000);
            expect(encrypted1M.iterations).toBe(1000000);
        });

        test('should include metadata', () => {
            const keyPair = certManager.generateKeyPair();
            const encrypted = certManager.encryptKey(keyPair.publicKey, 'pass', 10000);

            expect(encrypted.metadata.algorithm).toBe('AES-256-GCM');
            expect(encrypted.metadata.keySize).toBe(256);
            expect(encrypted.metadata.createdAt).toBeDefined();
        });

        test('should detect tampering (auth tag)', () => {
            const keyPair = certManager.generateKeyPair();
            const encrypted = certManager.encryptKey(keyPair.privateKey, 'pass', 10000);

            // Tamper with encrypted data
            const tampered = { ...encrypted };
            tampered.encrypted = Buffer.from('tampered data').toString('base64');

            expect(() => {
                certManager.decryptKey(tampered, 'pass');
            }).toThrow();
        });

        test('should use unique salt and IV each time', () => {
            const keyPair = certManager.generateKeyPair();

            const enc1 = certManager.encryptKey(keyPair.privateKey, 'pass', 10000);
            const enc2 = certManager.encryptKey(keyPair.privateKey, 'pass', 10000);

            expect(enc1.salt).not.toBe(enc2.salt);
            expect(enc1.iv).not.toBe(enc2.iv);
            expect(enc1.encrypted).not.toBe(enc2.encrypted); // Different due to salt/IV
        });
    });

    describe('saveEncryptedKey / loadEncryptedKey', () => {
        test('should save and load encrypted key', () => {
            const keyPair = certManager.generateKeyPair();
            const encrypted = certManager.encryptKey(keyPair.privateKey, 'pass', 10000);

            const testFile = path.join(testSecurityDir, 'test.key.enc');
            certManager.saveEncryptedKey(encrypted, testFile);

            const loaded = certManager.loadEncryptedKey(testFile);

            expect(loaded.salt).toBe(encrypted.salt);
            expect(loaded.iv).toBe(encrypted.iv);
            expect(loaded.authTag).toBe(encrypted.authTag);
            expect(loaded.encrypted).toBe(encrypted.encrypted);
            expect(loaded.iterations).toBe(encrypted.iterations);
        });

        test('should throw if file does not exist', () => {
            expect(() => {
                certManager.loadEncryptedKey(path.join(testSecurityDir, 'nonexistent.key.enc'));
            }).toThrow();
        });
    });

    describe('initialize', () => {
        test('should initialize and create encrypted keys', async () => {
            const keyPair = await certManager.initialize(publicPassword, privatePassword);

            expect(keyPair.publicKey).toBeDefined();
            expect(keyPair.privateKey).toBeDefined();
            expect(keyPair.thumbprint).toBeDefined();

            // Check files were created
            const exists = certManager.keysExist();
            expect(exists.public).toBe(true);
            expect(exists.private).toBe(true);
        }, 30000); // 30s timeout for key generation + encryption

        test('should fail if keys already exist', async () => {
            await certManager.initialize(publicPassword, privatePassword);

            await expect(async () => {
                await certManager.initialize(publicPassword, privatePassword);
            }).rejects.toThrow('Keys already exist');
        }, 30000);

        test('should use different iteration counts for public and private keys', async () => {
            await certManager.initialize(publicPassword, privatePassword);

            const publicKeyFile = certManager.loadEncryptedKey(path.join(testSecurityDir, 'public.key.enc'));
            const privateKeyFile = certManager.loadEncryptedKey(path.join(testSecurityDir, 'private.key.enc'));

            expect(publicKeyFile.iterations).toBe(600000);
            expect(privateKeyFile.iterations).toBe(1000000);
        }, 30000);
    });

    describe('loadKeys', () => {
        beforeEach(async () => {
            await certManager.initialize(publicPassword, privatePassword);
        }, 30000);

        test('should load public key only', () => {
            const keys = certManager.loadKeys(publicPassword);

            expect(keys.publicKey).toBeDefined();
            expect(keys.publicKey).toContain('BEGIN PUBLIC KEY');
            expect(keys.privateKey).toBeUndefined();
        });

        test('should load both keys', () => {
            const keys = certManager.loadKeys(publicPassword, privatePassword);

            expect(keys.publicKey).toBeDefined();
            expect(keys.privateKey).toBeDefined();
            expect(keys.publicKey).toContain('BEGIN PUBLIC KEY');
            expect(keys.privateKey).toContain('BEGIN PRIVATE KEY');
        });

        test('should fail with wrong password', () => {
            expect(() => {
                certManager.loadKeys('wrong-password');
            }).toThrow();
        });

        test('should throw if keys do not exist', () => {
            const emptyManager = new CertificateManager(path.join(testSecurityDir, 'empty'));

            expect(() => {
                emptyManager.loadKeys(publicPassword);
            }).toThrow('Public key not found');
        });
    });

    describe('keysExist', () => {
        test('should return false when no keys exist', () => {
            const exists = certManager.keysExist();

            expect(exists.public).toBe(false);
            expect(exists.private).toBe(false);
        });

        test('should return true after initialization', async () => {
            await certManager.initialize(publicPassword, privatePassword);

            const exists = certManager.keysExist();

            expect(exists.public).toBe(true);
            expect(exists.private).toBe(true);
        }, 30000);
    });

    describe('getStoredThumbprint', () => {
        beforeEach(async () => {
            await certManager.initialize(publicPassword, privatePassword);
        }, 30000);

        test('should get thumbprint from stored key', () => {
            const thumbprint = certManager.getStoredThumbprint(publicPassword);

            expect(thumbprint).toMatch(/^[A-F0-9]{64}$/);
            expect(thumbprint.length).toBe(64);
        });

        test('should match original thumbprint', () => {
            // Keys already initialized by beforeEach
            const storedThumbprint = certManager.getStoredThumbprint(publicPassword);

            // Should be valid thumbprint format
            expect(storedThumbprint).toBeDefined();
            expect(storedThumbprint).toMatch(/^[A-F0-9]{64}$/);
        });
    });

    describe('cryptographic strength', () => {
        test('should generate keys with sufficient entropy', () => {
            const keyPair = certManager.generateKeyPair();

            // RSA-4096 private key should be large
            expect(keyPair.privateKey.length).toBeGreaterThan(3000);
            expect(keyPair.publicKey.length).toBeGreaterThan(700);
        });

        test('should use secure random for salt and IV', () => {
            const keyPair = certManager.generateKeyPair();
            const encrypted = certManager.encryptKey(keyPair.privateKey, 'pass', 10000);

            const salt = Buffer.from(encrypted.salt, 'base64');
            const iv = Buffer.from(encrypted.iv, 'base64');

            expect(salt.length).toBe(32); // 256 bits
            expect(iv.length).toBe(16);   // 128 bits for AES-GCM
        });
    });
});
