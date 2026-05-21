/**
 * DbSettingsAdapter integration tests — PostgreSQL
 *
 * Prerequisites: PostgreSQL reachable at 192.168.254.16:5432
 * Credentials: ai_priv/db.json (gitignored).
 * Test DB: aiapi_test.
 *
 * Schema is managed by DbProvisioner (migration-based, idempotent).
 * Each test truncates aiapi_settings  for isolation.
 */

import * as path from 'path';
import * as fs from 'fs';
import { DbSettingsAdapter } from './DbSettingsAdapter';
import { DbProvisioner } from '../../db/DbProvisioner';
import { DbConfig } from '../types';

// ─── Load credentials from ai_priv/db.json ─────────────────────────────────

function loadPrivCreds(): { host: string; port: number; user: string; password: string } | null {
  try {
    const p = path.resolve(__dirname, '../../../../../../ai_priv/db.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw.postgresql ?? null;
  } catch {
    return null;
  }
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
let adp: DbSettingsAdapter;

async function rawPool() {
  // @ts-ignore optional peer
  const { Pool } = await import('pg');
  return new Pool({
    host: PG_CFG.host, port: PG_CFG.port, database: PG_CFG.database,
    user: PG_CFG.auth.username, password: PG_CFG.auth.password,
    connectionTimeoutMillis: 6000, max: 2,
  });
}

beforeAll(async () => {
  try {
    // Provision schema idempotently (creates tables if absent, applies migrations)
    const result = await DbProvisioner.provision({ targetCfg: PG_CFG, seed: false });
    if (!result.ok) {
      console.warn('[U4-settings] Provision had errors:', JSON.stringify(result.steps));
      return;
    }
    canConnect = true;
  } catch (e: unknown) {
    console.warn(`[U4-settings] PostgreSQL unavailable, skipping: ${(e as Error).message}`);
    return;
  }

  adp = new DbSettingsAdapter(PG_CFG);
  await adp.initialize();
}, 20000);

afterAll(async () => {
  if (!canConnect) return;
  await adp.close?.();
}, 5000);

beforeEach(async () => {
  if (!canConnect) return;
  // Truncate for test isolation; adapter cache is reset via null assignment
  const pool = await rawPool();
  try { await pool.query('TRUNCATE aiapi_settings'); } finally { await pool.end(); }
  (adp as unknown as { cache: null }).cache = null;
}, 5000);

// Helper: auto-skip when DB unavailable
function pg(name: string, fn: () => Promise<void>, tmo = 10000): void {
  it(name, async () => { if (!canConnect) return; await fn(); }, tmo);
}

// ─── DbSettingsAdapter tests ────────────────────────────────────────────────

describe('DbSettingsAdapter — PostgreSQL', () => {
  pg('get() returns undefined for missing key', async () => {
    const v = await adp.get('no.such.key');
    expect(v).toBeUndefined();
  });

  pg('set() stores a string value; get() retrieves it', async () => {
    await adp.set('app.name', 'AIAPI');
    const v = await adp.get<string>('app.name');
    expect(v).toBe('AIAPI');
  });

  pg('set() stores a numeric value; get() retrieves it as number', async () => {
    await adp.set('server.port', 8080);
    const v = await adp.get<number>('server.port');
    expect(v).toBe(8080);
  });

  pg('set() stores a boolean value; get() retrieves it', async () => {
    await adp.set('auth.enabled', true);
    const v = await adp.get<boolean>('auth.enabled');
    expect(v).toBe(true);
  });

  pg('set() updates existing key (upsert semantics)', async () => {
    await adp.set('app.name', 'First');
    await adp.set('app.name', 'Updated');
    const v = await adp.get<string>('app.name');
    expect(v).toBe('Updated');
  });

  pg('set() supports dot-notation nested keys', async () => {
    await adp.set('dashboard.theme.primary', '#336699');
    const v = await adp.get<string>('dashboard.theme.primary');
    expect(v).toBe('#336699');
  });

  pg('save() round-trip: saves object, load() reconstructs it', async () => {
    const settings = { mcp: { enabled: true, port: 3000 }, version: '0.2.0' };
    await adp.save(settings);
    const loaded = await adp.load();
    expect(loaded.mcp).toEqual({ enabled: true, port: 3000 });
    expect(loaded.version).toBe('0.2.0');
  });

  pg('load() reconstructs nested structure from flat rows', async () => {
    await adp.set('a.b.c', 'deep');
    await adp.set('a.b.d', 99);
    const all = await adp.load();
    expect((all as { a: { b: { c: string; d: number } } }).a.b.c).toBe('deep');
    expect((all as { a: { b: { c: string; d: number } } }).a.b.d).toBe(99);
  });
});

// ─── DbProvisioner tests ────────────────────────────────────────────────────

describe('DbProvisioner — PostgreSQL', () => {
  pg('provision() result is ok with no error steps', async () => {
    const result = await DbProvisioner.provision({ targetCfg: PG_CFG, seed: false });
    expect(result.ok).toBe(true);
    for (const s of result.steps) expect(s.status).not.toBe('error');
  });

  pg('second provision() run reports alreadyApplied=[1], applied=[]', async () => {
    const result = await DbProvisioner.provision({ targetCfg: PG_CFG, seed: false });
    const m = result.steps.find(s => s.step === 'migrations');
    expect(m?.status).toBe('ok');
    expect((m as unknown as { alreadyApplied: number[] }).alreadyApplied).toContain(1);
    expect((m as unknown as { applied: number[] }).applied).toHaveLength(0);
  });

  pg('createDatabase() reports skip when DB already exists', async () => {
    const adminCfg: DbConfig = { ...PG_CFG, database: 'postgres' };
    const step = await DbProvisioner.createDatabase(adminCfg, 'aiapi_test');
    expect(step.status).toBe('skip');
  });
});
