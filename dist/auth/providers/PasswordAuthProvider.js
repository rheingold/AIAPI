"use strict";
/**
 * auth/providers/PasswordAuthProvider.ts
 *
 * IAuthProvider for auth.mode = "password".
 *
 * POST /api/auth/login — body: { username, password }
 * → verifies password hash (bcrypt / PBKDF2 fallback), issues JWT.
 *
 * Prefers bcrypt then bcryptjs; falls back to the PBKDF2 shim in JsonUserStore.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PasswordAuthProvider = void 0;
const JsonUserStore_1 = require("../stores/JsonUserStore");
const Logger_1 = require("../../utils/Logger");
const TAG = 'PasswordAuthProvider';
class PasswordAuthProvider {
    constructor(store, jwt) {
        this.mode = 'password';
        this.store = store;
        this.jwt = jwt;
    }
    async authenticate(creds) {
        const { username, password, jwtToken } = creds;
        // ── JWT re-use ──────────────────────────────────────────────────────────
        if (jwtToken) {
            const ctx = await this.verifyToken(jwtToken);
            if (ctx)
                return { success: true, user: ctx.user, token: jwtToken };
            return { success: false, error: 'Invalid or expired token' };
        }
        if (!username || !password) {
            return { success: false, error: 'username and password required' };
        }
        const user = await this.store.findByUsername(username);
        if (!user) {
            Logger_1.globalLogger.warn(TAG, `Login attempt for unknown user: ${username}`);
            return { success: false, error: 'Invalid credentials' };
        }
        if (!user.passwordHash) {
            return { success: false, error: 'No password set for this user (external auth only)' };
        }
        const ok = await this.verifyPassword(password, user.passwordHash);
        if (!ok) {
            Logger_1.globalLogger.warn(TAG, `Invalid password for user: ${username}`);
            return { success: false, error: 'Invalid credentials' };
        }
        const token = this.jwt.sign({
            sub: user.id, username: user.username,
            roles: user.roles, externalGroups: [], authMode: 'password',
        });
        Logger_1.globalLogger.info(TAG, `User '${username}' authenticated`);
        return { success: true, user, token };
    }
    async verifyToken(token) {
        const payload = this.jwt.verify(token);
        if (!payload)
            return null;
        const user = await this.store.findByUsername(payload.username);
        if (!user)
            return null;
        return {
            authenticated: true,
            user,
            effectiveRoles: [...user.roles, ...payload.externalGroups],
            authMode: 'password',
            jwtToken: token,
        };
    }
    async getRedirectUrl() { return null; }
    // ─── Private ─────────────────────────────────────────────────────────────
    async verifyPassword(password, hash) {
        if (hash.startsWith('pbkdf2:')) {
            return (0, JsonUserStore_1.verifyFallback)(password, hash);
        }
        const bcrypt = await (0, JsonUserStore_1.importBcrypt)();
        if (bcrypt)
            return bcrypt.compare(password, hash);
        return (0, JsonUserStore_1.verifyFallback)(password, hash);
    }
}
exports.PasswordAuthProvider = PasswordAuthProvider;
//# sourceMappingURL=PasswordAuthProvider.js.map