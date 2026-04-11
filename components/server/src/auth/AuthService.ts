/**
 * auth/AuthService.ts
 *
 * Top-level factory and runtime for the authentication subsystem.
 *
 * Responsibilities:
 *  - Build the correct IAuthProvider and IUserStore from AuthConfig
 *  - Expose a single authenticate() entry point for the middleware
 *  - Expose admin operations (user / role CRUD) for _internal handlers
 *  - Expose the redirect URL for OAuth / SAML flows
 *
 * Instantiated once at server startup by the HTTP server.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import {
  AuthConfig, AuthMode, IAuthProvider, IUserStore, AuthResult, AuthContext,
  AuthCredentials, User, Role,
} from './types';
import { JwtService } from './JwtService';
import { NoAuthProvider } from './providers/NoAuthProvider';
import { PasswordAuthProvider } from './providers/PasswordAuthProvider';
import { ApiKeyAuthProvider } from './providers/ApiKeyAuthProvider';
import { CertificateAuthProvider } from './providers/CertificateAuthProvider';
import { OAuthProvider } from './providers/OAuthProvider';
import { SamlProvider } from './providers/SamlProvider';
import { JsonUserStore } from './stores/JsonUserStore';
import { DbUserStore } from './stores/DbUserStore';
import { DbConfig } from '../settings/types';
import { globalLogger } from '../utils/Logger';

const TAG = 'AuthService';

export class AuthService {
  readonly mode: AuthMode;
  private readonly provider: IAuthProvider;
  private readonly store: IUserStore;
  private readonly jwt: JwtService;

  private constructor(mode: AuthMode, provider: IAuthProvider, store: IUserStore, jwt: JwtService) {
    this.mode = mode;
    this.provider = provider;
    this.store = store;
    this.jwt = jwt;
  }

  /**
   * Build and initialise the AuthService from an AuthConfig.
   * Call once at server startup.
   */
  static async create(cfg: AuthConfig): Promise<AuthService> {
    // ── User store ──────────────────────────────────────────────────────────
    let store: IUserStore;
    if (cfg.users.storeSource === 'db') {
      const dbCfg = (cfg as AuthConfig & { users: { db: DbConfig } }).users.db;
      if (!dbCfg) throw new Error('auth.users.storeSource = "db" but no auth.users.db config provided');
      const dbStore = new DbUserStore(dbCfg);
      await dbStore.initialize();
      store = dbStore;
    } else {
      const jsonStore = new JsonUserStore(cfg.users.jsonPath);
      await jsonStore.initialize();
      store = jsonStore;
    }

    // ── JWT service ─────────────────────────────────────────────────────────
    const jwtCfg = {
      ...cfg.jwt,
      // Auto-generate secret on first start
      secret: cfg.jwt.secret || crypto.randomBytes(32).toString('hex'),
    };
    const jwt = new JwtService(jwtCfg);

    // ── Auth provider ───────────────────────────────────────────────────────
    let provider: IAuthProvider;
    switch (cfg.mode) {
      case 'none':
        provider = new NoAuthProvider();
        break;
      case 'password':
        provider = new PasswordAuthProvider(store, jwt);
        break;
      case 'apikey':
        provider = new ApiKeyAuthProvider(store, jwt);
        break;
      case 'certificate':
        provider = new CertificateAuthProvider(store, jwt, cfg.certificate?.caPath);
        break;
      case 'oauth':
        if (!cfg.oauth) throw new Error('auth.mode = "oauth" but no auth.oauth config provided');
        provider = new OAuthProvider(cfg.oauth, store, jwt, cfg.debugExternalAuth);
        break;
      case 'saml':
        if (!cfg.saml) throw new Error('auth.mode = "saml" but no auth.saml config provided');
        provider = new SamlProvider(cfg.saml, store, jwt, cfg.debugExternalAuth);
        break;
      default:
        throw new Error(`Unknown auth.mode: ${cfg.mode}`);
    }

    globalLogger.info(TAG, `Auth mode: ${cfg.mode} | user store: ${cfg.users.storeSource}`);
    return new AuthService(cfg.mode, provider, store, jwt);
  }

  // ─── Core auth ────────────────────────────────────────────────────────────

  async authenticate(creds: AuthCredentials): Promise<AuthResult> {
    return this.provider.authenticate(creds);
  }

  async verifyToken(token: string): Promise<AuthContext | null> {
    return this.provider.verifyToken?.(token) ?? null;
  }

  async getRedirectUrl(state?: string): Promise<string | null> {
    return this.provider.getRedirectUrl?.(state) ?? null;
  }

  // ─── User admin ───────────────────────────────────────────────────────────

  listUsers()                          { return this.store.listUsers(); }
  findByUsername(u: string)            { return this.store.findByUsername(u); }
  createUser(d: Omit<User,'id'|'createdAt'|'updatedAt'>) { return this.store.createUser(d); }
  updateUser(id: string, patch: Partial<Omit<User,'id'>>) { return this.store.updateUser(id, patch); }
  deleteUser(id: string)               { return this.store.deleteUser(id); }

  // ─── Role admin ───────────────────────────────────────────────────────────

  listRoles()                          { return this.store.listRoles(); }
  findRole(name: string)               { return this.store.findRole(name); }
  upsertRole(r: Omit<Role,'id'>)       { return this.store.upsertRole(r); }
  deleteRole(id: string)               { return this.store.deleteRole(id); }

  // ─── Helpers for AuthMiddleware ───────────────────────────────────────────

  /** Verify a JWT issued by any provider — used for session continuation */
  verifyJwt(token: string) { return this.jwt.verify(token); }
}
