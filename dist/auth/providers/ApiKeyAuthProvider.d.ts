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
import { IAuthProvider, AuthCredentials, AuthResult, AuthContext, IUserStore } from '../types';
import { JwtService } from '../JwtService';
export declare class ApiKeyAuthProvider implements IAuthProvider {
    readonly mode: "apikey";
    private readonly store;
    private readonly jwt;
    constructor(store: IUserStore, jwt: JwtService);
    authenticate(creds: AuthCredentials): Promise<AuthResult>;
    verifyToken(token: string): Promise<AuthContext | null>;
    getRedirectUrl(): Promise<null>;
}
//# sourceMappingURL=ApiKeyAuthProvider.d.ts.map