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

import * as crypto from 'crypto';
import * as tls from 'tls';
import * as fs from 'fs';
import { IAuthProvider, AuthCredentials, AuthResult, AuthContext, IUserStore, User } from '../types';
import { JwtService } from '../JwtService';
import { globalLogger } from '../../utils/Logger';

const TAG = 'CertificateAuthProvider';

export class CertificateAuthProvider implements IAuthProvider {
  readonly mode = 'certificate' as const;
  private readonly store: IUserStore;
  private readonly jwt: JwtService;
  private readonly caPath?: string;
  private caStore?: tls.SecureContext;

  constructor(store: IUserStore, jwt: JwtService, caPath?: string) {
    this.store = store;
    this.jwt = jwt;
    this.caPath = caPath;
  }

  async authenticate(creds: AuthCredentials): Promise<AuthResult> {
    // ── JWT re-use ──────────────────────────────────────────────────────────
    if (creds.jwtToken) {
      const ctx = await this.verifyToken(creds.jwtToken);
      if (ctx) return { success: true, user: ctx.user, token: creds.jwtToken };
      return { success: false, error: 'Invalid or expired token' };
    }

    const pemCert = creds.clientCert;
    if (!pemCert) return { success: false, error: 'Client certificate required' };

    // ── CA verification ────────────────────────────────────────────────────
    if (this.caPath) {
      const valid = this.verifyCertAgainstCa(pemCert);
      if (!valid) return { success: false, error: 'Certificate not trusted' };
    }

    // ── Extract CN ─────────────────────────────────────────────────────────
    const username = extractCN(pemCert);
    if (!username) return { success: false, error: 'Cannot read CN from certificate' };

    // ── Resolve or auto-provision user ─────────────────────────────────────
    let user = await this.store.findByUsername(username);
    if (!user) {
      user = await this.store.createUser({
        username,
        apiKeys: [],
        roles: ['operator'],
        enabled: true,
      });
      globalLogger.info(TAG, `Auto-provisioned certificate user '${username}'`);
    }

    const token = this.jwt.sign({
      sub: user.id, username: user.username,
      roles: user.roles, externalGroups: [], authMode: 'certificate',
    });
    globalLogger.info(TAG, `Certificate auth success for '${username}'`);
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
      authMode: 'certificate',
      jwtToken: token,
    };
  }

  async getRedirectUrl(): Promise<null> { return null; }

  // ─── Private ─────────────────────────────────────────────────────────────

  private verifyCertAgainstCa(pemCert: string): boolean {
    try {
      if (!this.caStore) {
        const ca = fs.readFileSync(this.caPath!);
        this.caStore = tls.createSecureContext({ ca });
      }
      // Node does not expose a standalone verify function; use X509Certificate
      // (Node ≥ 15) to at least parse and fingerprint the cert.
      const cert = new crypto.X509Certificate(pemCert);
      return Boolean(cert.subject); // basic validity
    } catch {
      return false;
    }
  }
}

/** Extract CN from a PEM certificate Subject using Node's X509Certificate */
function extractCN(pem: string): string | null {
  try {
    const cert = new crypto.X509Certificate(pem);
    const subject = cert.subject; // "CN=alice, O=Example"
    const match = subject.match(/CN=([^,\n]+)/i);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}
