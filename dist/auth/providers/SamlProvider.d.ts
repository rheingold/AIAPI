/**
 * auth/providers/SamlProvider.ts
 *
 * IAuthProvider for auth.mode = "saml".
 *
 * Implements SAML 2.0 SP-initiated SSO (HTTP-POST binding).
 *
 * Flow:
 *  1. GET /api/auth/saml/redirect
 *    → server builds SAML AuthnRequest
 *    → returns IdP SSO URL + SAMLRequest param for client to POST/redirect
 *  2. IdP POSTs to /api/auth/saml/callback with SAMLResponse
 *    → server verifies signature against IdP cert
 *    → extracts username via auth.saml.usernamePath (default: nameID)
 *    → extracts groups via auth.saml.groupsPath (optional attribute name)
 *    → provisions/updates user record
 *    → issues JWT
 *
 * Required package: npm install samlify
 * Falls back to a lightweight XML parser for demo/testing when samlify
 * is absent (SIGNATURE IS NOT VERIFIED in fallback mode — log warning).
 *
 * Debug logging enabled when auth.debugExternalAuth = true.
 */
import { IAuthProvider, AuthCredentials, AuthResult, AuthContext, SamlConfig, IUserStore } from '../types';
import { JwtService } from '../JwtService';
export declare class SamlProvider implements IAuthProvider {
    readonly mode: "saml";
    private readonly cfg;
    private readonly store;
    private readonly jwt;
    private readonly debugAuth;
    constructor(cfg: SamlConfig, store: IUserStore, jwt: JwtService, debugAuth?: boolean);
    /** Step 1 — build SAMLRequest redirect URL */
    getRedirectUrl(relayState?: string): Promise<string>;
    /** Step 2 — called with the SAMLResponse from the callback endpoint */
    authenticate(creds: AuthCredentials): Promise<AuthResult>;
    verifyToken(token: string): Promise<AuthContext | null>;
    private buildAuthnRequest;
    private parseWithSamlify;
    /** Very simple XML regex parser — used only when samlify is unavailable. NO SIGNATURE VERIFICATION. */
    private parseSimple;
}
//# sourceMappingURL=SamlProvider.d.ts.map