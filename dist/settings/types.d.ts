/**
 * settings/types.ts
 *
 * Types for the pluggable settings-source subsystem (CONVENTIONS.md §5.2).
 *
 * The server can load/persist its runtime configuration from:
 *  - "json"  — signed local file (config/dashboard-settings.json)
 *  - "db"    — remote RDBMS (MSSQL, Oracle, MySQL, PostgreSQL)
 *
 * Both implement ISettingsAdapter; SettingsManager is the factory.
 */
export type DbType = 'mssql' | 'oracle' | 'mysql' | 'postgresql';
/**
 * How the server authenticates *to* the remote database.
 *
 * | method          | description                                                  |
 * |-----------------|--------------------------------------------------------------|
 * | impersonation   | Windows impersonation (MSSQL + Kerberos, Windows only)      |
 * | integrated      | Windows integrated / SSPI                                    |
 * | certificate     | Client TLS certificate (reuses settings-signing cert if not |
 * |                 | overridden by db.auth.certificatePath)                      |
 * | password        | Username + password stored in config (may be encrypted)     |
 * | constant        | Full raw connection string in config — unencrypted, abusable |
 */
export type DbAuthMethod = 'impersonation' | 'integrated' | 'certificate' | 'password' | 'constant';
export interface DbAuthConfig {
    method: DbAuthMethod;
    /** Used for method = "password" */
    username?: string;
    /** Used for method = "password" (may be encrypted with settings key) */
    password?: string;
    /** Used for method = "constant"; full connection string */
    connectionString?: string;
    /** Used for method = "certificate" */
    certificatePath?: string;
    /** Used for method = "impersonation" */
    domain?: string;
}
export interface DbConfig {
    type: DbType;
    host: string;
    port?: number;
    database: string;
    /** Table name for key-value settings store */
    table: string;
    auth: DbAuthConfig;
    tls: boolean;
    /** Path to DB server CA cert bundle for TLS verification */
    tlsCertPath?: string;
}
/**
 * ISettingsAdapter — read/write server configuration from/to a backend.
 * All methods that write must also persist the change durably (re-sign JSON,
 * commit to DB, etc.).
 */
export interface ISettingsAdapter {
    /**
     * Load the full settings object.
     * Returns a plain JS object (same shape as dashboard-settings.json).
     */
    load(): Promise<Record<string, unknown>>;
    /**
     * Persist the full settings object, replacing the existing one.
     */
    save(settings: Record<string, unknown>): Promise<void>;
    /**
     * Read a single key.  Returns undefined if absent.
     * Dot-notation supported: "auth.jwt.expiryMinutes"
     */
    get<T = unknown>(key: string): Promise<T | undefined>;
    /**
     * Write a single key.  Dot-notation supported.
     * Triggers a full persist after the update.
     */
    set(key: string, value: unknown): Promise<void>;
    /**
     * Optional: called on server startup.
     * Can be used to test DB connectivity or verify JSON signature.
     */
    initialize?(): Promise<void>;
    /**
     * Optional: called on server shutdown.
     * Releases DB connection pools etc.
     */
    close?(): Promise<void>;
}
export interface SettingsSourceConfig {
    /** Which backend to use */
    settingsSource: 'json' | 'db';
    /** Path to signed JSON file (when settingsSource = "json") */
    settingsJsonPath?: string;
    /** DB connection info (when settingsSource = "db") */
    db?: DbConfig;
}
//# sourceMappingURL=types.d.ts.map