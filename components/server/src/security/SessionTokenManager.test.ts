import { SessionTokenManager } from './SessionTokenManager';
import * as crypto from 'crypto';

describe('SessionTokenManager', () => {
    describe('constructor', () => {
        it('should generate random 256-bit secret by default', () => {
            const manager1 = new SessionTokenManager();
            const manager2 = new SessionTokenManager();
            
            expect(manager1.getSecret()).toHaveLength(32);
            expect(manager2.getSecret()).toHaveLength(32);
            expect(manager1.getSecret()).not.toEqual(manager2.getSecret());
        });

        it('should accept provided session secret', () => {
            const secret = crypto.randomBytes(32);
            const manager = new SessionTokenManager(secret);
            
            expect(manager.getSecret()).toEqual(secret);
        });

        it('should reject invalid secret length', () => {
            const shortSecret = crypto.randomBytes(16);
            
            expect(() => new SessionTokenManager(shortSecret)).toThrow(
                'Session secret must be 32 bytes (256 bits)'
            );
        });

        it('should use 5s expiry in production mode', () => {
            const manager = new SessionTokenManager(undefined, false);
            expect(manager.getExpirySeconds()).toBe(5);
        });

        it('should use 60s expiry in development mode', () => {
            const manager = new SessionTokenManager(undefined, true);
            expect(manager.getExpirySeconds()).toBe(60);
        });
    });

    describe('generateToken', () => {
        it('should generate token in correct format', () => {
            const manager = new SessionTokenManager();
            const token = manager.generateToken();
            
            const parts = token.split(':');
            expect(parts).toHaveLength(3);
            
            const [timestamp, nonce, hmac] = parts;
            expect(parseInt(timestamp, 10)).toBeGreaterThan(0);
            expect(nonce).toHaveLength(64); // 32 bytes = 64 hex chars
            expect(hmac).toHaveLength(64); // SHA256 = 64 hex chars
        });

        it('should generate unique tokens', () => {
            const manager = new SessionTokenManager();
            const token1 = manager.generateToken();
            const token2 = manager.generateToken();
            
            expect(token1).not.toBe(token2);
        });

        it('should generate tokens with current timestamp', () => {
            const manager = new SessionTokenManager();
            const before = Math.floor(Date.now() / 1000);
            const token = manager.generateToken();
            const after = Math.floor(Date.now() / 1000);
            
            const [timestamp] = token.split(':');
            const tokenTime = parseInt(timestamp, 10);
            
            expect(tokenTime).toBeGreaterThanOrEqual(before);
            expect(tokenTime).toBeLessThanOrEqual(after);
        });
    });

    describe('verifyToken', () => {
        it('should verify valid token', () => {
            const secret = crypto.randomBytes(32);
            const manager = new SessionTokenManager(secret);
            
            const token = manager.generateToken();
            const result = manager.verifyToken(token);
            
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should reject token with invalid format', () => {
            const manager = new SessionTokenManager();
            
            const result = manager.verifyToken('invalid-token');
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid token format');
        });

        it('should reject token with invalid timestamp', () => {
            const manager = new SessionTokenManager();
            const token = 'notanumber:' + crypto.randomBytes(32).toString('hex') + ':' + crypto.randomBytes(32).toString('hex');
            
            const result = manager.verifyToken(token);
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid timestamp');
        });

        it('should reject expired token', () => {
            const secret = crypto.randomBytes(32);
            const manager = new SessionTokenManager(secret, false); // 5s expiry
            
            // Create token with old timestamp
            const oldTimestamp = Math.floor(Date.now() / 1000) - 10;
            const nonce = crypto.randomBytes(32).toString('hex');
            const message = `${oldTimestamp}:${nonce}`;
            const hmac = crypto.createHmac('sha256', secret).update(message).digest('hex');
            const token = `${message}:${hmac}`;
            
            const result = manager.verifyToken(token);
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('Token expired');
        });

        it('should reject token from future', () => {
            const secret = crypto.randomBytes(32);
            const manager = new SessionTokenManager(secret);
            
            // Create token with future timestamp (beyond clock skew tolerance)
            const futureTimestamp = Math.floor(Date.now() / 1000) + 10;
            const nonce = crypto.randomBytes(32).toString('hex');
            const message = `${futureTimestamp}:${nonce}`;
            const hmac = crypto.createHmac('sha256', secret).update(message).digest('hex');
            const token = `${message}:${hmac}`;
            
            const result = manager.verifyToken(token);
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Token timestamp in future');
        });

        it('should reject token with invalid HMAC', () => {
            const manager = new SessionTokenManager();
            
            const timestamp = Math.floor(Date.now() / 1000);
            const nonce = crypto.randomBytes(32).toString('hex');
            const invalidHmac = crypto.randomBytes(32).toString('hex');
            const token = `${timestamp}:${nonce}:${invalidHmac}`;
            
            const result = manager.verifyToken(token);
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid HMAC signature');
        });

        it('should detect token replay (nonce reuse)', () => {
            const secret = crypto.randomBytes(32);
            const manager = new SessionTokenManager(secret);
            
            const token = manager.generateToken();
            
            // First verification should succeed
            const result1 = manager.verifyToken(token);
            expect(result1.success).toBe(true);
            
            // Second verification should fail (replay)
            const result2 = manager.verifyToken(token);
            expect(result2.success).toBe(false);
            expect(result2.error).toContain('Token replay detected');
        });

        it('should accept valid token within expiry window', () => {
            const secret = crypto.randomBytes(32);
            const manager = new SessionTokenManager(secret, false); // 5s expiry
            
            // Create token with timestamp 2 seconds ago
            const recentTimestamp = Math.floor(Date.now() / 1000) - 2;
            const nonce = crypto.randomBytes(32).toString('hex');
            const message = `${recentTimestamp}:${nonce}`;
            const hmac = crypto.createHmac('sha256', secret).update(message).digest('hex');
            const token = `${message}:${hmac}`;
            
            const result = manager.verifyToken(token);
            
            expect(result.success).toBe(true);
        });

        it('should bypass verification when SKIP_SESSION_AUTH=true', () => {
            const originalEnv = process.env.SKIP_SESSION_AUTH;
            process.env.SKIP_SESSION_AUTH = 'true';
            
            const manager = new SessionTokenManager();
            const result = manager.verifyToken('completely-invalid-token');
            
            expect(result.success).toBe(true);
            
            // Restore environment
            if (originalEnv !== undefined) {
                process.env.SKIP_SESSION_AUTH = originalEnv;
            } else {
                delete process.env.SKIP_SESSION_AUTH;
            }
        });
    });

    describe('nonce cache management', () => {
        it('should track used nonces', () => {
            const secret = crypto.randomBytes(32);
            const manager = new SessionTokenManager(secret);
            
            expect(manager.getNonceCacheSize()).toBe(0);
            
            const token = manager.generateToken();
            manager.verifyToken(token);
            
            expect(manager.getNonceCacheSize()).toBe(1);
        });

        it('should clear nonce cache', () => {
            const secret = crypto.randomBytes(32);
            const manager = new SessionTokenManager(secret);
            
            const token = manager.generateToken();
            manager.verifyToken(token);
            expect(manager.getNonceCacheSize()).toBe(1);
            
            manager.clearNonceCache();
            expect(manager.getNonceCacheSize()).toBe(0);
        });

        it('should prevent memory leak by limiting cache size', () => {
            const secret = crypto.randomBytes(32);
            const manager = new SessionTokenManager(secret, true); // 60s expiry for testing
            
            // Generate and verify many tokens
            for (let i = 0; i < 12000; i++) {
                const token = manager.generateToken();
                manager.verifyToken(token);
            }
            
            // Cache should be limited to maxNonceCache (10000)
            expect(manager.getNonceCacheSize()).toBeLessThanOrEqual(10000);
        });
    });

    describe('fromEnvironment', () => {
        it('should create manager from environment variable', () => {
            const secret = crypto.randomBytes(32);
            const secretHex = secret.toString('hex');
            
            const originalEnv = process.env.MCP_SESSION_SECRET;
            process.env.MCP_SESSION_SECRET = secretHex;
            
            const manager = SessionTokenManager.fromEnvironment();
            expect(manager.getSecret()).toEqual(secret);
            
            // Restore environment
            if (originalEnv !== undefined) {
                process.env.MCP_SESSION_SECRET = originalEnv;
            } else {
                delete process.env.MCP_SESSION_SECRET;
            }
        });

        it('should create manager from custom environment variable', () => {
            const secret = crypto.randomBytes(32);
            const secretHex = secret.toString('hex');
            
            const originalEnv = process.env.CUSTOM_SECRET;
            process.env.CUSTOM_SECRET = secretHex;
            
            const manager = SessionTokenManager.fromEnvironment('CUSTOM_SECRET');
            expect(manager.getSecret()).toEqual(secret);
            
            // Restore environment
            if (originalEnv !== undefined) {
                process.env.CUSTOM_SECRET = originalEnv;
            } else {
                delete process.env.CUSTOM_SECRET;
            }
        });

        it('should throw error if environment variable not set', () => {
            const originalEnv = process.env.NONEXISTENT_VAR;
            delete process.env.NONEXISTENT_VAR;
            
            expect(() => SessionTokenManager.fromEnvironment('NONEXISTENT_VAR')).toThrow(
                'Environment variable NONEXISTENT_VAR not set'
            );
            
            // Restore environment
            if (originalEnv !== undefined) {
                process.env.NONEXISTENT_VAR = originalEnv;
            }
        });

        it('should throw error if environment variable has invalid length', () => {
            const originalEnv = process.env.INVALID_SECRET;
            process.env.INVALID_SECRET = crypto.randomBytes(16).toString('hex'); // Only 16 bytes
            
            expect(() => SessionTokenManager.fromEnvironment('INVALID_SECRET')).toThrow(
                'INVALID_SECRET must be 64 hex characters (32 bytes)'
            );
            
            // Restore environment
            if (originalEnv !== undefined) {
                process.env.INVALID_SECRET = originalEnv;
            } else {
                delete process.env.INVALID_SECRET;
            }
        });

        it('should respect development mode flag', () => {
            const secret = crypto.randomBytes(32);
            const secretHex = secret.toString('hex');
            
            const originalEnv = process.env.TEST_SECRET;
            process.env.TEST_SECRET = secretHex;
            
            const prodManager = SessionTokenManager.fromEnvironment('TEST_SECRET', false);
            expect(prodManager.getExpirySeconds()).toBe(5);
            
            const devManager = SessionTokenManager.fromEnvironment('TEST_SECRET', true);
            expect(devManager.getExpirySeconds()).toBe(60);
            
            // Restore environment
            if (originalEnv !== undefined) {
                process.env.TEST_SECRET = originalEnv;
            } else {
                delete process.env.TEST_SECRET;
            }
        });
    });

    describe('exportSecret', () => {
        it('should export secret as hex string', () => {
            const secret = crypto.randomBytes(32);
            const manager = new SessionTokenManager(secret);
            
            const exported = manager.exportSecret();
            
            expect(exported).toBe(secret.toString('hex'));
            expect(exported).toHaveLength(64); // 32 bytes = 64 hex chars
        });

        it('should allow round-trip (export and import)', () => {
            const manager1 = new SessionTokenManager();
            const exported = manager1.exportSecret();
            
            const manager2 = new SessionTokenManager(Buffer.from(exported, 'hex'));
            
            expect(manager2.getSecret()).toEqual(manager1.getSecret());
            
            // Verify they can validate each other's tokens
            const token1 = manager1.generateToken();
            const token2 = manager2.generateToken();
            
            expect(manager2.verifyToken(token1).success).toBe(true);
            expect(manager1.verifyToken(token2).success).toBe(true);
        });
    });

    describe('integration', () => {
        it('should enable secure communication between MCP and KeyWin', () => {
            // Simulate MCP server
            const mcpManager = new SessionTokenManager();
            const sessionSecret = mcpManager.exportSecret();
            
            // Simulate KeyWin receiving secret via environment
            const originalEnv = process.env.MCP_SESSION_SECRET;
            process.env.MCP_SESSION_SECRET = sessionSecret;
            const keywinManager = SessionTokenManager.fromEnvironment();
            
            // MCP generates token
            const token = mcpManager.generateToken();
            
            // KeyWin verifies token
            const result = keywinManager.verifyToken(token);
            expect(result.success).toBe(true);
            
            // Restore environment
            if (originalEnv !== undefined) {
                process.env.MCP_SESSION_SECRET = originalEnv;
            } else {
                delete process.env.MCP_SESSION_SECRET;
            }
        });

        it('should reject token from different session', () => {
            const manager1 = new SessionTokenManager();
            const manager2 = new SessionTokenManager();
            
            const token = manager1.generateToken();
            const result = manager2.verifyToken(token);
            
            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid HMAC signature');
        });
    });

    // ─── Admin token ──────────────────────────────────────────────────────────

    describe('generateAdminToken', () => {
        const ADMIN_PASSWORD = 'admin-test-pw-xyz';
        let manager: SessionTokenManager;

        beforeEach(() => {
            // Use a fixed secret and a known password so tests are deterministic.
            manager = new SessionTokenManager(crypto.randomBytes(32));
            process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
        });

        afterEach(() => {
            delete process.env.ADMIN_PASSWORD;
        });

        it('returns null for wrong password', () => {
            expect(manager.generateAdminToken('wrongpassword')).toBeNull();
        });

        it('returns null for empty string password', () => {
            expect(manager.generateAdminToken('')).toBeNull();
        });

        it('returns a non-empty base64 string for the correct password', () => {
            const token = manager.generateAdminToken(ADMIN_PASSWORD);
            expect(typeof token).toBe('string');
            expect((token as string).length).toBeGreaterThan(20);
        });

        it('tokens are unique (different nonces each call)', () => {
            const token1 = manager.generateAdminToken(ADMIN_PASSWORD);
            const token2 = manager.generateAdminToken(ADMIN_PASSWORD);
            expect(token1).not.toBe(token2);
        });

        it('default duration is 15 minutes', () => {
            const before = Math.floor(Date.now() / 1000);
            const token = manager.generateAdminToken(ADMIN_PASSWORD) as string;
            const after  = Math.floor(Date.now() / 1000);

            const decoded = Buffer.from(token, 'base64').toString();
            const msg = decoded.substring(0, decoded.lastIndexOf(':'));
            const data = JSON.parse(msg);

            const expectedExpiry = before + 15 * 60;
            expect(data.expiry).toBeGreaterThanOrEqual(expectedExpiry);
            expect(data.expiry).toBeLessThanOrEqual(after + 15 * 60);
        });

        it('custom duration is respected', () => {
            const before = Math.floor(Date.now() / 1000);
            const token  = manager.generateAdminToken(ADMIN_PASSWORD, 5) as string;
            const after  = Math.floor(Date.now() / 1000);

            const decoded = Buffer.from(token, 'base64').toString();
            const msg  = decoded.substring(0, decoded.lastIndexOf(':'));
            const data = JSON.parse(msg);

            const expectedExpiry = before + 5 * 60;
            expect(data.expiry).toBeGreaterThanOrEqual(expectedExpiry);
            expect(data.expiry).toBeLessThanOrEqual(after + 5 * 60);
        });

        it('token payload contains type=admin and required fields', () => {
            const token = manager.generateAdminToken(ADMIN_PASSWORD) as string;
            const decoded = Buffer.from(token, 'base64').toString();
            const msg  = decoded.substring(0, decoded.lastIndexOf(':'));
            const data = JSON.parse(msg);

            expect(data.type).toBe('admin');
            expect(typeof data.timestamp).toBe('number');
            expect(typeof data.expiry).toBe('number');
            expect(Array.isArray(data.privileges)).toBe(true);
            expect(data.privileges).toContain('BYPASS_FILTERS');
            expect(data.privileges).toContain('MODIFY_CONFIG');
        });
    });

    describe('validateAdminToken', () => {
        const ADMIN_PASSWORD = 'admin-validate-pw-xyz';
        let manager: SessionTokenManager;

        beforeEach(() => {
            manager = new SessionTokenManager(crypto.randomBytes(32));
            process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
        });

        afterEach(() => {
            delete process.env.ADMIN_PASSWORD;
        });

        it('valid freshly-generated token → { valid:true, expired:false }', () => {
            const token  = manager.generateAdminToken(ADMIN_PASSWORD) as string;
            const result = manager.validateAdminToken(token);
            expect(result.valid).toBe(true);
            expect(result.expired).toBe(false);
        });

        it('valid token includes decoded data', () => {
            const token  = manager.generateAdminToken(ADMIN_PASSWORD) as string;
            const result = manager.validateAdminToken(token);
            expect(result.data).toBeDefined();
            expect(result.data.type).toBe('admin');
            expect(Array.isArray(result.data.privileges)).toBe(true);
        });

        it('tampered token (altered base64) → { valid:false, expired:false }', () => {
            const token   = manager.generateAdminToken(ADMIN_PASSWORD) as string;
            const tampered = token.slice(0, -4) + 'ZZZZ';
            const result  = manager.validateAdminToken(tampered);
            expect(result.valid).toBe(false);
        });

        it('garbage string → { valid:false, expired:false }', () => {
            const result = manager.validateAdminToken('not-a-token-at-all');
            expect(result.valid).toBe(false);
            expect(result.expired).toBe(false);
        });

        it('empty string → { valid:false, expired:false }', () => {
            const result = manager.validateAdminToken('');
            expect(result.valid).toBe(false);
            expect(result.expired).toBe(false);
        });

        it('expired token → { valid:false, expired:true }', () => {
            const secret = manager.getSecret();
            // Build token with expiry = 1 second ago
            const timestamp = Math.floor(Date.now() / 1000) - 120;   // 2 min ago
            const expiry    = timestamp + 60;                          // expired 1 min ago
            const nonce = crypto.randomBytes(16).toString('hex');
            const tokenData = { type: 'admin', timestamp, expiry, privileges: [], nonce };
            const message  = JSON.stringify(tokenData);
            const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
            const raw       = Buffer.from(`${message}:${signature}`).toString('base64');

            const result = manager.validateAdminToken(raw);
            expect(result.valid).toBe(false);
            expect(result.expired).toBe(true);
        });

        it('token from a different manager instance (different secret) → invalid', () => {
            const otherManager = new SessionTokenManager(crypto.randomBytes(32));
            process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;   // ensure same password  
            const token = otherManager.generateAdminToken(ADMIN_PASSWORD) as string;

            const result = manager.validateAdminToken(token);
            expect(result.valid).toBe(false);
        });

        it('non-admin token type → invalid', () => {
            const secret = manager.getSecret();
            const now     = Math.floor(Date.now() / 1000);
            const tokenData = { type: 'session', timestamp: now, expiry: now + 3600, nonce: 'abc' };
            const message   = JSON.stringify(tokenData);
            const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
            const raw       = Buffer.from(`${message}:${signature}`).toString('base64');

            const result = manager.validateAdminToken(raw);
            expect(result.valid).toBe(false);
            expect(result.expired).toBe(false);
        });

        it('uses default password "admin123" when ADMIN_PASSWORD env var unset', () => {
            delete process.env.ADMIN_PASSWORD;
            const freshSecret = crypto.randomBytes(32);
            const freshManager = new SessionTokenManager(freshSecret);
            const token = freshManager.generateAdminToken('admin123');
            expect(token).not.toBeNull();
            const result = freshManager.validateAdminToken(token as string);
            expect(result.valid).toBe(true);
        });
    });
});
