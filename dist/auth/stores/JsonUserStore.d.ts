/**
 * auth/stores/JsonUserStore.ts
 *
 * IUserStore backed by a signed local JSON file (config/users.json).
 *
 * File schema:
 * {
 *   "version": "1.0",
 *   "users": [ User, ... ],
 *   "roles": [ Role, ... ]
 * }
 *
 * The file is written atomically (tmp → rename).
 * Signature verification / re-signing integrates with the existing
 * ConfigSigner in src/security/ConfigSigner.ts when available.
 *
 * On a fresh install, if the file is absent, a default "admin" user
 * (password "changeme") and default roles are created automatically.
 * The server logs a prominent warning until the default password is changed.
 */
import { IUserStore, User, Role, ApiKeyRecord } from '../types';
export declare class JsonUserStore implements IUserStore {
    private readonly filePath;
    private data;
    constructor(filePath: string);
    initialize(): Promise<void>;
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
    private ensureLoaded;
    private reload;
    private persist;
    private createDefaults;
}
interface BcryptLike {
    hash(data: string, rounds: number): Promise<string>;
    compare(data: string, hash: string): Promise<boolean>;
}
export declare function importBcrypt(): Promise<BcryptLike | null>;
/** Fallback: PBKDF2-SHA512 when bcrypt is unavailable */
export declare function hashFallback(password: string): string;
export declare function verifyFallback(password: string, stored: string): boolean;
/** Generate a cryptographically random API key (visible only once) */
export declare function generateApiKey(): {
    raw: string;
    record: ApiKeyRecord;
};
/** Hash a raw API key for storage lookup */
export declare function hashApiKey(raw: string): string;
export {};
//# sourceMappingURL=JsonUserStore.d.ts.map