/**
 * auth/providers/PasswordAuthProvider.ts
 *
 * IAuthProvider for auth.mode = "password".
 *
 * POST /api/auth/login — body: { username, password }
 * → verifies password hash (bcrypt / PBKDF2 fallback), issues JWT.
 *
 * Prefers bcrypt then bcryptjs; falls back to the PBKDF2 shim in JsonUserStore.
 */
import { IAuthProvider, AuthCredentials, AuthResult, AuthContext, IUserStore } from '../types';
import { JwtService } from '../JwtService';
export declare class PasswordAuthProvider implements IAuthProvider {
    readonly mode: "password";
    private readonly store;
    private readonly jwt;
    constructor(store: IUserStore, jwt: JwtService);
    authenticate(creds: AuthCredentials): Promise<AuthResult>;
    verifyToken(token: string): Promise<AuthContext | null>;
    getRedirectUrl(): Promise<null>;
    private verifyPassword;
}
//# sourceMappingURL=PasswordAuthProvider.d.ts.map