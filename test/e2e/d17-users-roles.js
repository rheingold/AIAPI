'use strict';
/**
 * D17 — Users, Roles & Auth Backend  (harness — test/e2e/d17-users-roles.js)
 *
 * Architecture
 * ────────
 *   Static structural assertions in test/e2e/d17/scenarios.xml (ADR-008):
 *     ur0-access-gate  — 3× GET _internal endpoints → structured JSON
 *     ur1-list-users   — GET /api/_internal/users → array with username+id
 *     ur6-list-roles   — GET /api/_internal/roles → array
 *     ur10-get-logs    — GET /api/_internal/logs  → logs key present
 *     d17-static-suite — chain ur0,ur1,ur6,ur10-get
 *
 *   UR2–UR5, UR7–UR9, UR10-DELETE, UR11 remain in JS:
 *     All require runtime-discovered IDs (createdUserId, createdRoleId,
 *     createdApiKeyId) embedded in subsequent DELETE/PUT URL segments.
 *
 * Run:   node test/e2e/d17-users-roles.js
 * Env:   DASH_PORT (default 3458)
 */

const {
  dashRest, ok, assert, skip,
  TEST_TAG, runSuite,
} = require('./_shared');
const { labelFrom }      = require('./_make-suite');
const { ScenarioRunner } = require('./_scenario-runner');

// Stable unique ids for this run
const TEST_USER = `dogfood_d17_${TEST_TAG}`;
const TEST_ROLE = `dogfood_d17_role_${TEST_TAG}`;

// Track created resource IDs for guaranteed cleanup
let createdUserId  = null;
let createdRoleId  = null;
let createdApiKeyId = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function listUsers() {
  const r = await dashRest('GET', '/api/_internal/users').catch(() => null);
  return r?.success === false ? null : (r?.users ?? r?.data ?? (Array.isArray(r) ? r : null));
}

async function listRoles() {
  const r = await dashRest('GET', '/api/_internal/roles').catch(() => null);
  return r?.success === false ? null : (r?.roles ?? r?.data ?? (Array.isArray(r) ? r : null));
}

/** Remove any leftover test users/roles from prior interrupted runs */
async function cleanupLeftovers() {
  const users = await listUsers();
  if (Array.isArray(users)) {
    for (const u of users.filter(u => (u.username || '').startsWith('dogfood_d17_'))) {
      await dashRest('DELETE', `/api/_internal/users/${u.id}`).catch(() => null);
    }
  }
  const roles = await listRoles();
  if (Array.isArray(roles)) {
    for (const r of roles.filter(r => (r.name || '').startsWith('dogfood_d17_'))) {
      await dashRest('DELETE', `/api/_internal/roles/${r.id}`).catch(() => null);
    }
  }
}

// ── Test sections ─────────────────────────────────────────────────────────────

/**
 * UR0: Access gate — _internal endpoints must return either a structured
 *      Forbidden response (when the caller lacks elevated role) OR a successful
 *      JSON response (when auth is open).  A 500/crash or unparseable output
 *      is always an error.
 */
async function testAccessGate() {
  console.log('\n── UR0 · _internal endpoint access gate ──');
  for (const path of ['/api/_internal/users', '/api/_internal/roles', '/api/_internal/logs']) {
    const r = await dashRest('GET', path).catch(e => ({ _e: e.message }));
    // Acceptable: success response OR structured Forbidden — NOT an exception or 500
    const structured = r !== null && typeof r === 'object' && !r?._e;
    assert(`${path} returns structured JSON (not a crash)`, structured,
      r?._e ?? JSON.stringify(r).slice(0, 80));
    if (structured && (r?.error === 'Forbidden' || r?.success === false)) {
      console.log(`   ${path}: access locked (Forbidden — expected in noauth mode)`);
    } else if (structured) {
      console.log(`   ${path}: accessible`);
    }
  }
}

async function testListUsers() {
  console.log('\n── UR1 · GET /api/_internal/users (gate check) ──');
  const r = await dashRest('GET', '/api/_internal/users').catch(e => ({ _e: e.message }));
  if (r?._e) { skip('Users tests', r._e); return false; }
  if (r?.success === false || r?.error === 'Forbidden') {
    skip('Users tests', `endpoint locked: ${r?.error ?? r?.message}`);
    return false;
  }
  ok('GET /api/_internal/users accessible', r);
  const users = r?.users ?? r?.data ?? (Array.isArray(r) ? r : []);
  console.log(`   existing users: ${Array.isArray(users) ? users.length : '?'}`);
  return true;
}

/** UR2: POST /api/_internal/users — create test user */
async function testCreateUser() {
  console.log('\n── UR2 · POST /api/_internal/users (create) ──');
  const r = await dashRest('POST', '/api/_internal/users', {
    username: TEST_USER,
    password: 'D0gfood!17Test',
    roles: [],
    email: `${TEST_TAG}@dogfood.local`,
  }).catch(e => ({ _e: e.message }));
  if (r?._e) { skip('UR2 create', r._e); return; }
  ok('POST /api/_internal/users', r);
  const uid = r?.user?.id ?? r?.id ?? r?.userId;
  assert('Created user has id', !!uid, JSON.stringify(r).slice(0, 80));
  if (uid) {
    createdUserId = uid;
    console.log(`   created user id: ${uid}`);
  }
}

/** UR3: PUT /api/_internal/users/:id — update username + roles */
async function testUpdateUser() {
  console.log('\n── UR3 · PUT /api/_internal/users/:id (update) ──');
  if (!createdUserId) { skip('UR3 update', 'no user created in UR2'); return; }

  const r = await dashRest('PUT', `/api/_internal/users/${createdUserId}`, {
    username: `${TEST_USER}_upd`,
    roles: [],
  }).catch(e => ({ _e: e.message }));
  if (r?._e) { skip('UR3 update', r._e); return; }
  ok('PUT /api/_internal/users/:id', r);
  assert('Update returns success or result', r?.success !== false,
    JSON.stringify(r).slice(0, 80));
  console.log(`   update result: ${JSON.stringify(r).slice(0, 60)}`);
}

/** UR4: POST /api/_internal/users/:id/apikeys — create API key */
async function testCreateApiKey() {
  console.log('\n── UR4 · POST /api/_internal/users/:id/apikeys ──');
  if (!createdUserId) { skip('UR4 apikey create', 'no user created'); return; }

  const r = await dashRest('POST', `/api/_internal/users/${createdUserId}/apikeys`, {
    label: `dogfood_d17_key_${TEST_TAG}`,
  }).catch(e => ({ _e: e.message }));
  if (r?._e) { skip('UR4 apikey', r._e); return; }
  ok('POST apikeys', r);
  const kid = r?.apiKey?.id ?? r?.id ?? r?.keyId;
  assert('Created API key has id', !!kid, JSON.stringify(r).slice(0, 80));
  if (kid) {
    createdApiKeyId = kid;
    console.log(`   api key id: ${kid}`);
  }
  // The raw key is typically returned once; verify it's a string
  const rawKey = r?.apiKey?.key ?? r?.key;
  if (rawKey) {
    assert('API key raw value is a non-empty string', typeof rawKey === 'string' && rawKey.length > 0,
      `got: ${String(rawKey).slice(0, 30)}`);
    console.log(`   key prefix: ${String(rawKey).slice(0, 8)}...`);
  }
}

/** UR5: DELETE /api/_internal/users/:id/apikeys/:keyId — revoke API key */
async function testRevokeApiKey() {
  console.log('\n── UR5 · DELETE /api/_internal/users/:id/apikeys/:keyId ──');
  if (!createdUserId || !createdApiKeyId) {
    skip('UR5 apikey revoke', 'no api key created in UR4'); return;
  }

  const r = await dashRest('DELETE',
    `/api/_internal/users/${createdUserId}/apikeys/${createdApiKeyId}`)
    .catch(e => ({ _e: e.message }));
  if (r?._e) { skip('UR5 revoke', r._e); return; }
  ok('DELETE apikeys/:keyId', r);
  assert('Revoke returns success', r?.success === true || r?.ok === true, JSON.stringify(r).slice(0, 80));
  createdApiKeyId = null;
  console.log('   api key revoked');
}

/** UR6: GET /api/_internal/roles — boolean gate (structural assert in XML ur6-list-roles) */
async function testListRoles() {
  console.log('\n── UR6 · GET /api/_internal/roles (gate check) ──');
  const r = await dashRest('GET', '/api/_internal/roles').catch(e => ({ _e: e.message }));
  if (r?._e) { skip('Roles tests', r._e); return false; }
  if (r?.success === false || r?.error === 'Forbidden') {
    skip('Roles tests', `endpoint locked: ${r?.error ?? r?.message}`);
    return false;
  }
  ok('GET /api/_internal/roles accessible', r);
  const roles = r?.roles ?? r?.data ?? (Array.isArray(r) ? r : []);
  console.log(`   existing roles: ${Array.isArray(roles) ? roles.length : '?'}`);
  return true;
}

/** UR7: POST /api/_internal/roles — create test role */
async function testCreateRole() {
  console.log('\n── UR7 · POST /api/_internal/roles (create) ──');
  const r = await dashRest('POST', '/api/_internal/roles', {
    name: TEST_ROLE,
    description: `Dogfood D17 test role ${TEST_TAG}`,
    permissions: [],
  }).catch(e => ({ _e: e.message }));
  if (r?._e) { skip('UR7 create role', r._e); return; }
  ok('POST /api/_internal/roles', r);
  const rid = r?.role?.id ?? r?.id;
  assert('Created role has id', !!rid, JSON.stringify(r).slice(0, 80));
  if (rid) {
    createdRoleId = rid;
    console.log(`   created role id: ${rid}`);
  }
}

/** UR8: PUT /api/_internal/roles/:id — update description */
async function testUpdateRole() {
  console.log('\n── UR8 · PUT /api/_internal/roles/:id (update) ──');
  if (!createdRoleId) { skip('UR8 update role', 'no role created in UR7'); return; }

  const r = await dashRest('PUT', `/api/_internal/roles/${createdRoleId}`, {
    name: TEST_ROLE,
    description: `Updated D17 ${TEST_TAG}`,
    permissions: ['read'],
  }).catch(e => ({ _e: e.message }));
  if (r?._e) { skip('UR8 update role', r._e); return; }
  ok('PUT /api/_internal/roles/:id', r);
  assert('Update returns success or result', r?.success !== false,
    JSON.stringify(r).slice(0, 80));
  console.log(`   update result: ${JSON.stringify(r).slice(0, 60)}`);
}

/** UR9: Assign test role to test user (PUT user with role) */
async function testAssignRole() {
  console.log('\n── UR9 · Assign test role to test user ──');
  if (!createdUserId || !createdRoleId) {
    skip('UR9 assign role', 'need both user and role from prior steps'); return;
  }

  // Try to get the role name for the assignment
  const rolesR = await dashRest('GET', '/api/_internal/roles').catch(() => null);
  const roleObj = (rolesR?.roles ?? rolesR?.data ?? []).find(r => r.id === createdRoleId);
  const roleName = roleObj?.name ?? TEST_ROLE;

  const r = await dashRest('PUT', `/api/_internal/users/${createdUserId}`, {
    username: `${TEST_USER}_upd`,
    roles: [roleName],
  }).catch(e => ({ _e: e.message }));
  if (r?._e) { skip('UR9', r._e); return; }
  ok('Assign test role to test user', r);
  console.log(`   assigned role "${roleName}" to user`);
}

/** UR10: GET (structural in XML ur10-get-logs) + DELETE /api/_internal/logs */
async function testInternalLogs() {
  console.log('\n── UR10 · /api/_internal/logs DELETE (clear) + verify ──');

  const getR = await dashRest('GET', '/api/_internal/logs').catch(e => ({ _e: e.message }));
  if (getR?._e || getR?.error === 'Forbidden' || getR?.success === false) {
    skip('UR10 logs', getR?._e ?? getR?.error ?? 'endpoint locked'); return;
  }
  ok('GET /api/_internal/logs accessible', getR);
  const logs = getR?.logs ?? getR?.data ?? (Array.isArray(getR) ? getR : []);
  const countBefore = Array.isArray(logs) ? logs.length : 0;
  console.log(`   logs before clear: ${countBefore}`);

  // DELETE (clear)
  const delR = await dashRest('DELETE', '/api/_internal/logs').catch(e => ({ _e: e.message }));
  if (delR?._e) { skip('UR10 delete logs', delR._e); return; }
  if (delR?.error === 'Forbidden') { skip('UR10 delete logs', 'Forbidden'); return; }
  ok('DELETE /api/_internal/logs (clear)', delR);
  assert('Clear returns success', delR?.success === true || delR?.ok === true,
    JSON.stringify(delR).slice(0, 80));

  // Verify cleared
  const afterR = await dashRest('GET', '/api/_internal/logs').catch(() => null);
  const afterLogs = afterR?.logs ?? afterR?.data ?? (Array.isArray(afterR) ? afterR : []);
  const countAfter = Array.isArray(afterLogs) ? afterLogs.length : null;
  if (countAfter !== null) {
    // Allow <=1 because the DELETE /logs request itself may be logged
    assert('Logs cleared (count <= 1)', countAfter <= 1,
      `still ${countAfter} entries`);
    console.log(`   logs after clear: ${countAfter}`);
  }
}

/** UR11: DELETE test user + role (cleanup + verify gone) */
async function testDeleteUserAndRole() {
  console.log('\n── UR11 · DELETE test user + role ──');

  if (createdUserId) {
    const delU = await dashRest('DELETE', `/api/_internal/users/${createdUserId}`)
      .catch(e => ({ _e: e.message }));
    if (!delU?._e) {
      ok('DELETE test user', delU);
      assert('User deleted', delU?.success === true || delU?.ok === true, JSON.stringify(delU).slice(0, 60));
      createdUserId = null;
    } else {
      skip('DELETE test user', delU._e);
    }
  } else {
    skip('DELETE test user', 'no user created');
  }

  if (createdRoleId) {
    const delR = await dashRest('DELETE', `/api/_internal/roles/${createdRoleId}`)
      .catch(e => ({ _e: e.message }));
    if (!delR?._e) {
      ok('DELETE test role', delR);
      assert('Role deleted', delR?.success === true || delR?.ok === true, JSON.stringify(delR).slice(0, 60));
      createdRoleId = null;
    } else {
      skip('DELETE test role', delR._e);
    }
  } else {
    skip('DELETE test role', 'no role created');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const DASH_PORT = parseInt(process.env.DASH_PORT || '3458', 10);
const DASH_URL  = `http://localhost:${DASH_PORT}`;

async function run() {
  return runSuite(labelFrom(__filename), async () => {
    const runner = new ScenarioRunner({ browser: null, dashUrl: DASH_URL });
    await runner.waitReady();

    // Static structural assertions (XML)
    await runner.runOk('d17', 'd17-static-suite', { dashUrl: DASH_URL });

    try {
      await cleanupLeftovers();
      const usersOk = await testListUsers();
      if (usersOk) {
        await testCreateUser();
        await testUpdateUser();
        await testCreateApiKey();
        await testRevokeApiKey();
      }
      const rolesOk = await testListRoles();
      if (rolesOk) {
        await testCreateRole();
        await testUpdateRole();
        await testAssignRole();
      }
      await testInternalLogs();
      await testDeleteUserAndRole();
    } finally {
      // Unconditional cleanup
      if (createdApiKeyId && createdUserId) {
        await dashRest('DELETE', `/api/_internal/users/${createdUserId}/apikeys/${createdApiKeyId}`)
          .catch(() => null);
      }
      if (createdUserId) {
        await dashRest('DELETE', `/api/_internal/users/${createdUserId}`).catch(() => null);
      }
      if (createdRoleId) {
        await dashRest('DELETE', `/api/_internal/roles/${createdRoleId}`).catch(() => null);
      }
    }
  });
}

if (require.main === module) run();
module.exports = { run };



