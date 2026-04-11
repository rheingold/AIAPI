/**
 * ConfigSigner - Sign and verify configuration files
 * 
 * Implements:
 * - RSA-SHA256 signature of config.json
 * - Signature verification with public key
 * - Binary hash storage and verification
 * - Development mode bypass
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CertificateManager } from './CertificateManager';

export interface ConfigSignature {
    signature: string;      // Base64 encoded RSA signature
    algorithm: string;      // "RSA-SHA256"
    timestamp: string;      // ISO 8601 timestamp
    configHash: string;     // SHA-256 hash of config content
    thumbprint: string;     // Certificate thumbprint
}

export interface SignedConfig {
    config: any;            // The actual configuration object
    signature: ConfigSignature;
}

export interface BinaryHash {
    path: string;           // Relative path to binary
    sha256: string;         // SHA-256 hash
    size: number;           // File size in bytes
    lastModified: string;   // ISO 8601 timestamp
}

export class ConfigSigner {
    private readonly securityDir: string;
    private readonly configPath: string;
    private readonly signaturePath: string;
    private readonly certManager: CertificateManager;

    constructor(securityDir?: string) {
        this.securityDir = securityDir || path.join(process.cwd(), 'security');
        this.configPath = path.join(this.securityDir, 'config.json');
        this.signaturePath = path.join(this.securityDir, 'config.json.sig');
        this.certManager = new CertificateManager(this.securityDir);
    }

    /**
     * Calculate SHA-256 hash of file
     */
    private calculateFileHash(filePath: string): string {
        const content = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
    }

    /**
     * Calculate SHA-256 hash of string content
     */
    private calculateContentHash(content: string): string {
        return crypto.createHash('sha256').update(content, 'utf8').digest('hex').toUpperCase();
    }

    /**
     * Get binary hashes for all critical binaries
     */
    getBinaryHashes(): { [key: string]: BinaryHash } {
        const binaries: { [key: string]: BinaryHash } = {};
        
        const binaryPaths = [
            { key: 'keywin', path: path.join(process.cwd(), 'dist', 'win', 'KeyWin.exe') },
            { key: 'mcpServer', path: path.join(process.cwd(), 'dist', 'server', 'mcpServer.js') },
            { key: 'automationEngine', path: path.join(process.cwd(), 'dist', 'engine', 'automationEngine.js') }
        ];

        for (const binary of binaryPaths) {
            if (fs.existsSync(binary.path)) {
                const stats = fs.statSync(binary.path);
                binaries[binary.key] = {
                    path: path.relative(process.cwd(), binary.path),
                    sha256: this.calculateFileHash(binary.path),
                    size: stats.size,
                    lastModified: stats.mtime.toISOString()
                };
            }
        }

        return binaries;
    }

    /**
     * Sign configuration file with private key
     * @param privatePassword Password to decrypt private key
     * @param addBinaryHashes Whether to add binary hashes to config before signing
     * @returns Signature metadata
     */
    signConfig(privatePassword: string, addBinaryHashes: boolean = true): ConfigSignature {
        // Load config
        if (!fs.existsSync(this.configPath)) {
            throw new Error(`Config file not found: ${this.configPath}`);
        }

        const configContent = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(configContent);

        // Add binary hashes if requested
        if (addBinaryHashes) {
            const binaryHashes = this.getBinaryHashes();
            if (Object.keys(binaryHashes).length > 0) {
                config.binaryHashes = binaryHashes;
                
                // Write updated config back
                fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
                console.log(`Added ${Object.keys(binaryHashes).length} binary hashes to config`);
            }
        }

        // Load private key
        const keys = this.certManager.loadKeys(privatePassword, privatePassword);
        if (!keys.privateKey) {
            throw new Error('Private key not loaded');
        }

        // Calculate config hash (after potentially adding binary hashes)
        const finalConfigContent = fs.readFileSync(this.configPath, 'utf8');
        const configHash = this.calculateContentHash(finalConfigContent);

        // Sign the config content
        const signature = crypto.sign('sha256', Buffer.from(finalConfigContent, 'utf8'), {
            key: keys.privateKey,
            padding: crypto.constants.RSA_PKCS1_PADDING
        });

        // Get thumbprint (use public key from the same load)
        const thumbprint = crypto.createHash('sha256').update(keys.publicKey!).digest('hex').toUpperCase();

        const signatureMetadata: ConfigSignature = {
            signature: signature.toString('base64'),
            algorithm: 'RSA-SHA256',
            timestamp: new Date().toISOString(),
            configHash,
            thumbprint
        };

        // Save signature to file
        fs.writeFileSync(this.signaturePath, JSON.stringify(signatureMetadata, null, 2), 'utf8');
        console.log(`Config signed successfully. Hash: ${configHash.substring(0, 16)}...`);

        return signatureMetadata;
    }

    /**
     * Verify configuration signature with public key
     * @param publicPassword Password to decrypt public key
     * @returns Verification result and config object
     */
    verifyConfig(publicPassword: string): { valid: boolean; config?: any; error?: string } {
        // Check for development bypass
        if (process.env.SKIP_CONFIG_SIGNATURE === 'true') {
            console.log('WARNING: Config signature verification skipped (SKIP_CONFIG_SIGNATURE=true)');
            const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            return { valid: true, config };
        }

        // Load config
        if (!fs.existsSync(this.configPath)) {
            return { valid: false, error: 'Config file not found' };
        }

        // Load signature
        if (!fs.existsSync(this.signaturePath)) {
            return { valid: false, error: 'Signature file not found' };
        }

        const configContent = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(configContent);
        const signatureMetadata = JSON.parse(fs.readFileSync(this.signaturePath, 'utf8')) as ConfigSignature;

        // Verify config hash
        const currentHash = this.calculateContentHash(configContent);
        if (currentHash !== signatureMetadata.configHash) {
            return { 
                valid: false, 
                error: `Config hash mismatch. Expected: ${signatureMetadata.configHash.substring(0, 16)}..., Got: ${currentHash.substring(0, 16)}...` 
            };
        }

        // Load public key
        const keys = this.certManager.loadKeys(publicPassword);
        if (!keys.publicKey) {
            return { valid: false, error: 'Public key not loaded' };
        }

        // Verify signature
        const signatureBuffer = Buffer.from(signatureMetadata.signature, 'base64');
        const isValid = crypto.verify(
            'sha256',
            Buffer.from(configContent, 'utf8'),
            {
                key: keys.publicKey,
                padding: crypto.constants.RSA_PKCS1_PADDING
            },
            signatureBuffer
        );

        if (!isValid) {
            return { valid: false, error: 'Signature verification failed' };
        }

        console.log('✓ Config signature verified successfully');
        return { valid: true, config };
    }

    /**
     * Verify binary integrity against hashes in config
     * @param config Configuration object with binaryHashes
     * @returns Verification results
     */
    verifyBinaries(config: any): { [key: string]: { valid: boolean; error?: string } } {
        const results: { [key: string]: { valid: boolean; error?: string } } = {};

        // Check for development bypass
        if (process.env.SKIP_INTEGRITY_CHECK === 'true') {
            console.log('WARNING: Binary integrity check skipped (SKIP_INTEGRITY_CHECK=true)');
            return results;
        }

        if (!config.binaryHashes) {
            console.log('WARNING: No binary hashes in config');
            return results;
        }

        for (const [key, expectedHash] of Object.entries(config.binaryHashes)) {
            const hashInfo = expectedHash as BinaryHash;
            const fullPath = path.join(process.cwd(), hashInfo.path);

            if (!fs.existsSync(fullPath)) {
                results[key] = { valid: false, error: 'Binary not found' };
                continue;
            }

            const currentHash = this.calculateFileHash(fullPath);
            if (currentHash !== hashInfo.sha256) {
                results[key] = { 
                    valid: false, 
                    error: `Hash mismatch. Expected: ${hashInfo.sha256.substring(0, 16)}..., Got: ${currentHash.substring(0, 16)}...` 
                };
                continue;
            }

            results[key] = { valid: true };
        }

        const validCount = Object.values(results).filter(r => r.valid).length;
        const totalCount = Object.keys(results).length;
        console.log(`✓ Binary integrity verified: ${validCount}/${totalCount} binaries valid`);

        return results;
    }

    /**
     * Update binary hashes in config without changing signature
     * (Development mode only - requires re-signing after)
     */
    updateBinaryHashes(): void {
        if (!fs.existsSync(this.configPath)) {
            throw new Error('Config file not found');
        }

        const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        config.binaryHashes = this.getBinaryHashes();

        fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log('Binary hashes updated in config. Remember to re-sign!');
    }

    /**
     * Check if config is signed
     */
    isSigned(): boolean {
        return fs.existsSync(this.signaturePath);
    }

    /**
     * Remove signature (development mode)
     */
    removeSignature(): void {
        if (fs.existsSync(this.signaturePath)) {
            fs.unlinkSync(this.signaturePath);
            console.log('Signature removed');
        }
    }
}
