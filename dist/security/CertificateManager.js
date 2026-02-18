"use strict";
/**
 * CertificateManager - Generate and manage RSA-4096 certificates
 *
 * Implements:
 * - RSA-4096 key pair generation
 * - Self-signed X.509 certificate creation
 * - AES-256-GCM encryption with PBKDF2 (600K-1M iterations)
 * - Key storage and retrieval
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CertificateManager = void 0;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class CertificateManager {
    constructor(securityDir) {
        this.securityDir = securityDir || path.join(process.cwd(), 'security');
        this.publicKeyPath = path.join(this.securityDir, 'public.key.enc');
        this.privateKeyPath = path.join(this.securityDir, 'private.key.enc');
        // Ensure security directory exists
        if (!fs.existsSync(this.securityDir)) {
            fs.mkdirSync(this.securityDir, { recursive: true });
        }
    }
    /**
     * Generate RSA-4096 key pair with self-signed certificate
     * @param subject Certificate subject (e.g., "CN=WinKeys Automation")
     * @param validityYears Certificate validity period (default: 10 years)
     * @returns KeyPair with public/private keys and certificate
     */
    generateKeyPair(subject = "CN=WinKeys Automation, O=User Installation, C=US", validityYears = 10) {
        // Generate RSA-4096 key pair
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 4096,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });
        // Create self-signed certificate using OpenSSL-style approach
        // Note: Node.js doesn't have built-in X.509 cert generation
        // For production, use external tools or libraries like node-forge
        // This is a simplified version for development
        const certificate = this.createSelfSignedCert(publicKey, privateKey, subject, validityYears);
        const thumbprint = this.calculateThumbprint(certificate);
        return {
            publicKey,
            privateKey,
            certificate,
            thumbprint
        };
    }
    /**
     * Create a self-signed certificate (simplified)
     * For production, use proper X.509 library (node-forge, etc.)
     */
    createSelfSignedCert(publicKey, privateKey, subject, validityYears) {
        // This is a placeholder - in production, use node-forge or external OpenSSL
        // For now, we'll just wrap the public key with metadata
        const notBefore = new Date();
        const notAfter = new Date();
        notAfter.setFullYear(notAfter.getFullYear() + validityYears);
        const certData = {
            version: 3,
            serialNumber: crypto.randomBytes(16).toString('hex'),
            subject,
            issuer: subject, // Self-signed
            notBefore: notBefore.toISOString(),
            notAfter: notAfter.toISOString(),
            publicKey,
            extensions: {
                basicConstraints: 'CA:FALSE',
                keyUsage: 'Digital Signature',
                extKeyUsage: 'Code Signing'
            }
        };
        // Sign the cert data
        const certDataBuffer = Buffer.from(JSON.stringify(certData), 'utf8');
        const signature = crypto.sign('sha256', certDataBuffer, {
            key: privateKey,
            padding: crypto.constants.RSA_PKCS1_PADDING
        });
        // Return PEM-like format
        return `-----BEGIN CERTIFICATE-----
${Buffer.from(JSON.stringify({ certData, signature: signature.toString('base64') })).toString('base64')}
-----END CERTIFICATE-----`;
    }
    /**
     * Calculate SHA-256 thumbprint of certificate
     */
    calculateThumbprint(certificate) {
        const hash = crypto.createHash('sha256');
        hash.update(certificate);
        return hash.digest('hex').toUpperCase();
    }
    /**
     * Encrypt key data with AES-256-GCM using password-derived key
     * @param keyData Key data to encrypt (PEM format)
     * @param password Password for encryption
     * @param iterations PBKDF2 iterations (600K for public, 1M for private)
     * @returns Encrypted key file structure
     */
    encryptKey(keyData, password, iterations = 600000) {
        // Generate random salt (32 bytes)
        const salt = crypto.randomBytes(32);
        // Derive encryption key using PBKDF2
        const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha512');
        // Generate random IV (16 bytes for AES-GCM)
        const iv = crypto.randomBytes(16);
        // Encrypt with AES-256-GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
        let encrypted = cipher.update(keyData, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        // Get authentication tag
        const authTag = cipher.getAuthTag();
        return {
            salt: salt.toString('base64'),
            iv: iv.toString('base64'),
            authTag: authTag.toString('base64'),
            encrypted: encrypted.toString('base64'),
            iterations,
            metadata: {
                createdAt: new Date().toISOString(),
                algorithm: 'AES-256-GCM',
                keySize: 256
            }
        };
    }
    /**
     * Decrypt key data from encrypted file
     * @param encryptedFile Encrypted key file structure
     * @param password Password for decryption
     * @returns Decrypted key data (PEM format)
     */
    decryptKey(encryptedFile, password) {
        // Parse components
        const salt = Buffer.from(encryptedFile.salt, 'base64');
        const iv = Buffer.from(encryptedFile.iv, 'base64');
        const authTag = Buffer.from(encryptedFile.authTag, 'base64');
        const encrypted = Buffer.from(encryptedFile.encrypted, 'base64');
        // Derive decryption key
        const derivedKey = crypto.pbkdf2Sync(password, salt, encryptedFile.iterations, 32, 'sha512');
        // Decrypt with AES-256-GCM
        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8');
    }
    /**
     * Save encrypted key to file
     */
    saveEncryptedKey(encryptedFile, filePath) {
        fs.writeFileSync(filePath, JSON.stringify(encryptedFile, null, 2), 'utf8');
    }
    /**
     * Load encrypted key from file
     */
    loadEncryptedKey(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    }
    /**
     * Initialize security: Generate keys and encrypt them
     * @param publicPassword Password for public key (600K iterations)
     * @param privatePassword Password for private key (1M iterations)
     * @returns KeyPair and thumbprint
     */
    async initialize(publicPassword, privatePassword) {
        // Check if keys already exist
        if (fs.existsSync(this.publicKeyPath) || fs.existsSync(this.privateKeyPath)) {
            throw new Error('Keys already exist. Use loadKeys() or delete existing keys first.');
        }
        console.log('Generating RSA-4096 key pair...');
        const keyPair = this.generateKeyPair();
        console.log('Encrypting public key (600K iterations)...');
        const encryptedPublic = this.encryptKey(keyPair.publicKey, publicPassword, 600000);
        this.saveEncryptedKey(encryptedPublic, this.publicKeyPath);
        console.log('Encrypting private key (1M iterations)...');
        const encryptedPrivate = this.encryptKey(keyPair.privateKey, privatePassword, 1000000);
        this.saveEncryptedKey(encryptedPrivate, this.privateKeyPath);
        console.log(`Certificate thumbprint: ${keyPair.thumbprint}`);
        console.log('Keys encrypted and saved successfully.');
        return keyPair;
    }
    /**
     * Load and decrypt keys
     * @param publicPassword Password for public key
     * @param privatePassword Password for private key (optional, if only verification needed)
     * @returns Decrypted keys
     */
    loadKeys(publicPassword, privatePassword) {
        const result = {};
        // Load public key (always required)
        if (!fs.existsSync(this.publicKeyPath)) {
            throw new Error('Public key not found. Run initialize() first.');
        }
        const encryptedPublic = this.loadEncryptedKey(this.publicKeyPath);
        result.publicKey = this.decryptKey(encryptedPublic, publicPassword);
        // Load private key (optional)
        if (privatePassword) {
            if (!fs.existsSync(this.privateKeyPath)) {
                throw new Error('Private key not found. Run initialize() first.');
            }
            const encryptedPrivate = this.loadEncryptedKey(this.privateKeyPath);
            result.privateKey = this.decryptKey(encryptedPrivate, privatePassword);
        }
        return result;
    }
    /**
     * Check if keys exist
     */
    keysExist() {
        return {
            public: fs.existsSync(this.publicKeyPath),
            private: fs.existsSync(this.privateKeyPath)
        };
    }
    /**
     * Get certificate thumbprint from stored public key
     */
    getStoredThumbprint(publicPassword) {
        const encryptedPublic = this.loadEncryptedKey(this.publicKeyPath);
        const publicKey = this.decryptKey(encryptedPublic, publicPassword);
        // For now, hash the public key itself as thumbprint
        // In production, extract from actual X.509 certificate
        const hash = crypto.createHash('sha256');
        hash.update(publicKey);
        return hash.digest('hex').toUpperCase();
    }
}
exports.CertificateManager = CertificateManager;
//# sourceMappingURL=CertificateManager.js.map