/**
 * db/DbProvisioner.ts
 *
 * Database lifecycle manager for AIAPI.
 *
 * Responsibilities (in order):
 *  1. [optionallyCreateDatabase]  — create the target database using a DDL/admin
 *     connection when the user did not pre-provision it themselves.
 *  2. [ensureSchema]              — apply version-tracked migrations to bring
 *     the schema to the latest version, preserving existing data.
 *  3. [seedInitialData]           — insert default roles + admin user when the
 *     users table is still empty (idempotent «seed once»).
 *
 * Usage surfaces
 * ──────────────
 *  • Server startup: `DbUserStore.initialize()` and `DbSettingsAdapter.initialize()`
 *    call `DbProvisioner.ensureSchema(cfg)` automatically so the schema is always
 *    current on first / subsequent connects.
 *  • REST: POST /api/_internal/db/provision  (handleInternalDbProvision)
 *    — allows the dashboard "Auth" panel to trigger a full provision cycle,
 *      including optional DB creation and seeding, after the user fills in
 *      the DB connection form.
 *  • CLI (planned): a lightweight `bin/setup.js` that reads the provision
 *    options from stdin / flags and calls DbProvisioner.provision().
 *
 * Engine support
 * ──────────────
 *  PostgreSQL  — fully tested
 *  MySQL       — structurally equivalent, CI matrix pending
 *  MSSQL       — wraps each CREATE TABLE in IF NOT EXISTS guard
 *  Oracle      — uses EXCEPTION WHEN OTHERS(-955) idiom
 *
 * Schema versioning
 * ─────────────────
 *  aiapi_migrations (version INT PK, applied_at VARCHAR(30))
 *  Migrations are additive-only; never DROP or ALTER in a way that loses data.
 */

import * as crypto from 'crypto';
import { DbConfig, DbType } from '../settings/types';
import { hashFallback } from '../auth/stores/JsonUserStore';
import { globalLogger } from '../utils/Logger';

const TAG = 'DbProvisioner';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ProvisionOptions {
  /** Admin/DDL connection to the server (postgres/master/mysql system DB).
   *  Required only when createDb=true. */
  adminCfg?: DbConfig;
  /** Target DB connection (the AIAPI application database). */
  targetCfg: DbConfig;
  /** If true, create the target database using adminCfg when it doesn't exist. */
  createDb?: boolean;
  /** If true, seed default roles + admin user when the users table is empty. */
  seed?: boolean;
}

export interface ProvisionStep {
  step: string;
  status: 'ok' | 'skip' | 'error';
  detail?: string;
  error?: string;
}

export interface ProvisionResult {
  ok: boolean;
  steps: ProvisionStep[];
}

// ─── Minimal DB connection wrapper (same pattern as adaptation layer) ─────────

interface Conn {
  query(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  close(): Promise<void>;
  readonly type: DbType;
}

async function openConn(cfg: DbConfig): Promise<Conn> {
  switch (cfg.type) {
    case 'postgresql': return openPg(cfg);
    case 'mysql':      return openMysql(cfg);
    case 'mssql':      return openMssql(cfg);
    case 'oracle':     return openOracle(cfg);
    default: throw new Error(`Unknown db.type: ${cfg.type}`);
  }
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────
async function openPg(cfg: DbConfig): Promise<Conn> {
  // @ts-ignore optional peer
  const { Pool } = await import('pg').then(m => m.default ?? m).catch(() => { throw new Error('pg not installed'); });
  const pool = new Pool({
    host: cfg.host, port: cfg.port ?? 5432, database: cfg.database,
    user: cfg.auth.username, password: cfg.auth.password,
    ssl: cfg.tls ? { rejectUnauthorized: true, ca: cfg.tlsCertPath } : undefined,
    max: 2,
  });
  return {
    type: 'postgresql',
    async query(sql, params = []) {
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      const r = await pool.query(pgSql, params);
      return r.rows as Array<Record<string, unknown>>;
    },
    async execute(sql, params = []) {
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      await pool.query(pgSql, params);
    },
    async close() { await pool.end(); },
  };
}

// ── MySQL ─────────────────────────────────────────────────────────────────────
async function openMysql(cfg: DbConfig): Promise<Conn> {
  // @ts-ignore optional peer
  const mysql = await import('mysql2/promise').then(m => m.default ?? m).catch(() => { throw new Error('mysql2 not installed'); });
  const pool = (mysql as { createPool(c: unknown): unknown }).createPool({
    host: cfg.host, port: cfg.port ?? 3306, database: cfg.database,
    user: cfg.auth.username, password: cfg.auth.password,
    ssl: cfg.tls ? { rejectUnauthorized: true } : undefined, connectionLimit: 2,
  });
  return {
    type: 'mysql',
    async query(sql, params = []) {
      const [rows] = await (pool as { execute(s: string, p: unknown[]): Promise<[unknown[]]> }).execute(sql, params);
      return rows as Array<Record<string, unknown>>;
    },
    async execute(sql, params = []) { await (pool as { execute(s: string, p: unknown[]): Promise<unknown> }).execute(sql, params); },
    async close() { await (pool as { end(): Promise<void> }).end(); },
  };
}

// ── MSSQL ─────────────────────────────────────────────────────────────────────
async function openMssql(cfg: DbConfig): Promise<Conn> {
  // @ts-ignore optional peer
  const mssql = await import('mssql').then(m => m.default ?? m).catch(() => { throw new Error('mssql not installed'); });
  const opts: Record<string, unknown> = {
    server: cfg.host, port: cfg.port ?? 1433, database: cfg.database,
    options: { encrypt: cfg.tls, trustServerCertificate: !cfg.tls },
  };
  if (cfg.auth.method === 'password') { opts.user = cfg.auth.username; opts.password = cfg.auth.password; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool: any = await new (mssql as { ConnectionPool: new (c: unknown) => { connect(): Promise<unknown> } }).ConnectionPool(opts).connect();
  return {
    type: 'mssql',
    async query(sql, params = []) {
      const req = pool.request();
      params.forEach((p, i) => req.input(`p${i}`, p));
      const t = sql.replace(/\?/g, (_m: string, i: number) => `@p${i}`);
      const r = await req.query(t);
      return r.recordset as Array<Record<string, unknown>>;
    },
    async execute(sql, params = []) {
      const req = pool.request();
      params.forEach((p, i) => req.input(`p${i}`, p));
      const t = sql.replace(/\?/g, (_m: string, i: number) => `@p${i}`);
      await req.query(t);
    },
    async close() { await pool.close(); },
  };
}

// ── Oracle ────────────────────────────────────────────────────────────────────
async function openOracle(cfg: DbConfig): Promise<Conn> {
  // @ts-ignore optional peer
  const oracledb = await import('oracledb').then(m => m.default ?? m).catch(() => { throw new Error('oracledb not installed'); });
  (oracledb as { outFormat: number }).outFormat = (oracledb as { OUT_FORMAT_OBJECT: number }).OUT_FORMAT_OBJECT;
  const conn = await (oracledb as { getConnection(c: unknown): Promise<unknown> }).getConnection({
    connectString: `${cfg.host}:${cfg.port ?? 1521}/${cfg.database}`,
    user: cfg.auth.username, password: cfg.auth.password,
  });
  return {
    type: 'oracle',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql, params = []) {
      const r = await (conn as any).execute(sql, params, { outFormat: 4002 });
      return (r.rows ?? []) as Array<Record<string, unknown>>;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(sql, params = []) { await (conn as any).execute(sql, params); await (conn as any).commit(); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async close() { await (conn as any).close(); },
  };
}

// ─── SQL migration catalogue ──────────────────────────────────────────────────

interface Migration {
  version: number;
  description: string;
  /** Returns an array of SQL statements to execute.  Each statement must be
   *  idempotent (IF NOT EXISTS / WHEN OTHERS guards). */
  stmts(type: DbType): string[];
}

/**
 * Dialect-aware BOOLEAN column type.
 * PostgreSQL + MySQL can use BOOLEAN; MSSQL uses BIT; Oracle uses NUMBER(1,0).
 */
function boolCol(type: DbType): string {
  if (type === 'mssql') return 'BIT';
  if (type === 'oracle') return 'NUMBER(1,0)';
  return 'BOOLEAN';
}

/**
 * Dialect-aware TEXT column type.
 * PostgreSQL + MySQL: TEXT; MSSQL: NVARCHAR(MAX); Oracle: CLOB.
 */
function textCol(type: DbType): string {
  if (type === 'mssql') return 'NVARCHAR(MAX)';
  if (type === 'oracle') return 'CLOB';
  return 'TEXT';
}

/**
 * Wrap a CREATE TABLE statement so it is safe to run even when the table
 * already exists.
 */
function safeCreate(type: DbType, tableName: string, body: string): string {
  switch (type) {
    case 'postgresql':
    case 'mysql':
      return `CREATE TABLE IF NOT EXISTS ${tableName} (${body})`;
    case 'mssql':
      return (
        `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES ` +
        `WHERE TABLE_NAME='${tableName}' AND TABLE_CATALOG=DB_NAME()) ` +
        `BEGIN CREATE TABLE [${tableName}] (${body}) END`
      );
    case 'oracle':
      // ORA-00955 = "name is already used by an existing object"
      return (
        `BEGIN EXECUTE IMMEDIATE 'CREATE TABLE ${tableName} (${body})'; ` +
        `EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;`
      );
  }
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial AIAPI schema: users, roles, user_roles, apikeys, settings, migrations',
    stmts(type) {
      const bool = boolCol(type);
      const text = textCol(type);
      return [
        safeCreate(type, 'aiapi_migrations',
          `version INT NOT NULL, applied_at VARCHAR(30) NOT NULL, ` +
          `CONSTRAINT pk_aiapi_migrations PRIMARY KEY (version)`),

        safeCreate(type, 'aiapi_users',
          `id VARCHAR(36) NOT NULL, username VARCHAR(255) NOT NULL, ` +
          `password_hash VARCHAR(512), enabled ${bool} NOT NULL DEFAULT ${type === 'mssql' ? '1' : 'TRUE'}, ` +
          `created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30), ` +
          `CONSTRAINT pk_aiapi_users PRIMARY KEY (id), ` +
          `CONSTRAINT uq_aiapi_users_username UNIQUE (username)`),

        safeCreate(type, 'aiapi_roles',
          `id VARCHAR(36) NOT NULL, name VARCHAR(128) NOT NULL, ` +
          `description ${text}, permissions ${text} NOT NULL, ` +
          `CONSTRAINT pk_aiapi_roles PRIMARY KEY (id), ` +
          `CONSTRAINT uq_aiapi_roles_name UNIQUE (name)`),

        safeCreate(type, 'aiapi_user_roles',
          `user_id VARCHAR(36) NOT NULL, role_name VARCHAR(128) NOT NULL, ` +
          `CONSTRAINT pk_aiapi_user_roles PRIMARY KEY (user_id, role_name), ` +
          `CONSTRAINT fk_aiapi_ur_user FOREIGN KEY (user_id) ` +
          `REFERENCES aiapi_users (id) ON DELETE CASCADE`),

        safeCreate(type, 'aiapi_apikeys',
          `id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, ` +
          `key_hash VARCHAR(64) NOT NULL, label VARCHAR(255), ` +
          `created_at VARCHAR(30) NOT NULL, last_used_at VARCHAR(30), ` +
          `CONSTRAINT pk_aiapi_apikeys PRIMARY KEY (id), ` +
          `CONSTRAINT uq_aiapi_apikeys_hash UNIQUE (key_hash), ` +
          `CONSTRAINT fk_aiapi_ak_user FOREIGN KEY (user_id) ` +
          `REFERENCES aiapi_users (id) ON DELETE CASCADE`),

        safeCreate(type, 'aiapi_settings',
          `key VARCHAR(512) NOT NULL, value ${text} NOT NULL, ` +
          `CONSTRAINT pk_aiapi_settings PRIMARY KEY (key)`),
      ];
    },
  },
];

// ─── DbProvisioner ────────────────────────────────────────────────────────────

export class DbProvisioner {

  // ── 1. Create database ──────────────────────────────────────────────────────

  /**
   * Connect to the DB server using `adminCfg` (pointing at the postgres/master
   * system database) and CREATE the database named `dbName` if it does not
   * already exist.  Supports PostgreSQL and MSSQL; MySQL requires CREATE DATABASE
   * which works identically; Oracle uses PDB creation which is too environment-
   * specific to automate here — manual creation is expected for Oracle.
   */
  static async createDatabase(adminCfg: DbConfig, dbName: string): Promise<ProvisionStep> {
    const conn = await openConn(adminCfg);
    try {
      switch (adminCfg.type) {
        case 'postgresql': {
          const rows = await conn.query(`SELECT 1 FROM pg_database WHERE datname=?`, [dbName]);
          if (rows.length) {
            return { step: 'createDatabase', status: 'skip', detail: `${dbName} already exists` };
          }
          // Can't use ? params for DDL identifiers; sanitize (alphanum + _ + -)
          if (!/^[\w-]+$/.test(dbName)) throw new Error(`Invalid database name: ${dbName}`);
          await conn.execute(`CREATE DATABASE "${dbName}"`);
          globalLogger.info(TAG, `Created PostgreSQL database: ${dbName}`);
          return { step: 'createDatabase', status: 'ok', detail: `${dbName} created` };
        }
        case 'mssql': {
          const rows = await conn.query(`SELECT 1 FROM sys.databases WHERE name=?`, [dbName]);
          if (rows.length) {
            return { step: 'createDatabase', status: 'skip', detail: `${dbName} already exists` };
          }
          if (!/^[\w-]+$/.test(dbName)) throw new Error(`Invalid database name: ${dbName}`);
          await conn.execute(`CREATE DATABASE [${dbName}]`);
          return { step: 'createDatabase', status: 'ok', detail: `${dbName} created` };
        }
        case 'mysql': {
          const rows = await conn.query(`SELECT 1 FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?`, [dbName]);
          if (rows.length) {
            return { step: 'createDatabase', status: 'skip', detail: `${dbName} already exists` };
          }
          if (!/^[\w-]+$/.test(dbName)) throw new Error(`Invalid database name: ${dbName}`);
          await conn.execute(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
          return { step: 'createDatabase', status: 'ok', detail: `${dbName} created` };
        }
        case 'oracle':
          return { step: 'createDatabase', status: 'skip', detail: 'Oracle PDB creation requires manual DBA steps' };
        default:
          return { step: 'createDatabase', status: 'skip', detail: 'Unsupported engine for auto-create' };
      }
    } catch (e: unknown) {
      return { step: 'createDatabase', status: 'error', error: (e as Error).message };
    } finally {
      await conn.close();
    }
  }

  // ── 2. Schema migrations ────────────────────────────────────────────────────

  /**
   * Ensure the target database schema is at the latest migration version.
   * Creates `aiapi_migrations` tracking table first (idempotent).
   * Only applies migrations that haven't been applied yet.
   * Never drops or destructively alters existing data.
   */
  static async ensureSchema(cfg: DbConfig): Promise<ProvisionStep & { applied: number[]; alreadyApplied: number[] }> {
    const conn = await openConn(cfg);
    const applied: number[] = [];
    const alreadyApplied: number[] = [];
    try {
      // Ensure the migration tracking table exists (migration 0, unversioned)
      await conn.execute(safeCreate(cfg.type, 'aiapi_migrations',
        `version INT NOT NULL, applied_at VARCHAR(30) NOT NULL, ` +
        `CONSTRAINT pk_aiapi_migrations PRIMARY KEY (version)`));

      // Load applied versions
      const rows = await conn.query('SELECT version FROM aiapi_migrations ORDER BY version');
      const appliedSet = new Set(rows.map(r => r['version'] as number));

      for (const migration of MIGRATIONS) {
        if (appliedSet.has(migration.version)) {
          alreadyApplied.push(migration.version);
          continue;
        }

        globalLogger.info(TAG, `Applying migration v${migration.version}: ${migration.description}`);
        for (const stmt of migration.stmts(cfg.type)) {
          await conn.execute(stmt, []);
        }
        // Record as applied
        await conn.execute(
          'INSERT INTO aiapi_migrations (version, applied_at) VALUES (?, ?)',
          [migration.version, new Date().toISOString()],
        );
        applied.push(migration.version);
        globalLogger.info(TAG, `Migration v${migration.version} applied`);
      }

      return {
        step: 'migrations',
        status: 'ok',
        detail: applied.length
          ? `Applied: [${applied.join(',')}]; already up-to-date: [${alreadyApplied.join(',')}]`
          : `Schema already at latest version (v${MIGRATIONS[MIGRATIONS.length - 1].version})`,
        applied,
        alreadyApplied,
      };
    } catch (e: unknown) {
      return { step: 'migrations', status: 'error', error: (e as Error).message, applied, alreadyApplied };
    } finally {
      await conn.close();
    }
  }

  // ── 3. Seed initial data ────────────────────────────────────────────────────

  /**
   * Insert default roles and an `admin` user (password: `admin`) if the
   * aiapi_users table is currently empty.  Completely idempotent: if any user
   * exists, seeding is skipped entirely (the assumption being the operator has
   * already set up their own users).
   */
  static async seedInitialData(cfg: DbConfig): Promise<ProvisionStep> {
    const conn = await openConn(cfg);
    try {
      const existingUsers = await conn.query('SELECT 1 FROM aiapi_users');
      if (existingUsers.length > 0) {
        return { step: 'seed', status: 'skip', detail: 'users table not empty — skipping seed' };
      }

      // Seed roles
      const adminPerms = JSON.stringify([
        { helper: '_internal', operation: 'access',         resource: '*' },
        { helper: '_internal', operation: 'settings_change', resource: '*' },
        { helper: '_internal', operation: 'access_logs',    resource: '*' },
        { helper: '*',         operation: '*',               resource: '*' },
      ]);
      const viewerPerms = JSON.stringify([
        { helper: '_internal', operation: 'access', resource: '*' },
      ]);

      const adminRoleId = crypto.randomUUID();
      const viewerRoleId = crypto.randomUUID();
      const adminUserId = crypto.randomUUID();
      const now = new Date().toISOString();

      await conn.execute(
        'INSERT INTO aiapi_roles (id, name, description, permissions) VALUES (?, ?, ?, ?)',
        [adminRoleId, 'admin', 'Full administrative access', adminPerms],
      );
      await conn.execute(
        'INSERT INTO aiapi_roles (id, name, description, permissions) VALUES (?, ?, ?, ?)',
        [viewerRoleId, 'viewer', 'Read-only access', viewerPerms],
      );

      // Hash admin password using PBKDF2 (no bcrypt dep needed at provision time)
      const hash = pbkdf2Hash('admin');
      await conn.execute(
        'INSERT INTO aiapi_users (id, username, password_hash, enabled, created_at) VALUES (?, ?, ?, ?, ?)',
        [adminUserId, 'admin', hash, cfg.type === 'mssql' ? 1 : true, now],
      );
      await conn.execute(
        'INSERT INTO aiapi_user_roles (user_id, role_name) VALUES (?, ?)',
        [adminUserId, 'admin'],
      );

      globalLogger.info(TAG, 'Seeded: roles [admin, viewer] + user [admin]');
      return {
        step: 'seed',
        status: 'ok',
        detail: 'Created roles: admin, viewer; user: admin (password: admin — CHANGE THIS)',
      };
    } catch (e: unknown) {
      return { step: 'seed', status: 'error', error: (e as Error).message };
    } finally {
      await conn.close();
    }
  }

  // ── Convenience: run all steps ──────────────────────────────────────────────

  /**
   * Full provision cycle: optionally create DB → apply migrations → seed.
   * Each step is independent; a failure in one is captured and reported
   * without aborting subsequent steps (so the caller gets a full picture).
   */
  static async provision(opts: ProvisionOptions): Promise<ProvisionResult> {
    const steps: ProvisionStep[] = [];

    // Step 1 — create database (optional)
    if (opts.createDb) {
      if (!opts.adminCfg) {
        steps.push({
          step: 'createDatabase',
          status: 'error',
          error: 'createDb=true but no adminCfg provided',
        });
      } else {
        steps.push(await DbProvisioner.createDatabase(opts.adminCfg, opts.targetCfg.database));
      }
    }

    // Step 2 — schema migrations (always)
    const schemaStep = await DbProvisioner.ensureSchema(opts.targetCfg);
    steps.push(schemaStep);

    // Step 3 — seed (optional, only if migration succeeded)
    if (opts.seed) {
      if (schemaStep.status === 'error') {
        steps.push({ step: 'seed', status: 'skip', detail: 'Skipped because schema migration failed' });
      } else {
        steps.push(await DbProvisioner.seedInitialData(opts.targetCfg));
      }
    }

    const ok = steps.every(s => s.status !== 'error');
    return { ok, steps };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Hash a password using the same PBKDF2 parameters as JsonUserStore.hashFallback,
 * so the hash is verifiable by PasswordAuthProvider out of the box.
 */
function pbkdf2Hash(password: string): string {
  return hashFallback(password);
}

// ─── Canonical current schema version ────────────────────────────────────────
export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
