# TODO - Next Development Phase

## ⚡ CRITICAL: Command Alignment (PRIORITY 0)
**Goal:** Ensure ALL commands are aligned across MCP ↔ KeyWin.exe ↔ Security Filters

### Complete Command Coverage
- [x] Document all KeyWin.exe commands (see COMMAND_ALIGNMENT.md)
- [x] Map MCP methods to KeyWin commands
- [x] Update security filter UI with ALL commands organized by risk level:
  - [x] 🟢 Read Operations: {QUERYTREE}, {READ}, {LISTWINDOWS}, {GETPROVIDERS}
  - [x] 🟡 Modification: {SET}
  - [x] 🔴 UI Interaction: {CLICKID}, {CLICKNAME}, {CLICK}, {SENDKEYS}
  - [x] ⛔ Process Control: {LAUNCH}, {KILL}
- [x] Implement command detection in KeyWin.exe
  - [x] Add `DetermineCommandType()` function
  - [x] Add `ExtractParameter()` function
  - [x] Pass to security validation before execution
- [x] Implement filter validation in MCP server
  - [x] Add `validateSecurityFilter()` function
  - [x] Check filters before calling KeyWin.exe
  - [x] Return proper error codes when blocked
- [x] Create test scenarios for each command type
- [x] Document filter evaluation order (DENY wins, default DENY)

### Filter Rule Format
```
ACTION PROCESS → HELPER::COMMAND/PATTERN
```
Example: `ALLOW calc* → KeyWin.exe::{CLICKID}/num*Button`

### Privileged Mode (Bootstrap Problem Solution) ✅ MOSTLY COMPLETED
- [x] **Admin Session Token** (Primary method - IMPLEMENTED)
  - [x] Generate time-limited admin tokens with private key
  - [x] Admin token bypasses all security filters
  - [x] 15-minute expiry (configurable)
  - [x] Dashboard UI: "🔓 Enter Admin Mode" button
  - [x] Red warning banner when admin mode active
  - [x] Auto-logout on expiry
  - [x] Audit logging of all privileged operations
- [x] **Whitelisted Endpoints** (Implemented via authentication)
  - [x] `/api/config/*` accessible with session authentication
  - [x] Security configuration management doesn't trigger filters
  - [x] Requires proper dashboard authentication
- [x] **Emergency Override** (Failsafe recovery - NEWLY IMPLEMENTED)
  - [x] `--emergency-admin-mode` command-line flag
  - [x] Disables all security for recovery only
  - [x] Auto-disable after 1 hour
  - [x] Console warnings and logging
- [x] Documentation: See [docs/specs/PRIVILEGED_MODE.md](docs/specs/PRIVILEGED_MODE.md)

---

## 🧹 Project Organization & Cleanup (PRIORITY 1.2) ✅ COMPLETED
**Goal:** Refactor folder structure and clean up unused files for better maintainability

### Folder Structure Refactoring ✅ COMPLETED
- [x] **Root Directory Cleanup**:
  - [x] Move development/testing files to appropriate subdirectories
  - [x] Consolidate documentation files into `docs/` folder
  - [x] Organize configuration files into `config/` folder
  - [x] Create clear separation between source, build, and runtime files

- [x] **Archive Unused Files**:
  - [x] Review all files in root directory for current relevance
  - [x] Move obsolete/experimental files to `archive/` directory
  - [x] Archive old test files that are no longer maintained
  - [x] Archive deprecated configuration files
  - [x] Archive old documentation versions
  - [x] Clean up temporary files and build artifacts

- [x] **Implemented New Structure**:
  ```
  /
  ├── src/                    (Source code - kept as-is)
  ├── docs/                   (All documentation - CREATED)
  │   ├── api/               (API docs: API.md, KEYWIN_API.md, SERVER_API.md)
  │   ├── architecture/      (ARCHITECTURE.md, SECURITY_ARCHITECTURE.md)
  │   ├── guides/           (SERVER_GUIDE.md, AI_ASSISTANT_MANUAL.md, QUICK_REF.md)
  │   ├── specs/            (SCENARIO_FORMAT.md, ELEMENT_IDENTIFICATION.md, etc.)
  │   └── INDEX.md          (Documentation index)
  ├── config/                 (Configuration files - CREATED)
  │   ├── security/          (Moved from root security/)
  │   ├── scenarios/         (Moved from root scenarios/)
  │   └── templates/         (Configuration templates)
  ├── tests/                  (New - consolidated test files)
  │   ├── integration/       (test-*.js files moved here)
  │   ├── scenarios/         (test scenario files)
  │   └── security/          (security test files)
  ├── tools/, static/, scripts/  (Kept as-is)
  ├── archive/                (Expanded - added planning docs)
  ├── dist/                   (Build output)
  └── README.md, START_HERE.md, TODO.md (Essential root files only)
  ```

- [x] **File Cleanup Completed**:
  - [x] **Documentation**: Moved to `docs/` with proper categorization
    - [x] `API.md`, `KEYWIN_API.md`, `SERVER_API.md` → `docs/api/`
    - [x] `ARCHITECTURE.md`, `SECURITY_ARCHITECTURE.md` → `docs/architecture/`
    - [x] `SERVER_GUIDE.md`, `AI_ASSISTANT_MANUAL.md`, `QUICK_REF.md` → `docs/guides/`
    - [x] `SCENARIO_FORMAT.md`, `ELEMENT_IDENTIFICATION.md`, etc. → `docs/specs/`
    - [x] `README.md`, `START_HERE.md`, `TODO.md` → Kept in root
  - [x] **Configuration**: Moved to `config/`
    - [x] `security/` → `config/security/`
    - [x] `scenarios/` → `config/scenarios/`
  - [x] **Tests**: Consolidated into `tests/`
    - [x] `test-*.js` files → `tests/integration/`
  - [x] **Archived Items**:
    - [x] `DASHBOARD_PLAN.md`, `SETTINGS_UI_IMPLEMENTATION.md` → `archive/`

- [x] **Updated References**:
  - [x] Updated all imports/requires in source code
  - [x] Updated documentation links in mcpServer.ts
  - [x] Updated build scripts and configuration paths
  - [x] Updated security configuration file paths
  - [x] Updated dashboard default paths
  - [x] Updated test file imports

### Benefits Achieved
- **✅ Improved Navigation**: Clear separation of concerns accomplished
- **✅ Better Maintenance**: Much easier to find and update files
- **✅ Reduced Clutter**: Clean root directory with only essential files
- **✅ Scalability**: Structure now supports future growth
- **✅ Development Efficiency**: Logical organization speeds up development

---

## 🌐 Web Scraping & Network Tools (PRIORITY 1.5)\n**Goal:** Add fetch_webpage MCP tool with security filters\n\n### fetch_webpage Tool Implementation\n- [x] **Core Web Scraping**\n  - [x] Add `fetch_webpage` MCP tool method\n  - [x] Support HTTP/HTTPS URL fetching\n  - [x] Extract text content, HTML, or specific elements\n  - [x] Handle basic authentication and headers\n  - [x] Timeout and retry configuration\n  - [x] User-agent customization\n\n- [x] **Security Filters for Web Scraping**\n  - [x] Domain whitelist/blacklist filtering\n  - [x] Protocol restrictions (HTTP/HTTPS only by default)\n  - [x] Content-type filtering (text/html, application/json, etc.)\n  - [x] Response size limits (prevent DoS via large files)\n  - [x] Rate limiting per domain\n  - [x] Header injection prevention\n  - [x] Redirect validation and limits\n\n- [ ] **Advanced Network Protocol Support**\n  - [ ] SSH client for secure remote access\n  - [ ] FTP/SFTP for file transfer operations\n  - [ ] Telnet for legacy system access\n  - [ ] Raw TCP/UDP socket connections\n  - [ ] WebSocket support for real-time communication\n  - [ ] SMTP for email automation\n  - [ ] LDAP for directory service queries\n\n- [ ] **Security Configurations**\n  - [ ] Network access policy configuration\n  - [ ] Trusted certificate management\n  - [ ] Proxy server support with authentication\n  - [ ] VPN integration for secure connections\n  - [ ] Network monitoring and logging\n  - [ ] Firewall rule validation\n\n- [ ] **Integration with Existing Security**\n  - [ ] Extend security filter UI to include network operations\n  - [ ] Network command logging and audit trails\n  - [ ] Admin mode for network configuration changes\n  - [ ] Emergency network lockdown capability\n\n---\n\n## 🔐 Security & Configuration UI (PRIORITY 1)
**Goal:** User-friendly configuration and security management

### Testing Strategy
- [ ] **Unit Tests**: All backend services and utilities
- [ ] **Integration Tests**: MCP server endpoints, security checks
- [ ] **UI Tests**: Dashboard using AIAPI itself (dogfooding!)
  - [ ] Test configuration UI by automating browser interactions
  - [ ] Test scenario editor by creating/editing scenarios
  - [ ] Test security filters by modifying settings
  - [ ] Validate forms using DOM queries
- [ ] **End-to-End Tests**: Full workflows from UI to execution
- [ ] **Security Tests**: Penetration testing, token validation
- [ ] **Performance Tests**: Load testing, memory leaks

### Configuration UI
- [x] Create web-based configuration interface
- [ ] Settings Management:
  - [x] Location of scenarios folder (default: `./scenarios`)
  - [x] Location of security folder (default: `./security`)
  - [x] Location of key files (public.key.enc, private.key.enc)
  - [x] Location of helper executables with wildcard search (*.exe in path)
  - [x] Server ports (MCP, Dashboard)
  - [x] Session token expiry settings
  - [x] Log level configuration
  - [x] Enable/disable security features
  - [x] Current working directory (".") display and configuration
  - [x] Command-line parameter for initial working directory
- [ ] File Browsing (ENHANCED):
  - [x] Placeholder prompt for paths (basic - implemented)
  - [ ] Real native file/folder dialog integration (Windows API)
  - [x] Show current "." path prominently at top of settings
  - [ ] Remember last browsed locations per field
- [x] **Security Filters Configuration (TREE-BASED - INITIAL IMPLEMENTATION)**:
  - [x] **Filter Format**: `ALLOW/DENY process → Helper.exe::{COMMAND}/pattern` (display)
  - [x] **UI Components (initial)**:
    - [x] **+ Add Filter** button with multi-field wizard modal
    - [x] Edit/Delete toolbuttons per filter item
    - [x] Action dropdown (ALLOW/DENY)
    - [x] Process name field with window selector integration
    - [x] Helper dropdown (KeyWin.exe, BrowserWin.exe, OfficeWin.exe)
    - [x] Command dropdown with risk grouping (🟢🟡🔴⛔)
    - [x] Parameter pattern field with UI Tree browser integration
    - [x] Live filter preview as you type
    - [x] Search/filter rules list
    - [x] Validate All button (syntax check)
    - [x] Export filters to JSON file
    - [x] Save All Filters button (persists to `/api/filters`)
    - [x] Auto-save on add/edit/delete
    - [x] Load filters from server on page load
  - [x] **Backend API**:
    - [x] `GET /api/filters` — returns in-memory filter list
    - [x] `POST /api/filters` — saves filter list to server memory + disk (`dashboard-settings.json`)
    - [x] Filters load from `dashboard-settings.json` on server startup (survive restarts)
  - [ ] **Pending / Future**:
    - [ ] Persist filters to disk (write to config JSON file)
    - [ ] Pre-defined command templates dropdown
    - [ ] Parameter autocomplete from discovered helper schemas
    - [ ] Test filter button (dry-run simulation against known targets)
    - [ ] Import filters from JSON file
    - [ ] Criteria: window title matching, binary hash, process path
    - [ ] RegExp pattern support in pattern field
    - [ ] XPath-like UI tree path filtering
    - [ ] Office/Browser document structure filters
- [x] Old Security Filters (basic lists - implemented):
  - [x] Allowed executables list (textarea)
  - [x] Blocked executables list (textarea)
  - [x] Allowed file paths (textarea)
  - [x] Blocked file paths (textarea)
- [ ] Validation:
  - [x] Check if paths exist (implemented)
  - [x] Validate key file integrity (implemented)
  - [ ] Test security configuration
  - [ ] Preview effective permissions

### 🔌 Dynamic Helper API Discovery (CRITICAL ARCHITECTURE) ✅ COMPLETED
**Goal:** MCP Server is just a thin wrapper - .exe helpers define their own API

- [x] **Helper Schema Advertisement**:
  - [x] Each helper supports `--api-schema` flag returning JSON schema
  - [x] KeyWin.exe now outputs structured API schema with commands, parameters, and examples
  - [x] Schema format includes helper info, version, command definitions, and usage examples
  - [x] Works independently of session authentication (for discovery purposes)
  
- [x] **MCP Server Dynamic Loading** (Implemented — `src/server/HelperRegistry.ts`):
  - [x] On startup, scan helper discovery paths (`dist/win/`, `dist/browser/`, `dist/office/`)
  - [x] Execute each helper with `--api-schema` flag
  - [x] Parse JSON schema and build internal command registry
  - [x] Generate MCP tools dynamically from schemas (one tool per helper)
  - [x] Map MCP tool calls to helper commands via `callCommand()`
  - [x] Validate incoming parameters against schemas (enum on command names)
  - [x] Added `listHelpers` MCP tool — lists all discovered helpers
  - [x] Added `getHelperSchema` MCP tool — returns full schema for a helper
  
- [x] **Settings UI Integration** (partial — see Dashboard Enhancements):
  - [x] Helper Discovery section added to Settings tab in dashboard
  - [x] Scan button + auto-scan on load (`/api/listHelpers` public endpoint)
  - [x] List discovered helpers with versions and command count
  - [x] Enable/disable toggle per helper (`/api/helpers/toggle` + `/api/helpers/disabled`)
  - [x] View schema button (full command details popup via `/api/getHelperSchema`)
  - [x] Commands tab showing inline command list (toggle per helper card)
  
- [ ] **Security Filter Integration**:
  - [ ] Use schemas to validate filter syntax
  - [ ] Autocomplete command names from discovered schemas
  - [ ] Parameter validation against schema types
  - [ ] Context-aware filter suggestions
  
- [x] **Benefits Achieved**:
  - [x] ✅ Foundation for pluggable helper architecture
  - [x] ✅ Self-documenting helper capabilities
  - [x] ✅ Automatic API discovery without code changes

### Interactive Scenario Editor
- [ ] Visual scenario builder (no syntax knowledge required)
- [ ] Features:
  - [ ] Drag-and-drop step builder
  - [ ] IntelliSense-style autocomplete for:
    - [ ] Action types (launchProcess, clickElement, sendKeys, etc.)
    - [ ] Parameter names
    - [ ] Valid parameter values
  - [ ] Context-aware suggestions:
    - [ ] Available providers
    - [ ] Target process names from running apps
    - [ ] Element IDs from queried UI trees
  - [ ] Step templates:
    - [ ] Common patterns (open app, fill form, etc.)
    - [ ] Parameterized templates
  - [ ] Real-time validation:
    - [ ] Required parameters highlighted
    - [ ] Type checking
    - [ ] Dependency validation (e.g., target must be launched first)
  - [ ] Live preview:
    - [ ] JSON output preview
    - [ ] Execution flow visualization
  - [ ] Test runner:
    - [ ] Run individual steps
    - [ ] Debug mode with breakpoints
    - [ ] Variable inspection
- [ ] UI Components:
  - [ ] Action palette (searchable list of all actions)
  - [ ] Parameter forms (type-specific inputs)
  - [ ] Step reordering (drag handles)
  - [ ] Copy/paste/duplicate steps
  - [ ] Undo/redo support
- [ ] Integration:
  - [ ] Save/load from scenarios folder
  - [ ] Import existing .json scenarios
  - [ ] Export to .json format
  - [ ] Version control friendly output

### Installer & Deployment
- [ ] Windows Installer:
  - [ ] MSI installer package
  - [ ] Install to Program Files
  - [ ] Create Start Menu shortcuts
  - [ ] Desktop shortcuts (optional)
  - [ ] Windows Service installation (optional)
  - [ ] Automatic security setup wizard
  - [ ] Generate key files on first run
  - [ ] Sign config.json automatically
- [ ] Installer Features:
  - [ ] Select installation directory
  - [ ] Choose components (server, dashboard, tools)
  - [ ] Port configuration during install
  - [ ] Create Windows Firewall rules
  - [ ] Register file associations (.aiapi-scenario)
  - [ ] Add to PATH (optional)
- [ ] Uninstaller:
  - [ ] Clean removal of all files
  - [ ] Option to keep scenarios and config
  - [ ] Remove firewall rules
  - [ ] Remove service
- [ ] Auto-updater:
  - [ ] Check for updates on startup
  - [ ] Download and install updates
  - [ ] Backup before update
  - [ ] Rollback on failure

### Dashboard Enhancements
- [ ] Add "Settings" tab with configuration UI
- [ ] Add "Scenario Editor" tab
- [ ] Add "Security" tab:
  - [ ] View current security config
  - [ ] Edit security filters
  - [ ] Test security rules
  - [ ] View security logs/violations
- [x] Add "Status" indicators:
  - [x] Security status (enabled/disabled, valid keys) — in header status bar
  - [x] Key expiry warnings — ⚠️ indicator when keys missing
  - [x] Helper count indicator — shows N loaded helpers
  - [ ] Configuration issues panel (errors/warnings listing)

---

## 🎯 Browser Automation (PRIORITY 2)
**Goal:** Control web browsers with DOM structure access.
Continue in same priority after this section:
↳ **🌐 Cross-Platform Browser DOM Access** — LAUNCH command, screen-reader trick, ISimpleDOMNode
↳ **🎮 Unified Input/Output Control Model** — KEYDOWN/UP/PRESS, RIGHTCLICK, CHECK, unified tree schema
↳ **🗺️ Unified Action Addressing** — XPath security filter path syntax

### BrowserWin.exe Helper
- [x] Create `tools/browser/BrowserWin.cs` (CDP-based, pure .NET 4.5, no NuGet)
- [x] **HelperRegistry protocol** — `--listen-stdin` pipe mode ✅
- [x] **QUERYTREE node schema aligned with KeyWin** — `{id,type,name,position,properties,actions,value,children}` ✅
- [x] **WebSocket masking** — RFC 6455; fixed ✅
- [x] **`targetDescription`** in `--api-schema` ✅
- [x] Support multiple browsers (target `browser` or `browser:port`):
  - [x] Brave (`brave:9222`) ✅
  - [x] Edge (`msedge:9223`) ✅
  - [x] Chrome (`chrome:9224`) ✅
  - [x] Firefox — UIA fallback (full ARIA tree, 11+ form nodes) ✅; CDP via `--remote-debugging-port` ✅
  - [ ] Internet Explorer — dead; Win32/MSAA via KeyWin.exe only
- [x] Core commands (CDP path + UIA fallback):
  - [x] `{NAVIGATE:url}` — CDP + UIA (Ctrl+L) ✅
  - [x] `{QUERYTREE}` / `{QUERYTREE:depth}` — CDP (full DOM) + UIA (accessibility tree) ✅
  - [x] `{CLICKID:selector}` — CDP (`querySelector`) + UIA (`FocusOrClickElement`) ✅
  - [x] `{CLICKNAME:text}` — CDP (text + label `for=` + aria-label) + UIA (Name / LabeledBy) ✅
  - [x] `{FILL:selector:value}` — CDP (`el.value` + events) + UIA (`FillElement` / `ValuePattern` / `LabeledBy`) ✅
  - [x] `{READELEM:selector}` — CDP (querySelector + label fallback) + UIA (ValuePattern / LabeledBy) ✅
  - [x] `{EXEC:js}` — CDP only ✅
  - [x] `{SENDKEYS:keys}` — UIA (SendInput to render widget) ✅
  - [x] `{COOKIES:get|clear|set:...}` ✅
  - [x] `{LISTBROWSERS}` — Chrome/Brave/Edge/Opera/Firefox ✅
  - [x] `{NEWPAGE}` / `{NEWPAGE:url}` — CDP (PUT /json/new) + UIA (Ctrl+T) ✅
  - [x] `{KILL}` ✅
  - [x] `{SCREENSHOT}` ✅ DONE: CDP `Page.captureScreenshot` via raw TCP WebSocket — saves PNG to file
    (reuses existing `BuildWsFrame`/`TryGetActiveTarget` infrastructure; 32 MB response buffer)
  - [ ] Alert/popup handling — needs WebSocket CDP event loop
- [x] **`{LAUNCH:browser[:visible|headless]}`** ✅ DONE + FULL-STACK TESTED: start browser with `--remote-debugging-port`
  - [x] Scans ports 9222–9229 for existing CDP window; returns `reused:true` if found ✅
  - [x] If not found: spawns `browser.exe --remote-debugging-port=N --user-data-dir=%TEMP%\aiapi-N` ✅
  - [x] `visible` (default) and `headless` (`--headless=new`) modes supported ✅
  - [x] Waits up to 6 s for CDP; returns `{"success":true,"port":N,"reused":false/true}` ✅
  - [x] AI schema text in `OutputApiSchema()` explains CDP unlock ✅
  - [x] Scans Program Files, LocalAppData, registry paths for browser executables ✅
  - [x] Idempotency test: 2nd LAUNCH call returns `reused:true` (all 4 browsers) ✅
- [x] **`{PAGESOURCE}`** ✅ DONE: raw HTML without CDP (UIA clipboard trick)
  - [x] Ctrl+U → Ctrl+A → Ctrl+C → read clipboard → Ctrl+W to close view-source tab ✅
  - [x] Returns original HTTP source; works on every browser, no debug port needed ✅
  - [x] Added to `OutputApiSchema()` (was missing from schema v1.1.0; now in v1.2.0) ✅
- [x] Integration:
  - [x] CDP over raw masked TCP WebSocket (no NuGet) ✅
  - [x] `--api-schema` with `targetDescription` ✅
  - [x] Security filter applied by MCP server ✅
  - [x] JSON output matching KeyWin.exe (`{"success":...}`) ✅
  - [ ] Session token authentication (SKIP_SESSION_AUTH currently in env)

### WebUIProvider Enhancement
- [x] Update `src/providers/webUIProvider.ts` to use BrowserWin.exe
- [x] Add browser selection (edge, chrome, brave, firefox)
- [x] DOM tree querying with depth control
- [x] Element interaction via selectors
- [x] JavaScript execution capability
- [x] Screenshot capture

### Test Scenarios
- [ ] `scenarios/browser-google-search.json`
- [ ] `scenarios/browser-form-fill.json`
- [ ] `scenarios/browser-dom-navigation.json`

---

## � Unified Helper Communication Architecture (PRIORITY 1.5)
**Goal:** All helpers (KeyWin, BrowserWin, OfficeWin, future) share identical wire protocol
across all transports. Remove unsafe env-var credential passing. Enable persistent daemons
for zero-spawn-overhead operation.

### Transport Modes (naming convention — agreed)

Each helper supports one or more via CLI flags (combinable):

| Flag | Behaviour |
|---|---|
| `--listen-stdin` | Read JSON lines from stdin, write JSON lines to stdout. **Exit on EOF** (caller controls lifetime). |
| `--listen-stdin --persistent` | Same but **ignore EOF** — only exit on `{"action":"_exit"}` or OS signal (SIGTERM / Ctrl-C). |
| `--listen-pipe=\\.\pipe\Name` | Named pipe server — Windows, multi-caller, survives caller disconnects. |
| `--listen-port=N` | HTTP JSON-RPC on `127.0.0.1:N` (loopback only). |
| *(combined)* | `--listen-pipe=... --listen-port=N` runs both on two threads, one process. |
| *(none / current)* | One-shot: `--inject-mode=direct tmpFile` or `--target=... --action=...` |

### Built-in Actions (underscore prefix, reserved namespace)

All transports handle these before routing to the helper's own command dispatch:

```json
{"action":"_schema"}
{"action":"_auth","token":"...","secret":"...","securityConfig":"/path/to/security/config.json"}
{"action":"_exit"}
```

- `_schema` — replaces the `--api-schema` CLI flag; returns the same JSON capabilities doc
- `_auth` — first-message auth handshake (replaces env-var credentials; see Security section)
- `_exit` — clean shutdown (only meaningful in `--persistent` mode or daemon)

### Wire Format (identical JSON fields across all transports)

```json
{"id":"req-1","target":"brave:9222","action":"{NAVIGATE:https://example.com}"}
{"id":"req-1","success":true,"result":"..."}
```

- `id` field optional but recommended for response correlation
- Same field names regardless of transport (stdin, pipe, HTTP, or direct CLI args)
- HTTP transport also accepts `Authorization: Bearer <token>` header for auth

### Things to Remove / Replace

- [ ] **`MCP_SESSION_TOKEN` env var** — credential lives in process environment, inherited by
  all child processes, visible to same-user debuggers. Replace with `_auth` first message.
- [ ] **`MCP_SESSION_SECRET` env var** — same problem as above.
- [ ] **`--token=` / `--secret=` CLI args** — visible in process listing (`tasklist /v`, Process
  Explorer). Replace with `_auth` message.
- [x] **`--inject-mode=direct tmpFile`** — ✅ DONE: replaced by `--listen-stdin` pipe in
  `HelperRegistry.callCommand()`. Temp file, `fs.writeFileSync`, and `os.tmpdir()` removed.
- [ ] **`--api-schema` CLI flag** — replace with `{"action":"_schema"}` (unified with wire
  protocol; flag can remain as alias for backwards compatibility during transition).
- [ ] Keep: `SKIP_SESSION_AUTH=true` env var — not a credential, just a dev/test bypass flag,
  acceptable in env.

### HelperRegistry.ts Upgrade Path

- [x] **Step 1 (quick win)** ✅ DONE + FULL-STACK TESTED: `callCommand()` uses `--listen-stdin` pipe.
  - `HelperRegistry.ts`: removed `os` import, removed `tmpFile` write/unlink, spawns with
    `['--listen-stdin']`, writes JSON line to stdin, closes stdin (EOF triggers exit).
  - `BrowserWin.cs`: `--listen-stdin` branch added at top of `Main()` — calls
    `HelperCommon.RunStdinListener()`, dispatches by re-invoking `Main([target,action])`.
  - `KeyWin.cs`: same pattern — `--listen-stdin` branch + `HelperCommon.RunStdinListener()`.
  - `tools/common/HelperCommon.cs` created and compiled into both helpers.
    - Bug fixed: `Console.InputEncoding = UTF8` throws `IOException` when stdin is a pipe
      on .NET 4.0 → replaced with `StreamReader(Console.OpenStandardInput(), UTF8)` +
      `Console.SetOut(StreamWriter(Console.OpenStandardOutput(), UTF8))`.
  - Build script updated: `$commonSrc` added to both KeyWin and BrowserWin compile lines.
  - **Full-stack MCP test: 20/20 passed** (`test-full-stack-stdin.js`):
    - KeyWin LISTWINDOWS ✅ | BrowserWin LISTBROWSERS ✅
    - Calculator: launched → found "Kalkulačka" (Czech) → QUERYTREE/CLICKID/READ
      → result = "32" ✅
    - Notepad: launched → QUERYTREE → SENDKEYS → READ round-trip ✅
    - Brave :9222 READ+QUERYTREE ✅ | Edge :9223 READ+QUERYTREE ✅ | Chrome :9224 READ+QUERYTREE ✅
    - Unicode (Czech window titles) handled correctly via UTF-8 StreamReader ✅
- [x] **Step 2 (perf win)** ✅ DONE + FULL-STACK TESTED: `--listen-stdin --persistent` daemon per helper
  - `HelperRegistry.ts` rewritten with new `HelperDaemon` class: sequential promise queue,
    string-aware JSON extractor (handles `{}` inside strings), auto-restart on crash
  - `HelperRegistry.discoverHelpers()` starts daemon immediately after schema parse; no extra spawn
  - `HelperRegistry.callCommand()` routes through daemon — zero process-spawn overhead per call
  - `HelperRegistry.shutdownAll()` sends `{"action":"_exit"}` to all daemons
  - `mcpServer.stop()` calls `shutdownAll()` first, then closes HTTP server
  - ⚠️ Daemons lock `.exe` files — server must be stopped before rebuilding (see START_HERE.md)
  - **117/0 tests passing** with persistent daemons ✅
- [ ] **Step 3 (future)**: Named-pipe transport for multi-client access
  - Allows external scripts / other processes to call helpers directly
  - Still goes through same security filter + `_auth` flow

---

## 🧩 HelperCommon.cs — Shared Source (PRIORITY 1.5)
**Goal:** Share transport + dispatch + auth boilerplate across all .exe helpers without
introducing a separately loadable DLL (which would break binary hash integrity).

### Design Decision: Compiled-In, NOT a DLL

- A separate `HelperCommon.dll` could be swapped without changing the `.exe` hash → **defeats
  binary integrity verification**
- Solution: `tools/common/HelperCommon.cs` is added to each helper's `csc` compile line
- Result: code is baked into each `.exe` — changing it changes the hash

### File Location

```
tools/
  common/
    HelperCommon.cs    ← shared source, compiled into every helper .exe
  win/
    KeyWin.cs          ← adds HelperCommon.cs to its compile command
  browser/
    BrowserWin.cs      ← same
  office/
    OfficeWin.cs       ← same (future)
```

### HelperCommon.cs Contents (current state)

- [x] `HcJson.GetString(json, key)` — minimal JSON string extractor (\uXXXX, all escape seqs)
- [x] `HcJson.EscapeStr(s)` — JSON string escaper
- [x] `HcJson.Err(id, msg)` — build `{"success":false,"error":"..."}` response
- [x] `HelperCommon.HasFlag(args, flag)` — case-insensitive flag lookup
- [x] `HelperCommon.RunStdinListener(persistent, dispatch, getSchema)` — full stdin loop
  with `_schema`, `_exit` built-ins; one-shot (persistent=false) and loop (persistent=true)
- [ ] `RunHttpListener(int port)` — HTTP/1.1 minimal server (System.Net.HttpListener)
- [ ] `RunNamedPipeListener(string pipeName)` — Windows named pipe server thread
- [ ] `AuthState` class — tracks `_auth` state, securityConfig path, sessionKey
- [ ] `ParseArgs(string[] args)` → unified flag parser for `--listen-*`, `--target=`, `--action=`

### Each Helper's Responsibilities (current state)

Currently helpers handle dispatch inline (re-invoke `Main([target,action])`).
The target future state is for each helper to implement a clean `ExecuteCommand(target, action)`
and `GetSchema()` that HelperCommon calls — but the current approach works and is backward-compat.

- [ ] Refactor `KeyWin.cs`: extract dispatch into `ExecuteCommand(target, action)` method
- [ ] Refactor `BrowserWin.cs`: extract `GetSchema()` returning string; `DispatchForStdin`
  to call `ExecuteCommand()` directly (avoids Main() re-invoke overhead)
- [x] Update `scripts/build-win-tools.ps1` to include `HelperCommon.cs` in each compile line ✅

---

## 🛡️ Shared Security Library (PRIORITY 1.5)
**Goal:** Single security enforcement point used by ALL helpers, independently of the MCP
server. Ensures security filters apply even to direct helper invocations that bypass MCP.

### Why a Native C++ DLL (not C#)

- Must work cross-platform (future Linux helpers in other languages)
- C# helpers load it via P/Invoke; future Python/Node helpers via ctypes/N-API
- Crypto primitives (SHA-256, RSA verify, AES-GCM) available without NuGet on all platforms
- DLL's own hash stored in `security/config.json` — helpers verify DLL hash BEFORE loading

### API Surface

```cpp
// All functions: return 0 = success, negative = error code
int  sec_load(const char* configPath, const char* password);
int  sec_validate_signature(const char* exePath);   // verify exe SHA-256 vs stored hash
int  sec_validate_action(                           // check security filter rules
       const char* action,
       const char* target,
       const char* processName,
       const char* processPath,
       const char* processHash,
       int         processId
     );  // returns: SEC_ALLOW(1) | SEC_DENY(0) | SEC_ASK(2) | SEC_ERROR(<0)
int  sec_get_session_key(uint8_t* outKey, int keyLen);  // derive session key post-auth
void sec_unload();
```

### Enforcement Rule

- Every helper calls `sec_validate_action()` BEFORE executing any command
- If result is `SEC_DENY` → return `{"success":false,"error":"SECURITY_FILTER_DENY"}` **without
  executing the action** — cannot be overridden by caller
- `SEC_ASK` → surface to user (future: OS dialog); currently treat as DENY for safety
- MCP server ALSO applies filters (defense in depth; direct helper calls bypass MCP)

### Implementation Tasks

- [ ] Create `tools/common/security/SecurityLib.cpp` + `SecurityLib.h`
- [ ] Implement `sec_load()`: parse `security/config.json`, verify `config.json.sig` with
  embedded/trusted public key, decrypt `private.key.enc` (PBKDF2 + AES-256-GCM — reuse
  same key format as `CertificateManager.ts`)
- [ ] Implement `sec_validate_signature()`: SHA-256 the exe file, compare to hash in
  `security/config.json`
- [ ] Implement `sec_validate_action()`: evaluate security filter rules from loaded config
  against action + process metadata
- [ ] Build as `.dll` (Windows) / `.so` (Linux/macOS) from build scripts
- [ ] P/Invoke declarations in `HelperCommon.cs` for C# callers
- [ ] Store DLL's own SHA-256 hash in `security/config.json` (verified before loading)
- [ ] Update `scripts/build-win-tools.ps1` to also compile `SecurityLib.dll`

---

## 🔐 Helper Authentication — In-Memory PK + HKDF Session Key (PRIORITY 1.5)
**Goal:** Replace env-var HMAC secret passing with a cryptographically sound scheme where
the decrypted private key **never touches persistent storage** in its raw form, is passed
to helpers exclusively over the in-process stdin pipe, and both parties independently
derive the same temporary session key via HKDF — the session key is never transmitted.

### Design Principles

- **Private key decrypted once in MCP server memory** — password entered by user at startup
  (or read from Windows DPAPI / Credential Manager — never stored plaintext)
- **Raw PK material sent to helper via stdin pipe only** — pipe is in-process memory;
  never hits disk, never appears in process listing, not in environment variables
- **No silent/bypass auth is possible** (and this is intentional) — no matter whether the
  call is one-shot or persistent, the helper MUST complete the `_auth_hello` → `_auth`
  exchange as the very first two messages on stdin before accepting any command.
  The raw PK material cannot safely travel on the command line (4096-bit arg length +
  visible in `tasklist /v` / Process Explorer), so the authentication entry point is the
  stdin pipe only. Practically: `--inject-mode=direct tmpFile` is replaced by a stdin pipe
  that begins with the auth exchange; `--target=... --action=...` CLI shortcuts remain
  available only in dev/debug mode with `SKIP_SESSION_AUTH=true` (existing flag).
- **Session key derived independently on both sides** — neither side transmits the key;
  both compute `HKDF(private_key_bytes, serverNonce || helperNonce, "AIAPI-v1-session")`
  and get identical output. Classic shared-secret sub-key derivation.
- **Helper has zero persistent state** — no key files needed on its side
  (it receives everything in the `_auth` message)

### Auth Handshake Flow

```
[Helper starts]                           [MCP Server]
   │                                          │
   │  1. sec_validate_signature(selfPath)      │  (MCP server has already decrypted
   │     — verify own exe + DLL hashes         │   private.key.enc on startup,
   │     BEFORE reading any stdin              │   password came from user/DPAPI)
   │                                          │
   ├─ {"action":"_auth_hello",           ───>  │
   │   "helperNonce":"<base64 32B>",            │
   │   "exeHash":"<sha256-hex>",                │
   │   "dllHash":"<sha256-hex>"}               │
   │                                          │
   │                      MCP: verify exeHash │
   │                        against stored    │
   │                        config.json entry │
   │                                          │
   │<─ {"action":"_auth",               <───  │
   │    "pk":"<base64-pkcs8-raw>",             │  raw decrypted RSA private key bytes
   │    "serverNonce":"<base64 32B>",          │  never written to disk
   │    "securityConfig":"<path>",             │
   │    "helperExePath":"<path>"}              │
   │                                          │
   │  2. sec_load(pk_bytes, configPath)        │
   │     — verify config.json.sig with pk      │
   │     — load security filter rules          │
   │  3. Derive session key:                   │
   │     HKDF-SHA256(                          │  MCP does the same:
   │       ikm  = pk_bytes,                    │  HKDF-SHA256(
   │       salt = SHA256(serverNonce           │    ikm  = pk_bytes,
   │               || helperNonce),            │    salt = SHA256(serverNonce
   │       info = "AIAPI-v1-session"           │            || helperNonce),
   │     ) → sessionKey (in memory only)       │    info = "AIAPI-v1-session"
   │                                          │  ) → same sessionKey
   ├─ {"action":"_auth_ok"}             ───>  │
   │                                          │
   │  All further messages include:            │
   │  "hmac":"HMAC-SHA256(sessionKey, body)"   │
```

### What Each `_auth` Step Achieves

1. **Helper verifies its own exe + DLL structure** (`sec_validate_signature`) — runs first,
   before accepting *any* input; tampered binary refuses to authenticate
2. **Helper verifies security config integrity** — `config.json.sig` checked with the
   received private key (no separate public key file needed on helper's side)
3. **Both derive the same session key** — HKDF over the shared PK material + both nonces;
   the session key is never transmitted; subsequent message HMACs use it

### Why This Is Better Than the Old Challenge-Response Design

| Old (challenge-response) | New (in-memory PK + HKDF) |
|---|---|
| Helper needs `public.key.enc` on disk | Helper needs no key files |
| RSA sign + verify per handshake | One HKDF call (faster) |
| Session secret still had to travel somewhere | Session key never transmitted |
| Helper could be targeted independently if pubkey on disk | Helper useless without live MCP pipe |

### Implementation Tasks

- [ ] `CertificateManager.ts`: add `getRawPrivateKeyBytes()` — returns decrypted PKCS#8 bytes
  after password unlock; keep in a `Buffer` in memory, never write to disk
- [ ] `HelperRegistry.ts`: spawn helper, wait for `_auth_hello`, verify `exeHash` against
  `security/config.json`; send `_auth` with raw PK bytes + serverNonce
- [ ] `HelperRegistry.ts`: remove `MCP_SESSION_TOKEN`, `MCP_SESSION_SECRET`, `SKIP_SESSION_AUTH`
  env vars (replace with in-pipe auth)
- [ ] `HelperCommon.cs`: implement `RunAuthHandshake()` — sends `_auth_hello`, receives
  `_auth`, calls `sec_load()`, derives `sessionKey` via HKDF
- [ ] `SecurityLib.cpp`: implement `sec_hkdf_sha256(pk, pkLen, salt, saltLen, info, out, outLen)`
  (or use Windows `BCryptDeriveKeyPBKDF2`/`BCryptKeyDerivation` for HKDF)
- [ ] All subsequent command messages include `"hmac":"HMAC-SHA256(sessionKey, JSON-body)"`;
  helper rejects messages with invalid HMAC
- [ ] MCP server password entry: prompt at startup; optionally persist (encrypted) via Windows
  DPAPI `ProtectedData.Protect(entropy:machineSID)` so restarts don't require re-entry
- [ ] Add `sec_validate_signature_self()` to `SecurityLib` — called from `main()` before any
  stdin read; exit code `SECURITY_TAMPER` (exit 77) if hash mismatch

---

## 🗺️ Unified Action Addressing — XPath-Style UI Path Syntax (PRIORITY 2)

> ⚠️ **PLANNED — NOT YET IMPLEMENTED.** The current system uses bare `{CMD:param}` tokens
> for commands and a freetext pattern field in security filter rules. Everything in this
> section is a design spec and a list of work items. Nothing here works yet.

**Goal:** A single, uniform addressing scheme that identifies *where* to act (across Win32
trees, browser DOM, Office document model, x/y coordinates, keystrokes) AND *what* to do —
usable both as the `action` parameter in helper commands AND as the pattern in security
filter rules. Backwards-compatible: `{CMD:param}` shorthands will continue to work as
aliases.

### Full Address Format

```
//[HelperGlob]//[ProcessFilter]//[TreePath...]//action:[Verb]/[Params...]
```

All four parts are optional in different contexts:
- **Security filter rule**: all four present (defines scope + what is allowed/denied)
- **Helper command target**: only `[TreePath...]//action:[Verb]/[Params...]` (process already
  known from the `target` field)
- **CLI direct invocation**: `--action=//mainWindow/GroupBox1//action:click`

### Segment Reference

| Segment kind | Syntax | Examples |
|---|---|---|
| **Helper selector** | `//HelperGlob` (first `//` only) | `//Keys*.exe`, `//Browser*.exe`, `//Office*.exe` |
| **Process filter** | `//[key:val & key:val]` | `//[SHA512:abc123 & ProcName:calc*.exe & ProcPath:C:\Windows\*]` |
| Named child | `//name` | `//mainWindow1`, `//GroupBox1`, `//ButtonOK` |
| Index child | `//[n]` | `//[0]`, `//[2]` (nth child) |
| By attribute | `//[attr=val]` | `//[class=submitBtn]`, `//[id=btn-ok]` |
| Wildcard (one level) | `//*` | any single node |
| Deep wildcard | `//**` | any subtree depth |
| XPath predicate | `//name(xpath:expr)` | `//li(xpath:last())`, `//td(xpath:[@role='cell'])` |
| Browser tab / frame | `//[tab=n]`, `//[frame=name]` | `//[tab=0]//document` |

**Process filter keys** (inside `[...]`, combined with `&`):

| Key | Matches |
|---|---|
| `ProcName:pattern` | Process executable name glob |
| `ProcPath:pattern` | Full process path glob |
| `SHA256:hex` | SHA-256 hash of exe |
| `SHA512:hex` | SHA-512 hash of exe |
| `PID:n` | Exact process ID |
| `HWND:hex` | Window handle |
| `WindowTitle:pattern` | Window title glob |

**Action verbs** (after `//action:`):

| Verb | Parameters | Description |
|---|---|---|
| `click` | `/x:N/y:N` or tree path | Left click at coordinate or element |
| `rightclick` | same | Right click |
| `dblclick` | same | Double click |
| `hover` | `/x:N/y:N` or tree path | Mouse move, no click |
| `keypress` | `/Key1/Key2` (sequence) or `/Key1+Key2` (chord) | Keyboard input |
| `keydown` | `/ModKey` then separate `keypress` | Hold modifier key |
| `keyup` | `/ModKey` | Release modifier |
| `read` | tree path | Read displayed text / value |
| `fill` | `/value:text` | Set input field value |
| `exec` | `/js:expression` | Execute JS (browser only) |
| `scroll` | `/dx:N/dy:N` | Scroll by pixels |
| `check` / `uncheck` | tree path | Toggle checkbox |

### Examples

```
# Win32 coordinate click
//[ProcName:calc*.exe]//action:click/x:320/y:240

# Win32 tree-path click
//[ProcName:calc*.exe]//mainWindow/ButtonPanel//action:click/buttonNumPad7

# Right-click via coordinate
//[ProcName:notepad.exe]//action:rightclick/x:100/y:200

# Key chord (Ctrl+A)
//[ProcName:notepad.exe]//action:keypress/Ctrl+A

# Key sequence (Ctrl+Alt+Del style: hold modifier, then keypress)
//[ProcName:winlogon.exe]//action:keydown/Ctrl+Alt  # hold
//[ProcName:winlogon.exe]//action:keypress/Del       # strike
//[ProcName:winlogon.exe]//action:keyup/Ctrl+Alt     # release

# Read value from Win32 control
//[SHA256:abc123&ProcName:myapp.exe]//mainWindow/GroupBox1/ValueEdit1//action:read

# Browser DOM click (tab 0, navigate shadow DOM, XPath predicate)
//Browser*.exe//[ProcName:brave.exe]//[tab=0]//document/**/form/fieldset/ul/li(xpath:last())/button//action:click

# Browser fill
//Browser*.exe//[ProcName:msedge.exe]//[tab=0]//document//#username//action:fill/value:admin

# Browser execute JS
//Browser*.exe//action:exec/js:document.title

# Excel cell read
//Office*.exe//[ProcName:EXCEL.EXE]//Sheet1//cells/col:F/row:3456//action:read

# Excel cell fill
//Office*.exe//[ProcName:EXCEL.EXE]//Sheet1//cells/col:F/row:3456//action:fill/value:HelloWorld

# Word paragraph click
//Office*.exe//[ProcName:WINWORD.EXE]//Document1//body/paragraph(xpath:[3])//action:click

# Full security filter rule (process + helper + path + action all specified)
ALLOW //Keys*.exe//[SHA256:deadbeef&ProcName:calc*.exe&ProcPath:C:\Windows\*]//mainWindow//*//action:click
DENY  //Browser*.exe//[ProcName:brave.exe]//action:exec/*
ALLOW //Browser*.exe//[ProcName:brave.exe]//[tab=0]//document//**//action:read
```

### Parsing Rules

- Segments split on `//` (double-slash); single `/` is used within action params
- First segment starting with `//` and NOT `[` and matching `*.exe` glob pattern → helper
  selector; if it starts with `[` → process filter; otherwise → tree step
- `action:` prefix on a segment marks the transition from tree path to action
- Predicates in `(xpath:...)` are passed through to the underlying query engine
- Coordinates `x:N/y:N` are always integers; `col:A-Z+` or `col:N` for spreadsheet columns
- `+` inside action params = chord (simultaneous); `/` between keys = sequence (successive)

### Implementation Tasks

**Core parser + dispatch (required for any of this to work):**
- [ ] Define formal ABNF grammar for the address syntax in `docs/specs/ACTION_ADDRESS.md`
- [ ] Implement parser in `HelperCommon.cs`: `ParseAddress(string addr)` → `AddressNode[]`
- [ ] Map `AddressNode` types: `HelperSelector`, `ProcessFilter`, `TreeStep`, `ActionStep`
- [ ] Update `KeyWin.cs` command dispatch to accept full address strings (not just bare
  `{CMD:param}` tokens) — `{CMD:param}` shorthands kept as aliases
- [ ] Update `BrowserWin.cs` similarly — map tree path segments to CSS selector / CDP node ID
- [ ] `BrowserWin.cs`: handle `(xpath:...)` predicates via CDP `DOM.performSearch` + XPath
- [x] `KeyWin.cs`: handle `action:keydown` / `action:keyup` for stateful modifier key input

**Security filter engine:**
- [ ] Update filter rule storage format to the new address syntax (migrate existing rules)
- [ ] Update filter evaluation engine: `MatchAddress(rule, incomingAddress)` — segment-by-
  segment glob/predicate matching (process filter keys, tree path globs, action verb match)
- [ ] Update filter rule editor UI: replace freetext pattern field with structured
  address-builder (helper, process, tree path, action each in separate validated inputs)

**Grammar manifest (each helper advertises what it understands):**
- [ ] Add `"addressGrammar"` array to `--api-schema` / `_schema` output per helper, listing
  which segment types and action verbs each helper recognises, e.g.:
  ```json
  "addressGrammar": [
    {"segment":"ProcessFilter", "keys":["ProcName","ProcPath","SHA256","PID","HWND","WindowTitle"]},
    {"segment":"TreeStep",      "types":["NamedChild","IndexChild","AttrFilter","Wildcard","DeepWildcard"]},
    {"segment":"Action",        "verbs":["click","rightclick","dblclick","hover","keypress",
                                         "keydown","keyup","read","fill","scroll","check","uncheck"]}
  ]
  ```
- [ ] `BrowserWin.cs` additionally advertises `"verbs":[..."exec"...]` and
  `"treeExtras":["tab","frame","xpath-predicate"]`
- [ ] `OfficeWin.cs` (future) advertises `"treeExtras":["cells","col","row","sheet"]`
- [ ] `HelperRegistry.ts`: expose merged grammar via `getHelperSchema` MCP tool response

**Validation tool (LOW PRIORITY):**
- [ ] `HelperCommon.cs`: `ValidateAddress(string addr, HelperGrammar grammar)` — parse +
  check each segment against the grammar, return list of errors/warnings; does NOT execute
- [ ] MCP server: expose `validateActionAddress(address, helperName)` tool that calls
  `ValidateAddress` on the target helper without running the action
- [ ] Dashboard UI: live address validation in the filter rule editor (call validate
  endpoint on blur, show inline error messages)

**Future helpers:**
- [ ] `OfficeWin.cs`: map `cells/col:*/row:*` to COM Interop `Range` addressing

---

## � Daemon Lifecycle, Rebuild Workflow & Helper Control (PRIORITY 2.5)
**Goal:** Clean daemon management for dev rebuild cycles, test automation, and runtime control

### Problem: Daemons Lock `.exe` Files
Persistent helper daemons (`KeyWin.exe`, `BrowserWin.exe`) hold the file open.
Running `build-all.ps1` while the server is running fails with:
> `error CS0016: Cannot write to KeyWin.exe — file in use by another process`

### Rebuild Workflow (documented in START_HERE.md ✅)
```powershell
# Clean stop (sends _exit to all daemons via shutdownAll()):
[Ctrl+C in server terminal]   # preferred — clean graceful shutdown

# OR force-kill everything:
Get-Process node -EA SilentlyContinue | Stop-Process -Force
Get-Process KeyWin, BrowserWin -EA SilentlyContinue | Stop-Process -Force

# Rebuild
PowerShell -ExecutionPolicy Bypass -File build-all.ps1

# Restart server
node dist/start-mcp-server.js
```

### `_ping` / `_schema` Built-in Daemon Actions
Add to `HelperCommon.cs` `RunStdinListener()` alongside the existing `_exit`:

- [x] `{"action":"_ping"}` ✅ DONE: health check; helper responds `{"success":true,"pong":true}` —
  added to `HelperCommon.cs` `RunStdinListener()` alongside `_schema` and `_exit`;
  `HelperDaemon.ping()` method added to `HelperRegistry.ts` for health checks
- [x] `{"action":"_schema"}` ✅ DONE (was already implemented in `HelperCommon.cs`): returns same
  JSON as `--api-schema` CLI flag via the alive persistent daemon pipe

### MCP Server `helpers/reload` Endpoint
Allow tests and scripts to trigger daemon restart without a full server restart:

- [x] Add `POST /api/helpers/reload` to `httpServerWithDashboard.ts`: ✅ DONE
  - `HelperRegistry.reloadHelpers()`: stores `searchPaths`, calls `shutdownAll()` + `schemas.clear()` + re-`discoverHelpers()`
  - Returns `{"success":true,"reloaded": N, "helpers": [...names...]}` — confirmed live
  - Added to `publicEndpoints` whitelist (no auth required)
- [x] Expose as JSON-RPC method `helpers/reload` in `mcpServer.ts` (same payload) ✅ DONE
- [x] Dashboard UI: "♻️ Reload Helpers" button in the Helpers card of the Settings tab ✅ DONE
  - `reloadHelpers()` in `dashboard.js`: disables button during reload, shows status, re-runs `scanHelpers()` after

### Test File Self-Sufficiency
- [x] `test-full-stack-stdin.js` helper function `reloadHelpers()`: ✅ DONE
  - `DASHBOARD_PORT = MCP_PORT + 1` constant added
  - Calls `POST /api/helpers/reload` via HTTP, then polls `GET /api/listHelpers` (300 ms interval) until `helpers.length >= expectedCount`; default timeout 15 s
- [x] `--self-hosted` flag for test runner ✅ DONE:
  - Spawns `node dist/start-mcp-server.js` as child process, streams stdout/stderr with `[server]` prefix
  - `pollUntilReady(45s)` polls tools/list until both `helper_KeyWin` and `helper_BrowserWin` appear
  - `stopServer()`: sends SIGINT (clean shutdown) with 5 s SIGKILL fallback
  - Tested live: spawn→poll→ready→SIGINT→graceful stop ✓
- [x] `--rebuild-first` flag ✅ DONE:
  - Runs `PowerShell -ExecutionPolicy Bypass -File build-all.ps1` synchronously before tests
  - Exits test process with code 1 if build fails
  - Combine with `--self-hosted` for fully unattended CI: `node test-full-stack-stdin.js --rebuild-first --self-hosted`

### Test-Session Recording ✅ DONE (TypeScript-only, no C# rebuild needed)
**Implemented as a pure TypeScript intercept in `HelperRegistry.callCommand()`.**
The C#-based `_start`/`_finish` approach from the original spec was replaced by a
server-side intercept that is simpler and works across all helpers uniformly.

- [x] `HelperRegistry.startSession(name, overrideDir?)`:
  - Creates `<testSessionDir>/<YYYY-MM-DD_HH-mm-ss>_<name>/` folder
  - Opens `session.log` (JSONL, append mode)
  - If a session is already open, closes it first
- [x] `HelperRegistry.finishSession()`:
  - Closes `session.log`, writes `summary.json` `{name,passed,failed,total,durationMs,startTime,endTime}`
  - Returns `{sessionDir,logLines,durationMs,passed,failed}`
- [x] `HelperRegistry.getActiveSessionDir()` — status query
- [x] `HelperRegistry.callCommand()` intercept: logs every call →
  `{ts,seq,helper,target,command,parameter,success,durationMs,error?}`
- [x] Auto-SCREENSHOT on failure for BrowserWin calls (when target has `:PORT`):
  saves `fail_<ts>_<command>.png` into session folder
- [x] `setSessionBaseDir(dir)` — called from `loadAdvancedFilters()` when
  `dashboard-settings.json` has a `"testSessionDir"` key; default `./test-sessions`
- [x] REST endpoints on dashboard port:
  - `POST /api/session/start  { name, dir? }` → `{success,sessionDir}`
  - `POST /api/session/finish`               → `{success,sessionDir,logLines,durationMs,passed,failed}`
  - `GET  /api/session/status`               → `{success,sessionActive,sessionDir|null}`
- [x] MCP cases `session/start` and `session/finish` in `mcpServer.ts` tools/call dispatch
- [x] `test-full-stack-stdin.js`:
  - `testSession.start(name, overrideDir?)` / `testSession.finish()` / `testSession.status()`
  - `main()` opens session before test sections, closes it after with summary printout
  - `--session-dir=<path>` CLI override: SESSION_DIR_ARG constant (wiring with testSession pending)
- [ ] Dashboard Settings tab: `testSessionDir` path field (deferred — dashboard already reads
  it from `dashboard-settings.json` via `setSessionBaseDir`)

---

## ⌨️ Command Integrity & Action Standardization (PRIORITY 2.7 — HIGH)
**Trigger:** Do this immediately after `BrowserWin.exe` command set is stable.
**Goal:** All helpers speak an identical wire vocabulary. Any AI assistant or test
script can call any helper using the same mental model. Inconsistencies eliminated.

### Problem: Inconsistent Special-Key Handling
Commands like `{NEWDOC}`, `{RESET}`, `{NEWPAGE}` are currently named commands that
internally fire a keyboard shortcut (e.g. Ctrl+N). This breaks the model: AI agents
must learn per-app vocabulary instead of a universal one.

**Rule:** *Keyboard shortcuts are never commands.* They always go through `SENDKEYS`.

**Audit tasks:**
- [x] `KeyWin.cs`: list every command that is a thin wrapper around a key combo
  - [x] **Audit result:** `NEWDOC` and `RESET` are NOT thin wrappers — both have substantial
    non-key logic (NEWDOC: window snapshot + new-window detection + HANDLE: return;
    RESET: UIA AC-button search first, Ctrl+Z×20 fallback). They are legitimate commands.
  - [x] All other KeyWin commands (`QUERYTREE`, `READ`, `LISTWINDOWS`, `CLICK*`, `SET`,
    `GETTEXT`, `KILL`, `SENDKEYS`) are clean — no key-combo-only commands remain.
- [x] `BrowserWin.cs`: same audit
  - [x] `NEWDOC` → confirmed non-trivial (CDP `Target.createTarget` + wait logic)
  - [x] `RESET` → confirmed non-trivial (CDP page reload + state clear)
  - [x] `NEWPAGE` → confirmed non-trivial (new CDP browser context)
- [x] Update schema strings and MCP tool descriptions to reflect final vocabulary
  - [x] `executeScenario` MCP tool description updated; XML template mode added (app, scenarioId, params)
- [x] Update all scenario JSON files in `config/scenarios/` to use new vocab
  - [x] **Audit result:** JSON files use ScenarioReplayer high-level action names (queryTree, clickElement, etc.) — these are not wire protocol names; no rename needed. Wire protocol names only appear in description strings.
- [x] Update `docs/api/KEYWIN_API.md` and `docs/api/API.md`

### Problem: Non-Uniform JSON Action Shape
Goal: 95% of calls look identical:
```json
{ "target": "...", "command": "READ", "parameter": "" }
```
Deviations require explicit justification in the schema.

**Audit tasks:**
- [x] Review every command that uses `parameter` as a structured sub-value
  (e.g. `FILL`, `COOKIES`, `READELEM`) — confirmed consistent: all use `selector:value`
  or single-value encoding with ColonSep; documented in schema descriptions.
- [x] Check that every response has `{ "success": bool, "command": "...", ... }`
  — both helpers audited; all success/error responses include `success` field.
  `command` is implicitly documented in the schema `name` field; callers use `success`.
- [x] `id` correlation: both helpers echo the request `id` in every response
  - [x] `IdInjectingWriter` added to `HelperCommon.cs` — auto-injects `"id":"<n>"`
    into every JSON-object response line via TextWriter override; zero changes
    to individual command handlers in KeyWin.cs / BrowserWin.cs
  - [x] `RunStdinListener` sets `injectingWriter.CurrentId = id` before each dispatch
    (covers `_schema`, `_ping`, `_exit` and all command handlers)
  - [x] `HelperRegistry.ts` `call()` now sends `id: String(++this.requestSeq)`
    (monotonically incrementing, distinct per request per daemon)
- [x] Schema `parameters[]` completeness: reviewed both helpers — all 11 KeyWin
  commands and 16 BrowserWin commands have `parameters`, `description`, and `examples`
  entries in `OutputApiSchema()`. Schema is complete.
- [x] Write a schema-validation unit test that asserts every known command is
  listed in the schema with at least one `parameters` entry
  - [x] Added `testSchemaValidation()` to `tests/integration/test-full-stack-stdin.js`

---

## 📂 Project Folder Structure Reconciliation (PRIORITY 2.8 — HIGH)
**Trigger:** Do this immediately after Command Integrity audit is done.
**Goal:** Eliminate the `src/server/` vs root vs `tools/` ambiguity; make the project
navigable for a new developer in under 5 minutes.

**Target layout:**
```
tools/helpers/common/   ← HelperCommon.cs  (was tools/common/)
tools/helpers/win/      ← KeyWin.cs        (was tools/win/)
tools/helpers/browser/  ← BrowserWin.cs    (was tools/browser/)
tools/helpers/office/   ← future OfficeWin.cs
src/helpers/            ← HelperRegistry.ts (was src/server/)
dist/helpers/           ← flat: KeyWin.exe, BrowserWin.exe
tests/integration/      ← test-full-stack-stdin.js (was root/)
config/                 ← dashboard-settings.json (was root/)
```

**Tasks:**
- [x] Move `tools/common/` → `tools/helpers/common/`
- [x] Move `tools/win/` → `tools/helpers/win/`
- [x] Move `tools/browser/` → `tools/helpers/browser/`
- [x] Move `src/server/HelperRegistry.ts` → `src/helpers/HelperRegistry.ts`
  - [x] Updated imports in `mcpServer.ts` and `httpServerWithDashboard.ts`
- [x] Move `test-full-stack-stdin.js` → `tests/integration/test-full-stack-stdin.js`
  - [x] Updated `__dirname` refs + all 8 task definitions in `.vscode/tasks.json`
- [x] Move `dashboard-settings.json` → `config/dashboard-settings.json`
  - [x] Updated `settingsPath` / `settingsFilePath` in both server files
- [x] Update `build-all.ps1` path variables for new tool locations
- [x] Update `dist/` output to `dist/helpers/` (was `dist/win/` + `dist/browser/`)
  - [x] Updated `mcpServer.ts` search paths: single `dist/helpers/` directory
- [x] Update `.gitignore` — test output artifacts, compiled TS subdirs, dist/helpers
  - [x] Un-tracked: `dist/scenario/`, `dist/security/`, `dist/utils/`, `dist/win/` (compiled TS)
  - [x] Un-tracked: `test-output*.txt`, `server.err`, `test-sessions/`
- [x] Update `START_HERE.md` to reflect new paths
- [x] Full rebuild confirmed: TS exit 0, KeyWin exit 0, BrowserWin exit 0
  Tests: 122/2 (2 pre-existing Notepad clipboard flakiness, unrelated to reorg)

---
## 📚 App Knowledge Base — App Templates & Scenario Library (PRIORITY 2.9)
**Trigger:** After folder-structure reconciliation. Drives AI-guided automation without
per-session trial-and-error tree exploration.
**Goal:** Ship a deployable folder of per-application knowledge: known control trees with
semantic annotations, reusable scenario templates, and optional embedding vectors for
LLM-assisted matching — all in a structured XML format that helpers can query at runtime.

### Concept

Each supported application gets its own sub-folder inside `apptemplates/`:

```
apptemplates/
  calculator/
    tree.xml           ← annotated control tree (see schema below)
    scenarios.xml      ← reusable scenario templates
    embeddings/        ← optional: per-engine vector files (.npy / .bin / .json)
      openai-ada-002.bin
      ollama-nomic-embed-text.json
  notepad/
    tree.xml
    scenarios.xml
  msword/
    tree.xml
    scenarios.xml
    embeddings/
  chrome/
    tree.xml
    scenarios.xml
  ...
```

The base path is configured in `dashboard-settings.json` → `"appTemplatesDir"`.
A Windows installer (or VS Code extension install hook) deploys a default set.

---

### tree.xml — Annotated Control Tree Schema

```xml
<AppTree app="calculator" version="11.2302" os="win11" helper="KeyWin.exe">
  <meta>
    <description lang="en">Windows Calculator (Modern UWP). Single-session app — use RESET to clear state.</description>
    <description lang="ai">Single-session UWP calculator. Numeric buttons use AutomationId numXButton. Operator buttons: plus, minus, multiply, divide. Result read from CalculatorResults. Reset via AC button (clearEntryButton or clearButton).</description>
    <!-- Optional per-engine embeddings inline or as external file reference -->
    <embeddings>
      <engine name="openai-ada-002" file="embeddings/openai-ada-002.bin" dims="1536"/>
      <engine name="ollama-nomic-embed-text" file="embeddings/ollama-nomic-embed-text.json" dims="768"/>
    </embeddings>
    <!-- Known binary hashes for integrity / version identification -->
    <binaries>
      <binary path="C:\Windows\SystemApps\Microsoft.WindowsCalculator_*\Calculator.exe"
              sha256="..." version="11.2302.x.0"/>
    </binaries>
  </meta>

  <Control id="num7Button" name="Seven" role="Button" automationId="num7Button">
    <label lang="en">The digit 7 button</label>
    <label lang="ai">Numeric button 7; sends CLICKID num7Button to type digit 7 in current expression</label>
    <action command="CLICKID" parameter="num7Button"/>
  </Control>
  <!-- ... all other controls ... -->
  <Control id="CalculatorResults" name="Display" role="Text">
    <label lang="en">Result display — shows current expression value</label>
    <label lang="ai">Read this control with READ to get the current expression or result as a string</label>
    <action command="READ" parameter=""/>
  </Control>
</AppTree>
```

**Tasks:**
- [x] Define `tree.xsd` schema (Controls, meta, embeddings, binaries sections)
- [x] Author `apptemplates/calculator/tree.xml` (full control set, human + AI labels)
- [x] Author `apptemplates/notepad/tree.xml`
- [x] Author `apptemplates/chrome/tree.xml` (CDP-aware, BrowserWin targets)
- [x] `HelperRegistry` / MCP server: expose `GET /api/appTemplates` endpoint listing all known apps
- [x] `GET /api/appTemplates/{app}/tree` — return the tree XML (or parsed JSON)
- [x] Tree diff: on first connection compare live QUERYTREE hash to stored tree hash;
  warn if control set changed (helper version upgrade detected)
  - **Deferred:** Live tree diff requires runtime QUERYTREE which is app-specific; deferred post-PRIORITY 2.9.

---

### scenarios.xml — Reusable Scenario Template Library

```xml
<ScenarioLibrary app="calculator" version="1.0">

  <!-- Generic lead-in: ensure app is running and in clean state -->
  <Scenario id="intro" label="Start / Lead-in">
    <description lang="en">Ensure Calculator is open and in a clean state before any test.</description>
    <description lang="ai">Check LISTWINDOWS for calc; if absent LAUNCH calc.exe; then RESET to clear expression. Use as the first step in any Calculator scenario.</description>
    <Steps>
      <Step action="LISTWINDOWS" target="SYSTEM" parameter=""/>
      <Step action="LAUNCH"      target="calc.exe" parameter="" onlyIfAbsent="true"/>
      <Step action="RESET"       target="{window}" parameter=""/>
    </Steps>
  </Scenario>

  <!-- Generic: compute expression -->
  <Scenario id="compute" label="Compute Expression">
    <description lang="en">Type an arithmetic expression and read the result.</description>
    <description lang="ai">Use SENDKEYS to type digits and operators, then SENDKEYS {ENTER} to evaluate. Read result with READ on the window.</description>
    <Parameters>
      <Param name="expression" type="string" example="7 * 6"/>
    </Parameters>
    <Steps>
      <ScenarioRef ref="intro"/>
      <Step action="SENDKEYS" target="{window}" parameter="{expression}"/>
      <Step action="SENDKEYS" target="{window}" parameter="{ENTER}"/>
      <Step action="READ"     target="{window}" parameter=""/>
    </Steps>
  </Scenario>

  <!-- Generic teardown -->
  <Scenario id="teardown-leave-open" label="Teardown: leave open">
    <description lang="en">Leave Calculator open (default: non-destructive teardown).</description>
    <Steps/>  <!-- no-op -->
  </Scenario>

</ScenarioLibrary>
```

**Key design choices:**
- `<ScenarioRef ref="..."/>` allows recursive composition (scenario includes other scenarios)
- `{window}` is a runtime-bound parameter filled from the intro step's LISTWINDOWS result
- Each scenario has both `lang="en"` (human narrative) and `lang="ai"` (LLM-optimised) descriptions
- Embedding vectors for semantic retrieval are stored in `embeddings/` alongside the tree

**Tasks:**
- [x] Define `scenarios.xsd` schema (Scenario, Steps, Step, ScenarioRef, Parameters)
  - [x] `apptemplates/scenarios.xsd` authored — formal XSD with Scenario, Steps, Step, ScenarioRef, Parameters.
- [x] Author `apptemplates/calculator/scenarios.xml` with: `intro`, `compute`, `teardown-*`
- [x] Author `apptemplates/notepad/scenarios.xml` with: `intro`, `new-document`, `type-text`, `save`, `close-window`, `teardown-*`
- [x] Author `apptemplates/chrome/scenarios.xml` with: `intro`, `navigate`, `fill-form`, `read-page`, `close-tab`, `teardown-*`
- [x] MCP tool `executeScenario` enhancement: resolve `<ScenarioRef>` recursively at runtime
  - [x] `src/scenario/xmlScenarioLoader.ts` — XmlScenarioLoader + shared executeXmlScenario executor
  - [x] `mcpServer.ts` — added `app`, `scenarioId`, `params` inputs; delegates to xmlScenarioLoader
- [x] `GET /api/appTemplates/{app}/scenarios` REST endpoint
- [x] `POST /api/appTemplates/{app}/scenarios/{id}/run` — execute a named scenario template
  - [x] Implemented in `httpServerWithDashboard.ts` `handleRunAppTemplateScenario`
- [x] Dashboard Settings tab: "App Templates" card showing loaded apps + scenario counts
  - [x] Added `📚 App Templates` nav section + `loadAppTemplates()` in dashboard.html/js
- [ ] Scenario editor: visual step builder (drag-drop reorder, ScenarioRef picker)

### App Template Namespacing / Package Layout (LOW PRIORITY)
**Goal:** Organise `apptemplates/` into a reverse-domain namespace hierarchy, similar to
Java/Maven package coordinates, so that vendor-shipped templates, OS-specific variants,
and user-local packs don't collide.

**Proposed layout:**
```
apptemplates/
  com.microsoft/
    windows.v11/
      calculator/
        tree.xml  scenarios.xml
      notepad/
        tree.xml  scenarios.xml
    windows.v10/
      notepad/          ← older HWND layout differs
  eu.plachy.aiapi/
    default/
      notepad/          ← user-supplied overrides / additional scenarios
```

**Addressing format** (used in REST paths and MCP tool args):
```
app  =  "com.microsoft/windows.v11/calculator"
POST /api/appTemplates/com.microsoft%2Fwindows.v11%2Fcalculator/scenarios/compute/run
```

**Migration tasks (when this becomes a priority):**
- [ ] Decide separator: `/` subdirectories (cleaner) vs `.` flat folder names (simpler glob)
  — recommendation: subdirectory hierarchy (`com.microsoft/windows.v11/notepad`)
- [ ] Move existing `apptemplates/calculator/`, `notepad/`, `chrome/` under
  `apptemplates/com.microsoft/windows.v11/` (calculator, notepad) and
  `apptemplates/com.google/chrome/` / `apptemplates/com.brave/browser/`
- [ ] Update `XmlScenarioLoader.load(app, scenarioId)`: `app` becomes a slash-path;
  `appTemplatesDir + '/' + app` resolves correctly without code changes (just path.join)
- [ ] Update REST routing in `httpServerWithDashboard.ts`: replace split-on-`/` with a
  greedy prefix match up to `/scenarios/` or `/tree`
- [ ] Update `GET /api/appTemplates` to return nested structure or flat list with
  full namespaced ids
- [ ] Update Dashboard "App Templates" card to render namespace hierarchy as a tree
- [ ] Update `tree.xsd` `app` attribute: allow slash-separated namespace paths
- [ ] Update `scenarios.xsd` same
- [ ] Add `namespace` + `registry` attributes to `<AppTree>` and `<ScenarioLibrary>` roots
- [ ] Document resolution order (user namespace beats vendor; OS-specific beats generic):
  `eu.plachy.aiapi/default/notepad` → `com.microsoft/windows.v11/notepad` → `com.microsoft/windows.v10/notepad`
- [ ] CLI: `npm run embed-tree -- --app com.microsoft/windows.v11/calculator ...`

---

### Embedding Vectors (Optional, Per-Engine)

Vectors allow LLM-assisted control discovery ("find the button that submits the form")
without exact AutomationId knowledge.

- [ ] Define embedding file format: JSON array `[{"id":"...", "label":"...", "vec":[...]}]`
  or binary `.bin` (float32 LE, prepended with a small JSON header)
- [ ] CLI tool `node tools/embed-tree.js --app calculator --engine openai-ada-002 --out apptemplates/calculator/embeddings/`
  that calls the target engine's embedding API for each control's `lang="ai"` label
- [ ] At runtime: `POST /api/appTemplates/{app}/tree/search` with `{"query":"...","engine":"...","topK":5}`
  returns the top-K controls whose label vectors are closest to the query embedding
- [ ] Multiple engines can coexist in the same `embeddings/` folder (different files)
- [ ] Keep vectors as separate files (not inlined in tree.xml) to avoid bloating the
  human-readable XML; `<embeddings>` in `<meta>` holds only the file references

---

## 🚀 Deployment Targets & Packaging (PRIORITY 3.5)
**Trigger:** After core feature parity is stable on Windows (all current priority 2.x items done).
**Goal:** The AIAPI server can be deployed in any environment without requiring VS Code.
Each target shares the same TypeScript core; only the entry-point and service-wrapper differ.

### Current State
- ✅ **VS Code Extension** — primary target, works today (`src/extension.ts` activates the server)

### Target Matrix

| Target | OS | Priority | Notes |
|---|---|---|---|
| VS Code Extension | Win / Lin / Mac | ✅ done | primary target |
| Standalone console .exe | Windows | HIGH | single `.exe`, no Node required (pkg/nexe) |
| Windows Service | Windows | HIGH | `sc create` or NSSM wrapper; auto-start |
| Standalone GUI tray app | Windows | MEDIUM | system-tray icon, start/stop, log viewer |
| Linux `systemd` daemon | Linux | MEDIUM | separate machine / separate branch |
| Linux `init.d` script | Linux | LOW | legacy distros (RHEL 7, Ubuntu 14) |
| macOS `launchd` daemon | macOS | LOW | `launchctl load ~/Library/LaunchAgents/...` |
| Standalone console app | Lin / Mac | MEDIUM | same binary packaged with `pkg` for each OS |
| Linux GUI tray app (KDE/GNOME) | Linux | LOW | AppIndicator / KStatusNotifierItem; start/stop/open-dashboard |
| Windows Explorer shell extension | Windows | LOW | Right-click context menu "Automate with AIAPI" → opens Dashboard |

> **Cross-platform note:** Linux/macOS targets will be built on a separate
> machine (or CI runner) where the platform-specific helpers
> (`KeyLin`, `BrowserLin`, `KeyMac`, `BrowserMac`) can be compiled.
> The TypeScript MCP server itself is already cross-platform — only the helper
> `.exe` launcher paths and the service-wrapper code are OS-specific.

---

### Windows: Standalone Console App
- [ ] `pkg` or `nexe` config to bundle `dist/start-mcp-server.js` + `node_modules` into
  a single `aiapi-server.exe`
- [ ] Embed `static/` dashboard files
- [ ] Auto-detect `dist/win/KeyWin.exe` and `dist/browser/BrowserWin.exe` relative to the bundle
- [ ] `--port`, `--no-auth`, `--log-level`, `--session-dir` CLI flags passed through
- [ ] CI artifact: `dist/release/aiapi-server-win-x64.exe`

### Windows: Windows Service
- [ ] NSSM-based service definition (`scripts/install-service-win.ps1`):
  ```powershell
  nssm install AIAPI "C:\Program Files\AIAPI\aiapi-server.exe"
  nssm set AIAPI AppParameters "--port 3457"
  nssm set AIAPI Start SERVICE_AUTO_START
  nssm start AIAPI
  ```
- [ ] Alternatively: pure SC + wrapper `.exe` that calls `SetConsoleCtrlHandler` + `StartServiceCtrlDispatcher`
- [ ] Windows Event Log integration (errors + startup banner written to Application log)
- [ ] Installer (`scripts/install-win.ps1`) that: copies files, installs service, opens firewall port
- [ ] Uninstaller (`scripts/uninstall-win.ps1`)

### Windows: System-Tray GUI App
- [ ] C# `SystemTray` wrapper (`tools/tray/TrayApp.cs`) using `NotifyIcon` + `ContextMenuStrip`
  - Right-click menu: Start / Stop / Restart / Open Dashboard / View Logs / Exit
  - Icon changes: grey (stopped) → green (running) → red (error)
- [ ] Spawns `aiapi-server.exe` as a child process, monitors stdout/stderr
- [ ] "Open Dashboard" opens `http://127.0.0.1:3458` in default browser
- [ ] Built by `build-all.ps1` alongside KeyWin.exe and BrowserWin.exe

### Linux: systemd Daemon
> **Build on Linux machine / separate VS Code Remote host**
- [ ] `scripts/linux/aiapi.service` systemd unit file:
  ```ini
  [Unit]
  Description=AIAPI MCP Automation Server
  After=network.target
  [Service]
  Type=simple
  ExecStart=/usr/local/bin/aiapi-server --port 3457
  Restart=on-failure
  [Install]
  WantedBy=multi-user.target
  ```
- [ ] `scripts/linux/install.sh`: copies binary, installs unit, `systemctl enable aiapi`
- [ ] Linux helpers: `KeyLin` (AT-SPI2 / xdotool) and `BrowserLin` (CDP same as Windows)
  compile on the Linux host and are bundled with the Linux package
- [ ] CI: GitHub Actions job `build-linux` on `ubuntu-latest` runner

### Linux: init.d Script (Legacy)
- [ ] `/etc/init.d/aiapi` LSB-compliant init script (start / stop / restart / status)
- [ ] Compatible with RHEL 6, Ubuntu 12, Debian 7 (sysvinit)

### macOS: launchd Plist
> **Build on macOS machine / separate VS Code Remote host**
- [ ] `scripts/macos/com.rheingold.aiapi.plist` LaunchAgent:
  ```xml
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/aiapi-server</string><string>--port</string><string>3457</string></array>
  <key>RunAtLoad</key><true/>
  ```
- [ ] `scripts/macos/install.sh`: copies plist to `~/Library/LaunchAgents/`, `launchctl load`
- [ ] macOS helpers: `KeyMac` (AX API + AppleScript) and `BrowserMac` (CDP)
  compile on the macOS host
- [ ] macOS code-signing and notarisation notes (required for Gatekeeper)

### Linux: GUI Tray App (KDE / GNOME / XWindow)
> **Build on Linux machine / separate VS Code Remote host**
- [ ] C or C++ (GTK3 + `libappindicator3`) tray application (`tools/tray/TrayAppLin.c`):
  - `AppIndicator` / `KStatusNotifierItem` for cross-desktop compatibility (KDE, GNOME 3+, XFCE)
  - Right-click menu: Start / Stop / Restart / Open Dashboard / View Logs / Exit
  - Icon states: grey (stopped) → green (running) → red (error)
  - "Open Dashboard" calls `xdg-open http://127.0.0.1:3458`
- [ ] Spawns `aiapi-server` (packaged Linux binary) as a child process, monitors stdout/stderr
- [ ] Autostart file: `~/.config/autostart/aiapi-tray.desktop`
  ```ini
  [Desktop Entry]
  Type=Application
  Name=AIAPI Tray
  Exec=/usr/local/bin/aiapi-tray
  X-GNOME-Autostart-enabled=true
  ```
- [ ] Built separately on Linux host; included in Linux package alongside `aiapi-server`

### Windows: Explorer Shell Extension (Context-Menu)
> **Low priority — comfort feature for non-CLI users**
- [ ] COM in-process shell extension (`tools/shellext/AiapiShellExt.cs` — C# with `SharpShell` or
  native C++ `IContextMenu` + `IShellExtInit`)
- [ ] Right-click on any file/folder in Windows Explorer → "Automate with AIAPI" sub-menu:
  - "Open Dashboard" → `http://127.0.0.1:3458`
  - "Run scenario…" → opens a small picker dialog listing available app scenarios
  - "Launch server" (if not running) → starts `aiapi-server.exe` silently
- [ ] Must be registered via `regsvr32` or included in the NSIS installer as optional component
- [ ] Requires COM signing for Windows 11 compatibility (same codesign cert as the main exe)

### Windows Installer (MSI / NSIS)
- [ ] NSIS script (`scripts/installer/aiapi-setup.nsi`) or WiX `.wxs` file
  - Bundles: `aiapi-server.exe`, `KeyWin.exe`, `BrowserWin.exe`, `dashboard.html/css/js`, `apptemplates/`
  - Install path: `C:\Program Files\AIAPI\`
  - Start Menu shortcut → TrayApp
  - Optional: install as Windows Service (checkbox)
  - Optional: add firewall rule for port 3457/3458
  - Uninstall: removes service, firewall rule, files
- [ ] Version number injected from `package.json` → `package.version`
- [ ] CI artifact: `dist/release/aiapi-setup-<version>-win-x64.exe`

---


## �📄 MS Office Automation (PRIORITY 3)
**Goal:** Control Word, Excel, PowerPoint with document structure access

> ⚠️ **Pre-requisite (this machine):** Microsoft Office must be installed before the
> `OfficeWin.exe` helper can be built or tested. The build uses COM Interop assemblies
> (`Microsoft.Office.Interop.*`) that are only present when Office is installed.
> Run the Office installer first, then come back here.

### OfficeWin.exe Helper
- [ ] Create `tools/office/OfficeWin.cs`
- [ ] Support MS Office applications:
  - [ ] Microsoft Word
  - [ ] Microsoft Excel
  - [ ] Microsoft PowerPoint
- [ ] Word Features:
  - [ ] Open/Create documents
  - [ ] Query document structure (paragraphs, tables, headings)
  - [ ] Insert/Modify text
  - [ ] Apply formatting (bold, italic, styles)
  - [ ] Table manipulation
  - [ ] Find/Replace text
  - [ ] Save as various formats (docx, pdf)
- [ ] Excel Features:
  - [ ] Open/Create workbooks
  - [ ] Query worksheets and cells
  - [ ] Read/Write cell values
  - [ ] Apply formulas
  - [ ] Format cells (colors, borders, fonts)
  - [ ] Charts creation
  - [ ] Named ranges
- [ ] PowerPoint Features:
  - [ ] Open/Create presentations
  - [ ] Query slide structure
  - [ ] Add/Modify slides
  - [ ] Insert text, images, shapes
  - [ ] Apply themes/layouts
  - [ ] Slide transitions
- [ ] Integration:
  - [ ] Use Office Interop APIs
  - [ ] COM automation
  - [ ] Session token authentication
  - [ ] JSON output format

### OfficeProvider Enhancement
- [ ] Update `src/providers/officeProvider.ts` to use OfficeWin.exe
- [ ] Application selection (word, excel, powerpoint)
- [ ] Document structure querying
- [ ] Content manipulation
- [ ] Format operations
- [ ] File operations (open, save, export)

### Test Scenarios
- [ ] `scenarios/word-document-edit.json`
- [ ] `scenarios/excel-data-entry.json`
- [ ] `scenarios/powerpoint-slide-creation.json`

---

## 🔧 Infrastructure Updates

### Build System
- [x] Update `scripts/build-win-tools.ps1`:
  - [x] Build BrowserWin.exe (added, outputs to `dist/browser/`)
  - [ ] Build OfficeWin.exe (blocked — Office must be installed first)
  - [x] Copy to dist/browser/ (done by build script)
  - [ ] Copy to dist/office/
- [ ] Add package references:
  - [ ] Selenium.WebDriver (needed for Firefox support in BrowserWin)
  - [ ] Microsoft.Office.Interop.Word
  - [ ] Microsoft.Office.Interop.Excel
  - [ ] Microsoft.Office.Interop.PowerPoint

### MCP Server
- [ ] Update `src/server/mcpServer.ts`:
  - [ ] Add browser control tools
  - [ ] Add office control tools
- [ ] Update tool schemas for browser/office operations
- [ ] Verify MCP server toolset alignment with documented MCP tools
  - [ ] Generate a quick whitepaper-style report showing MCP server ↔ toolset correspondence
  - [ ] Ensure MCP server advertises AI-readable API descriptions per MCP protocol
- [ ] Add fetch_webpage MCP tool (standard webpage scraper + search APIs)
  - [ ] Web security filters (separate section from UI filters):
    - [ ] Protocol allow/deny (HTTP, HTTPS, FTP, etc.)
    - [ ] Domain filtering with wildcards (*.trusted.com, *.internal.*)
    - [ ] Content keyword filtering (block/allow based on page content)
    - [ ] Header-based filtering (User-Agent, Referer, etc.)
  - [ ] Network protocol support beyond HTTP:
    - [ ] SSH client capability
    - [ ] FTP/SFTP client capability  
    - [ ] Telnet client capability
    - [ ] Raw TCP socket connections
    - [ ] Raw UDP socket connections

### Documentation
- [ ] Create `BROWSER_API.md`
- [ ] Create `OFFICE_API.md`
- [ ] Update `API.md` with new tools
- [ ] Add examples to `QUICK_REF.md`

---

## 🍪 Web Fetch: Cookie Consent & Auth Wall Handling (PRIORITY 4)
**Goal:** Allow the AI to navigate sites that gate content behind cookie consent dialogs or
login walls, without human interaction — while preserving user privacy and security control.

### Cookie Consent / GDPR Popups
- [ ] Detect common consent frameworks in fetched HTML:
  - [ ] Google Consent Mode (`consent.google.com/…`, `fc=allyesundefined` patterns)
  - [ ] CookieBot (`cookiebot.com` scripts / `data-cookieconsent` attributes)
  - [ ] OneTrust (`onetrust` CSS classes / `OptanonConsent` cookie)
  - [ ] TrustArc / Truste (`truste.com` iframes)
  - [ ] Generic: any `<div>` with id/class containing `cookie`, `consent`, `gdpr`, `banner`
- [ ] Report detected consent wall in `WebFetchResult`:
  - [ ] Add `consentWall?: ConsentWallInfo` to result (framework, button labels, form action)
  - [ ] AI can decide: skip consent (send cookie header), auto-click accept, or surface to user
- [ ] Auto-accept strategy (opt-in, disabled by default):
  - [ ] Identify "Accept All" / "Agree" button by common label patterns
  - [ ] POST the consent form or set the known cookie value directly
  - [ ] Re-fetch the target URL with the consent cookie set
  - [ ] Configurable in `WebFetchOptions.consentHandling: 'none' | 'auto-accept' | 'report'`
- [ ] Cookie jar support in `WebScrapingClient`:
  - [ ] Store `Set-Cookie` headers across redirect hops and re-fetch
  - [ ] Pass accumulated cookies on subsequent requests to the same domain
  - [ ] Respect `Secure`, `HttpOnly`, `SameSite` attributes (no cross-domain leakage)
  - [ ] `WebFetchOptions.cookies?: Record<string, string>` for manual cookie injection
- [ ] Handle Google-specific consent flow:
  - [ ] Detect `302 → consent.google.com/ml?continue=…` redirect pattern
  - [ ] Extract the `continue=` target URL and offer it directly (bypass the consent hop)
  - [ ] Optional: send `SOCS=…` cookie to skip Google's consent gate

### Session / State Management
- [ ] Persist cookies between multiple `fetchWebpage` calls in a named session:
  - [ ] `WebFetchOptions.sessionId?: string` — reuse cookie jar across calls
  - [ ] Expose `clearSession(sessionId)` to let the AI reset state
- [ ] Support `POST` method in `fetchWebpage` for form submissions:
  - [ ] `WebFetchOptions.method?: 'GET' | 'POST'`
  - [ ] `WebFetchOptions.body?: string | Record<string, string>` (form-encoded or JSON)
  - [ ] Needed for submitting login forms detected by `detectLoginForm()`

---

## 🌐 Cross-Platform Browser DOM Access — Unified Bridge (PRIORITY 2)
**Goal:** Access the live DOM of any browser on any platform without requiring the user to
manually restart their browser with debug flags. Two immediate approaches plus a full
fallback chain for older platforms.

### Approach 1: CDP — Launch or Detect with Debug Port (IMMEDIATE)
**AI assistant behavior:** When a browser task is requested, BrowserWin checks if CDP is
available. If not, it EXPLAINS to the user why a debug-port window is needed and offers to
launch one — either silently/headless or visibly with focus:

- [ ] **`{LAUNCH:brave}` / `{LAUNCH:chrome}` / `{LAUNCH:firefox}` command** in BrowserWin:
  - [ ] Detect if browser is already running with `--remote-debugging-port` on expected port
  - [ ] If not: launch a new instance with `--remote-debugging-port=<port>
        --user-data-dir=%TEMP%\aiapi-<browser>` (separate profile, doesn't touch user data)
  - [ ] Options: `{LAUNCH:brave:visible}` (foreground, user sees it) vs
        `{LAUNCH:brave:headless}` (headless=new, invisible)
  - [ ] Wait up to 5s for CDP port to become reachable, then return success+port
  - [ ] Return a clear error message if browser executable not found, with install hint
  - [ ] AI-readable schema description: explain WHY debug port is needed and what it unlocks
- [ ] **Browser path discovery**: scan common install locations per browser per platform
  - [ ] Windows: `%ProgramFiles%`, `%LocalAppData%`, registry `HKLM\SOFTWARE\...`
  - [ ] Linux: `/usr/bin/`, `/usr/local/bin/`, `~/.local/share/`
  - [ ] macOS: `/Applications/`, `~/Applications/`
- [ ] **`{LISTBROWSERS}` enhancement**: show which browsers have CDP available vs UIA-only
- [ ] **AI prompt in schema**: "If CDP is not available, call `{LAUNCH:browserName}` to open
      a debug-port window. The user must consent — explain that a separate browser window
      will open. Use `{LAUNCH:brave:headless}` for invisible operation."

### Approach 2: Screen Reader Trick — Force COM DOM Exposure (IMMEDIATE, no flags)
Sending `WM_GETOBJECT(OBJID_CLIENT)` to `Chrome_RenderWidgetHostHWND` can trigger Chromium
to instantiate its `BrowserAccessibility` tree — the same signal a screen reader sends.
For Firefox, `IAccessible2`/`ISimpleDOMNode` COM interfaces already expose real HTML
attributes without any flags.

- [ ] **Chromium WM_GETOBJECT nudge** in BrowserWin UIA path:
  - [ ] Find `Chrome_RenderWidgetHostHWND` child of browser window
  - [ ] Send `WM_GETOBJECT(OBJID_CLIENT)` — triggers accessibility tree creation on some
        Chrome versions (tested range: Chrome 80–120; may not work on latest)
  - [ ] Re-query UIA tree after 500ms delay; if node count > 20 → success
  - [ ] Flag result: `"mode":"uia_nudge"` in JSON output
- [ ] **Firefox `ISimpleDOMNode` COM traversal** (C# via COM interop):
  - [ ] P/Invoke `AccessibleObjectFromWindow(renderHwnd, OBJID_CLIENT)` → `IAccessible`
  - [ ] `QueryInterface(IID_IAccessible2)` → `IAccessible2`
  - [ ] `QueryInterface(IID_ISimpleDOMNode)` → `ISimpleDOMNode`
  - [ ] Walk with `get_nodeInfo()` (tagName, id), `get_attributes()` (all HTML attrs
        including `for=`, `name=`, `type=`, `placeholder=`), `get_childAt()`
  - [ ] Build same `{id,type,name,position,properties,actions,children}` JSON as UIA/CDP
  - [ ] Use `get_attributes()` to resolve label→input associations (HTML `for=` attr)
  - [ ] Mode flag: `"mode":"ia2"` in output
- [ ] **`--force-renderer-accessibility` hint**: if nudge fails, add to LAUNCH command and
      note in AI schema

---

## 🎮 Unified Input/Output Control Model — All Helpers (PRIORITY 2)
**Goal:** Every helper (KeyWin, BrowserWin, OfficeWin, future Linux/Mac helpers) supports
the SAME set of input verbs and the SAME tree node schema. The underlying mechanism varies
by platform/context but the API surface is identical.

### Unified Tree Node Schema (ancestor class concept)
Every node in every tree — Win32 UIA, browser DOM (CDP or UIA), Office COM, AT-SPI2,
AX API — MUST produce this shape. Fields may be null but must always be present:

```json
{
  "id":          "...",        // AutomationId / HTML id / COM ProgId / AT-SPI uniqueId
  "handle":      "0x1A2B",    // HWND / XID / AXUIElement ref / null for DOM nodes
  "path":        "//win/...", // XPath-style address (see Unified Action Addressing above)
  "type":        "Button",    // ControlType / tagName / AX role / AT-SPI role
  "tag":         "BUTTON",    // raw tag (HTML tagName / Win32 class name / null)
  "name":        "OK",        // accessible name (UIA Name / aria-label / AX title)
  "value":       "...",       // current value (ValuePattern / input.value / AX value)
  "attributes":  {},          // all extra attrs: HTML attrs, UIA properties, COM props
  "position": { "x":0, "y":0, "width":100, "height":30 },
  "zOrder":      0,           // z-order / tab-order where available, else null
  "tabOrder":    0,
  "events":      ["click","change","focus"],  // available event types / actions
  "actions":     ["click","setValue","readValue"],  // helper-executable actions
  "children":    []           // recursive, same schema
}
```

### Unified Input Verbs — ALL helpers must support ALL of these

#### Keyboard
- [ ] **`{SENDKEYS:text}`** — type text with embedded special keys (`{ENTER}`, `{TAB}`, etc.)
      Already in KeyWin + BrowserWin. Ensure consistent across all helpers.
- [x] **`{KEYDOWN:key}`** — hold a key (modifier: Ctrl, Alt, Shift, Win)
      → Win32: `SendInput(KEYEVENTF_KEYDOWN)` | JS: `dispatchEvent(new KeyboardEvent('keydown'))`
- [x] **`{KEYUP:key}`** — release a held key
      → Win32: `SendInput(KEYEVENTF_KEYUP)` | JS: `dispatchEvent(new KeyboardEvent('keyup'))`  
- [x] **`{KEYPRESS:key}`** — atomic keydown+keyup (for non-modifier keys)
      → Win32: `SendInput` pair | JS: `KeyboardEvent('keydown')` + `KeyboardEvent('keyup')`
- [x] **`{KEYPRESS:Ctrl+S}`** — chord: hold modifiers, press key, release all
- [ ] **Two delivery modes** for all key events:
  - `global` — `SendInput` to global queue (goes to focused window)
  - `direct` — `PostMessage(WM_KEYDOWN/WM_CHAR)` to specific HWND or JS `dispatchEvent`
    to specific element. Specify element via path: `{KEYPRESS:Enter::#submitBtn}`

#### Mouse
- [ ] **`{CLICK:x,y}`** — left click at screen coordinates
      Already in KeyWin as `{CLICK}`. Standardize format.
- [ ] **`{CLICK:elementPath}`** — left click at element centre (find element first)
- [x] **`{RIGHTCLICK:x,y}`** / **`{RIGHTCLICK:elementPath}`**
- [x] **`{DBLCLICK:x,y}`** / **`{DBLCLICK:elementPath}`**
- [x] **`{HOVER:x,y}`** / **`{HOVER:elementPath}`** — mouse move, no click
- [x] **`{MOUSEDOWN:x,y}`** / **`{MOUSEUP:x,y}`** — split press/release for drag
- [ ] **Two delivery modes**:
  - `sendinput` — `SendInput(INPUT_MOUSE)` via global input queue (realistic)
  - `message` — `PostMessage(WM_LBUTTONDOWN/WM_LBUTTONUP)` direct to HWND
    (works in background, but some apps ignore posted mouse messages)
  - `js` (browser only) — `element.dispatchEvent(new MouseEvent('click'))` — fires
    JS event handlers without actual OS mouse movement

#### Value / State
- [x] **`{FILL:selector:value}`** — set input value directly (no keyboard simulation)
      → Win32: `ValuePattern.SetValue` | JS: `el.value='x'` + input/change events
      → AT-SPI2: `atspi_editable_text_set_text_contents`
      → AX API: `AXUIElementSetAttributeValue(kAXValueAttribute)`
- [ ] **`{SET:selector:value}`** — alias for FILL (already in KeyWin)
- [x] **`{CHECK:selector}`** / **`{UNCHECK:selector}`** — checkbox toggle
      → Win32: `TogglePattern` | JS: `el.checked=true` + change event

#### Reading
- [ ] **`{READ}`** — read primary display text (title/value of main control)
- [x] **`{READELEM:selector}`** — read value of specific element
- [ ] **`{QUERYTREE}`** / **`{QUERYTREE:depth}`** — full tree at depth
- [ ] All produce the unified node schema above

### NOTE: same logic applies to KeyWin.exe
KeyWin currently has `SENDKEYS`, `CLICKID`, `CLICKNAME`, `CLICK`, `READ`, `SET`, `QUERYTREE`.
~~It is missing: `KEYDOWN`, `KEYUP`, `KEYPRESS`, `RIGHTCLICK`, `DBLCLICK`, `HOVER`,
`MOUSEDOWN`, `MOUSEUP`, `FILL`, `READELEM`, `CHECK`, `UNCHECK`.~~
**All 12 listed commands have now been implemented in KeyWin.exe and BrowserWin.exe.**

---

## 🕰️ Platform Portability — Fallback Chain (FUTURE / LOWER PRIORITY)

> These items apply when porting AIAPI helpers to older Windows versions or to Linux/macOS.
> All fallbacks should mirror the same hidden/shown/listed-existing session model and the
> same unified input verbs and tree schema defined above.

### Windows Backwards Compatibility — Fallback Chain

Implement in BrowserWin + KeyWin, selected at runtime based on available APIs:

```
Win10/11:  CDP WebSocket  →  UIA (UIAutomationCore.dll)  →  MSAA IAccessible
Win7/8:    CDP WebSocket  →  UIA  →  MSAA  →  IHTMLDocument2 (WebBrowser ActiveX + IE)
WinVista:  UIA  →  MSAA  →  IHTMLDocument2
WinXP:     MSAA  →  IHTMLDocument2 (IE6/7)  →  WM_GETTEXT + EnumChildWindows
Win2000:   MSAA (partial)  →  IHTMLDocument2 (IE5)  →  WM_GETTEXT
Win98/95:  IHTMLDocument2 (IE4+)  →  WM_GETTEXT  →  GetDlgItemText (Win16 controls)
Win3.1:    WM_GETTEXT  →  GetDlgItemText  →  nothing (no accessibility API exists)
```

- [ ] **Runtime API detection**: probe for `UIAutomationCore.dll` existence before using UIA
- [ ] **IHTMLDocument2 fallback** (Win95+, IE4+ installed):
  - `CoCreateInstance(CLSID_WebBrowser)` + `get_Document(&pDoc)` + `get_body(&el)` +
    `get_innerHTML` / `put_innerHTML` — full in-process DOM, no flags, all Windows versions
  - Only works when embedding a WebBrowser control (your own hosted browser window),
    not for standalone Chrome/Firefox
- [ ] **MSAA IAccessible fallback** (Win95 + MSAA SDK installed, or IE4+):
  - `AccessibleObjectFromWindow` available on all Windows since Win95 with MSAA DLL
  - Walk via `accChild(i)`, `accName()`, `accRole()`, `accValue()`
  - Firefox exposes full ARIA tree here via IAccessible2 extension
- [ ] **WM_GETTEXT / EnumChildWindows** (Win3.1+, always available):
  - Reliable only for classic Win32 controls (Edit, Button, ListBox, ComboBox)
  - Browser render widget: always returns empty string
- [ ] **Note**: Session model (headless/visible/reuse-existing) applies equally at every
  level — regardless of API version, the AI should be able to say "open a browser window
  silently" or "reuse the existing browser window"

### Linux — Platform Fallback Chain (FUTURE)

```
Modern (2015+):    CDP WebSocket  →  AT-SPI2 (D-Bus)  →  XDoTool + XQueryTree
Older (2005-2015): AT-SPI2 (CORBA/D-Bus)  →  XDoTool  →  XQueryTree + XGetWindowProperty
Classic (1990-2005): XQueryTree + XSendEvent  →  XGetWindowProperty  →  nothing
```

- [ ] **AT-SPI2 D-Bus tree walker**: `org.a11y.atspi.Accessible` interface on session bus.
  Firefox exposes full ARIA→AT-SPI2 bridge. Same role/name/value/children as UIA.
  Python reference: `pyatspi`. C reference: `at-spi2-core`.
- [ ] **XDoTool-equivalent**: wrap `XSendEvent(display, window, KeyPress/ButtonPress)` for
  keyboard + mouse injection without any accessibility API
- [ ] **WebKitGTK `ExecuteScript`**: for hosting a browser in-process on Linux
  (`webkit_web_view_evaluate_javascript`) — equivalent to WebView2 on Windows
- [ ] **Note**: same unified node schema and input verbs must be produced by AT-SPI2 walker

### macOS — Platform Fallback Chain (FUTURE)

```
Modern (2015+):    CDP WebSocket  →  AX API (AXUIElement)  →  AppleScript
Older (2005-2015): AX API  →  AppleScript  →  CGEventPost
Classic MacOS (pre-OSX): AppleScript Apple Events only
```

- [ ] **AX API tree walker**: `AXUIElementCreateSystemWide()` → `kAXChildrenAttribute` walk.
  Same ARIA→AX bridge as UIA/AT-SPI2. ObjC/Swift only; P/Invoke-able from .NET via Mono.
- [ ] **AppleScript `do JavaScript`** (Safari + macOS 10.0+):
  ```applescript
  tell application "Safari"
      do JavaScript "document.getElementById('custname').value" in current tab of front window
  end tell
  ```
  Zero flags, works from day 1 of Mac OS X. Gives full JS eval equivalent to CDP
  `Runtime.evaluate` — but Safari only. AppleScript is sendable via `NSAppleScript` from
  any process.
- [ ] **CGEventPost**: `CGEventCreateKeyboardEvent` / `CGEventCreateMouseEvent` — macOS
  equivalent of `SendInput`. Works globally without accessibility permissions on older macOS;
  requires "Accessibility" permission grant in System Preferences on macOS 10.15+.
- [ ] **WKWebView `evaluateJavaScript`**: in-process embedded browser on macOS/iOS,
  equivalent to WebView2. Part of WebKit framework, always available since macOS 10.10.
- [ ] **Note**: same unified input verbs and tree schema must be produced

---

## 📋 Implementation Priority
1. **PRIORITY 1 - Security & Config UI:**
   - a) Configuration UI for paths and settings
   - b) Security filters visual editor
   - c) Interactive scenario editor with IntelliSense
   - d) Windows installer with auto-setup
2. **PRIORITY 2 - Browser Automation:**
   - a) BrowserWin.exe with Edge/Chrome support
   - b) DOM structure access and manipulation
   - c) Test scenarios
3. **PRIORITY 3 - Office Automation:**
   - a) OfficeWin.exe with Word support
   - b) Excel and PowerPoint support
   - c) Document structure queries
4. **PRIORITY 4 - Advanced Features:**
   - a) Firefox and Brave browser support
   - b) Screenshots and video recording
   - c) Complex DOM/document queries
   - d) AI-assisted scenario generation

---

## ✅ Completed (Current State)
- [x] KeyWin.exe for Windows Forms automation
- [x] Calculator automation working end-to-end
- [x] Dashboard with Raw Mode
- [x] Dashboard working directory management
- [x] Command-line initial working directory support
- [x] Process hash endpoint with optional listWindows hashing
- [x] Helper executables path setting with wildcard support
- [x] Session token authentication
- [x] Logging system unified
- [x] Git repository created and pushed\n- [x] **Security Filter Command Detection (PRIORITY 0 - COMPLETED)**\n  - [x] Added command detection functions to KeyWin.exe\n  - [x] Implemented security filter validation in AutomationEngine\n  - [x] Added MCP server security filter integration\n  - [x] Created comprehensive test scenarios for all command types\n  - [x] Documented security filter evaluation order (DENY wins, default DENY)\n  - [x] Security validation covers all command types: QUERYTREE, READ, CLICKID, CLICKNAME, CLICK, SET, SENDKEYS, LAUNCH, KILL
