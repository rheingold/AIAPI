/**
 * auth/stores/DbUserStore.ts
 *
 * IUserStore backed by a remote relational database.
 *
 * Expected schema (run once per DB engine — DDL shown for PostgreSQL;
 * see inline comments for adjustments needed per engine):
 *
 *   CREATE TABLE aiapi_users (
 *     id           VARCHAR(36)  PRIMARY KEY,
 *     username     VARCHAR(255) NOT NULL UNIQUE,
 *     password_hash VARCHAR(512),
 *     enabled      BOOLEAN      NOT NULL DEFAULT TRUE,
 *     created_at   TIMESTAMP    NOT NULL,
 *     updated_at   TIMESTAMP
 *   );
 *   CREATE TABLE aiapi_roles (
 *     id           VARCHAR(36)  PRIMARY KEY,
 *     name         VARCHAR(128) NOT NULL UNIQUE,
 *     description  TEXT,
 *     permissions  TEXT NOT NULL   -- JSON array of Permission objects
 *   );
 *   CREATE TABLE aiapi_user_roles (
 *     user_id  VARCHAR(36) NOT NULL REFERENCES aiapi_users(id) ON DELETE CASCADE,
 *     role_name VARCHAR(128) NOT NULL,
 *     PRIMARY KEY (user_id, role_name)
 *   );
 *   CREATE TABLE aiapi_apikeys (
 *     id           VARCHAR(36)  PRIMARY KEY,
 *     user_id      VARCHAR(36)  NOT NULL REFERENCES aiapi_users(id) ON DELETE CASCADE,
 *     key_hash     VARCHAR(64)  NOT NULL UNIQUE,   -- SHA-256 hex of raw key
 *     label        VARCHAR(255),
 *     created_at   TIMESTAMP    NOT NULL,
 *     last_used_at TIMESTAMP
 *   );
 *
 * Reuses the same DB connection infrastructure as DbSettingsAdapter.
 * Pass the same DbConfig (or a different one via auth.users.db.* overrides).
 */

import * as crypto from 'crypto';
import { IUserStore, User, Role, Permission, ApiKeyRecord } from '../types';
import { DbConfig } from '../../settings/types';
import { DbProvisioner } from '../../db/DbProvisioner';
import { globalLogger } from '../../utils/Logger';

const TAG = 'DbUserStore';

// Reuse the same lazy-driver pattern from DbSettingsAdapter — we can't
// circularly import it, so we duplicate the minimal interface here.
interface DbConn {
  query(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  close(): Promise<void>;
}

async function openConn(cfg: DbConfig): Promise<DbConn> {
  // Delegate to the same factory in DbSettingsAdapter via a dynamic import so
  // both adapters use a shared pool in practice. If they are initialised from
  // the same singleton SettingsManager this import chain is cheap.
  const { DbSettingsAdapter } = await import('../../settings/adapters/DbSettingsAdapter');
  const dummy = new DbSettingsAdapter(cfg);
  // Access the private static factory through a lightweight wrapper approach.
  // In a production refactor, extract openConnection() to a shared db/connection.ts.
  // For now we reopen independently (connection pools are cheap for 5-user stores).
  return openDriverConn(cfg);
}

async function openDriverConn(cfg: DbConfig): Promise<DbConn> {
  switch (cfg.type) {
    case 'mssql': {
      // @ts-ignore: optional peer dependency
      const mssql = await import('mssql').then(m => m.default ?? m).catch(() => { throw new Error('mssql not installed'); });
      const auth = cfg.auth;
      const opts: Record<string, unknown> = {
        server: cfg.host, port: cfg.port ?? 1433, database: cfg.database,
        options: { encrypt: cfg.tls, trustServerCertificate: !cfg.tls },
      };
      if (auth.method === 'password') { opts.user = auth.username; opts.password = auth.password; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pool: any = await new (mssql as { ConnectionPool: new (c: unknown) => { connect(): Promise<any> } }).ConnectionPool(opts).connect();
      return makePool('mssql', pool, null, null, null);
    }
    case 'mysql': {
      // @ts-ignore: optional peer dependency
      const mysql = await import('mysql2/promise').then(m => m.default ?? m).catch(() => { throw new Error('mysql2 not installed'); });
      const pool = (mysql as { createPool(c: unknown): unknown }).createPool({
        host: cfg.host, port: cfg.port ?? 3306, database: cfg.database,
        user: cfg.auth.username, password: cfg.auth.password,
        ssl: cfg.tls ? { rejectUnauthorized: true } : undefined,
        connectionLimit: 3,
      });
      return makePool('mysql', null, pool, null, null);
    }
    case 'postgresql': {
      // @ts-ignore: optional peer dependency
      const { Pool } = await import('pg').then(m => m.default ?? m).catch(() => { throw new Error('pg not installed'); });
      const pool = new Pool({
        host: cfg.host, port: cfg.port ?? 5432, database: cfg.database,
        user: cfg.auth.username, password: cfg.auth.password,
        ssl: cfg.tls ? { rejectUnauthorized: true } : undefined, max: 3,
      });
      return makePool('postgresql', null, null, pool, null);
    }
    case 'oracle': {
      // @ts-ignore: optional peer dependency
      const oracledb = await import('oracledb').then(m => m.default ?? m).catch(() => { throw new Error('oracledb not installed'); });
      (oracledb as { outFormat: number }).outFormat = (oracledb as { OUT_FORMAT_OBJECT: number }).OUT_FORMAT_OBJECT;
      const conn = await (oracledb as { getConnection(c: unknown): Promise<unknown> }).getConnection({
        connectString: `${cfg.host}:${cfg.port ?? 1521}/${cfg.database}`,
        user: cfg.auth.username, password: cfg.auth.password,
      });
      return makePool('oracle', null, null, null, conn);
    }
    default: throw new Error(`Unknown db.type: ${cfg.type}`);
  }
}

// Minimal pool wrapper — each engine has a slightly different execute API
function makePool(type: string, mssql: unknown, mysql: unknown, pg: unknown, oracle: unknown): DbConn {
  async function query(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
    if (type === 'mssql') {
      const req = (mssql as { request(): { input(n: string, v: unknown): void; query(s: string): Promise<{ recordset: unknown[] }> } }).request();
      params.forEach((p, i) => req.input(`p${i}`, p));
      const r = await req.query(sql.replace(/\?/g, (_m, i) => `@p${i}`));
      return r.recordset as Array<Record<string, unknown>>;
    }
    if (type === 'mysql') {
      const [rows] = await (mysql as { execute(sql: string, params: unknown[]): Promise<[unknown[]]> }).execute(sql, params);
      return rows as Array<Record<string, unknown>>;
    }
    if (type === 'postgresql') {
      // pg uses $1 $2 … style params; transform ? placeholders
      let pidx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++pidx}`);
      const r = await (pg as { query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> }).query(pgSql, params);
      return r.rows as Array<Record<string, unknown>>;
    }
    // oracle
    const r = await (oracle as { execute(sql: string, params: unknown[], opts: unknown): Promise<{ rows: unknown[] }> })
      .execute(sql, params, { outFormat: 4002 }); // OUT_FORMAT_OBJECT = 4002
    return (r.rows ?? []) as Array<Record<string, unknown>>;
  }
  async function execute(sql: string, params: unknown[] = []): Promise<void> {
    await query(sql, params);
    if (type === 'oracle') await (oracle as { commit(): Promise<void> }).commit();
  }
  async function close(): Promise<void> {
    if (type === 'oracle') await (oracle as { close(): Promise<void> }).close();
    else if (type === 'postgresql') await (pg as { end(): Promise<void> }).end();
    else if (type === 'mysql') await (mysql as { end(): Promise<void> }).end();
    else await (mssql as { close(): Promise<void> }).close();
  }
  return { query, execute, close };
}

export class DbUserStore implements IUserStore {
  private readonly cfg: DbConfig;
  private conn: DbConn | null = null;

  constructor(cfg: DbConfig) {
    this.cfg = cfg;
  }

  async initialize(): Promise<void> {
    // Apply pending schema migrations (idempotent — safe to call on every startup)
    const migResult = await DbProvisioner.ensureSchema(this.cfg);
    if (migResult.status === 'error') {
      throw new Error(`DbUserStore schema migration failed: ${migResult.error}`);
    }
    globalLogger.info(TAG, `Schema: ${migResult.detail}`);
    this.conn = await openDriverConn(this.cfg);
    globalLogger.info(TAG, `Connected to ${this.cfg.type} for user store`);
  }

  async close(): Promise<void> {
    await this.conn?.close();
    this.conn = null;
  }

  // ─── IUserStore ──────────────────────────────────────────────────────────

  async findByUsername(username: string): Promise<User | null> {
    this.ensure();
    const rows = await this.conn!.query(
      'SELECT * FROM aiapi_users WHERE username=? AND enabled=TRUE', [username]);
    if (!rows.length) return null;
    return this.hydrateUser(rows[0]);
  }

  async findByApiKeyHash(keyHash: string): Promise<User | null> {
    this.ensure();
    const rows = await this.conn!.query(
      'SELECT u.* FROM aiapi_users u JOIN aiapi_apikeys k ON k.user_id=u.id WHERE k.key_hash=? AND u.enabled=TRUE', [keyHash]);
    if (!rows.length) return null;
    return this.hydrateUser(rows[0]);
  }

  async listUsers(): Promise<User[]> {
    this.ensure();
    const rows = await this.conn!.query('SELECT * FROM aiapi_users ORDER BY created_at');
    return Promise.all(rows.map(r => this.hydrateUser(r)));
  }

  async createUser(draft: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    this.ensure();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.conn!.execute(
      'INSERT INTO aiapi_users (id, username, password_hash, enabled, created_at) VALUES (?,?,?,?,?)',
      [id, draft.username, draft.passwordHash ?? null, draft.enabled, now],
    );
    for (const role of draft.roles) {
      await this.conn!.execute('INSERT INTO aiapi_user_roles (user_id, role_name) VALUES (?,?)', [id, role]);
    }
    return { ...draft, id, createdAt: now };
  }

  async updateUser(id: string, patch: Partial<Omit<User, 'id'>>): Promise<User> {
    this.ensure();
    const now = new Date().toISOString();
    if (patch.passwordHash !== undefined) {
      await this.conn!.execute('UPDATE aiapi_users SET password_hash=?, updated_at=? WHERE id=?', [patch.passwordHash, now, id]);
    }
    if (patch.enabled !== undefined) {
      await this.conn!.execute('UPDATE aiapi_users SET enabled=?, updated_at=? WHERE id=?', [patch.enabled, now, id]);
    }
    if (patch.roles) {
      await this.conn!.execute('DELETE FROM aiapi_user_roles WHERE user_id=?', [id]);
      for (const role of patch.roles) {
        await this.conn!.execute('INSERT INTO aiapi_user_roles (user_id, role_name) VALUES (?,?)', [id, role]);
      }
    }
    if (patch.apiKeys) {
      await this.conn!.execute('DELETE FROM aiapi_apikeys WHERE user_id=?', [id]);
      for (const k of patch.apiKeys) {
        await this.conn!.execute(
          'INSERT INTO aiapi_apikeys (id, user_id, key_hash, label, created_at) VALUES (?,?,?,?,?)',
          [k.id, id, k.keyHash, k.label ?? '', k.createdAt],
        );
      }
    }
    const rows = await this.conn!.query('SELECT * FROM aiapi_users WHERE id=?', [id]);
    if (!rows.length) throw new Error(`User '${id}' not found`);
    return this.hydrateUser(rows[0]);
  }

  async deleteUser(id: string): Promise<void> {
    this.ensure();
    await this.conn!.execute('DELETE FROM aiapi_users WHERE id=?', [id]);
  }

  async listRoles(): Promise<Role[]> {
    this.ensure();
    const rows = await this.conn!.query('SELECT * FROM aiapi_roles ORDER BY name');
    return rows.map(r => ({
      id: r['id'] as string,
      name: r['name'] as string,
      description: r['description'] as string | undefined,
      permissions: JSON.parse(r['permissions'] as string) as Permission[],
    }));
  }

  async findRole(name: string): Promise<Role | null> {
    this.ensure();
    const rows = await this.conn!.query('SELECT * FROM aiapi_roles WHERE name=?', [name]);
    if (!rows.length) return null;
    return {
      id: rows[0]['id'] as string,
      name: rows[0]['name'] as string,
      description: rows[0]['description'] as string | undefined,
      permissions: JSON.parse(rows[0]['permissions'] as string) as Permission[],
    };
  }

  async upsertRole(draft: Omit<Role, 'id'>): Promise<Role> {
    this.ensure();
    const existing = await this.findRole(draft.name);
    const permsJson = JSON.stringify(draft.permissions);
    if (existing) {
      await this.conn!.execute('UPDATE aiapi_roles SET description=?, permissions=? WHERE name=?',
        [draft.description ?? null, permsJson, draft.name]);
      return { ...existing, ...draft };
    }
    const id = crypto.randomUUID();
    await this.conn!.execute('INSERT INTO aiapi_roles (id, name, description, permissions) VALUES (?,?,?,?)',
      [id, draft.name, draft.description ?? null, permsJson]);
    return { ...draft, id };
  }

  async deleteRole(id: string): Promise<void> {
    this.ensure();
    await this.conn!.execute('DELETE FROM aiapi_roles WHERE id=?', [id]);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private ensure(): void {
    if (!this.conn) throw new Error('DbUserStore not initialized');
  }

  private async hydrateUser(row: Record<string, unknown>): Promise<User> {
    const id = row['id'] as string;
    const roleRows = await this.conn!.query('SELECT role_name FROM aiapi_user_roles WHERE user_id=?', [id]);
    const apiKeyRows = await this.conn!.query(
      'SELECT id, key_hash, label, created_at, last_used_at FROM aiapi_apikeys WHERE user_id=?', [id]);
    return {
      id,
      username: row['username'] as string,
      passwordHash: (row['password_hash'] as string | null) ?? undefined,
      roles: roleRows.map(r => r['role_name'] as string),
      apiKeys: apiKeyRows.map(r => ({
        id: r['id'] as string,
        keyHash: r['key_hash'] as string,
        label: (r['label'] as string) ?? '',
        createdAt: r['created_at'] as string,
        lastUsedAt: (r['last_used_at'] as string | null) ?? undefined,
      } as ApiKeyRecord)),
      enabled: Boolean(row['enabled']),
      createdAt: row['created_at'] as string,
      updatedAt: (row['updated_at'] as string | null) ?? undefined,
    };
  }
}
