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
import { DbConfig } from '../settings/types';
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
export declare class DbProvisioner {
    /**
     * Connect to the DB server using `adminCfg` (pointing at the postgres/master
     * system database) and CREATE the database named `dbName` if it does not
     * already exist.  Supports PostgreSQL and MSSQL; MySQL requires CREATE DATABASE
     * which works identically; Oracle uses PDB creation which is too environment-
     * specific to automate here — manual creation is expected for Oracle.
     */
    static createDatabase(adminCfg: DbConfig, dbName: string): Promise<ProvisionStep>;
    /**
     * Ensure the target database schema is at the latest migration version.
     * Creates `aiapi_migrations` tracking table first (idempotent).
     * Only applies migrations that haven't been applied yet.
     * Never drops or destructively alters existing data.
     */
    static ensureSchema(cfg: DbConfig): Promise<ProvisionStep & {
        applied: number[];
        alreadyApplied: number[];
    }>;
    /**
     * Insert default roles and an `admin` user (password: `admin`) if the
     * aiapi_users table is currently empty.  Completely idempotent: if any user
     * exists, seeding is skipped entirely (the assumption being the operator has
     * already set up their own users).
     */
    static seedInitialData(cfg: DbConfig): Promise<ProvisionStep>;
    /**
     * Full provision cycle: optionally create DB → apply migrations → seed.
     * Each step is independent; a failure in one is captured and reported
     * without aborting subsequent steps (so the caller gets a full picture).
     */
    static provision(opts: ProvisionOptions): Promise<ProvisionResult>;
}
export declare const CURRENT_SCHEMA_VERSION: number;
//# sourceMappingURL=DbProvisioner.d.ts.map