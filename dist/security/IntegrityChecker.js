"use strict";
/**
 * IntegrityChecker - Verify binary integrity against signed hashes
 *
 * Implements:
 * - SHA-256 hash calculation of binaries
 * - Hash verification against signed config
 * - Self-integrity check for MCP server and KeyWin.exe
 * - Development mode bypass
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
exports.IntegrityChecker = void 0;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ConfigSigner_1 = require("./ConfigSigner");
class IntegrityChecker {
    constructor(rootDir) {
        this.rootDir = rootDir || process.cwd();
        this.configSigner = new ConfigSigner_1.ConfigSigner(path.join(this.rootDir, 'security'));
    }
    /**
     * Calculate SHA-256 hash of file
     */
    calculateFileHash(filePath) {
        const content = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
    }
    /**
     * Check if binary exists and is readable
     */
    checkBinaryExists(binaryPath) {
        const fullPath = path.join(this.rootDir, binaryPath);
        if (!fs.existsSync(fullPath)) {
            return { exists: false, error: 'Binary not found' };
        }
        try {
            fs.accessSync(fullPath, fs.constants.R_OK);
            return { exists: true };
        }
        catch (err) {
            return { exists: false, error: 'Binary not readable' };
        }
    }
    /**
     * Verify single binary against expected hash
     */
    verifyBinary(binaryName, expectedHash) {
        const fullPath = path.join(this.rootDir, expectedHash.path);
        // Check existence
        const existsCheck = this.checkBinaryExists(expectedHash.path);
        if (!existsCheck.exists) {
            return {
                valid: false,
                binary: binaryName,
                path: expectedHash.path,
                error: existsCheck.error,
                expectedHash: expectedHash.sha256
            };
        }
        // Calculate hash
        const actualHash = this.calculateFileHash(fullPath);
        // Verify match
        const valid = actualHash === expectedHash.sha256;
        return {
            valid,
            binary: binaryName,
            path: expectedHash.path,
            expectedHash: expectedHash.sha256,
            actualHash,
            error: valid ? undefined : 'Hash mismatch'
        };
    }
    /**
     * Verify all binaries in config
     * @param config Configuration object with binaryHashes
     * @returns Integrity check results
     */
    verifyAll(config) {
        // Check for development bypass
        if (process.env.SKIP_INTEGRITY_CHECK === 'true') {
            console.log('⚠ Binary integrity check bypassed (SKIP_INTEGRITY_CHECK=true)');
            return {
                allValid: true,
                results: [],
                bypassed: true
            };
        }
        // Check if config has binary hashes
        if (!config.binaryHashes) {
            console.log('⚠ No binary hashes in config - cannot verify integrity');
            return {
                allValid: false,
                results: [],
                bypassed: false
            };
        }
        // Verify each binary
        const results = [];
        for (const [binaryName, hashInfo] of Object.entries(config.binaryHashes)) {
            const result = this.verifyBinary(binaryName, hashInfo);
            results.push(result);
        }
        const allValid = results.every(r => r.valid);
        // Log results
        const validCount = results.filter(r => r.valid).length;
        const totalCount = results.length;
        if (allValid) {
            console.log(`✓ Binary integrity verified: ${validCount}/${totalCount} binaries valid`);
        }
        else {
            console.error(`✗ Binary integrity check FAILED: ${validCount}/${totalCount} binaries valid`);
            results.filter(r => !r.valid).forEach(r => {
                console.error(`  - ${r.binary}: ${r.error}`);
            });
        }
        return {
            allValid,
            results,
            bypassed: false
        };
    }
    /**
     * Verify integrity with signed config
     * @param publicPassword Password to decrypt public key
     * @returns Integrity check results
     */
    async verifyWithSignedConfig(publicPassword) {
        // Verify config signature
        const configResult = this.configSigner.verifyConfig(publicPassword);
        if (!configResult.valid) {
            throw new Error(`Config verification failed: ${configResult.error}`);
        }
        // Verify binaries
        return this.verifyAll(configResult.config);
    }
    /**
     * Self-check: Verify integrity of specific binary (for startup checks)
     * @param binaryKey Key in binaryHashes (e.g., 'keywin', 'mcpServer')
     * @param config Configuration object
     * @returns Whether binary is valid
     */
    selfCheck(binaryKey, config) {
        // Development bypass
        if (process.env.SKIP_INTEGRITY_CHECK === 'true') {
            return true;
        }
        if (!config.binaryHashes || !config.binaryHashes[binaryKey]) {
            console.warn(`⚠ No hash found for ${binaryKey} - cannot verify`);
            return false;
        }
        const result = this.verifyBinary(binaryKey, config.binaryHashes[binaryKey]);
        if (!result.valid) {
            console.error(`✗ Self-check FAILED for ${binaryKey}: ${result.error}`);
            if (result.expectedHash && result.actualHash) {
                console.error(`  Expected: ${result.expectedHash.substring(0, 16)}...`);
                console.error(`  Actual:   ${result.actualHash.substring(0, 16)}...`);
            }
            return false;
        }
        console.log(`✓ Self-check passed for ${binaryKey}`);
        return true;
    }
    /**
     * Get hash of specific binary (for verification)
     */
    getBinaryHash(binaryPath) {
        const fullPath = path.join(this.rootDir, binaryPath);
        return this.calculateFileHash(fullPath);
    }
    /**
     * Development mode: Check integrity with warnings only (non-fatal)
     */
    checkDevelopmentMode(config) {
        if (config.developmentMode?.enabled !== true) {
            return;
        }
        console.log('🔧 Development mode: Running non-fatal integrity checks...');
        const result = this.verifyAll(config);
        if (!result.allValid && !result.bypassed) {
            console.warn('⚠ Development mode: Some binaries failed integrity check');
            console.warn('   This is non-fatal in development mode');
            result.results.filter(r => !r.valid).forEach(r => {
                console.warn(`   - ${r.binary}: ${r.error}`);
            });
        }
    }
}
exports.IntegrityChecker = IntegrityChecker;
//# sourceMappingURL=IntegrityChecker.js.map