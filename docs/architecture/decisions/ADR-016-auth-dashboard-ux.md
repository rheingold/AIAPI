# ADR-016 — Auth Dashboard UX

**Status:** Accepted
**Date:** 2026-05-21
**Authors:** Architect (ARCH)
**Supersedes:** —
**Related:** G-B U6 (TODO.md), ADR-006 (consent tiers), ADR-008 (dogfood scenarios),
[`DASHBOARD_SECURITY.md`](../../specs/DASHBOARD_SECURITY.md:1),
[`AUTH_DASHBOARD_SPEC.md`](../../specs/AUTH_DASHBOARD_SPEC.md:1)

---

## 1. Context

The authentication backend (G-B U0–U5) is complete:

- `AuthService` factory with six modes (`none` / `password` / `apikey` / `certificate` / `oauth` / `saml`)
- `JwtService` (sign / verify / refresh)
- Providers: `PasswordAuthProvider`, `ApiKeyAuthProvider`, `OAuthProvider`,
  `SamlProvider`, `CertificateAuthProvider`
- User stores: [`JsonUserStore`](../../../components/server/src/auth/stores/JsonUserStore.ts:1) +
  DB adapter (`PostgreSQL` / `MSSQL` / `MySQL` / `Oracle`)
- REST CRUD on [`internalHandlers.ts`](../../../components/server/src/server/internalHandlers.ts:1)
  (`/api/_internal/users`, `/api/_internal/roles`, `/api/_internal/db/provision`)
- Persistence endpoint [`handleSaveAuthConfig`](../../../components/server/src/server/httpServerWithDashboard.ts:2036)
  (`GET`/`POST /api/auth/config`) which re-signs `config/dashboard-settings.json`
  and hot-reloads the `AuthService`.

The dashboard UI already contains an extensive `#section-auth` skeleton
([`dashboard.html`](../../../components/server/dist-resources/dashboard/dashboard.html:466) lines 466–772)
with two sub-tabs (**Auth Config** / **Users & Roles**), mode-conditional panels for
all six modes, OAuth/SAML form fields, a DB-provision sub-panel and three modals
(Add User, Add Role, API Key Result). JS handlers in
[`dashboard.js`](../../../components/server/dist-resources/dashboard/dashboard.js:2775)
(lines 2775–3332) implement `loadAuthConfig`, `saveAuthConfig`, `loadUsers`,
`loadRoles`, `saveNewUser`, `saveNewRole`, `generateApiKeyForUser`, `provisionDb`,
plus mode/store toggles. The D3 dogfood suite
([`test/e2e/d3-auth-ui.js`](../../../test/e2e/d3-auth-ui.js:1)) covers REST
round-trips (a1, a2, a5, a6, a7, a9-rest, a10) and UI presence (a3, a4, a7-dom,
a8, a9-reload, a11-table, a11-modal).

Still missing relative to G-B U6 TODO:

1. **JWT `issuer` claim field** — backend supports it, no UI control.
2. **API key revoke control** — generate is wired (`POST …/apikeys`), but
   the table shows a count only, no per-key list with revoke buttons.
3. **Role permissions matrix** — current Add Role modal stores only
   `name`+`description`; the U6 TODO calls for a permissions matrix.
4. **Role edit (PUT)** — only POST/DELETE wired today.
5. **User role editing** — Add User accepts initial roles; existing-user role
   change is not exposed.
6. **SAML cert / SP private-key upload via file picker** — only paste-into-textarea
   today; U6 mentions "upload".
7. **Docs:** `docs/guides/SERVER_GUIDE.md` auth config example not yet written.
8. **D3 e2e coverage** of items 1–6 above.

A "from-scratch" rewrite is not warranted — the gap is incremental
finishing work on an already-coherent panel.

---

## 2. Decision

**Extend the existing `#section-auth` panel rather than introduce a new page or
top-level route.** The two-sub-tab layout (Config / Users-Roles) already in
[`dashboard.html`](../../../components/server/dist-resources/dashboard/dashboard.html:474)
is the canonical place for all auth UX.

### 2.1 Component layout (frozen)

```
#section-auth
├── .auth-tabs   (Config | Users & Roles)
├── #auth-tab-config
│   ├── 🔐 Authentication Mode            (mode select + debug toggle)
│   ├── 🎫 JWT Settings                   (enabled, secret, expiry, **+ issuer**)
│   ├── 🔒 Password Settings              (mode=password)
│   ├── 🗝️ API Key Settings               (mode=apikey)
│   ├── 📜 Client Certificate / mTLS      (mode=certificate)
│   ├── 🌐 OAuth 2.0 / OIDC Settings      (mode=oauth)
│   ├── 🔐 SAML 2.0 Settings              (mode=saml, **+ cert upload buttons**)
│   └── 🗄️ User Store
│       ├── JSON panel  (path + Browse)
│       └── DB panel    (engine, host, port, db, auth method, creds, provision)
└── #auth-tab-users
    ├── 👤 Users table   (username, enabled, **roles editor**, **api-keys details**, actions)
    ├── ➕ Add User modal
    ├── 🎭 Roles table   (name, description, **permissions**, members, actions)
    ├── ➕ Add/Edit Role modal  (**+ permissions matrix**)
    └── 🗝️ API-Key Result modal (existing show-once flow)
```

### 2.2 Persistence model

- **Save path:** `POST /api/auth/config` writes the `auth` subtree to
  `config/dashboard-settings.json`, re-signs the file, calls
  `AuthService.reload()`. (Already implemented at
  [`httpServerWithDashboard.ts:2036`](../../../components/server/src/server/httpServerWithDashboard.ts:2036).)
- **Secret hygiene:** `GET /api/auth/config` returns secrets as the sentinel
  `"***"`. On save, secrets only ride along the wire when the user typed
  something new — blank field means "keep current". Pattern already enforced
  by [`loadAuthConfig`](../../../components/server/dist-resources/dashboard/dashboard.js:2806)
  / [`saveAuthConfig`](../../../components/server/dist-resources/dashboard/dashboard.js:2894).
- **CRUD path:** Users/roles/API-keys use `/api/_internal/*` (handled in
  [`internalHandlers.ts`](../../../components/server/src/server/internalHandlers.ts:202))
  with admin-token gating via `checkInternalAccess`.

### 2.3 Users & Roles sub-panel rules

- If `auth.mode === "none"`, hide tables and show the inline `info-banner`
  `#auth-mode-none-notice` (already wired).
- Users table is read from `GET /api/_internal/users`; each row mutates via
  `PUT /api/_internal/users/{id}` (enable/disable, roles array) or
  `DELETE /api/_internal/users/{id}`.
- Roles table is read from `GET /api/_internal/roles`; create via `POST`,
  delete via `DELETE`, **and a new `PUT /api/_internal/roles/{id}`** for
  permissions-matrix updates (backend stub exists at
  [`handleInternalUpdateRole`](../../../components/server/src/server/internalHandlers.ts:381)).
- API-key generation expands the user row (collapsible `<details>`) to list
  existing keys (id, prefix, createdAt, lastUsed) with a 🚫 revoke button per
  key. Generate-result still uses the existing **show-once** modal.

### 2.4 No new files for production code

All HTML lives in the existing
[`dashboard.html`](../../../components/server/dist-resources/dashboard/dashboard.html:1);
all JS lives in
[`dashboard.js`](../../../components/server/dist-resources/dashboard/dashboard.js:1)
under the `// ── Auth …` section bands; no new CSS class families (re-use
`setting-group`, `info-banner`, `btn-primary`, `btn-secondary`, `modal`,
`role-badge`, `path-input`, `input-with-button`).

---

## 3. Consequences

### 3.1 Positive

- Zero new public URL surface; security model unchanged
  ([`DASHBOARD_SECURITY.md`](../../specs/DASHBOARD_SECURITY.md:11) protected
  endpoint list already covers `/api/auth/config`).
- The two-sub-tab pattern keeps each tab focused; new operators see the
  config sub-tab first, then opt into Users & Roles when ready.
- E2E coverage is incremental — D3 already has 11 scenarios; we add ≤5 more
  for the new controls (see spec §10).
- Re-signs `dashboard-settings.json` on save, so PKI signature chain (G-E)
  remains coherent.

### 3.2 Negative / monitored risks

- **`dashboard.js` size growth.** Current file is **3,536 lines**. After U6
  finish-work the file will exceed **3,700 lines** — past our internal
  refactor threshold (≈3,000 lines per single JS file). We accept the growth
  for this iteration but mark a follow-up:
  > **G-B-FU1:** Split `dashboard.js` into ES-module chunks
  > (`dashboard.core.js`, `dashboard.auth.js`, `dashboard.scenarios.js`,
  > `dashboard.security.js`). Tracked separately; do **not** bundle into U6.
- **`dashboard.html` size.** ~1,200 lines today. We add ≤80 lines (issuer
  input, role-edit modal, permissions matrix, file pickers). Acceptable.
- Permissions matrix introduces a new column/cell renderer; if the perm list
  grows beyond ~12 entries we may need a separate "Edit Role" modal rather
  than inline checkboxes. Spec uses a modal from the outset to future-proof.
- File-upload for SAML certs uses the same `btn-browse` + Electron file
  dialog pattern as `auth-cert-ca-path`; **no `<input type="file">`** — the
  dashboard is a remote browser and the server cannot reach a client-side
  upload directly. Operator pastes the PEM body, or browses a server-local
  path. This is intentional and consistent with the certificate-mode pattern.

### 3.3 Refactor threshold note

When `dashboard.js` exceeds **4,000 lines** OR `dashboard.html` exceeds
**1,500 lines**, the Architect MUST trigger G-B-FU1 (module split). Logged in
TODO.md under G-B follow-ups, not blocking U6 completion.

---

## 4. Key design choices (rationale digest)

| Decision | Alternative considered | Why chosen |
|---|---|---|
| Extend existing `#section-auth` | New top-level `/auth-admin` page | Existing HTML scaffold is 95% complete; rewrite wastes work |
| Sub-tabs (Config / Users) | Single flat scroll | Mode config + RBAC are conceptually different audiences |
| Sentinel `***` for masked secrets | Always-blank field on GET | Operator can see "a secret IS set" without seeing the value |
| Permissions matrix in a modal | Inline expandable row | Future-proof against >12 perms; cleaner table |
| File-path picker (not browser upload) for certs | `<input type="file">` | Server-side file is signable and re-usable; uploads aren't |
| `/api/_internal/*` for CRUD (admin-token gated) | `/api/auth/users`, `/api/auth/roles` (session-gated) | Already implemented; defense-in-depth (admin token + RBAC filter rules) |
| Re-sign `dashboard-settings.json` on save | Skip re-sign for auth subtree | Maintains coherent G-E signature chain |

---

## 5. Validation criteria (must hold after U6 ships)

1. Round-trip: load auth config → modify mode → save → reload → modified
   mode persisted. *(D3 a9 already proves this.)*
2. Switching to a mode shows ONLY that mode's settings group.
3. Secrets entered are never echoed back on `GET /api/auth/config`.
4. When `mode === "none"`, Users & Roles tab shows the notice and hides the tables.
5. New JWT issuer round-trips through save/load.
6. Adding a role with permissions persists `permissions[]` array; `PUT`
   updates it; deleting a role un-assigns it from all users (server-side cascade).
7. API key revoke removes the row, decrements the user's `apiKeyCount`.
8. SAML cert paste-or-browse both end up populating the textarea correctly.
9. All D3 scenarios still pass; new scenarios (a12–a14, see spec §10) pass.
10. `dashboard-settings.json` `.sig` verifies after save.
