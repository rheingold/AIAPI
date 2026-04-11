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
import * as http from 'http';
import { AuthService } from './AuthService';
import { AuthContext } from './types';
/** Symbol used to attach AuthContext to the Node IncomingMessage */
export declare const AUTH_CONTEXT_KEY: unique symbol;
/** Augmented request type — use in handlers to access auth context */
export type AuthedRequest = http.IncomingMessage & {
    [AUTH_CONTEXT_KEY]?: AuthContext;
    bodyBuffer?: Buffer;
};
export declare class AuthMiddleware {
    private readonly service;
    constructor(service: AuthService);
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
    handle(req: AuthedRequest, res: http.ServerResponse, next: () => void): Promise<void>;
    /** Retrieve the AuthContext attached by this middleware */
    static getContext(req: AuthedRequest): AuthContext | undefined;
    /**
     * Check whether an authenticated user has a required role.
     * Returns true if role is "(anyandall)" OR user's effectiveRoles contain it.
     */
    static hasRole(ctx: AuthContext | undefined, requiredRole: string): boolean;
    /**
     * Check whether the user's effective roles include permission for a
     * _internal operation.
     */
    static hasInternalPermission(ctx: AuthContext | undefined, operation: string): boolean;
}
//# sourceMappingURL=AuthMiddleware.d.ts.map