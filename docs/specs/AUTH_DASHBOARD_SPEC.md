# Auth Dashboard — Implementation Spec (G-B U6)

**Status:** Ready for Code-mode implementation
**Owner:** Code mode (delegated by Orchestrator)
**Architect sign-off required** to mark U6 done in [`TODO.md`](../../TODO.md:631).
**Related:** [`ADR-016`](../architecture/decisions/ADR-016-auth-dashboard-ux.md:1)

---

## 0. Pre-flight (READ before touching code)

| Doc | Key lines | Purpose |
|---|---|---|
| [`TODO.md`](../../TODO.md:631) | 631–649 | U6 acceptance items |
| [`ADR-016`](../architecture/decisions/ADR-016-auth-dashboard-ux.md:1) | all | Design rationale + validated decisions |
| [`CONVENTIONS.md`](../../CONVENTIONS.md:1) | §3, §9 | element-id casing, action protocol |
| [`dashboard.html`](../../components/server/dist-resources/dashboard/dashboard.html:466) | 466–860 | existing auth section + modals |
| [`dashboard.js`](../../components/server/dist-resources/dashboard/dashboard.js:2775) | 2775–3332 | existing auth handlers |
| [`internalHandlers.ts`](../../components/server/src/server/internalHandlers.ts:202) | 202–460 | REST CRUD impls |
| [`httpServerWithDashboard.ts`](../../components/server/src/server/httpServerWithDashboard.ts:1999) | 1999–2120 | auth/config + appTemplates endpoints |

**Core principle:** the auth panel is ~90 % complete; the scenario editor is
~100 % implemented but has a runtime regression. **DO NOT** delete existing
controls, ids, or handler names. Add only what is missing; fix what is
broken; extend D3/D4 scenarios.

---

## 1. Files to modify (no new files)

| File | Type of change |
|---|---|
| [`components/server/dist-resources/dashboard/dashboard.html`](../../components/server/dist-resources/dashboard/dashboard.html:1) | Add: JWT issuer input, role-edit modal with permissions matrix, per-user API-key detail row template, SAML cert Browse buttons |
| [`components/server/dist-resources/dashboard/dashboard.js`](../../components/server/dist-resources/dashboard/dashboard.js:1) | Add: `openEditRoleModal`, `closeEditRoleModal`, `saveEditedRole`, `_renderPermMatrix`, `_collectPermMatrix`, `editUserRoles`, `toggleUserApiKeys`, `loadUserApiKeys`, `revokeApiKey`; extend `loadAuthConfig`/`saveAuthConfig` for issuer; extend `saveNewRole` for permissions; extend `openAddRoleModal` for permissions |
| [`components/server/dist-resources/dashboard/dashboard.css`](../../components/server/dist-resources/dashboard/dashboard.css:1) | Add `.role-badge` only if not already defined |
| [`components/server/src/server/internalHandlers.ts`](../../components/server/src/server/internalHandlers.ts:1) | Verify/add `handleInternalListApiKeys` (GET /apikeys); verify `handleInternalUpdateRole` accepts `permissions[]`; verify `handleInternalListRoles` returns `permissions[]` per role; verify `handleInternalCreateRole` accepts `permissions[]` |
| [`components/server/src/server/httpServerWithDashboard.ts`](../../components/server/src/server/httpServerWithDashboard.ts:1) | Extend `handleGetAuthConfig`/`handleSaveAuthConfig` to read/write `jwt.issuer`; investigate and fix `handleSaveScenario` regression (see §8) |
| [`docs/guides/SERVER_GUIDE.md`](../guides/SERVER_GUIDE.md:1) | Append "Configuring authentication" section |
| [`test/e2e/d3/scenarios.xml`](../../test/e2e/d3/scenarios.xml:1) | Append scenarios `a12-jwt-issuer`, `a13-role-permissions`, `a14-apikey-revoke`, `a15-user-role-edit` |
| [`test/e2e/d3-auth-ui.js`](../../test/e2e/d3-auth-ui.js:1) | Register new scenarios after `a11-add-user-modal` |

**No new TypeScript modules. No new HTML files. No new CSS files.**

---

## 2. HTML changes — exact diffs to apply

### 2.1 JWT settings — add Issuer input

In [`dashboard.html`](../../components/server/dist-resources/dashboard/dashboard.html:518),
inside the JWT `setting-group`, AFTER the Token Expiry label (line ~522)
and BEFORE the closing `</div>` of the group, insert:

```html
<label>
  Issuer:
  <input type="text" id="auth-jwt-issuer" placeholder="aiapi" style="width:16rem;">
  <small style="margin-left:0.5rem;">Identifies who issued the JWT
    (default: <code>aiapi</code>). Must match clients that validate the <code>iss</code> claim.</small>
</label>
```

### 2.2 SAML — Browse buttons next to cert textareas

In [`dashboard.html`](../../components/server/dist-resources/dashboard/dashboard.html:613),
wrap each of the two SAML PEM textareas in a flex row with a `btn-browse`
button. The existing `btn-browse` handler reads a **file path** into a
target `<input>` (via `data-target`). Extend it to also read file
**content** into a `<textarea>` (via `data-target-textarea`) — see §3 for
the JS extension. Apply this wrapper to both textareas:

```html
<!-- IdP Certificate -->
<label>IdP Certificate (PEM or <code>file://path</code>):
  <div style="display:flex;gap:0.5rem;align-items:flex-start;">
    <textarea id="auth-saml-cert" rows="4"
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              style="flex:1;font-family:monospace;font-size:0.8rem;resize:vertical;"></textarea>
    <button class="btn-browse" data-target-textarea="auth-saml-cert"
            data-filter="Certificate Files (*.pem;*.crt;*.cer)|*.pem;*.crt;*.cer|All files (*.*)|*.*">📂</button>
  </div>
</label>

<!-- SP Private Key -->
<label>SP Private Key <small>(PEM, optional)</small>:
  <div style="display:flex;gap:0.5rem;align-items:flex-start;">
    <textarea id="auth-saml-private-key" rows="3"
              placeholder="-----BEGIN PRIVATE KEY-----&#10;(optional)"
              style="flex:1;font-family:monospace;font-size:0.8rem;resize:vertical;"></textarea>
    <button class="btn-browse" data-target-textarea="auth-saml-private-key"
            data-filter="Key Files (*.pem;*.key)|*.pem;*.key|All files (*.*)|*.*">📂</button>
  </div>
</label>
```

### 2.3 Roles table — add Permissions column

In [`dashboard.html`](../../components/server/dist-resources/dashboard/dashboard.html:757),
replace the roles table `<thead>` (4 columns) with 5 columns:

```html
<thead>
  <tr style="background:var(--bg-secondary);">
    <th style="padding:6px 8px;text-align:left;">Role Name</th>
    <th style="padding:6px 8px;text-align:left;">Description</th>
    <th style="padding:6px 8px;text-align:left;">Permissions</th>
    <th style="padding:6px 8px;text-align:center;width:80px;">Members</th>
    <th style="padding:6px 8px;text-align:center;width:140px;">Actions</th>
  </tr>
</thead>
```

Update both `colspan` values in the loading/empty `<td>` rows from `4` → `5`.

### 2.4 Edit Role modal (new — after `add-role-modal`)

After the closing `</div></div>` of `#add-role-modal`
([`dashboard.html`](../../components/server/dist-resources/dashboard/dashboard.html:834), line ~834):

```html
<!-- Edit Role Modal (with permissions matrix) -->
<div id="edit-role-modal" class="modal">
  <div class="modal-content" style="max-width:520px;">
    <div class="modal-header">
      <h3>✏️ Edit Role — <span id="edit-role-name"></span></h3>
      <button class="modal-close" onclick="closeEditRoleModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label for="edit-role-description">Description:</label>
        <input type="text" id="edit-role-description"
               style="width:100%;box-sizing:border-box;" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Permissions:</label>
        <div id="edit-role-permissions"
             style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;
                    padding:0.5rem;border:1px solid var(--border);border-radius:4px;
                    max-height:240px;overflow-y:auto;">
          <!-- rendered by openEditRoleModal() -->
        </div>
        <small>Toggle permissions granted to this role.</small>
      </div>
    </div>
    <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:0.75rem;
         padding:1rem 1.5rem;border-top:1px solid var(--border);">
      <button class="btn-secondary" onclick="closeEditRoleModal()">Cancel</button>
      <button class="btn-primary" onclick="saveEditedRole()">💾 Save</button>
    </div>
  </div>
</div>
```

### 2.5 Add-Role modal — extend with permissions matrix

In [`dashboard.html`](../../components/server/dist-resources/dashboard/dashboard.html:819),
after the `new-role-description` form-group div, add:

```html
<div class="form-group">
  <label>Permissions:</label>
  <div id="new-role-permissions"
       style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;
              padding:0.5rem;border:1px solid var(--border);border-radius:4px;
              max-height:200px;overflow-y:auto;">
    <!-- rendered by openAddRoleModal() -->
  </div>
  <small>Optional: grant permissions to this role (can be changed later).</small>
</div>
```

---

## 3. JS changes — additions to dashboard.js

### 3.1 Extend `loadAuthConfig` (line ~2808)

After the JWT expiry line, add:

```js
const jwtIssuerEl = document.getElementById('auth-jwt-issuer');
if (jwtIssuerEl) jwtIssuerEl.value = cfg.jwt?.issuer ?? 'aiapi';
```

### 3.2 Extend `saveAuthConfig` (line ~2887)

Add `issuer` inside the `jwt:` object literal:

```js
jwt: {
  enabled:      document.getElementById('auth-jwt-enabled').checked,
  expiryMinutes:parseInt(document.getElementById('auth-jwt-expiry').value) || 60,
  issuer:       (document.getElementById('auth-jwt-issuer')?.value.trim()) || 'aiapi',
},
```

### 3.3 Extend `btn-browse` click handler for textarea targets

Find the existing `btn-browse` click handler (search for `data-target` in the
DOMContentLoaded event listener section). After the `data-target` block that
writes a path into an `<input>`, add a fallback:

```js
// If browse target is a <textarea> (data-target-textarea), read file content
const textareaTarget = btn.dataset.targetTextarea;
if (textareaTarget) {
  // Use /api/_internal/read-file to fetch server-local PEM content
  const path = /* file selected via native dialog */ result?.path || result;
  if (path) {
    fetch(`/api/_internal/read-file?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(d => {
        const ta = document.getElementById(textareaTarget);
        if (ta && (d.content || d.text)) ta.value = d.content || d.text;
      })
      .catch(() => {
        // Fallback: just put the path string into the textarea
        const ta = document.getElementById(textareaTarget);
        if (ta) ta.value = path;
      });
  }
  return;
}
```

> **Note:** If `/api/_internal/read-file` doesn't exist, put the path string
> into the textarea as a fallback. The server will resolve `file://path` from
> the SAML cert field anyway (existing `SamlProvider` supports it).

### 3.4 Permissions matrix helpers

Add these utility functions before the role-edit modal handlers:

```js
// Canonical permission list (must stay in sync with server AuthService permission keys).
const AUTH_PERMISSIONS = [
  'admin',
  'users.read',   'users.write',
  'roles.read',   'roles.write',
  'config.read',  'config.write',
  'scenarios.read','scenarios.write','scenarios.execute',
  'helpers.execute',
  'logs.read',
];

function _renderPermMatrix(containerId, selected) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = AUTH_PERMISSIONS.map(p =>
    `<label style="font-size:0.85rem;display:flex;align-items:center;gap:4px;cursor:pointer;">
       <input type="checkbox" data-perm="${p}" ${selected.includes(p) ? 'checked' : ''}>
       ${p}
     </label>`
  ).join('');
}

function _collectPermMatrix(containerId) {
  return Array.from(
    document.querySelectorAll(`#${containerId} input[data-perm]`)
  ).filter(el => el.checked).map(el => el.dataset.perm);
}
```

### 3.5 Role-edit modal handlers

```js
function openEditRoleModal(role) {
  document.getElementById('edit-role-name').textContent = role.name;
  document.getElementById('edit-role-description').value = role.description || '';
  _renderPermMatrix('edit-role-permissions', role.permissions || []);
  const modal = document.getElementById('edit-role-modal');
  modal.classList.add('active');
  modal.dataset.roleName = role.name;
}

function closeEditRoleModal() {
  document.getElementById('edit-role-modal').classList.remove('active');
}

async function saveEditedRole() {
  const name = document.getElementById('edit-role-modal').dataset.roleName;
  const body = {
    description: document.getElementById('edit-role-description').value.trim(),
    permissions: _collectPermMatrix('edit-role-permissions'),
  };
  try {
    const r = await fetch(`/api/_internal/roles/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (data.success || data.role) {
      closeEditRoleModal();
      addLog('info', 'auth', `Role "${name}" updated`);
      await loadRoles();
    } else {
      alert(`Failed to update role: ${data.error || 'Unknown error'}`);
    }
  } catch (e) { alert(`Error: ${e.message}`); }
}
```

### 3.6 Extend `openAddRoleModal` and `saveNewRole`

In existing [`openAddRoleModal`](../../components/server/dist-resources/dashboard/dashboard.js:3285),
add at the end (before `classList.add('active')`):

```js
_renderPermMatrix('new-role-permissions', []);
```

In existing `saveNewRole`, add `permissions` to the POST body:

```js
body: JSON.stringify({ name, description, permissions: _collectPermMatrix('new-role-permissions') }),
```

### 3.7 Roles table — render permissions + Edit button

In `loadRoles()` (line ~3175), update the row template to 5 columns and add
Edit button:

```js
tbody.innerHTML = roles.map(role => `
  <tr>
    <td style="padding:5px 8px;font-weight:600;">${escapeHtml(role.name)}</td>
    <td style="padding:5px 8px;opacity:0.8;">${escapeHtml(role.description || '')}</td>
    <td style="padding:5px 8px;font-size:0.75rem;">
      ${(role.permissions || []).map(p =>
        `<span class="role-badge">${escapeHtml(p)}</span>`).join(' ')
        || '<em style="opacity:0.5;">none</em>'}
    </td>
    <td style="padding:5px 8px;text-align:center;">${role.memberCount ?? '—'}</td>
    <td style="padding:5px 8px;text-align:center;">
      <button class="btn-secondary" style="padding:2px 8px;font-size:0.75rem;"
              onclick='openEditRoleModal(${JSON.stringify(role).replace(/'/g,"&#39;")})'>✏️ Edit</button>
      <button class="btn-secondary" style="padding:2px 8px;font-size:0.75rem;"
              onclick="deleteRole('${escapeHtml(role.name)}')">🗑️</button>
    </td>
  </tr>`).join('');
```

### 3.8 Users table — clickable-roles cell + API-key expand row

In `loadUsers()` (line ~3136), apply these two changes to the row template:

**a) Roles cell — click-to-edit:**
```js
<td style="padding:5px 8px;cursor:pointer;"
    onclick="editUserRoles('${escapeHtml(u.id)}', this)"
    title="Click to edit roles">
  ${(u.roles || []).map(r =>
    `<span class="role-badge">${escapeHtml(r)}</span>`).join(' ')
    || '<em style="opacity:0.5;">click to assign</em>'}
</td>
```

**b) API-keys cell — expand + generate:**
```js
<td style="padding:5px 8px;text-align:center;">
  <button class="btn-tool" style="padding:1px 6px;font-size:0.75rem;"
          onclick="toggleUserApiKeys('${escapeHtml(u.id)}')">
    ${u.apiKeyCount ?? 0} 🔽
  </button>
  <button class="btn-tool" style="padding:1px 6px;font-size:0.75rem;"
          onclick="generateApiKeyForUser('${escapeHtml(u.id)}')"
          title="Generate new API key">🗝️＋</button>
</td>
```

**c) After each user `<tr>`, append a hidden expand row:**
```js
<tr id="apikeys-row-${escapeHtml(u.id)}" style="display:none;">
  <td colspan="5" style="background:var(--bg-secondary);padding:0.5rem 1rem;">
    <div id="apikeys-list-${escapeHtml(u.id)}"><em>Loading…</em></div>
  </td>
</tr>
```

### 3.9 New JS functions for user role editing and API-key management

```js
function editUserRoles(userId, td) {
  const current = Array.from(td.querySelectorAll('.role-badge'))
    .map(s => s.textContent.trim()).join(', ');
  const input = prompt('Roles (comma-separated):', current);
  if (input === null) return;
  const roles = input.split(',').map(s => s.trim()).filter(Boolean);
  fetch(`/api/_internal/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles }),
  }).then(r => r.json()).then(d => {
    if (d.success || d.user) {
      addLog('info', 'auth', `Roles updated for user ${userId}`);
      loadUsers();
    } else {
      alert(`Failed: ${d.error || 'unknown'}`);
    }
  }).catch(e => alert(`Error: ${e.message}`));
}

async function toggleUserApiKeys(userId) {
  const row = document.getElementById(`apikeys-row-${userId}`);
  if (!row) return;
  row.style.display = row.style.display === 'none' ? '' : 'none';
  if (row.style.display !== 'none') await loadUserApiKeys(userId);
}

async function loadUserApiKeys(userId) {
  const list = document.getElementById(`apikeys-list-${userId}`);
  if (!list) return;
  try {
    const r = await fetch(`/api/_internal/users/${encodeURIComponent(userId)}/apikeys`);
    if (!r.ok) { list.innerHTML = `<em>Error ${r.status}</em>`; return; }
    const data = await r.json();
    const keys = data.apiKeys || data.keys || [];
    if (keys.length === 0) { list.innerHTML = '<em>No API keys.</em>'; return; }
    list.innerHTML = `
      <table style="width:100%;font-size:0.8rem;">
        <thead><tr>
          <th align="left">Key ID</th><th align="left">Prefix</th>
          <th align="left">Created</th><th align="left">Last used</th><th></th>
        </tr></thead>
        <tbody>${keys.map(k => `
          <tr>
            <td>${escapeHtml(k.id)}</td>
            <td><code>${escapeHtml(k.prefix || '—')}</code></td>
            <td>${escapeHtml(k.createdAt || '—')}</td>
            <td>${escapeHtml(k.lastUsedAt || 'never')}</td>
            <td>
              <button class="btn-secondary" style="padding:1px 6px;font-size:0.75rem;"
                      onclick="revokeApiKey('${escapeHtml(userId)}','${escapeHtml(k.id)}')">
                🚫 Revoke
              </button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) { list.innerHTML = `<em>${e.message}</em>`; }
}

async function revokeApiKey(userId, keyId) {
  if (!confirm(`Revoke key ${keyId}? Calls using it will fail immediately.`)) return;
  try {
    const r = await fetch(
      `/api/_internal/users/${encodeURIComponent(userId)}/apikeys/${encodeURIComponent(keyId)}`,
      { method: 'DELETE' }
    );
    const data = await r.json();
    if (data.success) {
      addLog('info', 'auth', `API key ${keyId} revoked for user ${userId}`);
      await loadUserApiKeys(userId);
      await loadUsers();
    } else { alert(`Failed: ${data.error}`); }
  } catch (e) { alert(`Error: ${e.message}`); }
}
```

---

## 4. Auth mode selector — show/hide verification

(Already implemented in [`onAuthModeChange`](../../components/server/dist-resources/dashboard/dashboard.js:2984).
Confirm it matches this table exactly — no change needed if it does.)

| Mode | Visible panels |
|---|---|
| `none` | Mode selector + JWT + User Store only |
| `password` | + `#auth-panel-password` (bcrypt rounds) |
| `apikey` | + `#auth-panel-apikey` (default user) |
| `certificate` | + `#auth-panel-certificate` (CA path + require toggle) |
| `oauth` | + `#auth-panel-oauth` (full OAuth form) |
| `saml` | + `#auth-panel-saml` (full SAML form) |

JWT Settings and User Store groups are **always visible**.
When `mode === "none"`, Users & Roles tab shows `#auth-mode-none-notice`
and hides `#auth-users-roles-panel`.

---

## 5. REST endpoint audit (verify — no breaking changes)

| Endpoint | Method | Status | Action |
|---|---|---|---|
| `/api/auth/config` | GET | ✅ | **Extend** response object: include `jwt.issuer` |
| `/api/auth/config` | POST | ✅ | **Extend** handler: persist `jwt.issuer`; re-sign settings file |
| `/api/_internal/users` | GET | ✅ | No change |
| `/api/_internal/users` | POST | ✅ | No change |
| `/api/_internal/users/:id` | PUT | ✅ | No change (already accepts `{enabled?,roles?,password?}`) |
| `/api/_internal/users/:id` | DELETE | ✅ | No change |
| `/api/_internal/users/:id/apikeys` | GET | ⚠️ **verify** | Should return `{apiKeys:[{id,prefix,createdAt,lastUsedAt}]}`; add if missing |
| `/api/_internal/users/:id/apikeys` | POST | ✅ | Returns `{apiKey:"<shown-once>"}` |
| `/api/_internal/users/:id/apikeys/:keyId` | DELETE | ✅ line 326 | Returns `{success:true}` |
| `/api/_internal/roles` | GET | ✅ | **Verify** each role includes `permissions: string[]` |
| `/api/_internal/roles` | POST | ✅ | **Verify** body accepts `permissions: string[]` |
| `/api/_internal/roles/:id` | PUT | ✅ line 381 | **Verify** body accepts `{description?,permissions?}` |
| `/api/_internal/roles/:id` | DELETE | ✅ | No change |
| `/api/_internal/db/provision` | POST | ✅ | No change |

**Detailed checks in [`internalHandlers.ts`](../../components/server/src/server/internalHandlers.ts:348):**
- `handleInternalListRoles` (line 348): confirm the mapped role object includes `permissions`.
- `handleInternalCreateRole` (line 361): confirm `permissions` key is read from `req.body` and stored.
- `handleInternalUpdateRole` (line 381): confirm `permissions` key is accepted and merged.
- `handleInternalListApiKeys` (GET): if the function does not exist, add it next to
  `handleInternalCreateApiKey` (line 300); it should call `authService.listApiKeysForUser(userId)`
  and return `{apiKeys:[{id,prefix,createdAt,lastUsedAt}]}`.

**In [`httpServerWithDashboard.ts`](../../components/server/src/server/httpServerWithDashboard.ts:732):**
- Add route for `GET /api/_internal/users/:id/apikeys` (if missing) alongside the existing
  `POST /api/_internal/users/:id/apikeys` route.
- `handleGetAuthConfig` (line 2000): extract and return `settings.auth.jwt.issuer`.
- `handleSaveAuthConfig` (line 2036): write `body.jwt.issuer` to `settings.auth.jwt.issuer`.

---

## 6. dashboard-settings.json schema delta

```json
{
  "auth": {
    "mode": "none",
    "jwt": {
      "expiry": 90,
      "issuer": "aiapi"
    }
  }
}
```

The `issuer` field is already read by `JwtService` if present; this just
makes it UI-configurable and persisted.

---

## 7. CSS — minimal addition

In [`dashboard.css`](../../components/server/dist-resources/dashboard/dashboard.css:1),
**search first** for `.role-badge`. If not present, append:

```css
.role-badge {
  display: inline-block;
  background: var(--accent-soft, #2a3a5a);
  color: var(--accent, #88aaff);
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 0.72rem;
  margin: 1px 2px;
}
```

---

## 8. Scenario editor regression — investigation and fix (D4)

The user reports the scenario (steps) editor has "dropped". All code paths
exist and are structurally sound:
- [`openScenarioEditor`](../../components/server/dist-resources/dashboard/dashboard.js:2362),
  [`scenarioEditorPick`](../../components/server/dist-resources/dashboard/dashboard.js:2401),
  [`_seRenderRows`](../../components/server/dist-resources/dashboard/dashboard.js:2452),
  [`scenarioEditorSave`](../../components/server/dist-resources/dashboard/dashboard.js:2726) all exist.
- Server routes `GET /scenarios/list`, `GET /scenarios/{id}/steps`,
  `PUT /api/appTemplates/{app}/scenarios/{id}` are all wired in
  [`httpServerWithDashboard.ts`](../../components/server/src/server/httpServerWithDashboard.ts:698).
- D4 XML scenarios in [`test/e2e/d4/scenarios.xml`](../../test/e2e/d4/scenarios.xml:1) exist and reference valid atoms.

**Code mode investigation steps (in order):**

1. Run `node test/e2e/d4-scenarios-editor.js` and capture the exact failure
   step and error message.
2. If failure is in `se2-app-scenarios` (picker empty):  
   - Check `GET /api/appTemplates/calculator/scenarios/list` returns `{scenarios:[...]}`.  
   - Check `app.hasScenarios` in `loadAppTemplates` — the ✏️ button only renders if `true`.
3. If failure is in `se3-editor-round-trip` (step count assertion):  
   - Check `_seRenderRows()` in browser console for JS errors.  
   - Check whether `document.querySelectorAll('#scenario-editor-steps-table tbody tr').length`
     returns the right value post-add (the empty-state row is also a `<tr>` — count may be off by 1
     when steps array is non-empty but empty-state row is still present).
4. If failure is in `se4a-editor-save` (save+reload persistence):  
   - Check `PUT /api/appTemplates/calculator/scenarios/{id}` returns `{success:true}`.  
   - Check `handleSaveScenario` in
     [`httpServerWithDashboard.ts`](../../components/server/src/server/httpServerWithDashboard.ts:1502)
     for any path-resolution or write-permission issue.
5. If failure is JS syntax error: run `node -e "require('./components/server/dist-resources/dashboard/dashboard.js')"` 
   (won't exec browser APIs but will catch syntax errors).

**Fix criteria:** D4 se1 → se4b all pass green before declaring the regression resolved.

---

## 9. SERVER_GUIDE.md append

Add to [`docs/guides/SERVER_GUIDE.md`](../guides/SERVER_GUIDE.md:1) a new
H2 section with one worked example per auth mode. Voice: same style as
existing sections (imperative, short sentences). Minimum content per mode:
required fields, any gotcha (e.g. "restart required for certificate mode").

```markdown
## Configuring authentication

Open the dashboard → click **🔑 Auth** in the side nav.

### Password mode (recommended first setup)
1. Mode → **Password**.
2. JWT → **🎲 Generate** secret; set Expiry to `60`; Issuer to `aiapi`.
3. bcrypt Rounds → `10` (use `12` in production).
4. User Store → **JSON file**, path `./config/users.json`.
5. **💾 Save Auth Config**.
6. Switch to **Users & Roles** tab → **➕ Add User**.

### API Key mode
1. Mode → **API Key**.
2. Set Default username for anonymous keys (e.g. `apikey-user`).
3. **💾 Save Auth Config**.
4. In Users & Roles → find a user → click 🗝️＋ to generate a key.
   The key is shown **once** — copy it immediately.

### OAuth 2.0 / OIDC (e.g. Keycloak)
Fill in: Client ID, Client Secret, Authorization URL, Token URL,
User Info URL, Scope (`openid profile email`), Callback URL
(`http://localhost:3458/api/auth/oauth/callback`), Username path
(`preferred_username`). Enable PKCE for public clients.

### SAML 2.0 (e.g. Okta)
Fill in: IdP Entry Point (SSO URL), Issuer (SP Entity ID = your server URL),
IdP Certificate (paste PEM or use 📂 Browse), SP Private Key (optional),
Callback URL (`http://localhost:3458/api/auth/saml/callback`),
Username attribute path (`nameID`), Signature algorithm (`sha256`).

### Client Certificate / mTLS
1. Mode → **Certificate**.
2. CA Certificate Path → path to your CA PEM on the server.
3. Toggle "Require Client Certificate" → ON for strict mTLS.
4. **💾 Save Auth Config** — server restart required for mTLS to take effect.
   Run: `POST /api/restart`.

### User Store: Database
In the User Store group → Source → **Database**.
Fill engine, host, port, database, auth method and credentials.  
Use **🔧 Provision / Initialize Database** to run migrations before first use.
```

---

## 10. D3 e2e test extensions

Append the following four scenarios to
[`test/e2e/d3/scenarios.xml`](../../test/e2e/d3/scenarios.xml:1) and register
them in [`test/e2e/d3-auth-ui.js`](../../test/e2e/d3-auth-ui.js:79):

```js
// in d3-auth-ui.js, after a11-add-user-modal:
await runner.runOk('d3', 'a12-jwt-issuer',      { dashUrl: DASH_URL, testTag: TEST_TAG });
await runner.runOk('d3', 'a13-role-permissions', { dashUrl: DASH_URL, testTag: TEST_TAG });
await runner.runOk('d3', 'a14-apikey-revoke',    { dashUrl: DASH_URL, testTag: TEST_TAG });
await runner.runOk('d3', 'a15-user-role-edit',   { dashUrl: DASH_URL, testTag: TEST_TAG });
```

### `a12-jwt-issuer` (REST round-trip)
1. GET `/api/auth/config` → capture `cfg.jwt.issuer` as `originalIssuer`.
2. POST `/api/auth/config` with modified config where `jwt.issuer = "d3-test-{{testTag}}"`.
3. GET `/api/auth/config` → EVAL: `response.jwt.issuer === "d3-test-{{testTag}}"`.
4. Cleanup: POST original `issuer` back.

### `a13-role-permissions`
1. POST `/api/_internal/roles` `{name:"d3-perm-{{testTag}}",permissions:["users.read","logs.read"]}`.
2. GET `/api/_internal/roles` → EVAL: role has `permissions.length === 2`; includes `users.read`.
3. PUT `/api/_internal/roles/d3-perm-{{testTag}}` `{permissions:["admin"]}`.
4. GET → EVAL: `permissions` is `["admin"]`.
5. DELETE `/api/_internal/roles/d3-perm-{{testTag}}`.

### `a14-apikey-revoke`
1. POST `/api/_internal/users` `{username:"d3-ktest-{{testTag}}",password:"Temp1!"}` → capture `id`.
2. POST `/api/_internal/users/{id}/apikeys` → capture `keyId` (or `id` inside response).
3. GET `/api/_internal/users/{id}/apikeys` → EVAL `apiKeys.length >= 1`.
4. DELETE `/api/_internal/users/{id}/apikeys/{keyId}` → EVAL `success:true`.
5. GET `/api/_internal/users/{id}/apikeys` → EVAL key no longer present.
6. DELETE `/api/_internal/users/{id}` (cleanup).

### `a15-user-role-edit`
1. POST `/api/_internal/users` `{username:"d3-redit-{{testTag}}",roles:["operator"]}` → capture `id`.
2. PUT `/api/_internal/users/{id}` `{roles:["admin","operator"]}`.
3. GET `/api/_internal/users` → EVAL: user has `roles.length === 2`; includes `admin`.
4. DELETE user (cleanup).

All four scenarios must use `TEST_TAG` in the resource names to ensure cleanup
tooling can identify and remove test artefacts.

---

## 11. Acceptance checklist (Architect will verify before marking U6 done)

- [ ] JWT issuer field present in UI, round-trips through GET/POST `/api/auth/config`.
- [ ] All six mode panels show/hide correctly (existing `onAuthModeChange` behaviour preserved).
- [ ] OAuth client secret + SAML private key never echoed back on GET (`***` sentinel).
- [ ] Roles table has Permissions column; Add-Role and Edit-Role persist `permissions[]`.
- [ ] User Roles cell click-to-edit persists via `PUT /api/_internal/users/:id`.
- [ ] API-key expand row lists existing keys; 🚫 Revoke deletes key and decrements count.
- [ ] SAML cert and private-key textareas populatable via Browse.
- [ ] `dashboard-settings.json` `.sig` verifies correctly after Save Auth Config.
- [ ] `SERVER_GUIDE.md` has new "Configuring authentication" H2 with all five modes documented.
- [ ] D3 suite passes including `a12`–`a15`.
- [ ] D4 suite passes (se1–se4b): scenario editor regression resolved.
- [ ] No new production files beyond the 8 listed in §1.
- [ ] `dashboard.js` has no syntax errors; existing D1–D19 suites still green.

---

## 12. Hand-off to Orchestrator

When **all** checklist items pass, Code mode reports to Orchestrator:

1. **Diff summary** — files modified + line-count delta per file.
2. **D1–D19 test run output** — all green (or known-skip documented).
3. **Confirmation** that `config/dashboard-settings.json` was re-signed after test.
4. **D4 regression root-cause** — one sentence describing what was broken and what was fixed.

Orchestrator forwards to Architect. Architect verifies, then ticks U6 items
in [`TODO.md`](../../TODO.md:631) and authorises next G-B item.
