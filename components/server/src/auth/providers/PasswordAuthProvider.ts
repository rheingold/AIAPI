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
import { importBcrypt, verifyFallback } from '../stores/JsonUserStore';
import { globalLogger } from '../../utils/Logger';

const TAG = 'PasswordAuthProvider';

export class PasswordAuthProvider implements IAuthProvider {
  readonly mode = 'password' as const;
  private readonly store: IUserStore;
  private readonly jwt: JwtService;

  constructor(store: IUserStore, jwt: JwtService) {
    this.store = store;
    this.jwt = jwt;
  }

  async authenticate(creds: AuthCredentials): Promise<AuthResult> {
    const { username, password, jwtToken } = creds;

    // ── JWT re-use ──────────────────────────────────────────────────────────
    if (jwtToken) {
      const ctx = await this.verifyToken(jwtToken);
      if (ctx) return { success: true, user: ctx.user, token: jwtToken };
      return { success: false, error: 'Invalid or expired token' };
    }

    if (!username || !password) {
      return { success: false, error: 'username and password required' };
    }

    const user = await this.store.findByUsername(username);
    if (!user) {
      globalLogger.warn(TAG, `Login attempt for unknown user: ${username}`);
      return { success: false, error: 'Invalid credentials' };
    }
    if (!user.passwordHash) {
      return { success: false, error: 'No password set for this user (external auth only)' };
    }

    const ok = await this.verifyPassword(password, user.passwordHash);
    if (!ok) {
      globalLogger.warn(TAG, `Invalid password for user: ${username}`);
      return { success: false, error: 'Invalid credentials' };
    }

    const token = this.jwt.sign({
      sub: user.id, username: user.username,
      roles: user.roles, externalGroups: [], authMode: 'password',
    });
    globalLogger.info(TAG, `User '${username}' authenticated`);
    return { success: true, user, token };
  }

  async verifyToken(token: string): Promise<AuthContext | null> {
    const payload = this.jwt.verify(token);
    if (!payload) return null;
    const user = await this.store.findByUsername(payload.username);
    if (!user) return null;
    return {
      authenticated: true,
      user,
      effectiveRoles: [...user.roles, ...payload.externalGroups],
      authMode: 'password',
      jwtToken: token,
    };
  }

  async getRedirectUrl(): Promise<null> { return null; }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    if (hash.startsWith('pbkdf2:')) {
      return verifyFallback(password, hash);
    }
    const bcrypt = await importBcrypt();
    if (bcrypt) return bcrypt.compare(password, hash);
    return verifyFallback(password, hash);
  }
}
