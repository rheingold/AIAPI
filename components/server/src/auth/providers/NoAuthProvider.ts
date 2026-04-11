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

import { IAuthProvider, AuthCredentials, AuthResult, AuthContext, User } from '../types';

const ANON_USER: User = {
  id: 'anonymous',
  username: 'anonymous',
  apiKeys: [],
  roles: ['admin'],
  enabled: true,
  createdAt: new Date(0).toISOString(),
};

export class NoAuthProvider implements IAuthProvider {
  readonly mode = 'none' as const;

  async authenticate(_credentials: AuthCredentials): Promise<AuthResult> {
    return { success: true, user: ANON_USER };
  }

  async verifyToken(_token: string): Promise<AuthContext | null> {
    return {
      authenticated: true,
      user: ANON_USER,
      effectiveRoles: ['admin'],
      authMode: 'none',
    };
  }

  async getRedirectUrl(): Promise<null> { return null; }
}
