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
export declare class DbSettingsAdapter implements ISettingsAdapter {
    private readonly cfg;
    private conn;
    /** In-memory cache of all settings; avoids a round-trip on every get() */
    private cache;
    constructor(cfg: DbConfig);
    initialize(): Promise<void>;
    close(): Promise<void>;
    /** Load all key-value rows into cache and reconstruct nested settings object */
    load(): Promise<Record<string, unknown>>;
    save(settings: Record<string, unknown>): Promise<void>;
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    private ensureConnected;
    private upsertRow;
}
//# sourceMappingURL=DbSettingsAdapter.d.ts.map