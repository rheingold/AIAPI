"use strict";
/**
 * auth/providers/ApiKeyAuthProvider.ts
 *
 * IAuthProvider for auth.mode = "apikey".
 *
 * Clients pass a raw API key via:
 *  - HTTP header:   Authorization: Bearer <key>
 *  - HTTP header:   X-API-Key: <key>
 *  - JSON body:     { "apiKey": "<key>" }
 *
 * The raw key is never stored; only its SHA-256 hash is looked up in the user store.
 * Multiple API keys per user are supported.
 * JWT session token is issued after successful key auth.
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
exports.ApiKeyAuthProvider = void 0;
const crypto = __importStar(require("crypto"));
const Logger_1 = require("../../utils/Logger");
const TAG = 'ApiKeyAuthProvider';
class ApiKeyAuthProvider {
    constructor(store, jwt) {
        this.mode = 'apikey';
        this.store = store;
        this.jwt = jwt;
    }
    async authenticate(creds) {
        // ── JWT re-use ──────────────────────────────────────────────────────────
        if (creds.jwtToken) {
            const ctx = await this.verifyToken(creds.jwtToken);
            if (ctx)
                return { success: true, user: ctx.user, token: creds.jwtToken };
            return { success: false, error: 'Invalid or expired token' };
        }
        const rawKey = creds.apiKey;
        if (!rawKey)
            return { success: false, error: 'API key required' };
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const user = await this.store.findByApiKeyHash(keyHash);
        if (!user) {
            Logger_1.globalLogger.warn(TAG, 'API key lookup failed (unknown or revoked)');
            return { success: false, error: 'Invalid API key' };
        }
        // Update lastUsedAt on the matching key record
        const keyRecord = user.apiKeys.find(k => k.keyHash === keyHash);
        if (keyRecord) {
            keyRecord.lastUsedAt = new Date().toISOString();
            // Best-effort async update — don't await to avoid latency on every call
            this.store.updateUser(user.id, { apiKeys: user.apiKeys }).catch(e => Logger_1.globalLogger.debug(TAG, `lastUsedAt update failed: ${e.message}`));
        }
        const token = this.jwt.sign({
            sub: user.id, username: user.username,
            roles: user.roles, externalGroups: [], authMode: 'apikey',
        });
        Logger_1.globalLogger.debug(TAG, `API key auth success for user '${user.username}'`);
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
            authMode: 'apikey',
            jwtToken: token,
        };
    }
    async getRedirectUrl() { return null; }
}
exports.ApiKeyAuthProvider = ApiKeyAuthProvider;
//# sourceMappingURL=ApiKeyAuthProvider.js.map