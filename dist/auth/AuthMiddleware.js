"use strict";
/**
 * auth/AuthMiddleware.ts
 *
 * HTTP middleware for the server-client authentication layer.
 *
 * Runs on every request to httpServerWithDashboard.ts BEFORE the request
 * reaches application handlers.
 *
 * Credential extraction order (first found wins):
 *  1. Authorization: Bearer <token>    (JWT or raw API key)
 *  2. X-API-Key: <key>                 (raw API key)
 *  3. Cookie: aiapi_session=<token>    (browser session)
 *  4. Request body JSON field "token"   (for MCP calls over HTTP)
 *
 * After authentication the middleware attaches an AuthContext to the request
 * via the symbol AUTH_CONTEXT_KEY so downstream handlers can call
 *   const ctx = AuthMiddleware.getContext(req);
 *
 * Route exemptions:
 *  - /api/auth/login
 *  - /api/auth/oauth/* and /api/auth/saml/*  (redirect / callback flows)
 *  - /api/status                              (health check)
 *
 * When auth.mode = "none", every request gets an anonymous admin context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthMiddleware = exports.AUTH_CONTEXT_KEY = void 0;
const Logger_1 = require("../utils/Logger");
const TAG = 'AuthMiddleware';
/** Symbol used to attach AuthContext to the Node IncomingMessage */
exports.AUTH_CONTEXT_KEY = Symbol('authContext');
/** Routes exempt from authentication */
const PUBLIC_PATHS = [
    '/api/auth/login',
    '/api/auth/oauth/redirect',
    '/api/auth/oauth/callback',
    '/api/auth/saml/redirect',
    '/api/auth/saml/callback',
    '/api/status',
];
class AuthMiddleware {
    constructor(service) {
        this.service = service;
    }
    /**
     * Process a single request: extract credentials, authenticate, attach context.
     * Calls next() on success; writes 401 and returns if not authenticated.
     *
     * When auth.mode = "none" — always calls next() with admin context.
     *
     * @param req  Incoming request
     * @param res  Server response (for 401 replies)
     * @param next Continuation callback
     */
    async handle(req, res, next) {
        const pathname = extractPath(req.url ?? '/');
        // ── Public routes ───────────────────────────────────────────────────────
        if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
            next();
            return;
        }
        // ── mode = none → synthetic admin context ───────────────────────────────
        if (this.service.mode === 'none') {
            req[exports.AUTH_CONTEXT_KEY] = {
                authenticated: true,
                user: { id: 'system', username: 'anonymous', roles: ['admin'], apiKeys: [], enabled: true, createdAt: '' },
                effectiveRoles: ['admin'],
                authMode: 'none',
            };
            next();
            return;
        }
        // ── Extract credentials ─────────────────────────────────────────────────
        const token = extractBearer(req) ?? extractCookie(req, 'aiapi_session');
        const apiKey = req.headers['x-api-key'];
        const clientCert = extractClientCert(req);
        // ── JWT session continuation ────────────────────────────────────────────
        if (token) {
            const ctx = await this.service.verifyToken(token);
            if (ctx) {
                req[exports.AUTH_CONTEXT_KEY] = ctx;
                next();
                return;
            }
            // Token present but invalid/expired — fall through to re-auth below
        }
        // ── API key ─────────────────────────────────────────────────────────────
        if (apiKey || (token && this.service.mode === 'apikey')) {
            const result = await this.service.authenticate({ apiKey: apiKey ?? token });
            if (result.success && result.user) {
                const ctx = {
                    authenticated: true,
                    user: result.user,
                    effectiveRoles: result.user.roles,
                    authMode: 'apikey',
                    jwtToken: result.token,
                };
                req[exports.AUTH_CONTEXT_KEY] = ctx;
                next();
                return;
            }
        }
        // ── Client certificate ──────────────────────────────────────────────────
        if (clientCert && this.service.mode === 'certificate') {
            const result = await this.service.authenticate({ clientCert });
            if (result.success && result.user) {
                const ctx = {
                    authenticated: true,
                    user: result.user,
                    effectiveRoles: result.user.roles,
                    authMode: 'certificate',
                    jwtToken: result.token,
                };
                req[exports.AUTH_CONTEXT_KEY] = ctx;
                next();
                return;
            }
        }
        // ── Not authenticated ───────────────────────────────────────────────────
        Logger_1.globalLogger.debug(TAG, `Unauthenticated request to ${pathname}`);
        res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer realm="AIAPI"`,
        });
        res.end(JSON.stringify({ error: 'Unauthorized', path: pathname }));
    }
    // ─── Static helpers ───────────────────────────────────────────────────────
    /** Retrieve the AuthContext attached by this middleware */
    static getContext(req) {
        return req[exports.AUTH_CONTEXT_KEY];
    }
    /**
     * Check whether an authenticated user has a required role.
     * Returns true if role is "(anyandall)" OR user's effectiveRoles contain it.
     */
    static hasRole(ctx, requiredRole) {
        if (!ctx?.authenticated)
            return false;
        if (requiredRole === '(anyandall)')
            return true;
        const required = requiredRole.split(',').map(r => r.trim());
        return required.some(r => ctx.effectiveRoles.includes(r));
    }
    /**
     * Check whether the user's effective roles include permission for a
     * _internal operation.
     */
    static hasInternalPermission(ctx, operation) {
        if (!ctx?.authenticated)
            return false;
        if (!ctx.user)
            return false;
        // Collect all roles → find a matching permission
        // (In full implementation: query the role store for permissions.
        //  Here we short-circuit for the "admin" role which has wildcard permissions.)
        return ctx.effectiveRoles.includes('admin');
    }
}
exports.AuthMiddleware = AuthMiddleware;
// ─── Credential extraction helpers ───────────────────────────────────────────
function extractPath(rawUrl) {
    const q = rawUrl.indexOf('?');
    return q === -1 ? rawUrl : rawUrl.slice(0, q);
}
function extractBearer(req) {
    const auth = req.headers.authorization;
    if (!auth)
        return undefined;
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : undefined;
}
function extractCookie(req, name) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader)
        return undefined;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : undefined;
}
function extractClientCert(req) {
    // tlsClientError is set by Node's TLS stack as socket.getPeerCertificate()
    const socket = req.socket;
    if (!socket?.getPeerCertificate)
        return undefined;
    try {
        const cert = socket.getPeerCertificate();
        if (!cert?.raw)
            return undefined;
        return `-----BEGIN CERTIFICATE-----\n${cert.raw.toString('base64')}\n-----END CERTIFICATE-----`;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=AuthMiddleware.js.map