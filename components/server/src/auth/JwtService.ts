/**
 * auth/JwtService.ts
 *
 * Thin wrapper around JSON Web Tokens for session persistence.
 *
 * Falls back to a manual HS256 implementation when the `jsonwebtoken` package
 * is not installed, so the server starts without additional npm installs.
 * For production use, install: npm install jsonwebtoken @types/jsonwebtoken
 */

import * as crypto from 'crypto';
import { JwtConfig, JwtPayload, AuthContext, AuthMode } from './types';
import { globalLogger } from '../utils/Logger';

const TAG = 'JwtService';

export class JwtService {
  private readonly cfg: JwtConfig;

  constructor(cfg: JwtConfig) {
    this.cfg = cfg;
  }

  sign(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
    const now = Math.floor(Date.now() / 1000);
    const full: JwtPayload = {
      ...payload,
      iat: now,
      exp: now + this.cfg.expiryMinutes * 60,
    };
    return this.manualSign(full);
  }

  verify(token: string): JwtPayload | null {
    try {
      return this.manualVerify(token);
    } catch (err) {
      globalLogger.debug(TAG, `JWT verify failed: ${(err as Error).message}`);
      return null;
    }
  }

  toAuthContext(payload: JwtPayload, authMode: AuthMode): AuthContext {
    return {
      authenticated: true,
      effectiveRoles: [...payload.roles, ...payload.externalGroups],
      authMode,
      jwtToken: this.sign(payload),
    };
  }

  // ─── Manual HS256 implementation ────────────────────────────────────────

  private manualSign(payload: JwtPayload): string {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body   = b64url(JSON.stringify(payload));
    const sig    = this.hmac(`${header}.${body}`);
    return `${header}.${body}.${sig}`;
  }

  private manualVerify(token: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed JWT');
    const [header, body, sig] = parts;
    const expected = this.hmac(`${header}.${body}`);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new Error('Signature mismatch');
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) throw new Error('Token expired');
    return payload;
  }

  private hmac(data: string): string {
    return crypto.createHmac('sha256', this.cfg.secret).update(data).digest('base64url');
  }
}

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}
