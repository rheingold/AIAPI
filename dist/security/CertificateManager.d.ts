/**
 * CertificateManager - Generate and manage RSA-4096 certificates
 *
 * Implements:
 * - RSA-4096 key pair generation
 * - Self-signed X.509 certificate creation
 * - AES-256-GCM encryption with PBKDF2 (600K-1M iterations)
 * - Key storage and retrieval
 */
export interface KeyPair {
    publicKey: string;
    privateKey: string;
    certificate: string;
    thumbprint: string;
}
export interface EncryptedKeyFile {
    salt: string;
    iv: string;
    authTag: string;
    encrypted: string;
    iterations: number;
    metadata: {
        createdAt: string;
        algorithm: string;
        keySize: number;
    };
}
export declare class CertificateManager {
    private readonly securityDir;
    private readonly publicKeyPath;
    private readonly privateKeyPath;
    constructor(securityDir?: string);
    /**
     * Generate RSA-4096 key pair with self-signed certificate
     * @param subject Certificate subject (e.g., "CN=WinKeys Automation")
     * @param validityYears Certificate validity period (default: 10 years)
     * @returns KeyPair with public/private keys and certificate
     */
    generateKeyPair(subject?: string, validityYears?: number): KeyPair;
    /**
     * Create a self-signed certificate (simplified)
     * For production, use proper X.509 library (node-forge, etc.)
     */
    private createSelfSignedCert;
    /**
     * Calculate SHA-256 thumbprint of certificate
     */
    private calculateThumbprint;
    /**
     * Encrypt key data with AES-256-GCM using password-derived key
     * @param keyData Key data to encrypt (PEM format)
     * @param password Password for encryption
     * @param iterations PBKDF2 iterations (600K for public, 1M for private)
     * @returns Encrypted key file structure
     */
    encryptKey(keyData: string, password: string, iterations?: number): EncryptedKeyFile;
    /**
     * Decrypt key data from encrypted file
     * @param encryptedFile Encrypted key file structure
     * @param password Password for decryption
     * @returns Decrypted key data (PEM format)
     */
    decryptKey(encryptedFile: EncryptedKeyFile, password: string): string;
    /**
     * Save encrypted key to file
     */
    saveEncryptedKey(encryptedFile: EncryptedKeyFile, filePath: string): void;
    /**
     * Load encrypted key from file
     */
    loadEncryptedKey(filePath: string): EncryptedKeyFile;
    /**
     * Initialize security: Generate keys and encrypt them
     * @param publicPassword Password for public key (600K iterations)
     * @param privatePassword Password for private key (1M iterations)
     * @returns KeyPair and thumbprint
     */
    initialize(publicPassword: string, privatePassword: string): Promise<KeyPair>;
    /**
     * Load and decrypt keys
     * @param publicPassword Password for public key
     * @param privatePassword Password for private key (optional, if only verification needed)
     * @returns Decrypted keys
     */
    loadKeys(publicPassword: string, privatePassword?: string): Partial<KeyPair>;
    /**
     * Check if keys exist
     */
    keysExist(): {
        public: boolean;
        private: boolean;
    };
    /**
     * Get certificate thumbprint from stored public key
     */
    getStoredThumbprint(publicPassword: string): string;
}
//# sourceMappingURL=CertificateManager.d.ts.map