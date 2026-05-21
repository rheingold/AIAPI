'use strict';
/**
 * _pgadmin-verify.js
 * Full pgAdmin UI verification via BrowserWin MCP.
 *
 * Assumes:
 *   - Brave is open and loaded on /browser/ (already logged in)
 *     OR navigate step is enabled below.
 *   - PostgreSQL server "aiapi-pg" is registered OR will be registered here.
 *
 * Correct API paths (confirmed live):
 *   GET  /browser/server_group/obj/                        → [{id, name}]
 *   POST /browser/server/obj/<sgid>/                       → {node:{_id,connected}}
 *   GET  /browser/database/nodes/<sgid>/<sid>/             → [{_id, label, connected}]
 *   GET  /browser/schema/nodes/<sgid>/<sid>/<dbid>/        → [{_id, label}]
 *   GET  /browser/table/nodes/<sgid>/<sid>/<dbid>/<sch>/   → [{_id, label}]
 *
 * NOT: /children/, NOT: /nodes/<sgid>/ alone (410 if no servers registered).
 * XHR must be synchronous (EXEC has no awaitPromise).
 * CSRF token: pgAdmin.csrf_token global.
 */
const { mcpCall } = require('../../test/e2e/_shared');
const B = 'brave.exe';

// PostgreSQL credentials (see ai_priv/db.json)
const PG = { host: '192.168.254.16', port: 5432, user: 'ddladmin', password: '1/ddladmin.2' };

async function exec(js) {
  const r = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: js });
  if (!r?.success) throw new Error('EXEC failed: ' + r?.result);
  return r.result;
}

function strip(s) { return typeof s === 'string' ? s.replace(/^"|"$/g, '') : s; }

function xhr(method, path, body, csrf) {
  const bodyPart = body
    ? `;x.setRequestHeader('Content-Type','application/json');x.send(${JSON.stringify(JSON.stringify(body))})`
    : `;x.send()`;
  return `(function(){var c=${csrf ? `'${csrf}'` : 'pgAdmin.csrf_token'};` +
    `var x=new XMLHttpRequest();x.open('${method}','${path}',false);` +
    `x.setRequestHeader('X-pgA-CSRFToken',c);x.setRequestHeader('Accept','application/json')` +
    `${bodyPart};return x.status+'|'+x.responseText})()`;
}

function parse(raw, label) {
  const [status, body] = strip(raw).split('|');
  if (status !== '200') throw new Error(`${label} → HTTP ${status}: ${body.slice(0, 200)}`);
  try { return JSON.parse(body); } catch { throw new Error(`${label} parse error: ${body.slice(0, 200)}`); }
}

(async () => {
  console.log('── pgAdmin table verification ──────────────────────');

  // 1. Read CSRF token
  const csrf = strip(await exec('pgAdmin.csrf_token'));
  console.log('CSRF:', csrf.slice(0, 12) + '…');

  // 2. Server groups → sgid
  const sgRaw = await exec(xhr('GET', '/browser/server_group/obj/', null, csrf));
  const groups = parse(sgRaw, 'server_group/obj');
  const sg = groups.find(g => g.name === 'Servers') || groups[0];
  const sgid = sg.id;
  console.log(`Server group: ${sg.name} (sgid=${sgid})`);

  // 3. Register / connect server → sid
  const regBody = {
    name: 'aiapi-pg', host: PG.host, port: PG.port, db: 'aiapi_test',
    username: PG.user, password: PG.password, role: '', comment: 'AIAPI test server',
    connect_now: true, gid: sgid
  };
  let sid;
  try {
    const regRaw = await exec(xhr('POST', `/browser/server/obj/${sgid}/`, regBody, csrf));
    const reg = parse(regRaw, 'register-server');
    // Response: {node:{_id, connected}} or {_id, connected} directly
    sid = (reg.node || reg)._id;
    const connected = (reg.node || reg).connected;
    console.log(`Server registered: sid=${sid}, connected=${connected}`);
  } catch (e) {
    // May already exist — try to get existing server list via server_group
    console.log('Register error (likely already exists):', e.message);
    console.log('Using known sid=3 (aiapi-pg)');
    sid = 3;
  }

  // 4. Databases → dbid
  const dbRaw = await exec(xhr('GET', `/browser/database/nodes/${sgid}/${sid}/`, null, csrf));
  const dbList = (d => (d.data || d))(parse(dbRaw, 'database/nodes'));
  const testDb = dbList.find(d => d.label === 'aiapi_test');
  if (!testDb) {
    console.log('Available DBs:', dbList.map(d => d.label).join(', '));
    throw new Error('aiapi_test database not found');
  }
  const dbid = testDb._id;
  console.log(`Database: aiapi_test (dbid=${dbid})`);

  // 5. Schemas → schid
  const schRaw = await exec(xhr('GET', `/browser/schema/nodes/${sgid}/${sid}/${dbid}/`, null, csrf));
  const schList = (d => (d.data || d))(parse(schRaw, 'schema/nodes'));
  const pub = schList.find(s => s.label === 'public');
  if (!pub) throw new Error('public schema not found');
  const schid = pub._id;
  console.log(`Schema: public (schid=${schid})`);

  // 6. Tables → verify
  const tblRaw = await exec(xhr('GET', `/browser/table/nodes/${sgid}/${sid}/${dbid}/${schid}/`, null, csrf));
  const tblList = (d => (d.data || d))(parse(tblRaw, 'table/nodes'));
  const tables = tblList.map(t => t.label).sort();
  console.log('Tables:', tables.join(', '));

  const required = ['aiapi_users', 'aiapi_roles', 'aiapi_user_roles', 'aiapi_apikeys', 'aiapi_settings'];
  const missing  = required.filter(n => !tables.includes(n));

  console.log('\n─── Result ─────────────────────────────────────────');
  if (missing.length) {
    console.log('FAIL — missing tables:', missing.join(', '));
    process.exit(1);
  } else {
    console.log('PASS — all required tables present');
    console.log(JSON.stringify({ tables, missing, ok: true }));
  }
})().catch(e => { console.error('ERROR:', e.message ?? e); process.exit(1); });

