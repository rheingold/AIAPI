/**
 * settings/adapters/DbSettingsAdapter.ts
 *
 * ISettingsAdapter backed by a remote relational database.
 * Supported engines: MSSQL, Oracle, MySQL, PostgreSQL.
 *
 * Schema assumption (all engines):
 *   CREATE TABLE <table> (
 *     key   VARCHAR(512)  NOT NULL PRIMARY KEY,
 *     value TEXT          NOT NULL   -- JSON-encoded value
 *   );
 *
 * Auth methods supported (CONVENTIONS.md §5.2 db.auth.method):
 *   - password      → standard username/password
 *   - constant      → raw connection string passthrough
 *   - integrated    → Windows integrated / environment-provided credentials
 *   - impersonation → Windows impersonation (MSSQL + Kerberos)
 *   - certificate   → TLS client certificate
 *
 * The adapter uses lazy-loaded driver packages so the server starts correctly
 * even when optional DB drivers are not installed (graceful degradation).
 * Install the driver for the engine you use:
 *   npm install mssql          # MSSQL
 *   npm install oracledb       # Oracle
 *   npm install mysql2         # MySQL
 *   npm install pg             # PostgreSQL
 */

import { ISettingsAdapter, DbConfig } from '../types';
import { globalLogger } from '../../utils/Logger';

const TAG = 'DbSettingsAdapter';

// ─── Generic DB connection abstraction ───────────────────────────────────────

interface DbConnection {
  query(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  close(): Promise<void>;
}

// ─── Driver factory ───────────────────────────────────────────────────────────

async function openConnection(cfg: DbConfig): Promise<DbConnection> {
  switch (cfg.type) {
    case 'mssql':      return openMssql(cfg);
    case 'oracle':     return openOracle(cfg);
    case 'mysql':      return openMysql(cfg);
    case 'postgresql': return openPostgresql(cfg);
    default:
      throw new Error(`Unknown db.type: ${(cfg as DbConfig).type}`);
  }
}

// ── MSSQL ─────────────────────────────────────────────────────────────────────
async function openMssql(cfg: DbConfig): Promise<DbConnection> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // @ts-ignore: optional peer dependency
  const mssql = await import('mssql').then(m => m.default ?? m).catch(() => {
    throw new Error('mssql package not installed. Run: npm install mssql');
  });

  const auth = cfg.auth;
  let pool: InstanceType<typeof mssql.ConnectionPool>;

  if (auth.method === 'constant') {
    pool = await new mssql.ConnectionPool(auth.connectionString!).connect();
  } else {
    const base: Record<string, unknown> = {
      server: cfg.host,
      port: cfg.port ?? 1433,
      database: cfg.database,
      options: { encrypt: cfg.tls, trustServerCertificate: !cfg.tls },
    };
    if (auth.method === 'password') {
      base.user = auth.username;
      base.password = auth.password;
    } else if (auth.method === 'integrated' || auth.method === 'impersonation') {
      base.options = { ...(base.options as object), trustedConnection: true, domain: auth.domain };
    } else if (auth.method === 'certificate') {
      base.options = {
        ...(base.options as object),
        cryptoCredentialsDetails: { pfx: auth.certificatePath },
      };
    }
    pool = await new mssql.ConnectionPool(base as Parameters<typeof mssql.ConnectionPool>[0]).connect();
  }

  return {
    async query(sql, params = []) {
      const req = pool.request();
      params.forEach((p, i) => req.input(`p${i}`, p));
      const transformed = sql.replace(/\?/g, (_m, i) => `@p${i}`);
      const res = await req.query(transformed);
      return res.recordset as Array<Record<string, unknown>>;
    },
    async execute(sql, params = []) {
      const req = pool.request();
      params.forEach((p, i) => req.input(`p${i}`, p));
      const transformed = sql.replace(/\?/g, (_m, i) => `@p${i}`);
      await req.query(transformed);
    },
    async close() { await pool.close(); },
  };
}

// ── Oracle ────────────────────────────────────────────────────────────────────
async function openOracle(cfg: DbConfig): Promise<DbConnection> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // @ts-ignore: optional peer dependency
  const oracledb = await import('oracledb').then(m => m.default ?? m).catch(() => {
    throw new Error('oracledb package not installed. Run: npm install oracledb');
  });
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

  const auth = cfg.auth;
  const connCfg: Record<string, unknown> = {
    connectString: `${cfg.host}:${cfg.port ?? 1521}/${cfg.database}`,
  };
  if (auth.method === 'password') {
    connCfg.user = auth.username;
    connCfg.password = auth.password;
  }

  const conn = await oracledb.getConnection(connCfg as Parameters<typeof oracledb.getConnection>[0]);
  return {
    async query(sql, params = []) {
      const res = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return (res.rows ?? []) as Array<Record<string, unknown>>;
    },
    async execute(sql, params = []) { await conn.execute(sql, params); await conn.commit(); },
    async close() { await conn.close(); },
  };
}

// ── MySQL ─────────────────────────────────────────────────────────────────────
async function openMysql(cfg: DbConfig): Promise<DbConnection> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // @ts-ignore: optional peer dependency
  const mysql = await import('mysql2/promise').then(m => m.default ?? m).catch(() => {
    throw new Error('mysql2 package not installed. Run: npm install mysql2');
  });

  const auth = cfg.auth;
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port ?? 3306,
    database: cfg.database,
    user: auth.username,
    password: auth.password,
    ssl: cfg.tls ? { rejectUnauthorized: true } : undefined,
    waitForConnections: true,
    connectionLimit: 5,
  });

  return {
    async query(sql, params = []) {
      const [rows] = await pool.execute(sql, params);
      return rows as Array<Record<string, unknown>>;
    },
    async execute(sql, params = []) { await pool.execute(sql, params); },
    async close() { await pool.end(); },
  };
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────
async function openPostgresql(cfg: DbConfig): Promise<DbConnection> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // @ts-ignore: optional peer dependency
  const { Pool } = await import('pg').then(m => m.default ?? m).catch(() => {
    throw new Error('pg package not installed. Run: npm install pg');
  });

  const auth = cfg.auth;
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port ?? 5432,
    database: cfg.database,
    user: auth.username,
    password: auth.password,
    ssl: cfg.tls ? { rejectUnauthorized: true, ca: cfg.tlsCertPath } : undefined,
    max: 5,
  });

  return {
    async query(sql, params = []) {
      const res = await pool.query(sql, params);
      return res.rows as Array<Record<string, unknown>>;
    },
    async execute(sql, params = []) { await pool.query(sql, params); },
    async close() { await pool.end(); },
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class DbSettingsAdapter implements ISettingsAdapter {
  private readonly cfg: DbConfig;
  private conn: DbConnection | null = null;
  /** In-memory cache of all settings; avoids a round-trip on every get() */
  private cache: Record<string, unknown> | null = null;

  constructor(cfg: DbConfig) {
    this.cfg = cfg;
  }

  async initialize(): Promise<void> {
    this.conn = await openConnection(this.cfg);
    globalLogger.info(TAG, `Connected to ${this.cfg.type} at ${this.cfg.host}`);
    await this.load();
  }

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
  }

  /** Load all key-value rows into cache and reconstruct nested settings object */
  async load(): Promise<Record<string, unknown>> {
    this.ensureConnected();
    const rows = await this.conn!.query(
      `SELECT key, value FROM ${this.cfg.table}`,
    );
    const obj: Record<string, unknown> = {};
    for (const row of rows) {
      const key = row['key'] as string;
      let val: unknown;
      try { val = JSON.parse(row['value'] as string); } catch { val = row['value']; }
      setNestedKey(obj, key, val);
    }
    this.cache = obj;
    return { ...obj };
  }

  async save(settings: Record<string, unknown>): Promise<void> {
    this.ensureConnected();
    // Flatten the nested object to key-value pairs and upsert
    const flat = flattenObject(settings);
    for (const [key, value] of Object.entries(flat)) {
      const encoded = JSON.stringify(value);
      await this.upsertRow(key, encoded);
    }
    this.cache = { ...settings };
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (!this.cache) await this.load();
    return getNestedKey(this.cache!, key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.ensureConnected();
    await this.upsertRow(key, JSON.stringify(value));
    if (!this.cache) this.cache = {};
    setNestedKey(this.cache, key, value);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.conn) throw new Error('DbSettingsAdapter: not initialized — call initialize() first');
  }

  private async upsertRow(key: string, value: string): Promise<void> {
    const t = this.cfg.table;
    switch (this.cfg.type) {
      case 'mssql':
        await this.conn!.execute(
          `MERGE ${t} AS target USING (VALUES (?,?)) AS src(k,v) ON target.key=src.k ` +
          `WHEN MATCHED THEN UPDATE SET value=src.v ` +
          `WHEN NOT MATCHED THEN INSERT (key,value) VALUES (src.k,src.v);`,
          [key, value],
        );
        break;
      case 'mysql':
        await this.conn!.execute(
          `INSERT INTO ${t} (key, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)`,
          [key, value],
        );
        break;
      case 'postgresql':
        await this.conn!.execute(
          `INSERT INTO ${t} (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
          [key, value],
        );
        break;
      case 'oracle':
        await this.conn!.execute(
          `MERGE INTO ${t} t USING dual ON (t.key=:1) ` +
          `WHEN MATCHED THEN UPDATE SET t.value=:2 ` +
          `WHEN NOT MATCHED THEN INSERT(key,value) VALUES(:3,:4)`,
          [key, value, key, value],
        );
        break;
    }
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function getNestedKey(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, obj);
}

function setNestedKey(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.');
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
  result: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const dotKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flattenObject(v as Record<string, unknown>, dotKey, result);
    } else {
      result[dotKey] = v;
    }
  }
  return result;
}
