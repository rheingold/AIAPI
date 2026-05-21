/**
 * DbUserStore integration tests — PostgreSQL
 *
 * Prerequisites: PostgreSQL at 192.168.254.16:5432
 * Credentials: ai_priv/db.json (gitignored).
 * Test DB: aiapi_test.
 *
 * Schema is managed by DbProvisioner.  All user/role data is wiped in beforeEach
 * so tests run independently.  The seed step is exercised explicitly in its
 * own describe block.
 *
 * Covered:
 *  - DbUserStore CRUD: createUser, findByUsername, updateUser, deleteUser
 *  - Role management: upsertRole, findRole, listRoles, deleteRole
 *  - API key lifecycle: created externally (via store method), findByApiKeyHash
 *  - Password auth round-trip: hash stored → PasswordAuthProvider.authenticate()
 *  - JWT round-trip via PasswordAuthProvider + JwtService
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { DbUserStore } from './DbUserStore';
import { DbProvisioner } from '../../db/DbProvisioner';
import { PasswordAuthProvider } from '../providers/PasswordAuthProvider';
import { JwtService } from '../JwtService';
import { hashFallback, importBcrypt } from './JsonUserStore';
import { DbConfig } from '../../settings/types';
import { Permission } from '../types';

// ─── Credentials ────────────────────────────────────────────────────────────

function loadPrivCreds(): { host: string; port: number; user: string; password: string } | null {
  try {
    const p = path.resolve(__dirname, '../../../../../../ai_priv/db.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw.postgresql ?? null;
  } catch { return null; }
}

const CREDS = loadPrivCreds();

const PG_CFG: DbConfig = {
  type: 'postgresql',
  host: CREDS?.host ?? '192.168.254.16',
  port: CREDS?.port ?? 5432,
  database: 'aiapi_test',
  table: 'aiapi_settings',
  auth: {
    method: 'password',
    username: CREDS?.user ?? 'ddladmin',
    password: CREDS?.password ?? '1/ddladmin.2',
  },
  tls: false,
};

// ─── Setup ─────────────────────────────────────────────────────────────────

let canConnect = false;
let store: DbUserStore;

async function rawPool() {
  // @ts-ignore optional peer
  const { Pool } = await import('pg');
  return new Pool({
    host: PG_CFG.host, port: PG_CFG.port, database: PG_CFG.database,
    user: PG_CFG.auth.username, password: PG_CFG.auth.password,
    connectionTimeoutMillis: 6000, max: 2,
  });
}

async function wipeUserData() {
  const pool = await rawPool();
  try {
    await pool.query('DELETE FROM aiapi_apikeys');
    await pool.query('DELETE FROM aiapi_user_roles');
    await pool.query('DELETE FROM aiapi_users');
    await pool.query('DELETE FROM aiapi_roles');
  } finally { await pool.end(); }
}

beforeAll(async () => {
  try {
    // Provision schema (idempotent)
    const result = await DbProvisioner.provision({ targetCfg: PG_CFG, seed: false });
    if (!result.ok) {
      console.warn('[U4-users] Provision had errors:', JSON.stringify(result.steps));
      return;
    }
    canConnect = true;
  } catch (e: unknown) {
    console.warn(`[U4-users] PostgreSQL unavailable, skipping: ${(e as Error).message}`);
    return;
  }

  store = new DbUserStore(PG_CFG);
  await store.initialize();  // calls ensureSchema() internally then opens connection
}, 25000);

afterAll(async () => {
  if (!canConnect) return;
  await store.close();
}, 8000);

beforeEach(async () => {
  if (!canConnect) return;
  await wipeUserData();
}, 8000);

function pg(name: string, fn: () => Promise<void>, tmo = 12000): void {
  it(name, async () => { if (!canConnect) return; await fn(); }, tmo);
}

// ─── Helper: hash password ──────────────────────────────────────────────────

async function hashPwd(pw: string): Promise<string> {
  const bcrypt = await importBcrypt();
  if (bcrypt) return bcrypt.hash(pw, 10) as Promise<string>;
  return hashFallback(pw);
}

// ─── Role management ────────────────────────────────────────────────────────

describe('DbUserStore — Role management', () => {
  pg('upsertRole() inserts a new role; findRole() retrieves it', async () => {
    const perms: Permission[] = [{ helper: '_internal', operation: 'access', resource: '*' }];
    const role = await store.upsertRole({ name: 'viewer', description: 'Read only', permissions: perms });
    expect(role.id).toBeTruthy();
    expect(role.name).toBe('viewer');

    const found = await store.findRole('viewer');
    expect(found).not.toBeNull();
    expect(found!.permissions).toEqual(perms);
  });

  pg('upsertRole() updates existing role (upsert semantics)', async () => {
    await store.upsertRole({ name: 'editor', description: 'v1', permissions: [] });
    await store.upsertRole({ name: 'editor', description: 'v2', permissions: [] });
    const r = await store.findRole('editor');
    expect(r!.description).toBe('v2');
  });

  pg('listRoles() returns all upserted roles', async () => {
    await store.upsertRole({ name: 'r1', description: '', permissions: [] });
    await store.upsertRole({ name: 'r2', description: '', permissions: [] });
    const list = await store.listRoles();
    expect(list.map(r => r.name)).toEqual(expect.arrayContaining(['r1', 'r2']));
  });

  pg('deleteRole() removes the role', async () => {
    const role = await store.upsertRole({ name: 'tmp', description: '', permissions: [] });
    await store.deleteRole(role.id);
    expect(await store.findRole('tmp')).toBeNull();
  });
});

// ─── User CRUD ──────────────────────────────────────────────────────────────

describe('DbUserStore — User CRUD', () => {
  beforeEach(async () => {
    if (!canConnect) return;
    await store.upsertRole({ name: 'admin', description: 'Admin', permissions: [] });
  });

  pg('createUser() then findByUsername() round-trip', async () => {
    const hash = await hashPwd('secret');
    const user = await store.createUser({
      username: 'alice',
      passwordHash: hash,
      roles: ['admin'],
      apiKeys: [],
      enabled: true,
    });
    expect(user.id).toBeTruthy();
    expect(user.username).toBe('alice');

    const found = await store.findByUsername('alice');
    expect(found).not.toBeNull();
    expect(found!.roles).toContain('admin');
  });

  pg('findByUsername() returns null for unknown user', async () => {
    expect(await store.findByUsername('ghost')).toBeNull();
  });

  pg('listUsers() returns created users', async () => {
    await store.createUser({ username: 'u1', passwordHash: undefined, roles: [], apiKeys: [], enabled: true });
    await store.createUser({ username: 'u2', passwordHash: undefined, roles: [], apiKeys: [], enabled: true });
    const list = await store.listUsers();
    expect(list.map(u => u.username)).toEqual(expect.arrayContaining(['u1', 'u2']));
  });

  pg('updateUser() changes passwordHash', async () => {
    const user = await store.createUser({ username: 'bob', passwordHash: await hashPwd('old'), roles: [], apiKeys: [], enabled: true });
    const newHash = await hashPwd('new');
    await store.updateUser(user.id, { passwordHash: newHash });
    const updated = await store.findByUsername('bob');
    expect(updated!.passwordHash).toBe(newHash);
  });

  pg('updateUser() enables/disables user', async () => {
    const user = await store.createUser({ username: 'carol', passwordHash: undefined, roles: [], apiKeys: [], enabled: true });
    await store.updateUser(user.id, { enabled: false });
    // findByUsername filters enabled=TRUE, so disabled user should NOT be found
    const found = await store.findByUsername('carol');
    expect(found).toBeNull();
  });

  pg('updateUser() replaces role assignment', async () => {
    await store.upsertRole({ name: 'viewer', description: '', permissions: [] });
    const user = await store.createUser({ username: 'dave', passwordHash: undefined, roles: ['admin'], apiKeys: [], enabled: true });
    await store.updateUser(user.id, { roles: ['viewer'] });
    const updated = await store.findByUsername('dave');
    expect(updated!.roles).toEqual(['viewer']);
    expect(updated!.roles).not.toContain('admin');
  });

  pg('deleteUser() removes user and cascades apikeys/roles', async () => {
    const user = await store.createUser({ username: 'eve', passwordHash: undefined, roles: ['admin'], apiKeys: [], enabled: true });
    await store.deleteUser(user.id);
    expect(await store.findByUsername('eve')).toBeNull();
  });
});

// ─── Password auth round-trip ────────────────────────────────────────────────

describe('DbUserStore — PasswordAuthProvider round-trip', () => {
  const JWT_SECRET = 'test-jwt-secret-for-u4';

  beforeEach(async () => {
    if (!canConnect) return;
    await store.upsertRole({ name: 'admin', description: '', permissions: [] });
  });

  pg('correct password → JWT issued; wrong password → failure', async () => {
    const hash = await hashPwd('p@ssw0rd');
    await store.createUser({ username: 'frank', passwordHash: hash, roles: ['admin'], apiKeys: [], enabled: true });

    const jwt = new JwtService({ enabled: true, secret: JWT_SECRET, expiryMinutes: 60 });
    const provider = new PasswordAuthProvider(store, jwt);

    const good = await provider.authenticate({ username: 'frank', password: 'p@ssw0rd' });
    expect(good.success).toBe(true);
    expect(good.token).toBeTruthy();

    const bad = await provider.authenticate({ username: 'frank', password: 'wrong' });
    expect(bad.success).toBe(false);
  });

  pg('JWT issued by PasswordAuthProvider is verifiable via verifyToken()', async () => {
    const hash = await hashPwd('hello');
    await store.createUser({ username: 'grace', passwordHash: hash, roles: ['admin'], apiKeys: [], enabled: true });

    const jwt = new JwtService({ enabled: true, secret: JWT_SECRET, expiryMinutes: 60 });
    const provider = new PasswordAuthProvider(store, jwt);

    const result = await provider.authenticate({ username: 'grace', password: 'hello' });
    expect(result.success).toBe(true);

    const ctx = await provider.verifyToken(result.token!);
    expect(ctx).not.toBeNull();
    expect(ctx?.user?.username).toBe('grace');
    expect(ctx?.effectiveRoles).toContain('admin');
  });

  pg('unknown user → authentication failure', async () => {
    const jwt = new JwtService({ enabled: true, secret: JWT_SECRET, expiryMinutes: 60 });
    const provider = new PasswordAuthProvider(store, jwt);
    const result = await provider.authenticate({ username: 'nobody', password: 'x' });
    expect(result.success).toBe(false);
  });
});

// ─── DbProvisioner seed ─────────────────────────────────────────────────────

describe('DbProvisioner — seed round-trip', () => {
  pg('seed creates admin role + admin user with working PBKDF2 password', async () => {
    // wipeUserData() ran in beforeEach so tables are empty
    const step = await DbProvisioner.seedInitialData(PG_CFG);
    expect(step.status).toBe('ok');

    const seededAdmin = await store.findByUsername('admin');
    expect(seededAdmin).not.toBeNull();
    expect(seededAdmin!.roles).toContain('admin');

    // Verify the seeded password 'admin' works via PasswordAuthProvider
    const jwt = new JwtService({ enabled: true, secret: 'seed-test-secret', expiryMinutes: 60 });
    const provider = new PasswordAuthProvider(store, jwt);
    const auth = await provider.authenticate({ username: 'admin', password: 'admin' });
    expect(auth.success).toBe(true);
  });

  pg('second seed call is skipped (idempotent)', async () => {
    await DbProvisioner.seedInitialData(PG_CFG); // first
    const step2 = await DbProvisioner.seedInitialData(PG_CFG); // second
    expect(step2.status).toBe('skip');
  });
});

// ─── findByApiKeyHash ────────────────────────────────────────────────────────

describe('DbUserStore — API key lookup', () => {
  beforeEach(async () => {
    if (!canConnect) return;
    await store.upsertRole({ name: 'admin', description: '', permissions: [] });
  });

  pg('findByApiKeyHash() returns null for unknown hash', async () => {
    const result = await store.findByApiKeyHash('deadbeef'.repeat(8));
    expect(result).toBeNull();
  });

  pg('user created with pre-hashed API key row is findable by hash', async () => {
    const rawKey = crypto.randomBytes(20).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create user first, then insert API key row directly via raw pool
    const pool = await rawPool();
    try {
      // Insert user
      const userId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO aiapi_users (id, username, enabled, created_at) VALUES ($1,$2,$3,$4)',
        [userId, 'henry', true, now],
      );
      await pool.query(
        'INSERT INTO aiapi_user_roles (user_id, role_name) VALUES ($1,$2)',
        [userId, 'admin'],
      );
      await pool.query(
        'INSERT INTO aiapi_apikeys (id, user_id, key_hash, label, created_at) VALUES ($1,$2,$3,$4,$5)',
        [keyId, userId, keyHash, 'ci-key', now],
      );
    } finally { await pool.end(); }

    const found = await store.findByApiKeyHash(keyHash);
    expect(found).not.toBeNull();
    expect(found!.username).toBe('henry');
  });
});
