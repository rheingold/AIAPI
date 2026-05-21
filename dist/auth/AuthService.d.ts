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
import { AuthConfig, AuthMode, AuthResult, AuthContext, AuthCredentials, User, Role } from './types';
export declare class AuthService {
    readonly mode: AuthMode;
    private readonly provider;
    private readonly store;
    private readonly jwt;
    private constructor();
    /**
     * Build and initialise the AuthService from an AuthConfig.
     * Call once at server startup.
     */
    static create(cfg: AuthConfig): Promise<AuthService>;
    authenticate(creds: AuthCredentials): Promise<AuthResult>;
    verifyToken(token: string): Promise<AuthContext | null>;
    getRedirectUrl(state?: string): Promise<string | null>;
    listUsers(): Promise<User[]>;
    findByUsername(u: string): Promise<User | null>;
    createUser(d: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
    updateUser(id: string, patch: Partial<Omit<User, 'id'>>): Promise<User>;
    deleteUser(id: string): Promise<void>;
    listRoles(): Promise<Role[]>;
    findRole(name: string): Promise<Role | null>;
    upsertRole(r: Omit<Role, 'id'>): Promise<Role>;
    deleteRole(id: string): Promise<void>;
    /** Verify a JWT issued by any provider — used for session continuation */
    verifyJwt(token: string): import("./types").JwtPayload | null;
    /**
     * Issue a fresh JWT from a still-valid token (sliding-window refresh).
     * Returns the new token string, or null if the old token is invalid/expired.
     */
    refreshToken(oldToken: string): string | null;
}
//# sourceMappingURL=AuthService.d.ts.map