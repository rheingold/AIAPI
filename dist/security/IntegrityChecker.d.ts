/**
 * IntegrityChecker - Verify binary integrity against signed hashes
 *
 * Implements:
 * - SHA-256 hash calculation of binaries
 * - Hash verification against signed config
 * - Self-integrity check for MCP server and KeyWin.exe
 * - Development mode bypass
 */
import { BinaryHash } from './ConfigSigner';
export interface IntegrityResult {
    valid: boolean;
    binary: string;
    path: string;
    error?: string;
    expectedHash?: string;
    actualHash?: string;
}
export interface IntegrityCheckResult {
    allValid: boolean;
    results: IntegrityResult[];
    bypassed: boolean;
}
export declare class IntegrityChecker {
    private readonly configSigner;
    private readonly rootDir;
    constructor(rootDir?: string);
    /**
     * Calculate SHA-256 hash of file
     */
    private calculateFileHash;
    /**
     * Check if binary exists and is readable
     */
    private checkBinaryExists;
    /**
     * Verify single binary against expected hash
     */
    verifyBinary(binaryName: string, expectedHash: BinaryHash): IntegrityResult;
    /**
     * Verify all binaries in config
     * @param config Configuration object with binaryHashes
     * @returns Integrity check results
     */
    verifyAll(config: any): IntegrityCheckResult;
    /**
     * Verify integrity with signed config
     * @param publicPassword Password to decrypt public key
     * @returns Integrity check results
     */
    verifyWithSignedConfig(publicPassword: string): Promise<IntegrityCheckResult>;
    /**
     * Self-check: Verify integrity of specific binary (for startup checks)
     * @param binaryKey Key in binaryHashes (e.g., 'keywin', 'mcpServer')
     * @param config Configuration object
     * @returns Whether binary is valid
     */
    selfCheck(binaryKey: string, config: any): boolean;
    /**
     * Get hash of specific binary (for verification)
     */
    getBinaryHash(binaryPath: string): string;
    /**
     * Development mode: Check integrity with warnings only (non-fatal)
     */
    checkDevelopmentMode(config: any): void;
}
//# sourceMappingURL=IntegrityChecker.d.ts.map