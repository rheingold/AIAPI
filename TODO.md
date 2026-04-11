# TODO — AIAPI

> **Legend:** 🔴 blocking · 🟡 parallel-ready · ⚪ backlog · ✅ done
> Architecture: [`docs/architecture/CODEBASE_MAP.md`](docs/architecture/CODEBASE_MAP.md)
> Vocabulary: [`CONVENTIONS.md`](CONVENTIONS.md)
> ADRs: [`docs/architecture/decisions/`](docs/architecture/decisions/)

---

## 📊 Status Snapshot — April 2026

| ID  | Chapter                                        | State       | Key pending items                                      |
|-----|------------------------------------------------|-------------|--------------------------------------------------------|
| G-A | 🔴 Security Enforcement Gate                  | 🔴 blocking | auth bypass default, binary hash, caller roles wire    |
| G-B | 🗄️ Auth Subsystem Wiring                      | 🔴 blocking | U0–U6 all pending                                      |
| G-C | 🔒 Security Infrastructure (SecurityLib+HKDF) | 🔴 blocking | C++ DLL + HKDF session key not yet built               |
| S-1 | 🔐 Security & Configuration UI                | 🟡 active   | file-dialog, installer, auth UI panel, log pagination  |
| S-2 | 🐕 Dogfooding — Self-Test Suite               | 🟡 active   | D1 dashboard test, D2 schema round-trip, D3 filter test|
| S-3 | 🌐 Web Scraping & Network Tools               | 🟡 active   | fetch_webpage ✅; advanced network protocols pending   |
| N-0 | 📦 VS Code Extension — VSIX & Marketplace     | ⚪ next     | activate() rewrite, vsce package, .vscodeignore, publisher |
| N-1 | 📚 App Knowledge Base Extensions              | ⚪ next     | usr layer live, namespacing, embedding vectors         |
| N-2 | 🎯 Unified Addressing & Input Model           | ⚪ next     | parser, filter engine update, remaining input verbs    |
| N-3 | 🖥️ Browser Automation — Remaining            | ⚪ next     | alert handling, session auth, CDP/UIA DOM fallbacks    |
| N-4 | 🔧 Runtime & Daemon Lifecycle                 | ⚪ next     | R1 config migration, minor daemon items                |
| N-5 | 🍪 Web Fetch — Cookie & Auth Walls            | ⚪ backlog  | consent detection, session cookie jar, POST forms      |
| F-1 | 🔧📄 MS Office Automation                     | ⚪ future   | blocked — Office not installed on this machine         |
| F-2 | 🚀 Deployment & Packaging                     | ⚪ future   | standalone exe, service, installer, Linux, macOS       |
| F-3 | 🌍 Platform Portability                       | ⚪ future   | separate build machine required                        |

---

# PART I — BLOCKING (v1.0 gate items)

---

## G-A — 🔴 Security Enforcement Gate

> Must complete before Windows 1.0 package is cut.

### G-A1 — Remove `SKIP_SESSION_AUTH` default bypass 🔴
- [ ] In `HelperCommon.cs` `RunAuthHandshake(skipAuth)`: change callers so `skipAuth = false`
  unless `SKIP_SESSION_AUTH=true` env var is **explicitly set by the operator**.
  - Handshake code is complete; the flag exists; the default just needs flipping.
  - Production installers must **not** set this env var.
  - Dev: set it in `.env` / `launch.json` as explicit opt-in.

### G-A2 — SecurityLib.dll post-build hash 🟡
- [ ] Add PowerShell step at end of `build-all.ps1` after SecurityLib.dll is built:
  ```powershell
  $hash = (Get-FileHash $secLibDest -Algorithm SHA256).Hash.ToLower()
  # write to security/config.json under binaryHashes["SecurityLib.dll"]
  ```
  `sec_validate_signature_self()` already reads this value; needs population.

### G-A3 — `_caller_user` / `_caller_roles` wire protocol 🟡
- [ ] `HelperRegistry.ts`: append `_caller_user` + `_caller_roles` to every helper request JSON.
  Values from `AuthMiddleware.getContext(req)`. Roles as comma-separated string.
- [ ] `HelperCommon.cs` (all 3 listeners): extract these fields before dispatch; pass into
  `SecurityLib.ValidateAction()` as `callerUser` / `callerRoles`.
- [ ] `SecurityLib.cpp` `sec_validate_action()`: add `callerUser` / `callerRoles` params;
  filter rules with `role` field skip when caller lacks that role.
- [ ] Update P/Invoke wrapper in `HelperCommon.cs`.
- [ ] Document reserved field names in `CONVENTIONS.md §4`.

---

## G-B — 🗄️ Auth Subsystem — Wiring & Completion

> Architecture is fully designed (`src/auth/`, `src/settings/`) — what follows is wiring,
> config completeness, dashboard UI, and test coverage.
> PostgreSQL will be installed on request for DB-backed tests.

### U0 — `AuthConfig` type completeness
- [ ] Add `users.db: DbConfig` sub-field to `AuthConfig` in `src/auth/types.ts`
  so the user store can use a **different** DB connection than the settings adapter.
- [ ] Add `settings.source: 'json' | 'db'` + `settings.db: DbConfig` twin fields to
  the top-level `DashboardSettings` shape so the settings backend is selectable
  at install/setup time (not only at code level).
- [ ] Ensure `SettingsManager` factory reads those fields and wires `DbSettingsAdapter`
  or `JsonSettingsAdapter` accordingly — currently it always uses JSON.

### U1 — Auth provider endpoint wiring
> Both redirect-based providers are implemented but their HTTP routes are not registered.

- [ ] Register routes in `httpServerWithDashboard.ts`:
  - `GET  /api/auth/oauth/redirect`  → `OAuthProvider.getRedirectUrl()`
  - `GET  /api/auth/oauth/callback`  → `OAuthProvider.authenticate({ oauthCode, oauthState })`
  - `GET  /api/auth/saml/redirect`   → `SamlProvider.getRedirectUrl()`
  - `POST /api/auth/saml/callback`   → `SamlProvider.authenticate({ samlResponse, samlRelayState })`
  - `POST /api/auth/login`           → `PasswordAuthProvider.authenticate({ username, password })`
  - `POST /api/auth/apikey`          → `ApiKeyAuthProvider.authenticate({ apiKey })`
  - `POST /api/auth/refresh`         → `JwtService.verify()` → issue new token
  - `POST /api/auth/logout`          → invalidate JWT (`jti` blocklist or short expiry)
- [ ] `AuthMiddleware`: for every request extract and verify JWT if present;
  fall back to per-request credential check if no JWT header.
- [ ] Wire `AuthService.initAuth(cfg)` from `start-mcp-server.ts` so it selects the
  correct `IAuthProvider` and `IUserStore` based on `auth.mode` and
  `auth.users.storeSource` at startup.

### U2 — `_internal` pseudo-helper filter enforcement
> `Permission` type supports `helper: "_internal"` and `operation: "access" |
> "settings_change" | "access_logs"` — but `securityFilter.ts` does not yet enforce these.

- [ ] `securityFilter.ts`: before dispatching `_internal` REST endpoints, evaluate
  filter rules where `helper === "_internal"`:
  - `access` → any `GET /api/_internal/*` read operation
  - `settings_change` → any `POST/PUT/DELETE /api/_internal/*` or `POST /api/settings/*`
  - `access_logs` → `GET /api/security/log`, `GET /api/session/*`
- [ ] Default policy for `_internal`: DENY unless effective role has a matching ALLOW rule
  (role `admin` gets full `*` by default at setup).
- [ ] Expose `_internal` as a selectable "helper" in the Dashboard Security filter wizard.

### U3 — Role-aware filter evaluation (depends on G-A3)
- [ ] Dashboard: assign filter rule a `role` field via the wizard.
- [ ] Test: user without role → rule skipped (default-deny takes over).
- [ ] Test: user with role → rule applied.

### U4 — DbUserStore + DbSettingsAdapter integration tests
> PostgreSQL will be installed first; others follow as CI matrix jobs.

- [ ] `npm install pg` (PostgreSQL driver)
- [ ] Configure `config/dashboard-settings.json`:
  `"auth": {"users": {"storeSource":"db","db":{"type":"postgresql",...}}}`
- [ ] Verify `DbUserStore` creates tables on first run
  (`aiapi_users`, `aiapi_roles`, `aiapi_user_roles`, `aiapi_apikeys`)
- [ ] Test: create user → assign role → login via password → receive JWT →
  call `GET /api/_internal/users` with JWT → round-trip verified
- [ ] `DbSettingsAdapter`: same DB connection; `aiapi_settings` table; test get/set round-trip
- [ ] Repeat tests for MSSQL, MySQL, Oracle when machines available
- [ ] Test all 5 DB auth methods for PostgreSQL:
  - `password` (username + password in config)
  - `certificate` (client TLS cert = settings-signing cert)
  - `integrated` (Kerberos/SSPI on Windows domain)
  - `impersonation` (Windows impersonation, MSSQL only)
  - `constant` (raw connection string — documented as "abusable", warn in logs)

### U5 — Auth provider tests
- [ ] Unit tests: `PasswordAuthProvider` — correct password ✓, wrong ✗, locked user ✗
- [ ] Unit tests: `ApiKeyAuthProvider` — valid key ✓, revoked key ✗
- [ ] Unit tests: `JwtService` — issue / verify / expiry / tamper detection
- [ ] Unit tests: `AuthService` — factory selects correct provider per `auth.mode`
- [ ] Integration test: `OAuthProvider` — mock IdP returns code → token → userInfo →
  user provisioned → JWT; `usernamePath` + `groupsPath` extraction verified
- [ ] Integration test: `SamlProvider` — mock IdP POSTs SAMLResponse → signature verified
  → user provisioned → JWT; `samlify` absent → fallback warning logged
- [ ] Integration test: `CertificateAuthProvider` — mTLS handshake → CN extracted → user
  looked up → JWT; invalid cert → 401
- [ ] Verify `auth.debugExternalAuth = true` writes sanitised req/resp bodies to logger
  (credentials redacted)

### U6 — Dashboard auth configuration UI
- [ ] New **"Auth"** panel (or sub-tab of Settings) with:
  - Auth mode selector: None / Password / API Key / Certificate / OAuth / SAML
  - JWT settings: enabled toggle, expiry minutes, secret (masked)
  - Password settings: bcrypt rounds
  - OAuth form: clientId, clientSecret (masked), authorizationUrl, tokenUrl,
    userInfoUrl, scope, callbackUrl, usernamePath, groupsPath, PKCE toggle
  - SAML form: entryPoint, issuer, SP cert (upload), IdP cert (upload),
    privateKey (masked), callbackUrl, usernamePath, groupsPath, signatureAlgorithm
  - Debug external auth toggle
  - User store source: JSON (path field) / DB (shows DbConfig form)
  - DB form: engine selector, host, port, database, auth method + fields
- [ ] **"Users & Roles"** sub-panel (requires `auth.mode ≠ "none"`):
  - User list: username, enabled toggle, roles, API key count
  - Inline "Add user" form: username, password (masked), initial roles
  - Role list: name, description, permissions matrix
  - API key management per user: generate (shown once), revoke
- [ ] `POST /api/auth/config` — save auth section of dashboard settings (re-sign JSON)
- [ ] Docs: add auth config example to `docs/guides/SERVER_GUIDE.md`

---

## G-C — 🔒 Security Infrastructure (SecurityLib.dll + Helper HKDF Auth)

> SecurityLib provides the crypto primitives (`sec_load`, `sec_hkdf_sha256`,
> `sec_validate_action`) that the Helper HKDF Auth handshake depends on.
> These two topics are inseparable and tracked here together.

### Why a Native C++ DLL
- Must work cross-platform (future Linux helpers in other languages)
- C# helpers load it via P/Invoke; future Python/Node helpers via ctypes/N-API
- DLL's own hash stored in `security/config.json` — helpers verify DLL hash BEFORE loading

### SecurityLib API

```cpp
int  sec_load(const char* configPath, const char* password);
int  sec_validate_signature(const char* exePath);
int  sec_validate_action(const char* action, const char* target,
       const char* processName, const char* processPath,
       const char* processHash, int processId,
       const char* callerUser, const char* callerRoles);
     // returns: SEC_ALLOW(1) | SEC_DENY(0) | SEC_ASK(2) | SEC_ERROR(<0)
int  sec_hkdf_sha256(const uint8_t* ikm, int ikmLen,
       const uint8_t* salt, int saltLen,
       const char* info, uint8_t* out, int outLen);
int  sec_get_session_key(uint8_t* outKey, int keyLen);
void sec_unload();
```

### SecurityLib Implementation Tasks
- [ ] Create `components/helpers/shared/src/security/SecurityLib.cpp` + `SecurityLib.h`
- [ ] `sec_load()`: parse `security/config.json`, verify `config.json.sig` with embedded
  public key, decrypt `private.key.enc` (PBKDF2 + AES-256-GCM)
- [ ] `sec_validate_signature()`: SHA-256 the exe, compare to hash in config
- [ ] `sec_validate_action()`: evaluate filter rules; include `callerUser` / `callerRoles`
- [ ] `sec_hkdf_sha256()`: HKDF-SHA256 via Windows `BCryptKeyDerivation`
- [ ] `sec_validate_signature_self()` — called at main() start; exit 77 on hash mismatch
- [ ] Build as `.dll` (Windows) / `.so` (Linux/macOS) from build scripts
- [ ] P/Invoke declarations in `HelperCommon.cs`
- [ ] Store DLL's own SHA-256 in `security/config.json` (verified before loading)
- [ ] Update `scripts/build-win-tools.ps1` to compile `SecurityLib.dll`

### Enforcement Rule
Every helper calls `sec_validate_action()` BEFORE executing any command.
If `SEC_DENY` → return `{"success":false,"error":"SECURITY_FILTER_DENY"}` without executing.
`SEC_ASK` → treat as DENY for now (future: OS dialog).
MCP server ALSO applies filters for defense-in-depth.

### Helper HKDF Auth Handshake

```
[Helper]                                  [MCP Server]
  │  1. sec_validate_signature(selfPath)   │  (private.key.enc decrypted on startup;
  │     — verify own exe + DLL hashes      │   password from user / Windows DPAPI)
  │
  ├── {"action":"_auth_hello",
  │    "helperNonce":"<base64 32B>",
  │    "exeHash":"<sha256-hex>",
  │    "dllHash":"<sha256-hex>"}       ──> │  verify exeHash against config.json entry
  │
  │ <── {"action":"_auth",           <──   │  raw decrypted RSA private key (never on disk)
  │      "pk":"<base64-pkcs8-raw>",
  │      "serverNonce":"<base64 32B>",
  │      "securityConfig":"<path>",
  │      "helperExePath":"<path>"}
  │
  │  2. sec_load(pk_bytes, configPath)
  │  3. HKDF(ikm=pk, salt=SHA256(serverNonce||helperNonce),
  │        info="AIAPI-v1-session") → sessionKey [both sides derive same key]
  │
  ├── {"action":"_auth_ok"}           ──>  │  All further messages HMAC-signed
```

### Helper Auth Implementation Tasks
- [x] `CertificateManager.ts`: `getRawPrivateKeyBytes()` — decrypted PKCS#8 bytes in memory
- [x] `HelperRegistry.ts`: `HelperDaemon` has `startupPhase` / `readyPromise` /
  `handleStartupMessage()` stub for full auth flow
- [x] `HelperCommon.cs`: `RunAuthHandshake(skipAuth)` added; called in `--listen-stdin`
  branch before `RunStdinListener()`
- [ ] `HelperRegistry.ts`: complete exeHash verification + PK loading (requires SecurityLib)
- [ ] `HelperRegistry.ts`: remove `MCP_SESSION_TOKEN`, `MCP_SESSION_SECRET`,
  `SKIP_SESSION_AUTH` env vars once SecurityLib path is wired
- [ ] All subsequent messages: `"hmac":"HMAC-SHA256(sessionKey, JSON-body)"`;
  helper rejects messages with invalid HMAC
- [ ] MCP server startup: prompt for password; optionally persist via Windows DPAPI
  `ProtectedData.Protect(entropy:machineSID)` for restart-free operation


---

# PART II — ACTIVE SPRINT

---

## S-1 — 🔐 Security & Configuration UI

**Goal:** User-friendly configuration, security management, and scenario editing.

### Unit & Integration Test Coverage (current state)
- [x] `wildcardMatch` — 19 tests (`src/utils/wildcardMatch.test.ts`)
- [x] `xmlScenarioLoader` — 27 tests (`src/scenario/xmlScenarioLoader.test.ts`)
  _jsdom v28 ESM-only deps → solved via `src/__mocks__/jsdom-mock.js` + `moduleNameMapper`_
- [x] `Logger` — 18 tests (`src/utils/Logger.test.ts`)
- [x] `filterEval` — 33 tests (`src/utils/filterEval.test.ts`)
  _extracted `evaluateFilterRules()` from duplicate private loops_
- [x] `securityFilter` — 40 tests (`src/server/securityFilter.test.ts`)
  _admin-token bypass, advanced filter eval, read-only exemption, permissive default_
- [x] MCP server integration — 39 tests (`src/server/mcpServer.integration.test.ts`)
  _HTTP transport, JSON-RPC compliance, MCP core, tools/call, admin token API, filter wire_
- [x] `SessionTokenManager` — 16 tests (`src/security/SessionTokenManager.test.ts`)
- [x] MCP server perf — 7 tests (`src/server/mcpServer.perf.test.ts`)
  _p95<200ms serial, 0 errors concurrent (20/50/100), memory growth <20MB/200 reqs_
- [ ] **UI Tests** — dashboard using AIAPI itself (dogfooding): see S-2
- [ ] **End-to-End Tests** — full workflow from UI to execution

### Settings Tab
- [x] Paths, ports, key files, helper search paths, session token expiry, log level
- [x] Remember last browsed locations per field (localStorage)
- [x] Helper Discovery: scan, list, enable/disable toggle, view schema popup
- [ ] **Real native file/folder dialog integration (Windows API)**
  (placeholder prompts today; needs WinAPI `GetOpenFileName` / `SHBrowseForFolder`)

### Security Tab — Filters
- [x] Filter wizard: action, process, helper, command (risk-grouped), pattern, live preview
- [x] Quick-Edit table: inline select/input per cell, move-up/down, delete
- [x] Binary hash / process path / window title criteria
- [x] Pre-defined command template dropdown; parameter autocomplete from helper schemas
- [x] Test filter dry-run; Validate All; Import / Export JSON
- [x] `/regex/` and `/regex/i` pattern syntax in all pattern fields
- [x] "Rules by Process" collapsible panel — groups active rules by process
- [x] Security Audit Log panel — `GET /api/security/log`, auto-refresh 5s, colour-coded
- [ ] Security audit log: add `?limit=N&offset=N` pagination;
  persist events to rolling file log (survives server restarts)
- [ ] XPath-like UI tree path filtering (future, requires N-2 first)
- [ ] Office/Browser document structure filters (future)

### Privileged Mode ✅
- [x] Admin Session Token: time-limited, 15-min expiry, bypasses all filters
- [x] Dashboard: "🔐 Enter Admin Mode", red warning banner, auto-logout
- [x] Audit logging; whitelisted `/api/config/*`; `--emergency-admin-mode` failsafe
- [x] Documented in [docs/specs/PRIVILEGED_MODE.md](docs/specs/PRIVILEGED_MODE.md)

### Scenario Editor (Scenarios Tab)
- [x] Tabular step editor: command / target / parameter / conditional / note fields
- [x] Step reorder (↑↓), duplicate (🔀), undo/redo (Ctrl+Z/Ctrl+Y), history stack
- [x] Save/load; import .json / XML; export .json / XML
- [x] Metadata panel: helper, process, window title, linked assistant, binary checksum
- [x] Auto-refresh App Templates list after save
- [x] "Linked filter rules" sidebar per step — shows matching rules, create from step
- [ ] Drag-and-drop step reordering
- [ ] IntelliSense-style autocomplete: action types, parameter names, valid values
- [ ] Context-aware suggestions: running apps, element IDs from live UI trees

### Installer & First-Run Setup _(full packaging → F-2; setup wizard tracked here)_
- [ ] Automatic security setup wizard: generate key files on first run, sign `config.json`,
  create admin user (ADR-007 steps S4 + S5)
- [ ] Register file associations (`.aiapi-scenario`)

---

## S-2 — 🐕 Dogfooding — Platform Self-Test

> Key release criterion: AIAPI must configure and validate itself end-to-end
> using its own BrowserWin + MCP tools.

### D1 — Dashboard automation test suite
- [ ] Write `tests/integration/test-dogfooding-dashboard.js`:
  - Launch AIAPI server (`--self-hosted`)
  - Open dashboard URL via `BrowserWin LAUNCH:chrome`
  - Settings tab: verify helpers list loads
  - Security tab: add a filter rule via wizard, verify it appears in Quick-Edit table
  - Scenarios tab: create a minimal scenario, save, verify in app templates picker
  - Close browser; verify session log + summary JSON written

### D2 — MCP schema round-trip test
- [ ] Verify: AI issues `getHelperSchema(KeyWin)` → schema returned →
  AI calls `KeyWin.LISTWINDOWS` → response received
- [ ] Verify: `executeScenario(app="calculator", scenarioId="compute",
  params={expression:"3+4"})` → result `"7"`

### D3 — Security filter enforcement test 🟡
- [ ] Test: add DENY rule for `{SENDKEYS}` on notepad → MCP call blocked →
  `SECURITY_FILTER_DENY`
- [ ] Test: admin token bypass → same call succeeds with `X-Admin-Token` header
- [ ] Test: role-based rule → anonymous denied; user with role allowed

---

## S-3 — 🌐 Web Scraping & Network Tools

**Goal:** `fetch_webpage` MCP tool with security filters; advanced network protocol support.

### Core fetch_webpage ✅ IMPLEMENTED
- [x] `fetch_webpage` MCP tool: HTTP/HTTPS, text/HTML/element extraction
- [x] Basic auth and headers; timeout and retry; user-agent customisation
- [x] Domain whitelist/blacklist; protocol restrictions; content-type filtering
- [x] Response size limits; rate limiting per domain; header injection prevention
- [x] Redirect validation and limits

### Advanced Network Protocol Support _(backlog)_
- [ ] SSH client for secure remote access
- [ ] FTP/SFTP for file transfer
- [ ] Telnet for legacy system access
- [ ] Raw TCP/UDP socket connections
- [ ] WebSocket support for real-time communication
- [ ] SMTP for email automation
- [ ] LDAP for directory service queries

### Security Configurations for Network _(backlog)_
- [ ] Network access policy configuration
- [ ] Trusted certificate management; proxy server support with authentication
- [ ] Extend Security Filters UI to include network operations
- [ ] Network command audit trails; admin-mode lockdown capability


---

# PART III — NEXT SPRINT

---

## N-0 — 📦 VS Code Extension — VSIX & Marketplace

> The extension is the **primary and simplest distribution channel** — any Windows user
> with VS Code can install a `.vsix` drop-in without Node, build tools, or a service.
> This chapter tracks the work needed to make that possible.

### Current State
- [x] Extension scaffolding exists: `src/extension.ts` + `package.json` with
  `"engines": {"vscode":"^1.75.0"}`, `activationEvents`, `contributes`
- [x] MCP@IPC command pair (`extension.mcp.callTool`, `extension.mcp.listTools`) registered
- [ ] **`src/extension.ts` `activate()` is stale** — still starts the old `AutomationEngine`
  + `HttpServer` stack. Must be updated to start `MCPServer` + `HttpServerWithDashboard`
  (same as `src/start-mcp-server.ts`) using `context.extensionPath` as working directory.
  Until this is done the extension does not work with the current server code.

### N-0.1 — Fix `activate()` to start the real server stack
- [ ] Replace `AutomationEngine`/`HttpServer` in `activate()` with:
  ```typescript
  const server = new MCPServer(context.extensionPath);
  await server.start();
  context.subscriptions.push({ dispose: () => server.stop() });
  ```
- [ ] Pass `context.extensionPath` as root so relative paths (`dist/helpers/`,
  `config/`) resolve correctly inside the VSIX bundle
- [ ] Keep `extension.mcp.callTool` / `extension.mcp.listTools` IPC commands —
  they are the MCP@IPC interface for other extensions
- [ ] Show status bar item: `$(robot) AIAPI: running on :3457` with click → open dashboard
- [ ] Output channel `AIAPI` for server logs (replaces console.log)
- [ ] `deactivate()`: call `server.stop()` + `helperRegistry.shutdownAll()`

### N-0.2 — `package.json` cleanup
- [ ] Set `"publisher"` field (required for Marketplace; use `rheingold` or register)
- [ ] Fix `"repository".url` (currently placeholder `yourusername`)
- [ ] Fix `"files"` array — remove non-existent `MCP_IPC_QUICK.md` and `INDEX.md`;
  add `components/helpers/*/dist-resources/apptemplates/**`
- [ ] Add `"icon"` field (128×128 PNG)
- [ ] Bump `"version"` from `0.1.1` to `0.2.0` (server stack completely changed)
- [ ] Add `"extensionKind": ["ui"]` — extension must run on the local machine
  (not in a remote container) because it drives local Windows helpers

### N-0.3 — `.vscodeignore`
- [ ] Create `.vscodeignore` to exclude from VSIX:
  ```
  src/**
  components/helpers/*/src/**
  tests/**
  archive/**
  docs/**
  scripts/**
  tools/**
  *.ps1
  *.py
  node_modules/**
  !node_modules/  # vsce handles this
  ```
- [ ] Confirm VSIX includes: `dist/`, `static/`, `config/`,
  `components/helpers/*/dist-resources/`, `security/`, `README.md`

### N-0.4 — Build & CI
- [ ] Add `vsce package` step to `build-all.ps1` (after `npm run compile`)
  → `dist/release/ai-ui-automation-<version>.vsix`
- [ ] CI artifact: upload `.vsix` on every tagged release
- [ ] Optional: `vsce publish` from CI when tag matches `v*` (requires PAT secret)
- [ ] Test install: `code --install-extension dist/release/*.vsix` in a clean profile;
  verify dashboard opens, helpers loaded, MCP tools listed

### N-0.5 — Marketplace listing
- [ ] `README.md`: add badges (VS Code Marketplace version, installs, rating)
- [ ] Screenshot or GIF showing dashboard + scenario run in the Marketplace description
- [ ] `CHANGELOG.md`: document all changes since v0.1.1
- [ ] Category: `"Other"` → consider `"Programming Languages"` + `"Debuggers"` or
  `"Machine Learning"` for discoverability

---

## N-1 — 📚 App Knowledge Base — Extensions

**Goal:** Usr override layer, reverse-domain namespace hierarchy, embedding vectors.

### Usr Override Layer _(config/templates/ as first root — already wired, needs docs & test)_
> Shipped defaults: `components/helpers/*/dist-resources/apptemplates/`
> User overrides: `config/templates/` (first in `appTemplateRoots`; currently empty)

- [ ] Document `config/templates/` purpose and format in `docs/guides/SERVER_GUIDE.md`
- [ ] Example: `config/templates/calculator/scenarios.xml` overrides shipped scenarios
- [ ] Test: server picks usr override first; correctly falls back to shipped default

### R1 — Runtime Directory Migration _(prerequisite: ADR-007 S4 + S5)_
> Runtime-authored files should not live under the repo root.

- [ ] Migrate `config/` → `runtime/config/`, `security/` → `runtime/keys/`
- [ ] Update hardcoded path `config/scenarios` → `runtime/config/scenarios` in `mcpServer.ts`
- [ ] Update `httpServerWithDashboard.ts` settings and apptemplates paths
- [ ] Update setup wizard (`POST /api/_internal/setup`) to write into `runtime/`
- [ ] Add `runtime/` to `.gitignore` (mutable user data, not committed)
- [ ] Add `test/dev-runtime/` tracked stub with dev-time config + keys

### App Template Namespacing _(LOW PRIORITY — reverse-domain hierarchy)_

**Proposed layout:**
```
components/helpers/windows/dist-resources/apptemplates/
  com.microsoft/windows.v11/calculator/   tree.xml  scenarios.xml
  com.microsoft/windows.v11/notepad/
components/helpers/shared/dist-resources/apptemplates/
  com.google/chrome/
  com.brave/browser/
config/templates/
  eu.plachy.aiapi/default/notepad/        ← user overrides / additions
```

- [ ] Decide separator: `/` subdirectories (preferred) vs `.` flat folder names
- [ ] Move existing `calculator/`, `notepad/`, `chrome/` under namespace paths
- [ ] Update `XmlScenarioLoader.load(app, scenarioId)` — `app` is slash-path
- [ ] Update REST routing: greedy prefix match up to `/scenarios/` or `/tree`
- [ ] Update `GET /api/appTemplates` to return namespaced ids
- [ ] Update Dashboard "App Templates" card to render namespace hierarchy as a tree
- [ ] Update `tree.xsd` + `scenarios.xsd` `app` attribute to allow slash-separated paths
- [ ] Document resolution order (user namespace beats vendor; OS-specific beats generic)

### Embedding Vectors _(optional)_
- [ ] Define file format: JSON `[{"id":"...", "label":"...", "vec":[...]}]`
  or binary `.bin` (float32 LE, prepended JSON header)
- [ ] CLI: `node tools/embed-tree.js --app calculator --engine openai-ada-002 --out <path>`
- [ ] `POST /api/appTemplates/{app}/tree/search` — top-K controls by embedding similarity
- [ ] Multiple engines coexist in same `embeddings/` folder

---

## N-2 — 🎯 Unified Addressing & Input Model

> Two topics merged: the XPath-style address syntax and the unified input verb set
> are inseparable — the address syntax defines *where* and the input verbs define *what*.

### Unified Action Address Syntax

> ⏰ **PLANNED — NOT YET IMPLEMENTED.** `{CMD:param}` shorthands continue to work as aliases.

**Full format:**
```
//[HelperGlob]//[ProcessFilter]//[TreePath...]//action:[Verb]/[Params...]
```

**Examples:**
```
//[ProcName:calc*.exe]//mainWindow/ButtonPanel//action:click/buttonNumPad7
//[ProcName:notepad.exe]//action:keypress/Ctrl+A
//Browser*.exe//[tab=0]//document//#username//action:fill/value:admin
ALLOW //Keys*.exe//[SHA256:abc&ProcName:calc*.exe]//mainWindow//*//action:click
DENY  //Browser*.exe//[ProcName:brave.exe]//action:exec/*
```

**Address segment reference:**

| Segment | Syntax | Examples |
|---|---|---|
| Helper selector | `//HelperGlob` (first `//` only) | `//Keys*.exe`, `//Browser*.exe` |
| Process filter | `//[key:val & key:val]` | `//[SHA256:abc&ProcName:calc*.exe&ProcPath:C:\Win\*]` |
| Named child | `//name` | `//mainWindow1`, `//ButtonOK` |
| Index child | `//[n]` | `//[0]`, `//[2]` |
| By attribute | `//[attr=val]` | `//[id=btn-ok]`, `//[class=submitBtn]` |
| Wildcard (one level) | `//*` | any single node |
| Deep wildcard | `//**` | any subtree depth |
| XPath predicate | `//name(xpath:expr)` | `//li(xpath:last())` |
| Browser tab/frame | `//[tab=n]`, `//[frame=name]` | `//[tab=0]//document` |
| Action | `//action:[Verb]/[Params]` | `//action:click`, `//action:fill/value:x` |

**Process filter keys:** `ProcName`, `ProcPath`, `SHA256`, `SHA512`, `PID`, `HWND`, `WindowTitle`

**Action verbs:** `click`, `rightclick`, `dblclick`, `hover`, `keypress`, `keydown`, `keyup`,
`read`, `fill`, `exec`, `scroll`, `check`, `uncheck`

**Implementation tasks:**
- [ ] Formal ABNF grammar in `docs/specs/ACTION_ADDRESS.md`
- [ ] `ParseAddress(string addr)` → `AddressNode[]` in `HelperCommon.cs`
- [ ] Map node types: `HelperSelector`, `ProcessFilter`, `TreeStep`, `ActionStep`
- [ ] `KeyWin.cs`: accept full address strings (not only bare `{CMD:param}` tokens)
- [ ] `BrowserWin.cs`: map tree path segments to CSS selector / CDP node ID;
  handle `(xpath:...)` via `DOM.performSearch`
- [ ] Add `"addressGrammar"` array to each helper's `_schema` output
- [ ] `HelperRegistry.ts`: expose merged grammar via `getHelperSchema` MCP tool response
- [ ] Security filter engine: migrate storage format; implement `MatchAddress(rule, addr)`
- [ ] Dashboard filter editor: replace freetext pattern with structured address-builder

### Unified Input Verb Model (remaining items)

> **All 12 listed commands already implemented in KeyWin.exe and BrowserWin.exe.**
> The remaining items are delivery-mode variations and schema confirmation.

- [ ] **`{CLICK:x,y}` / `{CLICK:elementPath}`** — standardise format across both helpers
- [ ] **`{KEYPRESS:key}` delivery modes:**
  - `global` — `SendInput` to focused window
  - `direct` — `PostMessage(WM_KEYDOWN/WM_CHAR)` to specific HWND / JS `dispatchEvent`
    (specify element: `{KEYPRESS:Enter::#submitBtn}`)
- [ ] **Mouse delivery modes:**
  - `sendinput` — `SendInput(INPUT_MOUSE)` global queue
  - `message` — `PostMessage(WM_LBUTTONDOWN/WM_LBUTTONUP)` direct to HWND
  - `js` (browser only) — `element.dispatchEvent(new MouseEvent('click'))`

### Unified Tree Node Schema (finalise)
Every QUERYTREE response from every helper must produce:
```json
{
  "id": "...",  "handle": "0x1A2B",  "path": "//win/...",
  "type": "Button",  "tag": "BUTTON",  "name": "OK",  "value": "...",
  "attributes": {},
  "position": { "x": 0, "y": 0, "width": 100, "height": 30 },
  "zOrder": 0,  "tabOrder": 0,
  "events": ["click","change","focus"],
  "actions": ["click","setValue","readValue"],
  "children": []
}
```
- [ ] Audit `KeyWin.cs` QUERYTREE output — add any missing fields
- [ ] Audit `BrowserWin.cs` QUERYTREE output — add any missing fields
- [ ] Update schema validation test in `test-full-stack-stdin.js`

---

## N-3 — 🖥️ Browser Automation — Remaining & Cross-Platform DOM

**Goal:** Close remaining BrowserWin gaps; implement CDP-less accessibility fallbacks.

### Remaining BrowserWin.exe Items
- [ ] Alert/popup handling — needs WebSocket CDP event loop
- [ ] Session token authentication (currently guarded by `SKIP_SESSION_AUTH`)
- [ ] Internet Explorer: dead; document as Win32/MSAA via `KeyWin.exe` only

### Cross-Platform Browser DOM (CDP-less fallbacks)

#### Chromium WM_GETOBJECT nudge (no debug flags)
- [ ] Find `Chrome_RenderWidgetHostHWND` child of browser window
- [ ] Send `WM_GETOBJECT(OBJID_CLIENT)` — triggers Chromium accessibility tree
- [ ] Re-query UIA tree after 500ms; flag `"mode":"uia_nudge"` in output

#### Firefox ISimpleDOMNode COM traversal (no flags)
- [ ] `AccessibleObjectFromWindow(renderHwnd, OBJID_CLIENT)` → `IAccessible`
- [ ] `QueryInterface(IID_ISimpleDOMNode)` → walk with `get_nodeInfo()`, `get_attributes()`
- [ ] Build same `{id,type,name,...}` JSON as UIA/CDP; flag `"mode":"ia2"`
- [ ] Use `get_attributes()` to resolve `for=` label→input associations

#### Browser path discovery (Linux / macOS targets)
- [ ] Linux: `/usr/bin/`, `/usr/local/bin/`, `~/.local/share/`
- [ ] macOS: `/Applications/`, `~/Applications/`

---

## N-4 — 🔧 Runtime & Daemon Lifecycle

### Runtime Directory Migration (R1)
> Detailed spec in N-1. Prerequisite: ADR-007 setup wizard steps S4 + S5.

- [ ] Migrate `config/` → `runtime/config/`, `security/` → `runtime/keys/`
- [ ] Add `runtime/` to `.gitignore`; add `test/dev-runtime/` tracked stub

### Daemon Lifecycle (completed) + Minor Guard
- [x] `_ping` / `_schema` / `_exit` built-ins ✅
- [x] `POST /api/helpers/reload` endpoint; dashboard "Reload Helpers" button ✅
- [x] `--self-hosted` / `--rebuild-first` flags; `reloadHelpers()` test helper ✅
- [x] Test-session recording: start/finish/JSONL log; auto-screenshot on failure ✅
- [ ] **Guard:** `--token=` / `--secret=` CLI args — do NOT add them;
  credential passage is always via `_auth` message (in-pipe auth only)

### Documentation
- [ ] `docs/api/BROWSER_API.md` — BrowserWin command reference
- [ ] Update `docs/api/API.md` with all new MCP tools added since last update
- [ ] Add cross-platform usage examples to `docs/guides/QUICK_REF.md`

---

## N-5 — 🍪 Web Fetch — Cookie Consent & Auth Walls

**Goal:** Navigate sites gating content behind cookie consent dialogs or login walls.

### Cookie Consent / GDPR Popup Detection
- [ ] Detect common frameworks in fetched HTML:
  - Google Consent Mode (`consent.google.com`, `fc=allyesundefined`)
  - CookieBot (`data-cookieconsent` attributes)
  - OneTrust (`OptanonConsent` cookie / `onetrust` CSS classes)
  - TrustArc (`truste.com` iframes)
  - Generic: any `<div>` matching `cookie|consent|gdpr|banner` id/class
- [ ] Add `consentWall?: ConsentWallInfo` to `WebFetchResult`
- [ ] Auto-accept strategy (opt-in, disabled by default):
  - `WebFetchOptions.consentHandling: 'none' | 'auto-accept' | 'report'`
- [ ] Cookie jar: store `Set-Cookie` across redirect hops; respect `Secure`, `HttpOnly`, `SameSite`
- [ ] `WebFetchOptions.cookies?: Record<string, string>` for manual injection
- [ ] Handle Google `302 → consent.google.com/ml?continue=…` — extract and offer direct URL

### Session / State Management
- [ ] `WebFetchOptions.sessionId?` — persist cookie jar across `fetchWebpage` calls
- [ ] `clearSession(sessionId)` for AI-managed session reset
- [ ] `WebFetchOptions.method?: 'GET' | 'POST'`; `WebFetchOptions.body?`
  (needed for login form submission via `detectLoginForm()`)


---

# PART IV — FUTURE

---

## F-1 — 🔧📄 MS Office Automation

> ⏰ **Pre-requisite:** Microsoft Office must be installed before `OfficeWin.exe` can be
> built or tested (COM Interop assemblies only present when Office is installed).

### OfficeWin.exe Helper
- [ ] Create `components/helpers/windows/src/OfficeWin.cs`
- [ ] Follow HelperCommon patterns: `--listen-stdin --persistent`, `--api-schema`,
  `DispatchCommand()`, `GetSchema()`; add `HelperCommon.cs` to compile line
- [ ] **Word:** open/create; query structure (paragraphs, tables, headings);
  insert/modify/format text; table manipulation; find/replace; save as docx/pdf
- [ ] **Excel:** open/create; read/write cells; apply formulas; format cells;
  charts; named ranges
- [ ] **PowerPoint:** open/create; query slides; add/modify text and shapes; themes/layouts
- [ ] Update `src/providers/officeProvider.ts` to use `OfficeWin.exe`
- [ ] App templates:
  - `components/helpers/windows/dist-resources/apptemplates/msword/tree.xml` + `scenarios.xml`
  - `msexcel/` and `mspowerpoint/` equivalents
- [ ] Integration tests: `tests/integration/test-office-scenarios.js`

---

## F-2 — 🚀 Deployment & Packaging

> Trigger: after core feature parity stable on Windows (all current Part I–III items done).

### Windows: Standalone Console App
- [ ] `pkg` or `nexe` to bundle `dist/start-mcp-server.js` + `node_modules` + dashboard assets
- [ ] Auto-detect `dist/helpers/` helpers relative to bundle; `--port`, `--no-auth`, etc.
- [ ] CI artifact: `dist/release/aiapi-server-win-x64.exe`

### Windows: Windows Service
- [ ] NSSM-based service (`scripts/install-service-win.ps1`):
  ```powershell
  nssm install AIAPI "C:\Program Files\AIAPI\aiapi-server.exe"
  nssm set AIAPI Start SERVICE_AUTO_START
  ```
- [ ] Windows Event Log integration
- [ ] Installer + Uninstaller PowerShell scripts

### Windows: System-Tray GUI App
- [ ] `tools/tray/TrayApp.cs` with `NotifyIcon` + `ContextMenuStrip`
- [ ] Start / Stop / Restart / Open Dashboard / View Logs / Exit
- [ ] Icon states: grey (stopped) → green (running) → red (error)

### Windows Installer (MSI / NSIS)
- [ ] NSIS or WiX script; bundles: `aiapi-server.exe`, `KeyWin.exe`, `BrowserWin.exe`,
  dashboard assets, `components/helpers/*/dist-resources/apptemplates/`
- [ ] Install to `C:\Program Files\AIAPI\`; Start Menu shortcut
- [ ] Optional: install as Windows Service; add firewall rule for ports 3457/3458
- [ ] Uninstaller: removes service, firewall rule, files (option to keep config + scenarios)
- [ ] First-run setup wizard: generate key files, sign `config.json`, create admin user
- [ ] Version injected from `package.json`
- [ ] CI artifact: `dist/release/aiapi-setup-<version>-win-x64.exe`

### Linux: systemd Daemon _(build on Linux machine)_
- [ ] `scripts/linux/aiapi.service` unit file
- [ ] Linux helpers: `KeyLin` (AT-SPI2 / xdotool) + `BrowserLin` (CDP, same as Windows)
- [ ] `scripts/linux/install.sh`; CI: GitHub Actions `build-linux` job on `ubuntu-latest`

### macOS: launchd Plist _(build on macOS machine)_
- [ ] `scripts/macos/com.rheingold.aiapi.plist` LaunchAgent
- [ ] macOS helpers: `KeyMac` (AX API) + `BrowserMac` (CDP)
- [ ] Code-signing + notarisation for Gatekeeper

### Linux: GUI Tray App (GTK3 / AppIndicator) _(LOW PRIORITY)_
- [ ] `tools/tray/TrayAppLin.c` using `libappindicator3`
- [ ] Autostart via `~/.config/autostart/aiapi-tray.desktop`

### Windows: Explorer Shell Extension _(LOW PRIORITY)_
- [ ] COM in-process extension `tools/shellext/AiapiShellExt.cs`
- [ ] Right-click → "Automate with AIAPI" sub-menu: Open Dashboard, Run scenario…

---

## F-3 — 🌍 Platform Portability

> Separate build machines required. All fallbacks produce the same unified tree node
> schema and input verbs defined in N-2.

### Windows Backwards Compatibility — Fallback Chain
```
Win10/11:  CDP  →  UIA  →  MSAA IAccessible
Win7/8:    CDP  →  UIA  →  MSAA  →  IHTMLDocument2 (IE ActiveX)
WinVista:  UIA  →  MSAA  →  IHTMLDocument2
WinXP:     MSAA  →  IHTMLDocument2 (IE6/7)  →  WM_GETTEXT + EnumChildWindows
Win2000:   MSAA (partial)  →  IHTMLDocument2 (IE5)  →  WM_GETTEXT
Win98/95:  IHTMLDocument2 (IE4+)  →  WM_GETTEXT  →  GetDlgItemText
Win3.1:    WM_GETTEXT  →  GetDlgItemText  →  nothing
```
- [ ] Runtime API detection: probe `UIAutomationCore.dll` before using UIA
- [ ] `IHTMLDocument2` fallback (Win95+, IE4+): in-process DOM for hosted WebBrowser controls
- [ ] MSAA `IAccessible` fallback (Win95 + MSAA SDK)
- [ ] `WM_GETTEXT` / `EnumChildWindows` (Win3.1+, classic Win32 controls only)

### Linux — AT-SPI2 + XDoTool _(FUTURE)_
```
Modern (2015+):    CDP  →  AT-SPI2 (D-Bus)  →  XDoTool + XQueryTree
Older (2005-2015): AT-SPI2  →  XDoTool  →  XQueryTree + XGetWindowProperty
Classic (1990-2005): XQueryTree + XSendEvent  →  XGetWindowProperty
```
- [ ] AT-SPI2 D-Bus tree walker: `org.a11y.atspi.Accessible` C binding
  (Python ref: `pyatspi`; Firefox exposes full ARIA→AT-SPI2 bridge)
- [ ] XDoTool-equivalent: `XSendEvent(display, window, KeyPress/ButtonPress)`
- [ ] WebKitGTK `webkit_web_view_evaluate_javascript` for in-process browser

### macOS — AX API + AppleScript _(FUTURE)_
```
Modern (2015+):    CDP  →  AX API (AXUIElement)  →  AppleScript
Older (2005-2015): AX API  →  AppleScript  →  CGEventPost
```
- [ ] AX API walker: `AXUIElementCreateSystemWide()` → `kAXChildrenAttribute`
- [ ] AppleScript `do JavaScript` (Safari + macOS 10.0+): zero flags, full JS eval
  ```applescript
  tell application "Safari"
    do JavaScript "document.getElementById('x').value" in current tab of front window
  end tell
  ```
- [ ] `CGEventPost`: `CGEventCreateKeyboardEvent` / `CGEventCreateMouseEvent`
  (Accessibility permission required on macOS 10.15+)


---

# APPENDIX — COMPLETED MILESTONES

> These chapters are closed. Details live in git history and the referenced source files.
> The ✅ items throughout Parts I–IV track incremental completions within each active chapter.

| Milestone | Key files / commits | Notes |
|---|---|---|
| **KeyWin.exe core** | `components/helpers/windows/src/KeyWin.cs` | QUERYTREE, READ, LISTWINDOWS, CLICK*, SET, SENDKEYS, LAUNCH, KILL, NEWDOC, RESET; KEYDOWN/UP/PRESS, RIGHTCLICK, DBLCLICK, HOVER, MOUSEDOWN/UP, FILL, READELEM, CHECK, UNCHECK |
| **BrowserWin.exe core** | `components/helpers/shared/src/BrowserWin.cs` | CDP WebSocket (pure .NET 4.5, no NuGet); UIA fallback; LAUNCH, QUERYTREE, CLICK*, FILL, COOKIES, SCREENSHOT, PAGESOURCE, NEWPAGE; all 4 browsers |
| **HelperCommon.cs** | `components/helpers/shared/src/HelperCommon.cs` | RunStdinListener (one-shot + persistent), RunHttpListener, RunNamedPipeListener, AuthState, IdInjectingWriter, HcJson, ParseArgs |
| **Unified Helper Communication** | `src/helpers/HelperRegistry.ts` | --listen-stdin (Step 1), persistent daemon + HelperDaemon class (Step 2), named-pipe (Step 3); _ping / _schema / _exit built-ins; auto-restart on crash |
| **Dynamic Helper API Discovery** | `src/helpers/HelperRegistry.ts` | --api-schema scan on startup; MCP tools `listHelpers`, `getHelperSchema`; enable/disable toggle; schema-command autocomplete in filter wizard |
| **Command Alignment Audit** | `docs/api/KEYWIN_API.md` | Uniform `{target,command,parameter}` wire shape; `id` correlation via IdInjectingWriter; schema completeness verified for all 11 KeyWin + 16 BrowserWin commands |
| **Test-Session Recording** | `src/helpers/HelperRegistry.ts` | start/finish/JSONL log; auto-screenshot on BrowserWin failure; `/api/session/*` REST + MCP endpoints |
| **Test infra (self-hosted)** | `tests/integration/test-full-stack-stdin.js` | --self-hosted, --rebuild-first, reloadHelpers(), testSession helpers; 122 tests passing |
| **Security Filter System** | `src/utils/filterEval.ts`, `src/server/securityFilter.ts` | DENY-wins evaluation; admin bypass; wildcard + /regex/ patterns; wizard + Quick-Edit UI; binary-hash + process-path criteria; 73 unit tests |
| **Session Token Auth** | `src/security/SessionTokenManager.ts` | 16 unit tests; admin token generate/validate; 15-min expiry; audit logging |
| **VS Code Extension scaffold** | `src/extension.ts`, `package.json` | Extension activates; MCP@IPC commands (`extension.mcp.callTool`, `extension.mcp.listTools`) registered and working; `"engines":{"vscode":"^1.75.0"}` + `contributes` defined. **`activate()` rewrite pending** — currently starts stale `AutomationEngine`+`HttpServer`; N-0.1 tracks the fix. |
| **App Knowledge Base (core)** | `components/helpers/*/dist-resources/apptemplates/` | `tree.xsd`, `scenarios.xsd` defined; calculator, notepad, chrome templates authored; ScenarioRef recursion; XmlScenarioLoader + 27 tests; `executeScenario` MCP tool; REST endpoints; dashboard App Templates card; metadata panel; scenario↔filter sidebar |
| **Project Folder Reconciliation** | commits `cb37bd0`, `be66ceb`, `63624e2` | `components/tools/` → `components/helpers/`; apptemplates split to shared/windows; multi-root `resolveAppTemplateRoots()`; CONVENTIONS.md, CODEBASE_MAP.md updated; legacy JSON scenarios removed |
| **MCP Server Integration Tests** | `src/server/mcpServer.integration.test.ts` | 39 tests: HTTP transport, JSON-RPC compliance, MCP core, tools/call, admin token API, security filter wire |
| **MCP Server Performance Tests** | `src/server/mcpServer.perf.test.ts` | 7 tests: p95<200ms serial; 0 errors at 20/50/100 concurrent; memory growth <20MB |
| **Scenario Editor** | `static/dashboard.js` | tabular step editor; ↑↓ reorder; 🔀 duplicate; undo/redo with history stack; metadata panel; auto-refresh on save; filter sync sidebar |

