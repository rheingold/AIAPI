'use strict';
/**
 * D19 — Users, Roles & Auth Backend — DB backend e2e
 *
 * This is the complement of D17 (which only exercises the JSON store) and the
 * complement of the Jest integration suite (which tests DbUserStore directly but
 * not through the REST API layer).
 *
 * What this test covers:
 *   1. Reads live PostgreSQL credentials from ai_priv/db.json
 *      → SKIP ALL if the file is not present (CI without DB)
 *   2. Provisions the test DB schema + seed via POST /api/_internal/db/provision
 *   3. Switches auth.users.storeSource to "db" via POST /api/auth/config
 *      (keeps auth.mode = "none" so _internal endpoints stay open)
 *   4. Full CRUD cycle through the REST API:
 *        UR1  GET  /api/_internal/users          list
 *        UR2  POST /api/_internal/users          create test user
 *        UR3  POST /api/_internal/roles          create test role
 *        UR4  PUT  /api/_internal/users/:id      assign role + update
 *        UR5  POST /api/_internal/users/:id/apikeys  create API key
 *        UR6  DELETE /api/_internal/users/:id/apikeys/:kid  revoke API key
 *        UR7  POST /api/auth/login               login with mode=password (if mode switched)
 *        UR8  PUT  /api/_internal/users/:id      disable user (enabled=false)
 *        UR9  DELETE /api/_internal/users/:id    delete test user
 *        UR10 DELETE /api/_internal/roles/:id    delete test role
 *   5. Restores the original auth config (always, in finally block)
 *
 * Run:
 *   node test/e2e/d19-users-roles-db.js
 *
 * Requires:
 *   - Server running (MCP + dashboard)
 *   - ai_priv/db.json with { postgresql: { host, port, user, password } }
 *   - aiapi_test database reachable from the server process
 */

const fs   = require('fs');
const path = require('path');
const {
  dashRest, ok, assert, skip, sleep,
  TEST_TAG, runSuite,
} = require('./_shared');
const { labelFrom }      = require('./_make-suite');
const { ScenarioRunner } = require('./_scenario-runner');

// ── Credential loading ────────────────────────────────────────────────────────

const DB_CREDS_PATH = path.resolve(__dirname, '../../ai_priv/db.json');

function loadDbCreds() {
  if (!fs.existsSync(DB_CREDS_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(DB_CREDS_PATH, 'utf-8'));
    return raw.postgresql ?? null;
  } catch {
    return null;
  }
}

// ── Test state ────────────────────────────────────────────────────────────────

const TEST_USER = `d19_${TEST_TAG}`;
const TEST_ROLE = `d19_role_${TEST_TAG}`;

let originalAuthCfg = null;
let createdUserId   = null;
let createdRoleId   = null;
let createdKeyId    = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDbCfg(creds, database = 'aiapi_test') {
  return {
    type:     'postgresql',
    host:     creds.host,
    port:     creds.port ?? 5432,
    database,
    table:    'aiapi_users',
    auth: {
      method:   'password',
      username: creds.user,
      password: creds.password,
    },
    tls: false,
  };
}

// ── Test sections ─────────────────────────────────────────────────────────────

/** DB0: Provision schema on the test database */
async function testProvision(dbCfg) {
  console.log('\n── DB0 · Provision DB schema ──');

  const r = await dashRest('POST', '/api/_internal/db/provision', {
    targetDb:  dbCfg,
    createDb:  false,   // aiapi_test already exists
    seed:      true,    // ensure default roles + admin user
  }).catch(e => ({ _error: e.message }));

  assert('POST /api/_internal/db/provision not blocked (no 403)',
    r?.error !== 'Forbidden',
    'AuthMiddleware mode=none must attach synthetic admin context');
  assert('POST /api/_internal/db/provision returns { ok, steps[] }',
    typeof r?.ok === 'boolean' && Array.isArray(r?.steps),
    `got: ${JSON.stringify(r).slice(0, 120)}`);
  if (r?.steps) {
    for (const s of r.steps) {
      console.log(`   ${s.status === 'ok' ? '✅' : s.status === 'skipped' ? '⏭️' : '❌'} ${s.step}: ${s.status}${s.error ? ' — ' + s.error : ''}`);
    }
  }
  return r?.ok === true || (Array.isArray(r?.steps) && r.steps.every(s => s.status !== 'error'));
}

/** DB1: Switch storeSource to "db" (keep mode=none) */
async function switchToDbBackend(dbCfg) {
  console.log('\n── DB1 · Switch user store to DB backend ──');

  const cfg = {
    mode:  originalAuthCfg.mode ?? 'none',   // preserve existing mode
    users: {
      storeSource: 'db',
      jsonPath:    './config/users.json',
      db:          dbCfg,
    },
  };
  const r = await dashRest('POST', '/api/auth/config', cfg).catch(e => ({ _error: e.message }));
  assert('POST /api/auth/config (switch to db backend) succeeds',
    r?.success === true, `got: ${JSON.stringify(r).slice(0, 100)}`);
  // Give the server time to reinitialise DbUserStore (includes ensureSchema)
  await sleep(1500);
  return r?.success === true;
}

/** UR1: GET /api/_internal/users */
async function testListUsers() {
  console.log('\n── UR1 · GET /api/_internal/users (DB) ──');
  const r = await dashRest('GET', '/api/_internal/users').catch(e => ({ _error: e.message }));
  if (r?._error || r?.error === 'Forbidden') {
    assert('GET /api/_internal/users reachable', false, r?._error ?? r?.error);
    return false;
  }
  const users = Array.isArray(r) ? r : (r?.users ?? r?.data ?? []);
  assert('GET /api/_internal/users returns array', Array.isArray(users),
    `got: ${JSON.stringify(r).slice(0, 80)}`);
  console.log(`   users in DB: ${users.length}`);
  return true;
}

/** UR2: POST /api/_internal/users – create test user */
async function testCreateUser() {
  console.log('\n── UR2 · POST /api/_internal/users (DB) ──');
  const r = await dashRest('POST', '/api/_internal/users', {
    username: TEST_USER,
    password: 'D0gfoodDB!19',
    roles:    [],
    enabled:  true,
  }).catch(e => ({ _error: e.message }));
  if (r?._error) { assert('POST /api/_internal/users', false, r._error); return; }
  ok('POST /api/_internal/users (create in DB)', r);
  const uid = r?.id ?? r?.user?.id ?? r?.userId;
  assert('Created user has id', !!uid, JSON.stringify(r).slice(0, 80));
  if (uid) { createdUserId = uid; console.log(`   user id: ${uid}`); }
}

/** UR3: POST /api/_internal/roles – create test role */
async function testCreateRole() {
  console.log('\n── UR3 · POST /api/_internal/roles (DB) ──');
  const r = await dashRest('POST', '/api/_internal/roles', {
    name:        TEST_ROLE,
    description: `D19 dogfood ${TEST_TAG}`,
    permissions: [],
  }).catch(e => ({ _error: e.message }));
  if (r?._error) { assert('POST /api/_internal/roles', false, r._error); return; }
  ok('POST /api/_internal/roles (create in DB)', r);
  const rid = r?.id ?? r?.role?.id;
  assert('Created role has id', !!rid, JSON.stringify(r).slice(0, 80));
  if (rid) { createdRoleId = rid; console.log(`   role id: ${rid}`); }
}

/** UR4: PUT /api/_internal/users/:id – assign role */
async function testAssignRole() {
  console.log('\n── UR4 · PUT /api/_internal/users/:id (assign role, DB) ──');
  if (!createdUserId || !createdRoleId) { skip('UR4', 'need UR2 + UR3'); return; }
  const r = await dashRest('PUT', `/api/_internal/users/${createdUserId}`, {
    roles: [TEST_ROLE],
  }).catch(e => ({ _error: e.message }));
  if (r?._error) { assert('PUT assign role', false, r._error); return; }
  ok('PUT /api/_internal/users/:id (assign role)', r);
  const roles = r?.roles ?? r?.user?.roles ?? [];
  assert('User now has test role', Array.isArray(roles) && roles.includes(TEST_ROLE),
    `roles: ${JSON.stringify(roles)}`);
}

/** UR5: POST /api/_internal/users/:id/apikeys */
async function testCreateApiKey() {
  console.log('\n── UR5 · POST /api/_internal/users/:id/apikeys (DB) ──');
  if (!createdUserId) { skip('UR5', 'need UR2'); return; }
  const r = await dashRest('POST', `/api/_internal/users/${createdUserId}/apikeys`, {
    label: `d19key_${TEST_TAG}`,
  }).catch(e => ({ _error: e.message }));
  if (r?._error) { assert('POST apikeys', false, r._error); return; }
  ok('POST /api/_internal/users/:id/apikeys', r);
  const kid  = r?.id ?? r?.apiKey?.id;
  const rKey = r?.rawKey ?? r?.key ?? r?.apiKey?.key;
  assert('Created API key has id',     !!kid,  JSON.stringify(r).slice(0, 80));
  assert('rawKey returned once',       typeof rKey === 'string' && rKey.length > 0,
    `rKey: ${String(rKey).slice(0, 20)}`);
  if (kid) { createdKeyId = kid; console.log(`   key id: ${kid}, prefix: ${String(rKey).slice(0, 8)}...`); }
}

/** UR6: DELETE /api/_internal/users/:id/apikeys/:kid */
async function testRevokeApiKey() {
  console.log('\n── UR6 · DELETE /api/_internal/users/:id/apikeys/:kid (DB) ──');
  if (!createdUserId || !createdKeyId) { skip('UR6', 'need UR5'); return; }
  const r = await dashRest('DELETE',
    `/api/_internal/users/${createdUserId}/apikeys/${createdKeyId}`)
    .catch(e => ({ _error: e.message }));
  if (r?._error) { assert('DELETE apikey', false, r._error); return; }
  ok('DELETE /api/_internal/users/:id/apikeys/:kid', r);
  assert('Revoke returns success', r?.ok === true || r?.success === true, JSON.stringify(r).slice(0, 60));
  createdKeyId = null;
}

/** UR7: Verify DB-stored user is retrievable by username via GET /api/_internal/users */
async function testLogin() {
  console.log('\n── UR7 · Verify DB user retrievable by username ──');
  if (!createdUserId) { skip('UR7', 'need UR2'); return; }

  // Mode stays as 'none' throughout D19 to avoid locking ourselves out of
  // _internal endpoints (mode=password would require Bearer token for restore).
  // Login is exercised in the D3 test suite which explicitly manages auth state.
  const r = await dashRest('GET', '/api/_internal/users').catch(e => ({ _error: e.message }));
  const users = Array.isArray(r) ? r : (r?.users ?? r?.data ?? []);
  assert('GET /api/_internal/users returns array (DB round-trip)',
    Array.isArray(users), `got: ${JSON.stringify(r).slice(0, 80)}`);
  const found = users.find(u => u.id === createdUserId || u.username === TEST_USER);
  assert(`DB user '${TEST_USER}' persisted and retrievable`, !!found,
    `ids: ${users.map(u => u.username).join(', ')}`);
}

/** UR8: PUT – disable user */
async function testDisableUser() {
  console.log('\n── UR8 · PUT /api/_internal/users/:id (disable, DB) ──');
  if (!createdUserId) { skip('UR8', 'need UR2'); return; }
  const r = await dashRest('PUT', `/api/_internal/users/${createdUserId}`, {
    enabled: false,
  }).catch(e => ({ _error: e.message }));
  if (r?._error) { assert('PUT disable user', false, r._error); return; }
  ok('PUT disable user', r);
  const enabled = r?.enabled ?? r?.user?.enabled;
  if (enabled !== undefined) {
    assert('User disabled (enabled=false)', enabled === false, `enabled: ${enabled}`);
  }
}

/** UR9 + UR10: DELETE user + role */
async function testDeleteUserAndRole() {
  console.log('\n── UR9/UR10 · DELETE user + role (DB) ──');

  if (createdUserId) {
    const r = await dashRest('DELETE', `/api/_internal/users/${createdUserId}`)
      .catch(e => ({ _error: e.message }));
    if (r?._error) { assert('DELETE user', false, r._error); }
    else {
      ok('DELETE /api/_internal/users/:id', r);
      assert('Delete returns success', r?.ok === true || r?.success === true, JSON.stringify(r).slice(0, 60));
      createdUserId = null;
    }
  } else {
    skip('UR9 DELETE user', 'none created');
  }

  if (createdRoleId) {
    const r = await dashRest('DELETE', `/api/_internal/roles/${createdRoleId}`)
      .catch(e => ({ _error: e.message }));
    if (r?._error) { assert('DELETE role', false, r._error); }
    else {
      ok('DELETE /api/_internal/roles/:id', r);
      assert('Delete returns success', r?.ok === true || r?.success === true, JSON.stringify(r).slice(0, 60));
      createdRoleId = null;
    }
  } else {
    skip('UR10 DELETE role', 'none created');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const DASH_PORT = parseInt(process.env.DASH_PORT || '3458', 10);
  const DASH_URL  = `http://localhost:${DASH_PORT}`;

  return runSuite(labelFrom(__filename), async () => {
    // Static preflight — always runs, no DB required (ADR-008)
    const runner = new ScenarioRunner({ browser: null, dashUrl: DASH_URL });
    await runner.waitReady();
    await runner.runOk('d19', 'd19-preflight', { dashUrl: DASH_URL });

    const creds = loadDbCreds();
    if (!creds) {
      console.log('\n  ⊘  ai_priv/db.json not found — DB tests skipped');
      skip('DB backend tests', 'ai_priv/db.json not found (DB not configured)');
      return;
    }
    console.log(`  DB host: ${creds.host}:${creds.port ?? 5432}, user: ${creds.user}`);
    const dbCfg = buildDbCfg(creds);
    try {
      // Save original config for restore
      originalAuthCfg = await dashRest('GET', '/api/auth/config').catch(() => ({}));
      console.log(`  Original auth mode: ${originalAuthCfg?.mode ?? '?'}, storeSource: ${originalAuthCfg?.users?.storeSource ?? '?'}`);
      // Provision DB schema
      const provOk = await testProvision(dbCfg);
      if (!provOk) {
        console.log('  ⊘  Provision failed — cannot continue with DB backend tests');
        throw new Error('Provision failed');
      }
      // Switch to DB backend
      const switchOk = await switchToDbBackend(dbCfg);
      if (!switchOk) {
        console.log('  ⊘  Failed to switch to DB backend — skipping CRUD tests');
        throw new Error('Switch to DB backend failed');
      }
      // CRUD cycle
      await testListUsers();
      await testCreateUser();
      await testCreateRole();
      await testAssignRole();
      await testCreateApiKey();
      await testRevokeApiKey();
      await testLogin();
      await testDisableUser();
      await testDeleteUserAndRole();
    } finally {
      // Unconditional cleanup of any leaked resources
      if (createdKeyId && createdUserId) {
        await dashRest('DELETE', `/api/_internal/users/${createdUserId}/apikeys/${createdKeyId}`)
          .catch(() => null);
      }
      if (createdUserId) {
        await dashRest('DELETE', `/api/_internal/users/${createdUserId}`).catch(() => null);
      }
      if (createdRoleId) {
        await dashRest('DELETE', `/api/_internal/roles/${createdRoleId}`).catch(() => null);
      }
      // Restore original auth config (always)
      if (originalAuthCfg) {
        const restoreR = await dashRest('POST', '/api/auth/config', {
          mode:  originalAuthCfg.mode ?? 'none',
          users: originalAuthCfg.users ?? { storeSource: 'json', jsonPath: './config/users.json' },
        }).catch(e => ({ _error: e.message }));
        if (restoreR?.success === true) {
          await sleep(600);
          console.log('  ✓  Auth config restored');
        } else {
          console.warn(`  ⚠  Auth config restore may have FAILED: ${JSON.stringify(restoreR).slice(0, 120)}`);
          console.warn('  ⚠  Manually reset config/dashboard-settings.json auth.mode to "none"');
        }
      }
    }
  });
}

if (require.main === module) run();
module.exports = { run };



