/**
 * auth/JwtService.ts
 *
 * Thin wrapper around JSON Web Tokens for session persistence.
 *
 * Falls back to a manual HS256 implementation when the `jsonwebtoken` package
 * is not installed, so the server starts without additional npm installs.
 * For production use, install: npm install jsonwebtoken @types/jsonwebtoken
 */
import { JwtConfig, JwtPayload, AuthContext, AuthMode } from './types';
export declare class JwtService {
    private readonly cfg;
    constructor(cfg: JwtConfig);
    sign(payload: Omit<JwtPayload, 'iat' | 'exp'>): string;
    verify(token: string): JwtPayload | null;
    toAuthContext(payload: JwtPayload, authMode: AuthMode): AuthContext;
    private manualSign;
    private manualVerify;
    private hmac;
}
//# sourceMappingURL=JwtService.d.ts.map