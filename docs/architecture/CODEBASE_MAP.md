# AIAPI — Codebase Map & Architecture Overview

> Quick-navigation guide for code walkthroughs and onboarding.
> Last updated: 2026-04

---

## What this project is

**AIAPI** is an **MCP (Model Context Protocol) server** that bridges AI language models
to the Windows desktop. It lets an LLM automate applications by calling MCP tools that
translate to native Win32/UIA, COM Office automation, CDP browser control and LibreOffice
UNO socket commands — all via persistent C# helper processes that run alongside the server.

```
AI model (Claude / GPT / …)
     │  MCP over stdio / HTTP+SSE
     ▼
MCP Server  (Node.js / TypeScript)
  ├── auth + security filters
  ├── helper discovery (--api-schema)
  └── HelperRegistry (persistent daemons)
         ├── KeyWin.exe    (Win32 + UIA)
         ├── BrowserWin.exe (CDP + UIA fallback)
         ├── MSOfficeWin.exe (COM Word/Excel/PPT)
         └── LibreOfficeWin.exe (UNO socket)

Dashboard (SPA at :3458)  ←  user configures filters, scenarios, settings
```

---

## Folder layout

```
AIAPI/
│
├── components/
│   ├── server/                     MCP server + VS Code extension (TypeScript)
│   │   ├── src/                    TypeScript source
│   │   │   ├── start-mcp-server.ts Entry point: startup, password prompt, auth init
│   │   │   ├── extension.ts        VS Code extension entry; activates server on install
│   │   │   ├── run-scenario.ts     CLI runner: execute a named XML scenario
│   │   │   ├── types.ts            Shared TS types
│   │   │   ├── server/             MCP + dashboard HTTP server layer
│   │   │   │   ├── mcpServer.ts            MCP JSON-RPC server, tool dispatch
│   │   │   │   ├── httpServerWithDashboard.ts  Dashboard API + SPA serving
│   │   │   │   ├── securityFilter.ts       Filter rule evaluation (runSecurityFilter)
│   │   │   │   ├── internalHandlers.ts     Auth/user/role REST endpoints (_internal)
│   │   │   │   └── fileBridge.ts
│   │   │   ├── helpers/            HelperRegistry.ts — discover, spawn, auth, call daemons
│   │   │   ├── auth/               ⚠️ designed; HTTP routes NOT wired (TODO U0–U6)
│   │   │   │   ├── types.ts  AuthService.ts  AuthMiddleware.ts  JwtService.ts
│   │   │   │   ├── providers/      NoAuth  Password  ApiKey  Certificate  OAuth  SAML
│   │   │   │   └── stores/         JsonUserStore.ts  DbUserStore.ts
│   │   │   ├── security/           SessionTokenManager  CertificateManager  ConfigSigner  IntegrityChecker  …
│   │   │   ├── settings/           SettingsManager  JsonSettingsAdapter  DbSettingsAdapter
│   │   │   ├── scenario/           xmlScenarioLoader  replayer
│   │   │   ├── engine/             automationEngine  webScrapingClient
│   │   │   ├── providers/          windowsFormsProvider  webUIProvider  officeProvider
│   │   │   ├── utils/              Logger  filterEval  wildcardMatch
│   │   │   ├── win/                win32.ts (Win32 P/Invoke bindings)
│   │   │   └── __mocks__/          jsdom-mock.js  encoding-stub.js
│   │   └── dist-resources/         Shipped assets copied to dist/ on build
│   │       ├── dashboard/          Dashboard SPA (dashboard.html/css/js, favicon.svg)
│   │       └── config-defaults/    Starter config templates — setup wizard copies these to runtime/
│   │
│   └── helpers/                    C# helper executables
│       ├── shared/
│       │   ├── src/                Compiled into every helper .exe (see ADR-001)
│       │   │   ├── HelperCommon.cs     Cross-platform shared boilerplate
│       │   │   ├── WinCommon.cs        Windows-specific UIA helpers (KeyWin + BrowserWin)
│       │   │   └── security/
│       │   │       ├── SecurityLib.cpp Native C++ security library (see ADR-003)
│       │   │       └── SecurityLib.h
│       │   └── dist-resources/
│       │       └── apptemplates/   OS-neutral app templates (CDP-based; present on all platforms)
│       │           ├── chrome/
│       │           ├── scenarios.xsd
│       │           └── tree.xsd
│       ├── windows/
│       │   ├── src/                Windows-only helpers
│       │   │   ├── KeyWin.cs           Win32 + UIA helper (all UI automation)
│       │   │   ├── BrowserWin.cs       CDP + UIA browser helper (Chrome/Edge/Brave/Firefox)
│       │   │   ├── MSOfficeWin.cs      Microsoft Office COM helper (Word/Excel/PowerPoint)
│       │   │   └── LibreOfficeWin.cs   LibreOffice UNO socket helper
│       │   └── dist-resources/
│       │       └── apptemplates/   Windows-specific app templates (UIA-based)
│       │           ├── calculator/
│       │           └── notepad/
│       ├── linux/                  (future: KeyLin, BrowserLin)
│       ├── macos/                  (future: KeyMac)
│       └── shims/                  dotnet.cmd — .NET shim for build toolchain
│
├── build/                          Build and deployment scripts
│   ├── windows/
│   │   └── build.ps1               Master build: tsc + csc all helpers + SecurityLib
│   ├── build-win-tools.ps1         Individual helper build (legacy)
│   ├── package-win.ps1             pkg → aiapi-server-win-x64.exe
│   ├── install-win.ps1             Windows Service install via NSSM
│   └── run-jest-capture.ps1
│
├── runtime/                        Live instance data — .gitignored, mutable at runtime
│   ├── config/                     ← TODO: move config/ here (setup wizard target)
│   └── keys/                       ← TODO: move security/ here (encrypted RSA key pair)
│
├── config/                         (⚠️ to be moved to runtime/config/ — see ADR-007 / TODO R1)
│   ├── dashboard-settings.json     Per-deployment settings
│   ├── users.json                  User/role store (JsonUserStore)
│   ├── security/                   Signed security config + filter rules
│   └── scenarios/                  User-authored scenario XML/JSON files
│
├── security/                       (⚠️ to be moved to runtime/keys/ — see ADR-007 / TODO R1)
│   ├── public.key.enc              Encrypted RSA public key
│   └── private.key.enc             Encrypted RSA private key (password required at startup)
│
├── test/
│   ├── src/                        Test suites
│   │   ├── integration/            test-full-stack-stdin.js — full MCP→helper E2E
│   │   └── fixtures/               Test data files
│   ├── dev-runtime/                Tracked dev config for local/CI testing
│   └── sessionlogs/                Auto-recorded session JSONL logs (.gitignored)
│
├── dist/                           Generated build output (TS .js + helper .exe + dist-resources copy)
│   └── helpers/                    KeyWin.exe  BrowserWin.exe  MSOfficeWin.exe  LibreOfficeWin.exe
│
├── docs/
│   ├── INDEX.md                    Documentation index
│   ├── api/                        API.md  KEYWIN_API.md  OFFICE_API.md  SERVER_API.md
│   ├── architecture/               ARCHITECTURE.md  SECURITY_ARCHITECTURE.md  CODEBASE_MAP.md
│   │   └── decisions/              ADR-001 … ADR-007
│   ├── guides/                     AI_ASSISTANT_MANUAL.md  SERVER_GUIDE.md  LINUX_MAC_PORTING.md  QUICK_REF.md
│   ├── specs/                      COMMAND_ALIGNMENT.md  SCENARIO_FORMAT.md  BINARY_HASH_VERIFICATION.md  …
│   └── filesarchive/               Superseded plans, old experiments, past test outputs
│
├── CONVENTIONS.md                  Authoritative vocabulary — commands, targets, settings, REST, wire protocol
├── START_HERE.md                   Quick dev setup and rebuild workflow
└── TODO.md                         Prioritised task backlog
```

---

## Chapter 1 — Entry points and startup

### `src/start-mcp-server.ts`

CLI entry point. Runs in sequence:

1. Parse CLI flags (`--port`, `--dashboard-port`, `--no-auth`, `--log-level`, etc.)
2. Load settings via `SettingsManager` (JSON file or DB)
3. Call `loadCryptoCredentials()` — reads `KEY_PASSWORD` env var or prompts interactively;
   calls `CertificateManager.getRawPrivateKeyBytes(password)` → raw RSA PK bytes in memory
4. Construct `MCPServer` with raw PK bytes
5. Call `await server.initAuth()` — initialises `AuthService`, loads user store,
   wires `AuthMiddleware`
6. Call `await server.start()` — starts HTTP transport, discovers helpers, spawns daemons,
   runs auth handshakes

### `src/extension.ts`

VS Code extension entry. Calls the same startup sequence; provides `vscode.window.showInputBox`
for the password prompt instead of readline. Registers a `AIAPI: Start Server` command.

---

## Chapter 2 — MCP server (`src/server/mcpServer.ts`)

Implements the **MCP JSON-RPC 2.0 protocol** over HTTP+SSE (and optionally stdio).

Key responsibilities:
- Register MCP tools dynamically from discovered helper schemas
- Dispatch `tools/call` requests: `resolveCallArgs(args)` → `callCommand()` → daemon queue
- Run security filter (`runSecurityFilter()`) before dispatching any tool call
- Expose `executeScenario`, `session/start`, `session/finish`, `helpers/reload` as
  additional MCP methods
- Admin token bypass: `X-Admin-Token` header skips all filters for privileged operations

### Tool registration flow

```
server.start()
  → HelperRegistry.discoverHelpers()
    → foreach helper path: spawn "helper.exe --api-schema"
      → parse JSON schema
      → spawn "helper.exe --listen-stdin --persistent"
      → _auth_hello / _auth handshake
      → register MCP tool with schema description
  → toMcpTools() → addTool() for each helper
```

### Dispatch flow for a tool call

```
tools/call { helper: "KeyWin", proc: "calc.exe", action: "CLICKID",
             path: "Button[@id='num7Button']" }
  → resolveCallArgs(args)
      → procFilterToTarget("calc.exe") → "calc.exe"
      → return { target, command: "CLICKID", path, value }
  → runSecurityFilter(target, command, path, callerRoles)
      → evaluateFilterRules(...) → ALLOW / DENY
  → HelperRegistry.callCommand("KeyWin", target, command, path, value)
      → HelperDaemon.call() → write JSON to stdin pipe
        → read response JSON line → return result
```

---

## Chapter 3 — HelperRegistry (`src/helpers/HelperRegistry.ts`)

Central process manager for all helper daemons.

### Key classes

**`HelperDaemon`**  
One instance per discovered helper. Wraps a persistent `child_process.spawn` handle.

- Sequential promise queue — all calls serialised per daemon
- `startupPhase`: `INIT → AUTH_HELLO_SENT → AUTH_SENT → READY`
- `handleStartupMessage()` — processes `_auth_hello` / `_auth_ok` during startup
- `call(target, command, path?, value?)` — enqueues a request, writes JSON line, reads response
- `ping()` — sends `_schema` to verify daemon health
- Auto-restart on unexpected exit (up to 3 times)

**`HelperRegistry`**  
Singleton. Manages the collection of daemons.

- `discoverHelpers(searchPaths)` — scans `dist/helpers/` for `.exe` files, spawns each
- `callCommand(helperName, target, command, path?, value?)` — routes to correct daemon
- `reloadHelpers()` — `shutdownAll()` + re-`discoverHelpers()`
- `startSession(name)` / `finishSession()` — test session recording (JSONL log)
- `callCommand()` intercepts: auto-SCREENSHOT on `BrowserWin` failures

### Wire format (MCP server → helper stdin)

```json
{ "id": "42", "proc": "calc.exe", "action": "CLICKID",
  "path": "Button[@id='num7Button']",
  "_caller_user": "alice", "_caller_roles": "operator",
  "hmac": "<HMAC-SHA256(sessionKey, body)>" }
```

Response:

```json
{ "id": "42", "success": true, "result": "clicked" }
```

See `CONVENTIONS.md §2.6–§2.7` for full wire protocol spec.

---

## Chapter 4 — C# helpers

All four helpers share the same architecture (see ADR-001, ADR-002, ADR-004).

### `HelperCommon.cs` — shared boilerplate

Compiled into every `.exe`. Contains:

| Component | Purpose |
|---|---|
| `RunStdinListener(persistent, dispatch, getSchema)` | stdin JSON-line loop; handles `_schema`, `_ping`, `_exit` |
| `RunHttpListener(port)` | Minimal HTTP/1.1 server on loopback (`System.Net.HttpListener`) |
| `RunNamedPipeListener(pipeName)` | Windows named pipe server (multi-caller sequential) |
| `RunAuthHandshake(skipAuth)` | `_auth_hello → _auth → _auth_ok`; calls `sec_load()` + HKDF |
| `AuthState` | Per-process state: `Authenticated`, `SessionKey`, `SecurityConfigPath`, nonces |
| `IdInjectingWriter` | Wraps `TextWriter`; auto-injects `"id":"<n>"` into every JSON response |
| `HcJson` | Minimal JSON string extractor + escaper (no JSON.NET / no NuGet) |
| `SecurityLib` static class | P/Invoke wrappers for `SecurityLib.dll` functions |
| `ParseArgs(args)` | Unified CLI flag parser |

### `KeyWin.cs` — Win32 + UIA helper

Handles all Windows Forms / Win32 UI automation.

Key commands: `LISTWINDOWS`, `QUERYTREE`, `READ`, `CLICKID`, `CLICKNAME`, `CLICK`,
`SENDKEYS`, `KEYDOWN`, `KEYUP`, `KEYPRESS`, `RIGHTCLICK`, `DBLCLICK`, `HOVER`,
`SET`, `FILL`, `CHECK`, `UNCHECK`, `READELEM`, `FOCUS`, `LAUNCH`, `KILL`, `NEWDOC`, `RESET`

Notable implementations:
- `UiaPathWalker` static class — parses `Button[@id='x']`, `Group[2]/*`, `**` etc. via
  `AutomationElement.FindAll(TreeScope.Children, cond)` with 30+ ControlType mappings
- `InvokeOrClickElement()` — tries `InvokePattern.Invoke()` first, falls back to
  bounding-rect centre click via `SendMouseClick(x, y)`
- `QUERYTREE` returns unified JSON schema: `{id, type, name, position, properties, actions, children}`

### `BrowserWin.cs` — CDP + UIA browser helper

Communicates with Chrome/Edge/Brave via **raw masked WebSocket** (RFC 6455, no NuGet).
Firefox uses UIA accessibility tree as fallback (IAccessible2 / full ARIA tree).

Key commands: `LAUNCH`, `LISTBROWSERS`, `NAVIGATE`, `QUERYTREE`, `CLICKID`, `CLICKNAME`,
`FILL`, `READELEM`, `EXEC`, `SENDKEYS`, `COOKIES`, `NEWPAGE`, `PAGESOURCE`, `SCREENSHOT`,
`KILL`, `FOCUS`

Notable: `LAUNCH` scans ports 9222–9229 for existing CDP window (idempotent, returns
`reused:true`); spawns with `--remote-debugging-port=N --user-data-dir=%TEMP%\aiapi-N`.

### `MSOfficeWin.cs` — Microsoft Office COM helper

Uses `dynamic` + `Marshal.GetActiveObject` — no PIA DLLs needed at compile time.
Target resolution: `word`, `excel`, `powerpoint`, `DOCNAME:<name>`, `PROC:<exe>`.

Commands: `LISTDOCS`, `QUERYTREE`, `READ`, `WRITE`, `SAVE`, `EXPORT`, `NEWDOC`,
`EXEC_MACRO`, `FORMAT`, `FOCUS`

`ComPathWalker.Eval(doc, canonicalPath)` — `body/para[3]` style paths walk the COM OM.
`CmdFormat` — pipe-delimited key=value formatting: `bold`, `italic`, `fontSize`, `color`,
`alignment`, `lineSpacing`, `indentLeftCm`, etc. (full spec in `docs/api/OFFICE_API.md`).

### `LibreOfficeWin.cs` — LibreOffice UNO socket helper

Connects via UNO inter-process socket (`--accept=socket,host=localhost,port=2002;urp;...`).
COM bridge (`com.sun.star.ServiceManager` ProgID) used as fallback for LO < 7.4.

Commands: `LISTDOCS`, `QUERYTREE`, `READ`, `WRITE`, `SAVE`, `NEWDOC`, `FORMAT`,
`RELAUNCH`, `LAUNCH`, `FOCUS`

`RELAUNCH` — saves all docs, kills `soffice.bin`, restarts with `--accept` flag, polls
socket for 12 s. `IsUnoSocketReachable(port)` — TCP probe via `BeginConnect/WaitOne`.

---

## Chapter 5 — Dashboard (`static/dashboard.html` + `dashboard.js`)

Single-page application served at `:3458`. Plain JS, no framework. ~4000 lines.

**Tabs:**
- **Status** — helper health, active sessions, server uptime
- **Settings** — all `dashboard-settings.json` keys; helper discovery scan; app templates
- **Security** — filter rule wizard, quick-edit table, audit log, admin session mode
- **Scenarios** — scenario editor (tabular step builder, ↑↓ reorder, undo/redo, linked filters)

**REST API used by dashboard:** (`docs/api/SERVER_API.md` has full reference)

| Endpoint | Purpose |
|---|---|
| `GET /api/listHelpers` | Discovered helper list + command counts |
| `GET /api/getHelperSchema?helper=X` | Full schema for helper X |
| `GET/POST /api/filters` | Security filter CRUD |
| `GET /api/config/security` | Security config summary |
| `POST /api/helpers/reload` | Hot-reload helper daemons |
| `POST /api/session/start` | Start test session recording |
| `POST /api/session/finish` | Finish session, get summary |
| `GET /api/appTemplates` | List loaded app template apps |
| `GET /api/appTemplates/{app}/scenarios` | Scenario list for app |
| `POST /api/appTemplates/{app}/scenarios/{id}/run` | Run named scenario |
| `GET /api/security/log` | Security audit log entries |

---

## Chapter 6 — Security model

> Full design: `docs/architecture/SECURITY_ARCHITECTURE.md`

Three independent layers:

1. **Server-side security filters** (`src/server/securityFilter.ts`)  
   Every MCP tool call is evaluated against `dashboard-settings.json` filter rules
   **before** reaching the helper. DENY wins, default DENY.
   Rule format: `ALLOW/DENY process → Helper::COMMAND/pattern`. Supports glob + `/regex/`.
   Admin token bypasses all filters.

2. **Binary integrity** (`SecurityLib.cpp` / `ValidateSelfOrExit`)  
   Each helper `.exe` calls `sec_validate_signature(selfPath)` before processing input.
   Exits with code 77 on hash mismatch. Hashes stored in `security/config.json` (signed).

3. **Helper auth handshake** (`HelperCommon.RunAuthHandshake`)  
   In-memory private key + HKDF session key; per-message HMAC-SHA256. (See ADR-002.)
   Gated by `SKIP_SESSION_AUTH=true` env var (dev bypass — removed before production).

---

## Chapter 7 — Test suite

```
tests/integration/
  test-full-stack-stdin.js   Full E2E tests (calc, notepad, browsers, Office, daemons)
    --self-hosted             Spawns server + polls until ready; shuts down after
    --rebuild-first           Runs build-all.ps1 before starting

src/**/*.test.ts             Jest unit tests (122 tests total across 6 suites):
  utils/wildcardMatch.test.ts      19 tests — glob + regex matching
  scenario/xmlScenarioLoader.test.ts  27 tests — substitute, execute, load, circular-ref
  utils/Logger.test.ts             18 tests — callbacks, logJSON
  security/loadCryptoCredentials.test.ts  13 tests — key load paths
  server/securityFilter.test.ts    40 tests — filter eval, admin bypass, exemptions
  server/mcpServer.integration.test.ts   39 tests — HTTP, JSON-RPC, MCP methods
  security/SessionTokenManager.test.ts   16 tests — token generate/validate
  server/mcpServer.perf.test.ts    7 tests  — latency, concurrency, memory

test-sessions/               Auto-recorded test session logs (JSONL + summary.json)
```

Run: `node node_modules/jest-cli/bin/jest.js --no-coverage` (or `npm test`).

---

## Architecture Decision Records

| ADR | Title |
|---|---|
| [ADR-001](decisions/ADR-001-helpercommon-compiled-in.md) | HelperCommon.cs: Compiled-In, Not a DLL |
| [ADR-002](decisions/ADR-002-helper-auth-in-memory-pk-hkdf.md) | Helper Auth: In-Memory PK + HKDF Session Key |
| [ADR-003](decisions/ADR-003-securitylib-native-cpp.md) | SecurityLib: Native C++ DLL / .so |
| [ADR-004](decisions/ADR-004-persistent-daemon-model.md) | Helper Daemon Model: Persistent Process |
| [ADR-005](decisions/ADR-005-unified-action-addressing.md) | Unified XPath-Style Action Addressing |
| [ADR-006](decisions/ADR-006-ai-consent-tier-system.md) | AI Consent Tier System |
| [ADR-007](decisions/ADR-007-universal-installer-idempotent-setup.md) | Universal Installer: Idempotent, Re-runnable Setup |

---

## Key source dependencies (simplified)

```
start-mcp-server.ts
  └── loadCryptoCredentials.ts → CertificateManager.ts
  └── mcpServer.ts
        ├── HelperRegistry.ts       ← spawns & autenticates helpers
        ├── securityFilter.ts       ← filter evaluation before dispatch
        ├── httpServerWithDashboard.ts ← REST API + SPA serving
        └── internalHandlers.ts     ← /api/_internal/users, roles, auth

HelperRegistry.ts
  └── HelperDaemon (inner class)
        ├── _auth handshake         ← ADR-002
        ├── request queue           ← ADR-004
        └── session recording

MCPServer.handleToolsCall()
  └── resolveCallArgs()
  └── runSecurityFilter()
  └── HelperRegistry.callCommand()
        └── HelperDaemon.call()
              └── stdin JSON line → helper .exe
```
