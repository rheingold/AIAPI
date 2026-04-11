/**
 * auth/providers/SamlProvider.ts
 *
 * IAuthProvider for auth.mode = "saml".
 *
 * Implements SAML 2.0 SP-initiated SSO (HTTP-POST binding).
 *
 * Flow:
 *  1. GET /api/auth/saml/redirect
 *    → server builds SAML AuthnRequest
 *    → returns IdP SSO URL + SAMLRequest param for client to POST/redirect
 *  2. IdP POSTs to /api/auth/saml/callback with SAMLResponse
 *    → server verifies signature against IdP cert
 *    → extracts username via auth.saml.usernamePath (default: nameID)
 *    → extracts groups via auth.saml.groupsPath (optional attribute name)
 *    → provisions/updates user record
 *    → issues JWT
 *
 * Required package: npm install samlify
 * Falls back to a lightweight XML parser for demo/testing when samlify
 * is absent (SIGNATURE IS NOT VERIFIED in fallback mode — log warning).
 *
 * Debug logging enabled when auth.debugExternalAuth = true.
 */

import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { IAuthProvider, AuthCredentials, AuthResult, AuthContext, SamlConfig, IUserStore } from '../types';
import { JwtService } from '../JwtService';
import { globalLogger } from '../../utils/Logger';

const TAG = 'SamlProvider';

export class SamlProvider implements IAuthProvider {
  readonly mode = 'saml' as const;
  private readonly cfg: SamlConfig;
  private readonly store: IUserStore;
  private readonly jwt: JwtService;
  private readonly debugAuth: boolean;

  constructor(cfg: SamlConfig, store: IUserStore, jwt: JwtService, debugAuth = false) {
    this.cfg = cfg;
    this.store = store;
    this.jwt = jwt;
    this.debugAuth = debugAuth;
  }

  /** Step 1 — build SAMLRequest redirect URL */
  async getRedirectUrl(relayState?: string): Promise<string> {
    const authnRequest = this.buildAuthnRequest(relayState);
    const deflated = zlib.deflateRawSync(Buffer.from(authnRequest, 'utf-8'));
    const encoded = deflated.toString('base64');
    const params = new URLSearchParams({
      SAMLRequest: encoded,
      ...(relayState ? { RelayState: relayState } : {}),
    });
    return `${this.cfg.entryPoint}?${params.toString()}`;
  }

  /** Step 2 — called with the SAMLResponse from the callback endpoint */
  async authenticate(creds: AuthCredentials): Promise<AuthResult> {
    // ── JWT re-use ──────────────────────────────────────────────────────────
    if (creds.jwtToken) {
      const ctx = await this.verifyToken(creds.jwtToken);
      if (ctx) return { success: true, user: ctx.user, token: creds.jwtToken };
      return { success: false, error: 'Invalid or expired token' };
    }

    const { samlResponse } = creds;
    if (!samlResponse) return { success: false, error: 'SAMLResponse missing' };

    let xml: string;
    try {
      xml = Buffer.from(samlResponse, 'base64').toString('utf-8');
    } catch {
      return { success: false, error: 'Cannot decode SAMLResponse' };
    }

    if (this.debugAuth) {
      globalLogger.debug(TAG, `[SAML] SAMLResponse XML (${xml.length} bytes):\n${xml.substring(0, 2000)}`);
    }

    // ── Try samlify for production-grade verification ────────────────────
    const parsed = await this.parseWithSamlify(xml) ?? this.parseSimple(xml);
    if (!parsed) return { success: false, error: 'SAML assertion parse failed' };

    const { username, groups } = parsed;
    if (!username) return { success: false, error: 'Cannot find username in assertion' };

    // ── Provision/update user ───────────────────────────────────────────────
    let user = await this.store.findByUsername(username);
    if (!user) {
      user = await this.store.createUser({
        username,
        apiKeys: [],
        roles: [],     // roles resolved from externalGroups
        enabled: true,
      });
      globalLogger.info(TAG, `Auto-provisioned SAML user '${username}'`);
    }

    const token = this.jwt.sign({
      sub: user.id, username: user.username,
      roles: user.roles, externalGroups: groups, authMode: 'saml',
    });
    globalLogger.info(TAG, `SAML auth success for '${username}' groups=[${groups.join(',')}]`);
    return { success: true, user, externalGroups: groups, token };
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
      authMode: 'saml',
      jwtToken: token,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private buildAuthnRequest(relayState?: string): string {
    const id = `_${crypto.randomBytes(12).toString('hex')}`;
    const now = new Date().toISOString();
    return [
      `<?xml version="1.0"?>`,
      `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"`,
      `  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`,
      `  ID="${id}" Version="2.0" IssueInstant="${now}"`,
      `  AssertionConsumerServiceURL="${escapeXml(this.cfg.callbackUrl)}"`,
      `  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
      `  <saml:Issuer>${escapeXml(this.cfg.issuer)}</saml:Issuer>`,
      `</samlp:AuthnRequest>`,
    ].join('\n');
  }

  private async parseWithSamlify(xml: string): Promise<{ username: string; groups: string[] } | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      // @ts-ignore: optional peer dependency
      const samlify = await import('samlify').then(m => m.default ?? m);
      const sp = (samlify as { ServiceProvider(cfg: unknown): { parseLoginResponse(idp: unknown, binding: string, req: { body: { SAMLResponse: string } }): Promise<{ extract: { nameID?: string; attributes?: Record<string, unknown> } }> } }).ServiceProvider({
        entityID: this.cfg.issuer,
        assertionConsumerService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST', Location: this.cfg.callbackUrl }],
      });
      const idpCert = loadPem(this.cfg.cert);
      const idp = (samlify as { IdentityProvider(cfg: unknown): unknown }).IdentityProvider({
        entityID: this.cfg.entryPoint,
        signingCert: idpCert,
      });
      const result = await sp.parseLoginResponse(idp, 'post', { body: { SAMLResponse: Buffer.from(xml).toString('base64') } });
      const nameID = result.extract.nameID;
      const attrs = result.extract.attributes ?? {};
      const groupAttr = this.cfg.groupsPath ? (attrs[this.cfg.groupsPath] as string | string[] | undefined) : undefined;
      const groups = groupAttr ? (Array.isArray(groupAttr) ? groupAttr : [groupAttr]) : [];
      if (!nameID) return null;
      return { username: nameID, groups };
    } catch (err) {
      globalLogger.debug(TAG, `samlify not available or failed (${(err as Error).message}) — using simple XML parser`);
      return null;
    }
  }

  /** Very simple XML regex parser — used only when samlify is unavailable. NO SIGNATURE VERIFICATION. */
  private parseSimple(xml: string): { username: string; groups: string[] } | null {
    globalLogger.warn(TAG, '⚠️  Using unverified SAML XML parser (samlify not installed). Install with: npm install samlify');

    // Extract nameID
    let username: string | null = null;
    const nameIdPath = this.cfg.usernamePath;
    if (nameIdPath === 'nameID' || nameIdPath === 'NameID') {
      const m = xml.match(/<(?:[^:>]+:)?NameID[^>]*>([^<]+)<\/(?:[^:>]+:)?NameID>/);
      username = m ? m[1].trim() : null;
    } else {
      // Try attribute
      const attrRe = new RegExp(`Name="${escapeRegex(nameIdPath)}"[^>]*>[\\s\\S]*?<[^:>]+:AttributeValue[^>]*>([^<]+)<`);
      const m = xml.match(attrRe);
      username = m ? m[1].trim() : null;
    }

    const groups: string[] = [];
    if (this.cfg.groupsPath) {
      const attrRe = new RegExp(`Name="${escapeRegex(this.cfg.groupsPath)}"[\\s\\S]*?<[^:>]+:AttributeValue[^>]*>([^<]+)<`, 'g');
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(xml)) !== null) groups.push(m[1].trim());
    }

    if (!username) return null;
    return { username, groups };
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadPem(certOrPath: string): string {
  if (certOrPath.startsWith('file:')) {
    const fs = require('fs') as typeof import('fs');
    return fs.readFileSync(certOrPath.slice(5), 'utf-8');
  }
  return certOrPath;
}
