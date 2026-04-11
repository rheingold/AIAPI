"use strict";
/**
 * auth/providers/NoAuthProvider.ts
 *
 * IAuthProvider for auth.mode = "none".
 *
 * Every request is accepted immediately; a synthetic "anonymous" user
 * with the "admin" role is injected so all operations pass.
 *
 * This is the default mode — convenient for local/trusted setups where
 * the server is only reachable by the machine owner.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoAuthProvider = void 0;
const ANON_USER = {
    id: 'anonymous',
    username: 'anonymous',
    apiKeys: [],
    roles: ['admin'],
    enabled: true,
    createdAt: new Date(0).toISOString(),
};
class NoAuthProvider {
    constructor() {
        this.mode = 'none';
    }
    async authenticate(_credentials) {
        return { success: true, user: ANON_USER };
    }
    async verifyToken(_token) {
        return {
            authenticated: true,
            user: ANON_USER,
            effectiveRoles: ['admin'],
            authMode: 'none',
        };
    }
    async getRedirectUrl() { return null; }
}
exports.NoAuthProvider = NoAuthProvider;
//# sourceMappingURL=NoAuthProvider.js.map