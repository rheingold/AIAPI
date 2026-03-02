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
export declare class SessionTokenManager {
    private sessionSecret;
    private usedNonces;
    private readonly developmentMode;
    private readonly tokenExpirySeconds;
    private readonly maxNonceCache;
    /**
     * Create a new SessionTokenManager
     * @param sessionSecret Optional session secret (for testing). If not provided, generates random 256-bit secret.
     * @param developmentMode If true, uses 60s token expiry. If false, uses 5s expiry.
     */
    constructor(sessionSecret?: Buffer, developmentMode?: boolean);
    /**
     * Generate a new session token
     * @returns Token string in format "timestamp:nonce:hmac"
     */
    generateToken(): string;
    /**
     * Verify a session token
     * @param token Token string in format "timestamp:nonce:hmac"
     * @returns Object with success boolean and optional error message
     */
    verifyToken(token: string): {
        success: boolean;
        error?: string;
    };
    /**
     * Get the session secret (for testing only)
     */
    getSecret(): Buffer;
    /**
     * Get the token expiry duration in seconds
     */
    getExpirySeconds(): number;
    /**
     * Clear the nonce cache (for testing)
     */
    clearNonceCache(): void;
    /**
     * Get the number of cached nonces (for testing)
     */
    getNonceCacheSize(): number;
    /**
     * Create a SessionTokenManager from an environment variable
     * @param envVar Environment variable name containing the session secret (hex-encoded)
     * @param developmentMode If true, uses 60s token expiry
     * @returns SessionTokenManager instance
     */
    static fromEnvironment(envVar?: string, developmentMode?: boolean): SessionTokenManager;
    /**
     * Generate an admin token with extended privileges
     * @param password Private key password for authentication
     * @param durationMinutes How long the admin token should be valid (default 15 minutes)
     * @returns Admin token or null if password invalid
     */
    generateAdminToken(password: string, durationMinutes?: number): string | null;
    /**
     * Validate an admin token
     * @param token Admin token to validate
     * @returns Object with validation result and token data
     */
    validateAdminToken(token: string): {
        valid: boolean;
        expired: boolean;
        data?: any;
    };
    /**
     * Export session secret as hex string (for passing to child processes)
     */
    exportSecret(): string;
}
//# sourceMappingURL=SessionTokenManager.d.ts.map