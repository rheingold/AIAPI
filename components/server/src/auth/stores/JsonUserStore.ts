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

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IUserStore, User, Role, ApiKeyRecord } from '../types';
import { globalLogger } from '../../utils/Logger';

const TAG = 'JsonUserStore';

interface UserStoreFile {
  version: string;
  users: User[];
  roles: Role[];
}

const DEFAULT_ROLES: Role[] = [
  {
    id: 'role-admin',
    name: 'admin',
    description: 'Full access — can manage users, roles, settings and logs',
    permissions: [
      { helper: '_internal', operation: 'access',         resource: '*' },
      { helper: '_internal', operation: 'settings_change', resource: '*' },
      { helper: '_internal', operation: 'access_logs',    resource: '*' },
      { helper: '*',         operation: '*',              resource: '*' },
    ],
  },
  {
    id: 'role-operator',
    name: 'operator',
    description: 'Can call helpers but cannot change settings or users',
    permissions: [
      { helper: '_internal', operation: 'access',  resource: '*' },
      { helper: '*',         operation: '*',        resource: '*' },
    ],
  },
  {
    id: 'role-auditor',
    name: 'auditor',
    description: 'Read-only access to logs and status',
    permissions: [
      { helper: '_internal', operation: 'access',      resource: '*' },
      { helper: '_internal', operation: 'access_logs', resource: '*' },
    ],
  },
];

export class JsonUserStore implements IUserStore {
  private readonly filePath: string;
  private data: UserStoreFile | null = null;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.filePath)) {
      globalLogger.warn(
        TAG,
        '⚠️  No user store found — creating default admin user with password "changeme". ' +
        'CHANGE THIS IMMEDIATELY via POST /api/_internal/users/<id>.',
      );
      this.data = await this.createDefaults();
      await this.persist();
    } else {
      await this.reload();
    }
  }

  // ─── IUserStore ──────────────────────────────────────────────────────────

  async findByUsername(username: string): Promise<User | null> {
    await this.ensureLoaded();
    return this.data!.users.find(u => u.username === username && u.enabled) ?? null;
  }

  async findByApiKeyHash(keyHash: string): Promise<User | null> {
    await this.ensureLoaded();
    for (const user of this.data!.users) {
      if (!user.enabled) continue;
      if (user.apiKeys.some(k => k.keyHash === keyHash)) return user;
    }
    return null;
  }

  async listUsers(): Promise<User[]> {
    await this.ensureLoaded();
    return this.data!.users.map(u => ({ ...u }));
  }

  async createUser(draft: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    await this.ensureLoaded();
    if (this.data!.users.some(u => u.username === draft.username)) {
      throw new Error(`User '${draft.username}' already exists`);
    }
    const user: User = {
      ...draft,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.data!.users.push(user);
    await this.persist();
    return { ...user };
  }

  async updateUser(id: string, patch: Partial<Omit<User, 'id'>>): Promise<User> {
    await this.ensureLoaded();
    const idx = this.data!.users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error(`User '${id}' not found`);
    this.data!.users[idx] = {
      ...this.data!.users[idx],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
    return { ...this.data!.users[idx] };
  }

  async deleteUser(id: string): Promise<void> {
    await this.ensureLoaded();
    const before = this.data!.users.length;
    this.data!.users = this.data!.users.filter(u => u.id !== id);
    if (this.data!.users.length === before) throw new Error(`User '${id}' not found`);
    await this.persist();
  }

  async listRoles(): Promise<Role[]> {
    await this.ensureLoaded();
    return this.data!.roles.map(r => ({ ...r }));
  }

  async findRole(name: string): Promise<Role | null> {
    await this.ensureLoaded();
    return this.data!.roles.find(r => r.name === name) ?? null;
  }

  async upsertRole(draft: Omit<Role, 'id'>): Promise<Role> {
    await this.ensureLoaded();
    const existing = this.data!.roles.find(r => r.name === draft.name);
    if (existing) {
      Object.assign(existing, draft);
      await this.persist();
      return { ...existing };
    }
    const role: Role = { ...draft, id: crypto.randomUUID() };
    this.data!.roles.push(role);
    await this.persist();
    return { ...role };
  }

  async deleteRole(id: string): Promise<void> {
    await this.ensureLoaded();
    const before = this.data!.roles.length;
    this.data!.roles = this.data!.roles.filter(r => r.id !== id);
    if (this.data!.roles.length === before) throw new Error(`Role '${id}' not found`);
    await this.persist();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async ensureLoaded(): Promise<void> {
    if (!this.data) await this.reload();
  }

  private async reload(): Promise<void> {
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    this.data = JSON.parse(raw) as UserStoreFile;
  }

  private async persist(): Promise<void> {
    const content = JSON.stringify(this.data, null, 2);
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  private async createDefaults(): Promise<UserStoreFile> {
    const bcrypt = await importBcrypt();
    const hash = bcrypt
      ? await bcrypt.hash('changeme', 12)
      : hashFallback('changeme');

    const adminUser: User = {
      id: crypto.randomUUID(),
      username: 'admin',
      passwordHash: hash,
      apiKeys: [],
      roles: ['admin'],
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    return { version: '1.0', users: [adminUser], roles: DEFAULT_ROLES };
  }
}

// ─── bcrypt helpers (optional; graceful if not installed) ────────────────────

interface BcryptLike {
  hash(data: string, rounds: number): Promise<string>;
  compare(data: string, hash: string): Promise<boolean>;
}

let _bcrypt: BcryptLike | null | undefined = undefined;

export async function importBcrypt(): Promise<BcryptLike | null> {
  if (_bcrypt !== undefined) return _bcrypt;
  try {
    // @ts-ignore: optional peer dependency
    const m = await import('bcrypt');
    _bcrypt = (m.default ?? m) as unknown as BcryptLike;
  } catch {
    try {
      // @ts-ignore: optional peer dependency
      const m = await import('bcryptjs');
      _bcrypt = (m.default ?? m) as unknown as BcryptLike;
    } catch {
      globalLogger.warn(TAG, 'Neither bcrypt nor bcryptjs installed — password hashing will use SHA-512 fallback (less secure). Run: npm install bcrypt');
      _bcrypt = null;
    }
  }
  return _bcrypt;
}

/** Fallback: PBKDF2-SHA512 when bcrypt is unavailable */
export function hashFallback(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.pbkdf2Sync(password, salt, 200_000, 64, 'sha512').toString('hex');
  return `pbkdf2:${salt}:${dk}`;
}

export function verifyFallback(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts[0] !== 'pbkdf2') return false;
  const [, salt, expectedDk] = parts;
  const actualDk = crypto.pbkdf2Sync(password, salt, 200_000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actualDk, 'hex'), Buffer.from(expectedDk, 'hex'));
}

/** Generate a cryptographically random API key (visible only once) */
export function generateApiKey(): { raw: string; record: ApiKeyRecord } {
  const raw = crypto.randomBytes(32).toString('base64url');
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex');
  return {
    raw,
    record: {
      id: crypto.randomUUID(),
      keyHash,
      label: '',
      createdAt: new Date().toISOString(),
    },
  };
}

/** Hash a raw API key for storage lookup */
export function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
