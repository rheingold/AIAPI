"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbUserStore = void 0;
const crypto = __importStar(require("crypto"));
const DbProvisioner_1 = require("../../db/DbProvisioner");
const Logger_1 = require("../../utils/Logger");
const TAG = 'DbUserStore';
async function openConn(cfg) {
    // Delegate to the same factory in DbSettingsAdapter via a dynamic import so
    // both adapters use a shared pool in practice. If they are initialised from
    // the same singleton SettingsManager this import chain is cheap.
    const { DbSettingsAdapter } = await Promise.resolve().then(() => __importStar(require('../../settings/adapters/DbSettingsAdapter')));
    const dummy = new DbSettingsAdapter(cfg);
    // Access the private static factory through a lightweight wrapper approach.
    // In a production refactor, extract openConnection() to a shared db/connection.ts.
    // For now we reopen independently (connection pools are cheap for 5-user stores).
    return openDriverConn(cfg);
}
async function openDriverConn(cfg) {
    switch (cfg.type) {
        case 'mssql': {
            // @ts-ignore: optional peer dependency
            const mssql = await Promise.resolve().then(() => __importStar(require('mssql'))).then(m => m.default ?? m).catch(() => { throw new Error('mssql not installed'); });
            const auth = cfg.auth;
            const opts = {
                server: cfg.host, port: cfg.port ?? 1433, database: cfg.database,
                options: { encrypt: cfg.tls, trustServerCertificate: !cfg.tls },
            };
            if (auth.method === 'password') {
                opts.user = auth.username;
                opts.password = auth.password;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pool = await new mssql.ConnectionPool(opts).connect();
            return makePool('mssql', pool, null, null, null);
        }
        case 'mysql': {
            // @ts-ignore: optional peer dependency
            const mysql = await Promise.resolve().then(() => __importStar(require('mysql2/promise'))).then(m => m.default ?? m).catch(() => { throw new Error('mysql2 not installed'); });
            const pool = mysql.createPool({
                host: cfg.host, port: cfg.port ?? 3306, database: cfg.database,
                user: cfg.auth.username, password: cfg.auth.password,
                ssl: cfg.tls ? { rejectUnauthorized: true } : undefined,
                connectionLimit: 3,
            });
            return makePool('mysql', null, pool, null, null);
        }
        case 'postgresql': {
            // @ts-ignore: optional peer dependency
            const { Pool } = await Promise.resolve().then(() => __importStar(require('pg'))).then(m => m.default ?? m).catch(() => { throw new Error('pg not installed'); });
            const pool = new Pool({
                host: cfg.host, port: cfg.port ?? 5432, database: cfg.database,
                user: cfg.auth.username, password: cfg.auth.password,
                ssl: cfg.tls ? { rejectUnauthorized: true } : undefined, max: 3,
            });
            return makePool('postgresql', null, null, pool, null);
        }
        case 'oracle': {
            // @ts-ignore: optional peer dependency
            const oracledb = await Promise.resolve().then(() => __importStar(require('oracledb'))).then(m => m.default ?? m).catch(() => { throw new Error('oracledb not installed'); });
            oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
            const conn = await oracledb.getConnection({
                connectString: `${cfg.host}:${cfg.port ?? 1521}/${cfg.database}`,
                user: cfg.auth.username, password: cfg.auth.password,
            });
            return makePool('oracle', null, null, null, conn);
        }
        default: throw new Error(`Unknown db.type: ${cfg.type}`);
    }
}
// Minimal pool wrapper — each engine has a slightly different execute API
function makePool(type, mssql, mysql, pg, oracle) {
    async function query(sql, params = []) {
        if (type === 'mssql') {
            const req = mssql.request();
            params.forEach((p, i) => req.input(`p${i}`, p));
            const r = await req.query(sql.replace(/\?/g, (_m, i) => `@p${i}`));
            return r.recordset;
        }
        if (type === 'mysql') {
            const [rows] = await mysql.execute(sql, params);
            return rows;
        }
        if (type === 'postgresql') {
            // pg uses $1 $2 … style params; transform ? placeholders
            let pidx = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++pidx}`);
            const r = await pg.query(pgSql, params);
            return r.rows;
        }
        // oracle
        const r = await oracle
            .execute(sql, params, { outFormat: 4002 }); // OUT_FORMAT_OBJECT = 4002
        return (r.rows ?? []);
    }
    async function execute(sql, params = []) {
        await query(sql, params);
        if (type === 'oracle')
            await oracle.commit();
    }
    async function close() {
        if (type === 'oracle')
            await oracle.close();
        else if (type === 'postgresql')
            await pg.end();
        else if (type === 'mysql')
            await mysql.end();
        else
            await mssql.close();
    }
    return { query, execute, close };
}
class DbUserStore {
    constructor(cfg) {
        this.conn = null;
        this.cfg = cfg;
    }
    async initialize() {
        // Apply pending schema migrations (idempotent — safe to call on every startup)
        const migResult = await DbProvisioner_1.DbProvisioner.ensureSchema(this.cfg);
        if (migResult.status === 'error') {
            throw new Error(`DbUserStore schema migration failed: ${migResult.error}`);
        }
        Logger_1.globalLogger.info(TAG, `Schema: ${migResult.detail}`);
        this.conn = await openDriverConn(this.cfg);
        Logger_1.globalLogger.info(TAG, `Connected to ${this.cfg.type} for user store`);
    }
    async close() {
        await this.conn?.close();
        this.conn = null;
    }
    // ─── IUserStore ──────────────────────────────────────────────────────────
    async findByUsername(username) {
        this.ensure();
        const rows = await this.conn.query('SELECT * FROM aiapi_users WHERE username=? AND enabled=TRUE', [username]);
        if (!rows.length)
            return null;
        return this.hydrateUser(rows[0]);
    }
    async findByApiKeyHash(keyHash) {
        this.ensure();
        const rows = await this.conn.query('SELECT u.* FROM aiapi_users u JOIN aiapi_apikeys k ON k.user_id=u.id WHERE k.key_hash=? AND u.enabled=TRUE', [keyHash]);
        if (!rows.length)
            return null;
        return this.hydrateUser(rows[0]);
    }
    async listUsers() {
        this.ensure();
        const rows = await this.conn.query('SELECT * FROM aiapi_users ORDER BY created_at');
        return Promise.all(rows.map(r => this.hydrateUser(r)));
    }
    async createUser(draft) {
        this.ensure();
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await this.conn.execute('INSERT INTO aiapi_users (id, username, password_hash, enabled, created_at) VALUES (?,?,?,?,?)', [id, draft.username, draft.passwordHash ?? null, draft.enabled, now]);
        for (const role of draft.roles) {
            await this.conn.execute('INSERT INTO aiapi_user_roles (user_id, role_name) VALUES (?,?)', [id, role]);
        }
        return { ...draft, id, createdAt: now };
    }
    async updateUser(id, patch) {
        this.ensure();
        const now = new Date().toISOString();
        if (patch.passwordHash !== undefined) {
            await this.conn.execute('UPDATE aiapi_users SET password_hash=?, updated_at=? WHERE id=?', [patch.passwordHash, now, id]);
        }
        if (patch.enabled !== undefined) {
            await this.conn.execute('UPDATE aiapi_users SET enabled=?, updated_at=? WHERE id=?', [patch.enabled, now, id]);
        }
        if (patch.roles) {
            await this.conn.execute('DELETE FROM aiapi_user_roles WHERE user_id=?', [id]);
            for (const role of patch.roles) {
                await this.conn.execute('INSERT INTO aiapi_user_roles (user_id, role_name) VALUES (?,?)', [id, role]);
            }
        }
        if (patch.apiKeys) {
            await this.conn.execute('DELETE FROM aiapi_apikeys WHERE user_id=?', [id]);
            for (const k of patch.apiKeys) {
                await this.conn.execute('INSERT INTO aiapi_apikeys (id, user_id, key_hash, label, created_at) VALUES (?,?,?,?,?)', [k.id, id, k.keyHash, k.label ?? '', k.createdAt]);
            }
        }
        const rows = await this.conn.query('SELECT * FROM aiapi_users WHERE id=?', [id]);
        if (!rows.length)
            throw new Error(`User '${id}' not found`);
        return this.hydrateUser(rows[0]);
    }
    async deleteUser(id) {
        this.ensure();
        await this.conn.execute('DELETE FROM aiapi_users WHERE id=?', [id]);
    }
    async listRoles() {
        this.ensure();
        const rows = await this.conn.query('SELECT * FROM aiapi_roles ORDER BY name');
        return rows.map(r => ({
            id: r['id'],
            name: r['name'],
            description: r['description'],
            permissions: JSON.parse(r['permissions']),
        }));
    }
    async findRole(name) {
        this.ensure();
        const rows = await this.conn.query('SELECT * FROM aiapi_roles WHERE name=?', [name]);
        if (!rows.length)
            return null;
        return {
            id: rows[0]['id'],
            name: rows[0]['name'],
            description: rows[0]['description'],
            permissions: JSON.parse(rows[0]['permissions']),
        };
    }
    async upsertRole(draft) {
        this.ensure();
        const existing = await this.findRole(draft.name);
        const permsJson = JSON.stringify(draft.permissions);
        if (existing) {
            await this.conn.execute('UPDATE aiapi_roles SET description=?, permissions=? WHERE name=?', [draft.description ?? null, permsJson, draft.name]);
            return { ...existing, ...draft };
        }
        const id = crypto.randomUUID();
        await this.conn.execute('INSERT INTO aiapi_roles (id, name, description, permissions) VALUES (?,?,?,?)', [id, draft.name, draft.description ?? null, permsJson]);
        return { ...draft, id };
    }
    async deleteRole(id) {
        this.ensure();
        await this.conn.execute('DELETE FROM aiapi_roles WHERE id=?', [id]);
    }
    // ─── Private ─────────────────────────────────────────────────────────────
    ensure() {
        if (!this.conn)
            throw new Error('DbUserStore not initialized');
    }
    async hydrateUser(row) {
        const id = row['id'];
        const roleRows = await this.conn.query('SELECT role_name FROM aiapi_user_roles WHERE user_id=?', [id]);
        const apiKeyRows = await this.conn.query('SELECT id, key_hash, label, created_at, last_used_at FROM aiapi_apikeys WHERE user_id=?', [id]);
        return {
            id,
            username: row['username'],
            passwordHash: row['password_hash'] ?? undefined,
            roles: roleRows.map(r => r['role_name']),
            apiKeys: apiKeyRows.map(r => ({
                id: r['id'],
                keyHash: r['key_hash'],
                label: r['label'] ?? '',
                createdAt: r['created_at'],
                lastUsedAt: r['last_used_at'] ?? undefined,
            })),
            enabled: Boolean(row['enabled']),
            createdAt: row['created_at'],
            updatedAt: row['updated_at'] ?? undefined,
        };
    }
}
exports.DbUserStore = DbUserStore;
//# sourceMappingURL=DbUserStore.js.map