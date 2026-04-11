/**
 * auth/providers/NoAuthProvider.ts
 *
 * IAuthProvider for auth.mode = "none".
 *
 * Every request is accepted immediately; a synthetic "anonymous" user
 * with the "admin" role is injected so all operations pass.
 *
 * This is the default mode — convenient for local/trusted setups where
 * the server is only reachable by the machine owner.
 */
import { IAuthProvider, AuthCredentials, AuthResult, AuthContext } from '../types';
export declare class NoAuthProvider implements IAuthProvider {
    readonly mode: "none";
    authenticate(_credentials: AuthCredentials): Promise<AuthResult>;
    verifyToken(_token: string): Promise<AuthContext | null>;
    getRedirectUrl(): Promise<null>;
}
//# sourceMappingURL=NoAuthProvider.d.ts.map