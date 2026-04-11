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
import { IAuthProvider, AuthCredentials, AuthResult, AuthContext, OAuthConfig, IUserStore } from '../types';
import { JwtService } from '../JwtService';
export declare class OAuthProvider implements IAuthProvider {
    readonly mode: "oauth";
    private readonly cfg;
    private readonly store;
    private readonly jwt;
    private readonly debugAuth;
    /** Short-lived PKCE state map: state → code_verifier; cleaned up after use */
    private readonly pkceMap;
    constructor(cfg: OAuthConfig, store: IUserStore, jwt: JwtService, debugAuth?: boolean);
    /** Step 1 — build the authorization URL (client will be redirected here) */
    getRedirectUrl(state?: string): Promise<string>;
    /** Step 2 — called from the callback endpoint with code + state */
    authenticate(creds: AuthCredentials): Promise<AuthResult>;
    verifyToken(token: string): Promise<AuthContext | null>;
    private exchangeCode;
    private fetchUserInfo;
    private gcPkceMap;
}
//# sourceMappingURL=OAuthProvider.d.ts.map