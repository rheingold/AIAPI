"use strict";
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
exports.SessionTokenManager = void 0;
const crypto = __importStar(require("crypto"));
/**
 * Session Token Manager for MCP <-> KeyWin.exe Authentication
 *
 * Implements HMAC-SHA256 session tokens with:
 * - Random 256-bit session secret
 * - Nonce tracking (replay protection)
 * - 5-second token expiry (60s in dev mode)
 *
 * Token format: `timestamp:nonce:hmac`
 * - timestamp: Unix timestamp in seconds (when token was created)
 * - nonce: Random 32-byte hex string
 * - hmac: HMAC-SHA256(secret, timestamp:nonce)
 */
class SessionTokenManager {
    /**
     * Create a new SessionTokenManager
     * @param sessionSecret Optional session secret (for testing). If not provided, generates random 256-bit secret.
     * @param developmentMode If true, uses 60s token expiry. If false, uses 5s expiry.
     */
    constructor(sessionSecret, developmentMode = false) {
        this.usedNonces = new Set();
        this.maxNonceCache = 10000; // Prevent memory leak
        this.developmentMode = developmentMode;
        this.tokenExpirySeconds = developmentMode ? 60 : 5;
        if (sessionSecret) {
            if (sessionSecret.length !== 32) {
                throw new Error('Session secret must be 32 bytes (256 bits)');
            }
            this.sessionSecret = sessionSecret;
        }
        else {
            this.sessionSecret = crypto.randomBytes(32);
        }
    }
    /**
     * Generate a new session token
     * @returns Token string in format "timestamp:nonce:hmac"
     */
    generateToken() {
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = crypto.randomBytes(32).toString('hex');
        const message = `${timestamp}:${nonce}`;
        const hmac = crypto.createHmac('sha256', this.sessionSecret)
            .update(message)
            .digest('hex');
        return `${message}:${hmac}`;
    }
    /**
     * Verify a session token
     * @param token Token string in format "timestamp:nonce:hmac"
     * @returns Object with success boolean and optional error message
     */
    verifyToken(token) {
        // Check for development bypass
        if (process.env.SKIP_SESSION_AUTH === 'true') {
            return { success: true };
        }
        // Parse token
        const parts = token.split(':');
        if (parts.length !== 3) {
            return { success: false, error: 'Invalid token format' };
        }
        const [timestampStr, nonce, providedHmac] = parts;
        const timestamp = parseInt(timestampStr, 10);
        // Check timestamp validity
        if (isNaN(timestamp)) {
            return { success: false, error: 'Invalid timestamp' };
        }
        // Check token expiry
        const now = Math.floor(Date.now() / 1000);
        const age = now - timestamp;
        if (age > this.tokenExpirySeconds) {
            return { success: false, error: `Token expired (age: ${age}s, max: ${this.tokenExpirySeconds}s)` };
        }
        if (age < -5) {
            // Token from future (clock skew tolerance: 5 seconds)
            return { success: false, error: 'Token timestamp in future' };
        }
        // Check nonce replay
        if (this.usedNonces.has(nonce)) {
            return { success: false, error: 'Token replay detected (nonce already used)' };
        }
        // Verify HMAC
        const message = `${timestamp}:${nonce}`;
        const expectedHmac = crypto.createHmac('sha256', this.sessionSecret)
            .update(message)
            .digest('hex');
        if (expectedHmac !== providedHmac) {
            return { success: false, error: 'Invalid HMAC signature' };
        }
        // Mark nonce as used
        this.usedNonces.add(nonce);
        // Cleanup old nonces to prevent memory leak
        if (this.usedNonces.size > this.maxNonceCache) {
            const noncesToDelete = Math.floor(this.maxNonceCache / 2);
            const iterator = this.usedNonces.values();
            for (let i = 0; i < noncesToDelete; i++) {
                const value = iterator.next().value;
                if (value) {
                    this.usedNonces.delete(value);
                }
            }
        }
        return { success: true };
    }
    /**
     * Get the session secret (for testing only)
     */
    getSecret() {
        return this.sessionSecret;
    }
    /**
     * Get the token expiry duration in seconds
     */
    getExpirySeconds() {
        return this.tokenExpirySeconds;
    }
    /**
     * Clear the nonce cache (for testing)
     */
    clearNonceCache() {
        this.usedNonces.clear();
    }
    /**
     * Get the number of cached nonces (for testing)
     */
    getNonceCacheSize() {
        return this.usedNonces.size;
    }
    /**
     * Create a SessionTokenManager from an environment variable
     * @param envVar Environment variable name containing the session secret (hex-encoded)
     * @param developmentMode If true, uses 60s token expiry
     * @returns SessionTokenManager instance
     */
    static fromEnvironment(envVar = 'MCP_SESSION_SECRET', developmentMode = false) {
        const secretHex = process.env[envVar];
        if (!secretHex) {
            throw new Error(`Environment variable ${envVar} not set`);
        }
        const secret = Buffer.from(secretHex, 'hex');
        if (secret.length !== 32) {
            throw new Error(`${envVar} must be 64 hex characters (32 bytes)`);
        }
        return new SessionTokenManager(secret, developmentMode);
    }
    /**
     * Generate an admin token with extended privileges
     * @param password Private key password for authentication
     * @param durationMinutes How long the admin token should be valid (default 15 minutes)
     * @returns Admin token or null if password invalid
     */
    generateAdminToken(password, durationMinutes = 15) {
        // In a real implementation, this would verify against the encrypted private key
        // For now, we'll use a simple password check
        const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';
        if (password !== expectedPassword) {
            return null; // Invalid password
        }
        const timestamp = Math.floor(Date.now() / 1000);
        const expiry = timestamp + (durationMinutes * 60);
        const nonce = crypto.randomBytes(16).toString('hex');
        const tokenData = {
            type: 'admin',
            timestamp,
            expiry,
            privileges: ['BYPASS_FILTERS', 'MODIFY_CONFIG'],
            nonce
        };
        const message = JSON.stringify(tokenData);
        const signature = crypto.createHmac('sha256', this.sessionSecret).update(message).digest('hex');
        // Return base64 encoded token
        const token = Buffer.from(`${message}:${signature}`).toString('base64');
        return token;
    }
    /**
     * Validate an admin token
     * @param token Admin token to validate
     * @returns Object with validation result and token data
     */
    validateAdminToken(token) {
        try {
            const decoded = Buffer.from(token, 'base64').toString();
            const lastColonIndex = decoded.lastIndexOf(':');
            if (lastColonIndex === -1) {
                return { valid: false, expired: false };
            }
            const message = decoded.substring(0, lastColonIndex);
            const signature = decoded.substring(lastColonIndex + 1);
            // Verify signature
            const expectedSignature = crypto.createHmac('sha256', this.sessionSecret).update(message).digest('hex');
            if (signature !== expectedSignature) {
                return { valid: false, expired: false };
            }
            // Parse token data
            const tokenData = JSON.parse(message);
            // Check if admin token
            if (tokenData.type !== 'admin') {
                return { valid: false, expired: false };
            }
            // Check expiry
            const currentTimestamp = Math.floor(Date.now() / 1000);
            if (currentTimestamp > tokenData.expiry) {
                return { valid: false, expired: true, data: tokenData };
            }
            return { valid: true, expired: false, data: tokenData };
        }
        catch (error) {
            return { valid: false, expired: false };
        }
    }
    /**
     * Export session secret as hex string (for passing to child processes)
     */
    exportSecret() {
        return this.sessionSecret.toString('hex');
    }
}
exports.SessionTokenManager = SessionTokenManager;
//# sourceMappingURL=SessionTokenManager.js.map