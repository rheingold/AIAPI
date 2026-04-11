/**
 * auth/providers/OAuthProvider.ts
 *
 * IAuthProvider for auth.mode = "oauth".
 *
 * Implements OAuth2 Authorization Code flow with optional PKCE (RFC 7636).
 * Supports any OAuth2/OIDC-compliant provider (Google, Microsoft AAD,
 * GitHub, Keycloak, Auth0, etc.) via the config URLs.
 *
 * Flow:
 *  1. Client calls GET /api/auth/oauth/redirect
 *    → server builds authorization URL with state + code_verifier (PKCE)
 *    → redirects client to IdP
 *  2. IdP redirects to GET /api/auth/oauth/callback?code=…&state=…
 *    → server exchanges code for access token (+ code_verifier for PKCE)
 *    → server fetches userInfo (or parses ID token)
 *    → extracts username via auth.oauth.usernamePath
 *    → extracts groups via auth.oauth.groupsPath (optional)
 *    → provisions/updates the user record
 *    → issues a JWT
 *
 * Optional packages (graceful degradation if absent):
 *   npm install node-fetch   (if Node < 18, which has built-in fetch)
 *
 * Debug logging of OAuth request/response bodies is enabled when
 * auth.debugExternalAuth = true (credentials are redacted).
 */

import * as crypto from 'crypto';
import * as url from 'url';
import { IAuthProvider, AuthCredentials, AuthResult, AuthContext, OAuthConfig, IUserStore } from '../types';
import { JwtService } from '../JwtService';
import { globalLogger } from '../../utils/Logger';

const TAG = 'OAuthProvider';

interface PkceState {
  codeVerifier: string;
  createdAt: number;
}

export class OAuthProvider implements IAuthProvider {
  readonly mode = 'oauth' as const;
  private readonly cfg: OAuthConfig;
  private readonly store: IUserStore;
  private readonly jwt: JwtService;
  private readonly debugAuth: boolean;
  /** Short-lived PKCE state map: state → code_verifier; cleaned up after use */
  private readonly pkceMap = new Map<string, PkceState>();

  constructor(cfg: OAuthConfig, store: IUserStore, jwt: JwtService, debugAuth = false) {
    this.cfg = cfg;
    this.store = store;
    this.jwt = jwt;
    this.debugAuth = debugAuth;
  }

  /** Step 1 — build the authorization URL (client will be redirected here) */
  async getRedirectUrl(state?: string): Promise<string> {
    const st = state ?? crypto.randomBytes(16).toString('hex');
    const params: Record<string, string> = {
      response_type: 'code',
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.callbackUrl,
      scope: this.cfg.scope,
      state: st,
    };
    if (this.cfg.pkce) {
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      params['code_challenge'] = codeChallenge;
      params['code_challenge_method'] = 'S256';
      this.pkceMap.set(st, { codeVerifier, createdAt: Date.now() });
      this.gcPkceMap();
    }
    return `${this.cfg.authorizationUrl}?${new url.URLSearchParams(params).toString()}`;
  }

  /** Step 2 — called from the callback endpoint with code + state */
  async authenticate(creds: AuthCredentials): Promise<AuthResult> {
    // ── JWT re-use ──────────────────────────────────────────────────────────
    if (creds.jwtToken) {
      const ctx = await this.verifyToken(creds.jwtToken);
      if (ctx) return { success: true, user: ctx.user, token: creds.jwtToken };
      return { success: false, error: 'Invalid or expired token' };
    }

    const { oauthCode, oauthState } = creds;
    if (!oauthCode) return { success: false, error: 'OAuth code missing from callback' };

    let codeVerifier: string | undefined;
    if (this.cfg.pkce && oauthState) {
      const entry = this.pkceMap.get(oauthState);
      if (entry) {
        codeVerifier = entry.codeVerifier;
        this.pkceMap.delete(oauthState);
      }
    }

    // ── Token exchange ──────────────────────────────────────────────────────
    const tokenRes = await this.exchangeCode(oauthCode, codeVerifier);
    if (!tokenRes.access_token) {
      return { success: false, error: `Token exchange failed: ${tokenRes.error ?? 'unknown'}` };
    }

    // ── UserInfo ────────────────────────────────────────────────────────────
    const userInfo = await this.fetchUserInfo(tokenRes.access_token, tokenRes.id_token);
    if (!userInfo) return { success: false, error: 'Could not retrieve userInfo' };

    const username = resolveJsonPath(userInfo, this.cfg.usernamePath);
    if (!username) return { success: false, error: `Cannot resolve username at path '${this.cfg.usernamePath}'` };

    const externalGroups: string[] = this.cfg.groupsPath
      ? (resolveJsonPath(userInfo, this.cfg.groupsPath) as string[] | null) ?? []
      : [];

    // ── Provision/update user ───────────────────────────────────────────────
    let user = await this.store.findByUsername(username as string);
    if (!user) {
      user = await this.store.createUser({
        username: username as string,
        apiKeys: [],
        roles: [],        // roles come from externalGroups
        enabled: true,
      });
      globalLogger.info(TAG, `Auto-provisioned OAuth user '${username}'`);
    }

    const token = this.jwt.sign({
      sub: user.id, username: user.username,
      roles: user.roles, externalGroups, authMode: 'oauth',
    });
    globalLogger.info(TAG, `OAuth auth success for '${username}' groups=[${externalGroups.join(',')}]`);
    return { success: true, user, externalGroups, token };
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
      authMode: 'oauth',
      jwtToken: token,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async exchangeCode(code: string, codeVerifier?: string): Promise<Record<string, string>> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg.callbackUrl,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    };
    if (codeVerifier) body['code_verifier'] = codeVerifier;

    if (this.debugAuth) {
      globalLogger.debug(TAG, `[OAuth] token exchange → ${this.cfg.tokenUrl} body=${JSON.stringify({ ...body, client_secret: '***' })}`);
    }

    const resp = await globalFetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new url.URLSearchParams(body).toString(),
    });
    const json = await resp.json() as Record<string, string>;

    if (this.debugAuth) {
      globalLogger.debug(TAG, `[OAuth] token response: ${JSON.stringify({ ...json, access_token: json.access_token ? '***' : undefined, id_token: json.id_token ? '***' : undefined })}`);
    }
    return json;
  }

  private async fetchUserInfo(accessToken: string, idToken?: string): Promise<Record<string, unknown> | null> {
    // If no userInfoUrl, try to decode the ID token claims
    if (!this.cfg.userInfoUrl) {
      if (idToken) return decodeJwtClaims(idToken);
      return null;
    }
    if (this.debugAuth) {
      globalLogger.debug(TAG, `[OAuth] userInfo GET → ${this.cfg.userInfoUrl}`);
    }
    const resp = await globalFetch(this.cfg.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await resp.json() as Record<string, unknown>;
    if (this.debugAuth) {
      globalLogger.debug(TAG, `[OAuth] userInfo response: ${JSON.stringify(json)}`);
    }
    return json;
  }

  private gcPkceMap(): void {
    const threshold = Date.now() - 10 * 60 * 1000; // 10 min TTL
    for (const [k, v] of this.pkceMap) {
      if (v.createdAt < threshold) this.pkceMap.delete(k);
    }
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Resolve a dot-path through a JSON object: "a.b.c" → obj.a.b.c */
function resolveJsonPath(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, obj);
}

/** Decode JWT claims without verifying signature (IdP-signed token) */
function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Use native fetch (Node ≥ 18) or fall back to node-fetch */
async function globalFetch(url: string, init: RequestInit): Promise<Response> {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(url, init);
  }
  // @ts-ignore: optional peer dependency
  const nodeFetch = await import('node-fetch').then(m => m.default ?? m).catch(() => {
    throw new Error('node-fetch not installed and Node < 18 — run: npm install node-fetch');
  });
  return nodeFetch(url, init as Parameters<typeof nodeFetch>[1]) as unknown as Response;
}
