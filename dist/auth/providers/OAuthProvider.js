"use strict";
/**
 * auth/providers/OAuthProvider.ts
 *
 * IAuthProvider for auth.mode = "oauth".
 *
 * Implements OAuth2 Authorization Code flow with optional PKCE (RFC 7636).
 * Supports any OAuth2/OIDC-compliant provider (Google, Microsoft AAD,
 * GitHub, Keycloak, Auth0, etc.) via the config URLs.
 *
 * Flow:
 *  1. Client calls GET /api/auth/oauth/redirect
 *    → server builds authorization URL with state + code_verifier (PKCE)
 *    → redirects client to IdP
 *  2. IdP redirects to GET /api/auth/oauth/callback?code=…&state=…
 *    → server exchanges code for access token (+ code_verifier for PKCE)
 *    → server fetches userInfo (or parses ID token)
 *    → extracts username via auth.oauth.usernamePath
 *    → extracts groups via auth.oauth.groupsPath (optional)
 *    → provisions/updates the user record
 *    → issues a JWT
 *
 * Optional packages (graceful degradation if absent):
 *   npm install node-fetch   (if Node < 18, which has built-in fetch)
 *
 * Debug logging of OAuth request/response bodies is enabled when
 * auth.debugExternalAuth = true (credentials are redacted).
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
exports.OAuthProvider = void 0;
const crypto = __importStar(require("crypto"));
const url = __importStar(require("url"));
const Logger_1 = require("../../utils/Logger");
const TAG = 'OAuthProvider';
class OAuthProvider {
    constructor(cfg, store, jwt, debugAuth = false) {
        this.mode = 'oauth';
        /** Short-lived PKCE state map: state → code_verifier; cleaned up after use */
        this.pkceMap = new Map();
        this.cfg = cfg;
        this.store = store;
        this.jwt = jwt;
        this.debugAuth = debugAuth;
    }
    /** Step 1 — build the authorization URL (client will be redirected here) */
    async getRedirectUrl(state) {
        const st = state ?? crypto.randomBytes(16).toString('hex');
        const params = {
            response_type: 'code',
            client_id: this.cfg.clientId,
            redirect_uri: this.cfg.callbackUrl,
            scope: this.cfg.scope,
            state: st,
        };
        if (this.cfg.pkce) {
            const codeVerifier = crypto.randomBytes(32).toString('base64url');
            const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
            params['code_challenge'] = codeChallenge;
            params['code_challenge_method'] = 'S256';
            this.pkceMap.set(st, { codeVerifier, createdAt: Date.now() });
            this.gcPkceMap();
        }
        return `${this.cfg.authorizationUrl}?${new url.URLSearchParams(params).toString()}`;
    }
    /** Step 2 — called from the callback endpoint with code + state */
    async authenticate(creds) {
        // ── JWT re-use ──────────────────────────────────────────────────────────
        if (creds.jwtToken) {
            const ctx = await this.verifyToken(creds.jwtToken);
            if (ctx)
                return { success: true, user: ctx.user, token: creds.jwtToken };
            return { success: false, error: 'Invalid or expired token' };
        }
        const { oauthCode, oauthState } = creds;
        if (!oauthCode)
            return { success: false, error: 'OAuth code missing from callback' };
        let codeVerifier;
        if (this.cfg.pkce && oauthState) {
            const entry = this.pkceMap.get(oauthState);
            if (entry) {
                codeVerifier = entry.codeVerifier;
                this.pkceMap.delete(oauthState);
            }
        }
        // ── Token exchange ──────────────────────────────────────────────────────
        const tokenRes = await this.exchangeCode(oauthCode, codeVerifier);
        if (!tokenRes.access_token) {
            return { success: false, error: `Token exchange failed: ${tokenRes.error ?? 'unknown'}` };
        }
        // ── UserInfo ────────────────────────────────────────────────────────────
        const userInfo = await this.fetchUserInfo(tokenRes.access_token, tokenRes.id_token);
        if (!userInfo)
            return { success: false, error: 'Could not retrieve userInfo' };
        const username = resolveJsonPath(userInfo, this.cfg.usernamePath);
        if (!username)
            return { success: false, error: `Cannot resolve username at path '${this.cfg.usernamePath}'` };
        const externalGroups = this.cfg.groupsPath
            ? resolveJsonPath(userInfo, this.cfg.groupsPath) ?? []
            : [];
        // ── Provision/update user ───────────────────────────────────────────────
        let user = await this.store.findByUsername(username);
        if (!user) {
            user = await this.store.createUser({
                username: username,
                apiKeys: [],
                roles: [], // roles come from externalGroups
                enabled: true,
            });
            Logger_1.globalLogger.info(TAG, `Auto-provisioned OAuth user '${username}'`);
        }
        const token = this.jwt.sign({
            sub: user.id, username: user.username,
            roles: user.roles, externalGroups, authMode: 'oauth',
        });
        Logger_1.globalLogger.info(TAG, `OAuth auth success for '${username}' groups=[${externalGroups.join(',')}]`);
        return { success: true, user, externalGroups, token };
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
            authMode: 'oauth',
            jwtToken: token,
        };
    }
    // ─── Private ─────────────────────────────────────────────────────────────
    async exchangeCode(code, codeVerifier) {
        const body = {
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.cfg.callbackUrl,
            client_id: this.cfg.clientId,
            client_secret: this.cfg.clientSecret,
        };
        if (codeVerifier)
            body['code_verifier'] = codeVerifier;
        if (this.debugAuth) {
            Logger_1.globalLogger.debug(TAG, `[OAuth] token exchange → ${this.cfg.tokenUrl} body=${JSON.stringify({ ...body, client_secret: '***' })}`);
        }
        const resp = await globalFetch(this.cfg.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
            body: new url.URLSearchParams(body).toString(),
        });
        const json = await resp.json();
        if (this.debugAuth) {
            Logger_1.globalLogger.debug(TAG, `[OAuth] token response: ${JSON.stringify({ ...json, access_token: json.access_token ? '***' : undefined, id_token: json.id_token ? '***' : undefined })}`);
        }
        return json;
    }
    async fetchUserInfo(accessToken, idToken) {
        // If no userInfoUrl, try to decode the ID token claims
        if (!this.cfg.userInfoUrl) {
            if (idToken)
                return decodeJwtClaims(idToken);
            return null;
        }
        if (this.debugAuth) {
            Logger_1.globalLogger.debug(TAG, `[OAuth] userInfo GET → ${this.cfg.userInfoUrl}`);
        }
        const resp = await globalFetch(this.cfg.userInfoUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const json = await resp.json();
        if (this.debugAuth) {
            Logger_1.globalLogger.debug(TAG, `[OAuth] userInfo response: ${JSON.stringify(json)}`);
        }
        return json;
    }
    gcPkceMap() {
        const threshold = Date.now() - 10 * 60 * 1000; // 10 min TTL
        for (const [k, v] of this.pkceMap) {
            if (v.createdAt < threshold)
                this.pkceMap.delete(k);
        }
    }
}
exports.OAuthProvider = OAuthProvider;
// ─── Utility ──────────────────────────────────────────────────────────────────
/** Resolve a dot-path through a JSON object: "a.b.c" → obj.a.b.c */
function resolveJsonPath(obj, dotPath) {
    return dotPath.split('.').reduce((acc, part) => {
        if (acc && typeof acc === 'object')
            return acc[part];
        return undefined;
    }, obj);
}
/** Decode JWT claims without verifying signature (IdP-signed token) */
function decodeJwtClaims(token) {
    const parts = token.split('.');
    if (parts.length < 2)
        return null;
    try {
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    }
    catch {
        return null;
    }
}
/** Use native fetch (Node ≥ 18) or fall back to node-fetch */
async function globalFetch(url, init) {
    if (typeof globalThis.fetch === 'function') {
        return globalThis.fetch(url, init);
    }
    // @ts-ignore: optional peer dependency
    const nodeFetch = await Promise.resolve().then(() => __importStar(require('node-fetch'))).then(m => m.default ?? m).catch(() => {
        throw new Error('node-fetch not installed and Node < 18 — run: npm install node-fetch');
    });
    return nodeFetch(url, init);
}
//# sourceMappingURL=OAuthProvider.js.map