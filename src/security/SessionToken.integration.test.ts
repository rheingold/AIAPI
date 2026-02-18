/**
 * Integration test for Session Token Authentication (Phase 6)
 * 
 * Tests the complete flow:
 * 1. SessionTokenManager generates token
 * 2. Token passed to KeyWin.exe via environment
 * 3. KeyWin.exe verifies token using HMAC-SHA256
 * 4. Invalid tokens are rejected
 */

import { SessionTokenManager } from './SessionTokenManager';
import { spawn } from 'child_process';
import * as path from 'path';

const keywinPath = path.join(__dirname, '..', '..', 'dist', 'win', 'KeyWin.exe');

describe('Session Token Integration', () => {
    it('should execute KeyWin with valid session token', async () => {
        const manager = new SessionTokenManager(undefined, true); // dev mode for longer expiry
        const token = manager.generateToken();
        const secret = manager.exportSecret();

        const result = await executeKeyWin('{LISTWINDOWS}', token, secret);
        
        expect(result.success).toBe(true);
    }, 10000);

    it('should reject KeyWin execution with invalid token', async () => {
        const manager = new SessionTokenManager(undefined, true);
        const invalidToken = 'invalid:token:here';
        const secret = manager.exportSecret();

        const result = await executeKeyWin('{LISTWINDOWS}', invalidToken, secret);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('SESSION_AUTH_FAILED');
    }, 10000);

    it('should reject KeyWin execution with expired token', async () => {
        const manager = new SessionTokenManager(undefined, false); // production mode = 5s expiry
        const secret = manager.exportSecret();
        
        // Create token with old timestamp
        const oldTimestamp = Math.floor(Date.now() / 1000) - 10;
        const crypto = require('crypto');
        const nonce = crypto.randomBytes(32).toString('hex');
        const message = `${oldTimestamp}:${nonce}`;
        const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
            .update(message)
            .digest('hex');
        const expiredToken = `${message}:${hmac}`;

        const result = await executeKeyWin('{LISTWINDOWS}', expiredToken, secret, 'production');
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('SESSION_AUTH_FAILED');
    }, 10000);

    it('should reject KeyWin execution with wrong secret', async () => {
        const manager1 = new SessionTokenManager(undefined, true);
        const manager2 = new SessionTokenManager(undefined, true);
        
        const token = manager1.generateToken();
        const wrongSecret = manager2.exportSecret();

        const result = await executeKeyWin('{LISTWINDOWS}', token, wrongSecret);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('SESSION_AUTH_FAILED');
    }, 10000);

    it('should bypass authentication with SKIP_SESSION_AUTH=true', async () => {
        const originalEnv = process.env.SKIP_SESSION_AUTH;
        process.env.SKIP_SESSION_AUTH = 'true';

        try {
            // No valid token or secret
            const result = await executeKeyWinWithBypass('{LISTWINDOWS}');
            
            expect(result.success).toBe(true);
        } finally {
            // Restore environment
            if (originalEnv !== undefined) {
                process.env.SKIP_SESSION_AUTH = originalEnv;
            } else {
                delete process.env.SKIP_SESSION_AUTH;
            }
        }
    }, 10000);
});

/**
 * Execute KeyWin with session token
 */
function executeKeyWin(command: string, token: string, secret: string, nodeEnv: string = 'development'): Promise<any> {
    return new Promise((resolve) => {
        const env: any = {
            ...process.env,
            MCP_SESSION_TOKEN: token,
            MCP_SESSION_SECRET: secret,
            NODE_ENV: nodeEnv
        };
        
        // Explicitly unset bypass flag for these tests
        delete env.SKIP_SESSION_AUTH;

        let stdout = '';
        let stderr = '';

        const proc = spawn(keywinPath, [command], { env });

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (err) {
                resolve({ success: false, error: 'PARSE_ERROR', message: stdout || stderr });
            }
        });

        proc.on('error', (err) => {
            resolve({ success: false, error: 'SPAWN_ERROR', message: err.message });
        });
    });
}

/**
 * Execute KeyWin with bypass flag
 */
function executeKeyWinWithBypass(command: string): Promise<any> {
    return new Promise((resolve) => {
        const env = {
            ...process.env,
            SKIP_SESSION_AUTH: 'true',
            NODE_ENV: 'development'
        };

        let stdout = '';
        let stderr = '';

        const proc = spawn(keywinPath, [command], { env });

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (err) {
                resolve({ success: false, error: 'PARSE_ERROR', message: stdout || stderr });
            }
        });

        proc.on('error', (err) => {
            resolve({ success: false, error: 'SPAWN_ERROR', message: err.message });
        });
    });
}
