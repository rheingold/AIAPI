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
import { IUserStore, User, Role } from '../types';
import { DbConfig } from '../../settings/types';
export declare class DbUserStore implements IUserStore {
    private readonly cfg;
    private conn;
    constructor(cfg: DbConfig);
    initialize(): Promise<void>;
    close(): Promise<void>;
    findByUsername(username: string): Promise<User | null>;
    findByApiKeyHash(keyHash: string): Promise<User | null>;
    listUsers(): Promise<User[]>;
    createUser(draft: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
    updateUser(id: string, patch: Partial<Omit<User, 'id'>>): Promise<User>;
    deleteUser(id: string): Promise<void>;
    listRoles(): Promise<Role[]>;
    findRole(name: string): Promise<Role | null>;
    upsertRole(draft: Omit<Role, 'id'>): Promise<Role>;
    deleteRole(id: string): Promise<void>;
    private ensure;
    private hydrateUser;
}
//# sourceMappingURL=DbUserStore.d.ts.map