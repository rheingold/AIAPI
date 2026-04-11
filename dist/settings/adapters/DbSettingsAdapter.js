"use strict";
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
exports.DbSettingsAdapter = void 0;
const Logger_1 = require("../../utils/Logger");
const TAG = 'DbSettingsAdapter';
// ─── Driver factory ───────────────────────────────────────────────────────────
async function openConnection(cfg) {
    switch (cfg.type) {
        case 'mssql': return openMssql(cfg);
        case 'oracle': return openOracle(cfg);
        case 'mysql': return openMysql(cfg);
        case 'postgresql': return openPostgresql(cfg);
        default:
            throw new Error(`Unknown db.type: ${cfg.type}`);
    }
}
// ── MSSQL ─────────────────────────────────────────────────────────────────────
async function openMssql(cfg) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // @ts-ignore: optional peer dependency
    const mssql = await Promise.resolve().then(() => __importStar(require('mssql'))).then(m => m.default ?? m).catch(() => {
        throw new Error('mssql package not installed. Run: npm install mssql');
    });
    const auth = cfg.auth;
    let pool;
    if (auth.method === 'constant') {
        pool = await new mssql.ConnectionPool(auth.connectionString).connect();
    }
    else {
        const base = {
            server: cfg.host,
            port: cfg.port ?? 1433,
            database: cfg.database,
            options: { encrypt: cfg.tls, trustServerCertificate: !cfg.tls },
        };
        if (auth.method === 'password') {
            base.user = auth.username;
            base.password = auth.password;
        }
        else if (auth.method === 'integrated' || auth.method === 'impersonation') {
            base.options = { ...base.options, trustedConnection: true, domain: auth.domain };
        }
        else if (auth.method === 'certificate') {
            base.options = {
                ...base.options,
                cryptoCredentialsDetails: { pfx: auth.certificatePath },
            };
        }
        pool = await new mssql.ConnectionPool(base).connect();
    }
    return {
        async query(sql, params = []) {
            const req = pool.request();
            params.forEach((p, i) => req.input(`p${i}`, p));
            const transformed = sql.replace(/\?/g, (_m, i) => `@p${i}`);
            const res = await req.query(transformed);
            return res.recordset;
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
async function openOracle(cfg) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // @ts-ignore: optional peer dependency
    const oracledb = await Promise.resolve().then(() => __importStar(require('oracledb'))).then(m => m.default ?? m).catch(() => {
        throw new Error('oracledb package not installed. Run: npm install oracledb');
    });
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    const auth = cfg.auth;
    const connCfg = {
        connectString: `${cfg.host}:${cfg.port ?? 1521}/${cfg.database}`,
    };
    if (auth.method === 'password') {
        connCfg.user = auth.username;
        connCfg.password = auth.password;
    }
    const conn = await oracledb.getConnection(connCfg);
    return {
        async query(sql, params = []) {
            const res = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return (res.rows ?? []);
        },
        async execute(sql, params = []) { await conn.execute(sql, params); await conn.commit(); },
        async close() { await conn.close(); },
    };
}
// ── MySQL ─────────────────────────────────────────────────────────────────────
async function openMysql(cfg) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // @ts-ignore: optional peer dependency
    const mysql = await Promise.resolve().then(() => __importStar(require('mysql2/promise'))).then(m => m.default ?? m).catch(() => {
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
            return rows;
        },
        async execute(sql, params = []) { await pool.execute(sql, params); },
        async close() { await pool.end(); },
    };
}
// ── PostgreSQL ────────────────────────────────────────────────────────────────
async function openPostgresql(cfg) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // @ts-ignore: optional peer dependency
    const { Pool } = await Promise.resolve().then(() => __importStar(require('pg'))).then(m => m.default ?? m).catch(() => {
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
            return res.rows;
        },
        async execute(sql, params = []) { await pool.query(sql, params); },
        async close() { await pool.end(); },
    };
}
// ─── Adapter ──────────────────────────────────────────────────────────────────
class DbSettingsAdapter {
    constructor(cfg) {
        this.conn = null;
        /** In-memory cache of all settings; avoids a round-trip on every get() */
        this.cache = null;
        this.cfg = cfg;
    }
    async initialize() {
        this.conn = await openConnection(this.cfg);
        Logger_1.globalLogger.info(TAG, `Connected to ${this.cfg.type} at ${this.cfg.host}`);
        await this.load();
    }
    async close() {
        if (this.conn) {
            await this.conn.close();
            this.conn = null;
        }
    }
    /** Load all key-value rows into cache and reconstruct nested settings object */
    async load() {
        this.ensureConnected();
        const rows = await this.conn.query(`SELECT key, value FROM ${this.cfg.table}`);
        const obj = {};
        for (const row of rows) {
            const key = row['key'];
            let val;
            try {
                val = JSON.parse(row['value']);
            }
            catch {
                val = row['value'];
            }
            setNestedKey(obj, key, val);
        }
        this.cache = obj;
        return { ...obj };
    }
    async save(settings) {
        this.ensureConnected();
        // Flatten the nested object to key-value pairs and upsert
        const flat = flattenObject(settings);
        for (const [key, value] of Object.entries(flat)) {
            const encoded = JSON.stringify(value);
            await this.upsertRow(key, encoded);
        }
        this.cache = { ...settings };
    }
    async get(key) {
        if (!this.cache)
            await this.load();
        return getNestedKey(this.cache, key);
    }
    async set(key, value) {
        this.ensureConnected();
        await this.upsertRow(key, JSON.stringify(value));
        if (!this.cache)
            this.cache = {};
        setNestedKey(this.cache, key, value);
    }
    // ── Private helpers ──────────────────────────────────────────────────────
    ensureConnected() {
        if (!this.conn)
            throw new Error('DbSettingsAdapter: not initialized — call initialize() first');
    }
    async upsertRow(key, value) {
        const t = this.cfg.table;
        switch (this.cfg.type) {
            case 'mssql':
                await this.conn.execute(`MERGE ${t} AS target USING (VALUES (?,?)) AS src(k,v) ON target.key=src.k ` +
                    `WHEN MATCHED THEN UPDATE SET value=src.v ` +
                    `WHEN NOT MATCHED THEN INSERT (key,value) VALUES (src.k,src.v);`, [key, value]);
                break;
            case 'mysql':
                await this.conn.execute(`INSERT INTO ${t} (key, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)`, [key, value]);
                break;
            case 'postgresql':
                await this.conn.execute(`INSERT INTO ${t} (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [key, value]);
                break;
            case 'oracle':
                await this.conn.execute(`MERGE INTO ${t} t USING dual ON (t.key=:1) ` +
                    `WHEN MATCHED THEN UPDATE SET t.value=:2 ` +
                    `WHEN NOT MATCHED THEN INSERT(key,value) VALUES(:3,:4)`, [key, value, key, value]);
                break;
        }
    }
}
exports.DbSettingsAdapter = DbSettingsAdapter;
// ─── Utility ──────────────────────────────────────────────────────────────────
function getNestedKey(obj, dotPath) {
    return dotPath.split('.').reduce((acc, part) => {
        if (acc && typeof acc === 'object')
            return acc[part];
        return undefined;
    }, obj);
}
function setNestedKey(obj, dotPath, value) {
    const parts = dotPath.split('.');
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!cursor[part] || typeof cursor[part] !== 'object')
            cursor[part] = {};
        cursor = cursor[part];
    }
    cursor[parts[parts.length - 1]] = value;
}
function flattenObject(obj, prefix = '', result = {}) {
    for (const [k, v] of Object.entries(obj)) {
        const dotKey = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            flattenObject(v, dotKey, result);
        }
        else {
            result[dotKey] = v;
        }
    }
    return result;
}
//# sourceMappingURL=DbSettingsAdapter.js.map