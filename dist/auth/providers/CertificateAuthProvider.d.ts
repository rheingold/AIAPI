/**
 * auth/providers/CertificateAuthProvider.ts
 *
 * IAuthProvider for auth.mode = "certificate".
 *
 * The TLS client certificate is extracted from the incoming socket by Node's
 * built-in TLS stack (requires the HTTP server to be created with `requestCert: true`
 * and optionally `rejectUnauthorized: false` so the server can issue a 401 rather
 * than a raw TLS error for unknown clients).
 *
 * The Subject Common Name (CN) field of the certificate is used as the username.
 * On first-seen CN: a user is auto-provisioned with the "operator" role.
 *
 * The certificate itself is verified against the CA bundle configured in
 * auth.certificate.caPath before being accepted.
 */
import { IAuthProvider, AuthCredentials, AuthResult, AuthContext, IUserStore } from '../types';
import { JwtService } from '../JwtService';
export declare class CertificateAuthProvider implements IAuthProvider {
    readonly mode: "certificate";
    private readonly store;
    private readonly jwt;
    private readonly caPath?;
    private caStore?;
    constructor(store: IUserStore, jwt: JwtService, caPath?: string);
    authenticate(creds: AuthCredentials): Promise<AuthResult>;
    verifyToken(token: string): Promise<AuthContext | null>;
    getRedirectUrl(): Promise<null>;
    private verifyCertAgainstCa;
}
//# sourceMappingURL=CertificateAuthProvider.d.ts.map