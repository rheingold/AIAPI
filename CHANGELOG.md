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

### Added
- `aiAutomation.openDashboard` command (Command Palette + status bar click).
- `@vscode/vsce` devDependency; `npm run package:vsix` and `publish:vsix` scripts.
- `.vscodeignore` — excludes source, tests, docs, build tools from VSIX bundle.
- GitHub Actions workflow `.github/workflows/release.yml`:
  - builds VSIX on every `v*` tag push and on manual trigger
  - uploads `.vsix` as a build artifact
  - creates a GitHub Release with the VSIX on tagged pushes
- `extensionKind: ["ui"]` — enforces local-only execution (required for Windows helpers).

### Removed
- Legacy `enableLegacyHttp` / `httpPort` settings (the old REST server is gone).
- Old automation commands: `aiAutomation.inspectWindow`, `aiAutomation.clickElement`,
  `aiAutomation.setProperty`, `aiAutomation.readProperty`.

### Fixed
- `package.json` repository URL was a placeholder; now points to `rheingold/AIAPI`.
- `package.json` `files` array referenced non-existent `MCP_IPC_QUICK.md` / `INDEX.md`.
- `version` bumped from `0.1.1` to `0.2.0` to reflect the breaking architecture change.

---

## [0.1.1] — 2025 (initial scaffold)

### Added
- Initial VS Code extension scaffold with `AutomationEngine` + basic MCP server.
- `extension.mcp.callTool` / `extension.mcp.listTools` IPC command pair.
- Windows Forms, Web, and Office UI providers.
- REST HTTP API server (legacy; default off).
