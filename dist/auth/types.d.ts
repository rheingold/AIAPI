/**
 * auth/types.ts
 *
 * Canonical type definitions for the server-client authentication and
 * authorisation subsystem (CONVENTIONS.md §5.3 – §5.6, §6.2 – §6.4).
 *
 * Design principles:
 *  - IAuthProvider: pluggable strategy (one per auth.mode)
 *  - IUserStore: pluggable persistence (JSON or DB)
 *  - AuthContext: attached to every authenticated request
 *  - Permissions / roles summed from user's explicit roles + external-auth groups
 */
import { DbConfig } from '../settings/types';
/** A single API key record attached to a user */
export interface ApiKeyRecord {
    /** Stable UUID */
    id: string;
    /** HMAC-SHA256 of the raw secret key — never stored in plain text */
    keyHash: string;
    /** Human label */
    label: string;
    createdAt: string;
    lastUsedAt?: string;
}
/** Core user record stored in the user store */
export interface User {
    /** Stable UUID */
    id: string;
    /** Login name or external-auth identity (email, UPN, oAuth sub, SAML nameID) */
    username: string;
    /** bcrypt hash (absent for external-auth-only users) */
    passwordHash?: string;
    /** API keys for this user */
    apiKeys: ApiKeyRecord[];
    /**
     * Explicit role names assigned to this user.
     * External-auth groups are added at runtime and NOT stored here.
     */
    roles: string[];
    enabled: boolean;
    createdAt: string;
    updatedAt?: string;
}
/** Role definition */
export interface Role {
    /** Stable UUID */
    id: string;
    /** Short name used in filter rules (e.g., "admin", "operator", "auditor") */
    name: string;
    description?: string;
    permissions: Permission[];
}
/**
 * A single permission entry inside a Role.
 * Mirrors the filter-rule `_internal` model (CONVENTIONS.md §6.4).
 */
export interface Permission {
    /**
     * Helper name or "_internal".
     * "*" means any helper.
     */
    helper: string;
    /**
     * Command / operation.
     * "_internal" helpers use: "access" | "settings_change" | "access_logs"
     * Regular helpers use command names or "*".
     */
    operation: string;
    /** Path / resource glob. "*" means any. */
    resource: string;
}
export type AuthMode = 'none' | 'password' | 'apikey' | 'certificate' | 'oauth' | 'saml';
export interface AuthResult {
    success: boolean;
    /** Set on success */
    user?: User;
    /**
     * Groups obtained from external auth (oAuth/SAML) – merged with user.roles at
     * authorisation time; NOT stored in the user record.
     */
    externalGroups?: string[];
    /** JWT token — issued when auth.jwt.enabled = true */
    token?: string;
    /** Human-readable failure reason */
    error?: string;
}
/**
 * Context carried on every authenticated HTTP / MCP request.
 * Set by AuthMiddleware; read by security-filter and _internal handlers.
 */
export interface AuthContext {
    authenticated: boolean;
    user?: User;
    /** Resolved effective roles = user.roles + externalGroups */
    effectiveRoles: string[];
    /** auth.mode used to authenticate this request */
    authMode: AuthMode;
    /** Raw JWT if session is token-based */
    jwtToken?: string;
}
/**
 * IAuthProvider — one implementation per auth.mode.
 * All methods are optional except authenticate().
 */
export interface IAuthProvider {
    readonly mode: AuthMode;
    /**
     * Authenticate a request from supplied credentials.
     * For redirect-based flows (oauth, saml) this is called on the callback leg
     * with the code/assertion payload.
     */
    authenticate(credentials: AuthCredentials): Promise<AuthResult>;
    /**
     * For redirect-based providers: returns the URL the client should be sent to.
     * Returns null for non-redirect providers.
     */
    getRedirectUrl?(state?: string): Promise<string | null>;
    /**
     * Verify a JWT token previously issued by this provider (or the JWT service).
     * Returns the AuthContext on success.
     */
    verifyToken?(token: string): Promise<AuthContext | null>;
}
/** Union of all credential shapes passed to authenticate() */
export interface AuthCredentials {
    username?: string;
    password?: string;
    apiKey?: string;
    clientCert?: string;
    oauthCode?: string;
    oauthState?: string;
    codeVerifier?: string;
    samlResponse?: string;
    samlRelayState?: string;
    jwtToken?: string;
}
export interface IUserStore {
    /** Find a user by their username. Returns null if not found. */
    findByUsername(username: string): Promise<User | null>;
    /** Find a user by the hash of one of their API keys. Returns null if not found. */
    findByApiKeyHash(keyHash: string): Promise<User | null>;
    /** Return all users (admin use). */
    listUsers(): Promise<User[]>;
    /** Create a new user. Throws if username already exists. */
    createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
    /** Update an existing user. Throws if not found. */
    updateUser(id: string, patch: Partial<Omit<User, 'id'>>): Promise<User>;
    /** Delete a user by ID. */
    deleteUser(id: string): Promise<void>;
    /** List all roles. */
    listRoles(): Promise<Role[]>;
    /** Find a role by its name. */
    findRole(name: string): Promise<Role | null>;
    /** Create or replace a role. */
    upsertRole(role: Omit<Role, 'id'>): Promise<Role>;
    /** Delete a role by ID. */
    deleteRole(id: string): Promise<void>;
}
export interface JwtConfig {
    enabled: boolean;
    secret: string;
    expiryMinutes: number;
}
export interface JwtPayload {
    sub: string;
    username: string;
    roles: string[];
    externalGroups: string[];
    authMode: AuthMode;
    iat: number;
    exp: number;
}
export interface OAuthConfig {
    clientId: string;
    clientSecret: string;
    authorizationUrl: string;
    tokenUrl: string;
    userInfoUrl?: string;
    scope: string;
    callbackUrl: string;
    usernamePath: string;
    groupsPath?: string;
    pkce: boolean;
}
export interface SamlConfig {
    entryPoint: string;
    issuer: string;
    cert: string;
    privateKey?: string;
    callbackUrl: string;
    usernamePath: string;
    groupsPath?: string;
    signatureAlgorithm: string;
}
export interface AuthConfig {
    mode: AuthMode;
    jwt: JwtConfig;
    password?: {
        bcryptRounds: number;
    };
    apikey?: {
        defaultUser: string;
    };
    certificate?: {
        caPath: string;
        requireClientCert: boolean;
    };
    oauth?: OAuthConfig;
    saml?: SamlConfig;
    debugExternalAuth: boolean;
    users: {
        storeSource: 'json' | 'db';
        jsonPath: string;
        /**
         * DB connection override for the user store.
         * When storeSource = "db" and this is provided, {@link DbUserStore} uses
         * this connection instead of the top-level settings DB config.
         */
        db?: DbConfig;
    };
    /**
     * Settings-backend override for auth configuration.
     * When present, auth config is read/written via this backend instead of the
     * main settings adapter.  Useful when auth config lives in a separate DB
     * from the rest of the dashboard settings.
     *
     * `source = "json"` — use the standard dashboard-settings.json (default)
     * `source = "db"`   — use the DB specified in `db`
     */
    settings?: {
        source: 'json' | 'db';
        db?: DbConfig;
    };
}
//# sourceMappingURL=types.d.ts.map