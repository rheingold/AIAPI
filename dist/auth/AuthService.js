"use strict";
/**
 * auth/AuthService.ts
 *
 * Top-level factory and runtime for the authentication subsystem.
 *
 * Responsibilities:
 *  - Build the correct IAuthProvider and IUserStore from AuthConfig
 *  - Expose a single authenticate() entry point for the middleware
 *  - Expose admin operations (user / role CRUD) for _internal handlers
 *  - Expose the redirect URL for OAuth / SAML flows
 *
 * Instantiated once at server startup by the HTTP server.
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
exports.AuthService = void 0;
const crypto = __importStar(require("crypto"));
const JwtService_1 = require("./JwtService");
const NoAuthProvider_1 = require("./providers/NoAuthProvider");
const PasswordAuthProvider_1 = require("./providers/PasswordAuthProvider");
const ApiKeyAuthProvider_1 = require("./providers/ApiKeyAuthProvider");
const CertificateAuthProvider_1 = require("./providers/CertificateAuthProvider");
const OAuthProvider_1 = require("./providers/OAuthProvider");
const SamlProvider_1 = require("./providers/SamlProvider");
const JsonUserStore_1 = require("./stores/JsonUserStore");
const DbUserStore_1 = require("./stores/DbUserStore");
const Logger_1 = require("../utils/Logger");
const TAG = 'AuthService';
class AuthService {
    constructor(mode, provider, store, jwt) {
        this.mode = mode;
        this.provider = provider;
        this.store = store;
        this.jwt = jwt;
    }
    /**
     * Build and initialise the AuthService from an AuthConfig.
     * Call once at server startup.
     */
    static async create(cfg) {
        // ── User store ──────────────────────────────────────────────────────────
        let store;
        if (cfg.users.storeSource === 'db') {
            const dbCfg = cfg.users.db;
            if (!dbCfg)
                throw new Error('auth.users.storeSource = "db" but no auth.users.db config provided');
            const dbStore = new DbUserStore_1.DbUserStore(dbCfg);
            await dbStore.initialize();
            store = dbStore;
        }
        else {
            const jsonStore = new JsonUserStore_1.JsonUserStore(cfg.users.jsonPath);
            await jsonStore.initialize();
            store = jsonStore;
        }
        // ── JWT service ─────────────────────────────────────────────────────────
        const jwtCfg = {
            ...cfg.jwt,
            // Auto-generate secret on first start
            secret: cfg.jwt.secret || crypto.randomBytes(32).toString('hex'),
        };
        const jwt = new JwtService_1.JwtService(jwtCfg);
        // ── Auth provider ───────────────────────────────────────────────────────
        let provider;
        switch (cfg.mode) {
            case 'none':
                provider = new NoAuthProvider_1.NoAuthProvider();
                break;
            case 'password':
                provider = new PasswordAuthProvider_1.PasswordAuthProvider(store, jwt);
                break;
            case 'apikey':
                provider = new ApiKeyAuthProvider_1.ApiKeyAuthProvider(store, jwt);
                break;
            case 'certificate':
                provider = new CertificateAuthProvider_1.CertificateAuthProvider(store, jwt, cfg.certificate?.caPath);
                break;
            case 'oauth':
                if (!cfg.oauth)
                    throw new Error('auth.mode = "oauth" but no auth.oauth config provided');
                provider = new OAuthProvider_1.OAuthProvider(cfg.oauth, store, jwt, cfg.debugExternalAuth);
                break;
            case 'saml':
                if (!cfg.saml)
                    throw new Error('auth.mode = "saml" but no auth.saml config provided');
                provider = new SamlProvider_1.SamlProvider(cfg.saml, store, jwt, cfg.debugExternalAuth);
                break;
            default:
                throw new Error(`Unknown auth.mode: ${cfg.mode}`);
        }
        Logger_1.globalLogger.info(TAG, `Auth mode: ${cfg.mode} | user store: ${cfg.users.storeSource}`);
        return new AuthService(cfg.mode, provider, store, jwt);
    }
    // ─── Core auth ────────────────────────────────────────────────────────────
    async authenticate(creds) {
        return this.provider.authenticate(creds);
    }
    async verifyToken(token) {
        return this.provider.verifyToken?.(token) ?? null;
    }
    async getRedirectUrl(state) {
        return this.provider.getRedirectUrl?.(state) ?? null;
    }
    // ─── User admin ───────────────────────────────────────────────────────────
    listUsers() { return this.store.listUsers(); }
    findByUsername(u) { return this.store.findByUsername(u); }
    createUser(d) { return this.store.createUser(d); }
    updateUser(id, patch) { return this.store.updateUser(id, patch); }
    deleteUser(id) { return this.store.deleteUser(id); }
    // ─── Role admin ───────────────────────────────────────────────────────────
    listRoles() { return this.store.listRoles(); }
    findRole(name) { return this.store.findRole(name); }
    upsertRole(r) { return this.store.upsertRole(r); }
    deleteRole(id) { return this.store.deleteRole(id); }
    // ─── Helpers for AuthMiddleware ───────────────────────────────────────────
    /** Verify a JWT issued by any provider — used for session continuation */
    verifyJwt(token) { return this.jwt.verify(token); }
}
exports.AuthService = AuthService;
//# sourceMappingURL=AuthService.js.map