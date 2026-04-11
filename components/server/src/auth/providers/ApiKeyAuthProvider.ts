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

import * as crypto from 'crypto';
import { IAuthProvider, AuthCredentials, AuthResult, AuthContext, IUserStore } from '../types';
import { JwtService } from '../JwtService';
import { globalLogger } from '../../utils/Logger';

const TAG = 'ApiKeyAuthProvider';

export class ApiKeyAuthProvider implements IAuthProvider {
  readonly mode = 'apikey' as const;
  private readonly store: IUserStore;
  private readonly jwt: JwtService;

  constructor(store: IUserStore, jwt: JwtService) {
    this.store = store;
    this.jwt = jwt;
  }

  async authenticate(creds: AuthCredentials): Promise<AuthResult> {
    // ── JWT re-use ──────────────────────────────────────────────────────────
    if (creds.jwtToken) {
      const ctx = await this.verifyToken(creds.jwtToken);
      if (ctx) return { success: true, user: ctx.user, token: creds.jwtToken };
      return { success: false, error: 'Invalid or expired token' };
    }

    const rawKey = creds.apiKey;
    if (!rawKey) return { success: false, error: 'API key required' };

    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const user = await this.store.findByApiKeyHash(keyHash);
    if (!user) {
      globalLogger.warn(TAG, 'API key lookup failed (unknown or revoked)');
      return { success: false, error: 'Invalid API key' };
    }

    // Update lastUsedAt on the matching key record
    const keyRecord = user.apiKeys.find(k => k.keyHash === keyHash);
    if (keyRecord) {
      keyRecord.lastUsedAt = new Date().toISOString();
      // Best-effort async update — don't await to avoid latency on every call
      this.store.updateUser(user.id, { apiKeys: user.apiKeys }).catch(e =>
        globalLogger.debug(TAG, `lastUsedAt update failed: ${e.message}`));
    }

    const token = this.jwt.sign({
      sub: user.id, username: user.username,
      roles: user.roles, externalGroups: [], authMode: 'apikey',
    });
    globalLogger.debug(TAG, `API key auth success for user '${user.username}'`);
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
      authMode: 'apikey',
      jwtToken: token,
    };
  }

  async getRedirectUrl(): Promise<null> { return null; }
}
