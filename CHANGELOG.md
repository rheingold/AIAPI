# Changelog

All notable changes to **AI UI Automation** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.2.0] — 2026-04-11

### Changed
- **`activate()` completely rewritten** — now starts the real `MCPServer` +
  `HttpServerWithDashboard` stack (same as `start-mcp-server.ts`).
  Previously started a stale `AutomationEngine` + `HttpServer` that was
  disconnected from the current architecture.
- `process.chdir(context.extensionPath)` pins CWD so all relative paths
  (`config/`, `security/`, `dist/helpers/`) resolve correctly inside a VSIX.
- `extension.mcp.callTool` and `extension.mcp.listTools` IPC commands now
  relay over loopback HTTP to the running `MCPServer` — full security filter
  and helper registry path is exercised, no code duplication with the server.
- `deactivate()` now correctly stops both servers gracefully.
- Status bar item `$(rocket) AIAPI :<port>` added; click opens the dashboard.
- Output channel `AIAPI` added for all server-side logs.
- **VSIX default ports changed to 3467 (MCP) / 3468 (dashboard)** so the installed
  extension never clashes with the dev server running on 3457/3458.
  Updated in: `package.json` contribution default, `extension.ts` fallback,
  and `config/dashboard-settings.json`.

### Added
- `aiAutomation.openDashboard` command (Command Palette + status bar click).
- `@vscode/vsce` devDependency; `npm run package:vsix` and `publish:vsix` scripts.
- `.vscodeignore` — excludes source, tests, docs, build tools from VSIX bundle.
- GitHub Actions workflow `.github/workflows/release.yml`:
  - builds VSIX on every `v*` tag push and on manual trigger
  - uploads `.vsix` as a build artifact
  - creates a GitHub Release with the VSIX on tagged pushes
- `extensionKind: ["ui"]` — enforces local-only execution (required for Windows helpers).
- **Security audit log persistence** — `GET /api/security/log` now draws from a rolling
  JSONL file (`config/security/security-audit.jsonl`) loaded at startup; security events
  are appended on every occurrence; file is trimmed to 10 000 entries.
- **Security audit log pagination** — `GET /api/security/log?limit=N&offset=N` supported;
  response includes `total`, `offset`, `limit` for cursor-based paging (max 500 per page).
- **Admin token bypass via HTTP header** — `X-Admin-Token: <token>` on any MCP `tools/call`
  request is now extracted and forwarded to `validateSecurityFilter`.
  Valid token → security filter bypassed; invalid/expired → filter still applied.

### Removed
- Legacy `enableLegacyHttp` / `httpPort` settings (the old REST server is gone).
- Old automation commands: `aiAutomation.inspectWindow`, `aiAutomation.clickElement`,
  `aiAutomation.setProperty`, `aiAutomation.readProperty`.

### Fixed
- `filterEval.ts`: `{BRACES}` around command names were not stripped before rule matching
  (e.g. `{CLICKID}` failed to match a rule written as `CLICKID`). Fixed with
  `commandType.replace(/^\{|\}$/g, '')`.
- `securityFilter.ts`: same normalisation applied at entry point for read-only exempt
  commands and system-process block checks.
- `HelperRegistry.auth.test.ts`: `daemon.call()` call sites updated to match expanded
  5-parameter signature `(target, command, elemPath, value, timeoutMs)`.
- `SessionToken.integration.test.ts`: `KeyWin.exe` path fixed to `process.cwd()` base;
  "valid token" test marked `xit` pending G-A1 (env-var HKDF auth not yet fully wired).
- `package.json` repository URL was a placeholder; now points to `rheingold/AIAPI`.
- `package.json` `files` array referenced non-existent `MCP_IPC_QUICK.md` / `INDEX.md`.
- `version` bumped from `0.1.1` to `0.2.0` to reflect the breaking architecture change.

### Also added in this chapter
- **Authentication Configuration UI** — full Auth panel in dashboard (mode selector,
  JWT settings, OAuth/SAML/Password/APIKey/Certificate panels, User Store config).
  REST endpoints: `GET/POST /api/auth/config`.
- **Users & Roles management** — Auth → Users & Roles tab; full CRUD via
  `/api/_internal/users` and `/api/_internal/roles`.
- **IntelliSense autocomplete in Scenario Editor** — command/target/parameter fields now
  autocomplete from helper schema (`se-cmd-list`) and live window handles (`se-tgt-list`);
  parameter examples loaded on focus (`se-par-list`).
- **Native Windows file/folder dialog** — all Settings Browse buttons now call
  `POST /api/shell/openFileDialog` (PowerShell System.Windows.Forms), with graceful
  fallback to `prompt()` on non-Windows.
- **First-run Setup Wizard** — idempotent `POST /api/_internal/setup` handles S1–S5
  (key-pair, signed config skeleton, dashboard-settings.json, users.json).
  Dashboard Settings tab shows collapsible step-table + Run button.
- `README.md` rewritten with VS Code Marketplace badges, feature table, MCP tools table,
  architecture diagram, docs table.
- `package.json` `categories` updated to include `"AI"`.

---

## [0.1.1] — 2025 (initial scaffold)

### Added
- Initial VS Code extension scaffold with `AutomationEngine` + basic MCP server.
- `extension.mcp.callTool` / `extension.mcp.listTools` IPC command pair.
- Windows Forms, Web, and Office UI providers.
- REST HTTP API server (legacy; default off).

