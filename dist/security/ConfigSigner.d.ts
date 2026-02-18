/**
 * ConfigSigner - Sign and verify configuration files
 *
 * Implements:
 * - RSA-SHA256 signature of config.json
 * - Signature verification with public key
 * - Binary hash storage and verification
 * - Development mode bypass
 */
export interface ConfigSignature {
    signature: string;
    algorithm: string;
    timestamp: string;
    configHash: string;
    thumbprint: string;
}
export interface SignedConfig {
    config: any;
    signature: ConfigSignature;
}
export interface BinaryHash {
    path: string;
    sha256: string;
    size: number;
    lastModified: string;
}
export declare class ConfigSigner {
    private readonly securityDir;
    private readonly configPath;
    private readonly signaturePath;
    private readonly certManager;
    constructor(securityDir?: string);
    /**
     * Calculate SHA-256 hash of file
     */
    private calculateFileHash;
    /**
     * Calculate SHA-256 hash of string content
     */
    private calculateContentHash;
    /**
     * Get binary hashes for all critical binaries
     */
    getBinaryHashes(): {
        [key: string]: BinaryHash;
    };
    /**
     * Sign configuration file with private key
     * @param privatePassword Password to decrypt private key
     * @param addBinaryHashes Whether to add binary hashes to config before signing
     * @returns Signature metadata
     */
    signConfig(privatePassword: string, addBinaryHashes?: boolean): ConfigSignature;
    /**
     * Verify configuration signature with public key
     * @param publicPassword Password to decrypt public key
     * @returns Verification result and config object
     */
    verifyConfig(publicPassword: string): {
        valid: boolean;
        config?: any;
        error?: string;
    };
    /**
     * Verify binary integrity against hashes in config
     * @param config Configuration object with binaryHashes
     * @returns Verification results
     */
    verifyBinaries(config: any): {
        [key: string]: {
            valid: boolean;
            error?: string;
        };
    };
    /**
     * Update binary hashes in config without changing signature
     * (Development mode only - requires re-signing after)
     */
    updateBinaryHashes(): void;
    /**
     * Check if config is signed
     */
    isSigned(): boolean;
    /**
     * Remove signature (development mode)
     */
    removeSignature(): void;
}
//# sourceMappingURL=ConfigSigner.d.ts.map