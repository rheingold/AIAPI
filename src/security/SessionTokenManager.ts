import * as crypto from 'crypto';

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
export class SessionTokenManager {
    private sessionSecret: Buffer;
    private usedNonces: Set<string> = new Set();
    private readonly developmentMode: boolean;
    private readonly tokenExpirySeconds: number;
    private readonly maxNonceCache: number = 10000; // Prevent memory leak

    /**
     * Create a new SessionTokenManager
     * @param sessionSecret Optional session secret (for testing). If not provided, generates random 256-bit secret.
     * @param developmentMode If true, uses 60s token expiry. If false, uses 5s expiry.
     */
    constructor(sessionSecret?: Buffer, developmentMode: boolean = false) {
        this.developmentMode = developmentMode;
        this.tokenExpirySeconds = developmentMode ? 60 : 5;
        
        if (sessionSecret) {
            if (sessionSecret.length !== 32) {
                throw new Error('Session secret must be 32 bytes (256 bits)');
            }
            this.sessionSecret = sessionSecret;
        } else {
            this.sessionSecret = crypto.randomBytes(32);
        }
    }

    /**
     * Generate a new session token
     * @returns Token string in format "timestamp:nonce:hmac"
     */
    generateToken(): string {
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
    verifyToken(token: string): { success: boolean; error?: string } {
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
    getSecret(): Buffer {
        return this.sessionSecret;
    }

    /**
     * Get the token expiry duration in seconds
     */
    getExpirySeconds(): number {
        return this.tokenExpirySeconds;
    }

    /**
     * Clear the nonce cache (for testing)
     */
    clearNonceCache(): void {
        this.usedNonces.clear();
    }

    /**
     * Get the number of cached nonces (for testing)
     */
    getNonceCacheSize(): number {
        return this.usedNonces.size;
    }

    /**
     * Create a SessionTokenManager from an environment variable
     * @param envVar Environment variable name containing the session secret (hex-encoded)
     * @param developmentMode If true, uses 60s token expiry
     * @returns SessionTokenManager instance
     */
    static fromEnvironment(envVar: string = 'MCP_SESSION_SECRET', developmentMode: boolean = false): SessionTokenManager {
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
     * Export session secret as hex string (for passing to child processes)
     */
    exportSecret(): string {
        return this.sessionSecret.toString('hex');
    }
}
