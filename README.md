# AI UI Automation

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/rheingold.ai-ui-automation?label=VS%20Code%20Marketplace&color=007acc)](https://marketplace.visualstudio.com/items?itemName=rheingold.ai-ui-automation)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/rheingold.ai-ui-automation?color=007acc)](https://marketplace.visualstudio.com/items?itemName=rheingold.ai-ui-automation)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/rheingold.ai-ui-automation?color=007acc)](https://marketplace.visualstudio.com/items?itemName=rheingold.ai-ui-automation)
[![License](https://img.shields.io/github/license/rheingold/AIAPI)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

> **MCP server for Windows UI automation inside VS Code.**  
> Drive any desktop app — Calculator, Notepad, Office, browsers — via natural-language tool calls from Claude, Copilot or any MCP client.

---

## Features

| Capability | Detail |
|---|---|
| 🖥️ **Windows UI control** | Click, type, read, drag — any Win32 / UWP / WPF app via UI Automation |
| 🌐 **Browser automation** | Full Chrome DevTools Protocol via BrowserWin.exe |
| 🤖 **MCP protocol** | MCP@HTTP (port 3458) and MCP@IPC (VS Code command relay) |
| 📊 **Dashboard** | Web UI on `http://localhost:3458/dashboard` — settings, scenarios, security |
| 🛡️ **Security filters** | Per-helper ALLOW/DENY rules with process, command, pattern scoping |
| 🔑 **Authentication** | None / Password / API-Key / OAuth 2.0 / SAML 2.0 / Certificates |
| 📜 **Scenario editor** | XML-based scenario authoring with IntelliSense autocomplete |
| ⚙️ **Setup wizard** | Idempotent first-run setup — generates keys, signs config, creates admin |

---

## Quick Start

### VS Code Extension (recommended)

1. Install from the VS Code Marketplace (`rheingold.ai-ui-automation`) or:
   ```bash
   code --install-extension dist/release/ai-ui-automation-0.2.0.vsix
   ```
2. The server starts automatically on VS Code launch.  
   Click the **$(rocket) AIAPI :3468** status bar item to open the dashboard.

### Standalone (without VS Code)

```powershell
npm install
npm run compile
node dist/start-mcp-server.js
# MCP server → http://127.0.0.1:3457
# Dashboard  → http://127.0.0.1:3458/dashboard
```

### First-run setup

Open the dashboard → **Settings** → expand **⚙️ First-Run Setup Wizard** → click **▶ Run Setup**.

This generates the cryptographic key pair, signs the security config, and creates the default admin user (`admin` / `changeme` — change immediately via the Auth tab).

---

## MCP Tools

| Tool | Description |
|---|---|
| `automateWindows` | SENDKEYS, CLICKID, CLICKNAME, READ, QUERYTREE, LISTWINDOWS, LAUNCH, KILL, … |
| `automateBrowser` | CDP_EVALUATE, CDP_CLICK, CDP_FILL, CDP_NAVIGATE, QUERYTREE, … |
| `getHelperSchema` | Introspect available commands and their schemas |
| `listHelpers` | List registered helper executables |
| `runScenario` | Execute an XML scenario |

All tool calls pass through the security filter chain before reaching the helper.

---

## Architecture

```
AI Client (Claude, Copilot, …)
  │  MCP JSON-RPC 2.0
  ▼
MCP Server (TS, port 3457)
  │  Security filter (ALLOW/DENY rules)
  ▼
HelperRegistry ──→ KeyWin.exe (Win32 / UWP / WPF, UI Automation)
                └→ BrowserWin.exe (Chrome DevTools Protocol)
  │
HttpServerWithDashboard (port 3458)
  └→ Dashboard SPA / REST API
```

---

## Security

- **Cryptographic key pair** (RSA-4096 AES-256-GCM encrypted) — used for config signing and helper authentication
- **Security filter chain** — every tool call is evaluated against ALLOW/DENY rules (process, helper, command, pattern, role)
- **Admin Session Tokens** — 15-minute time-limited bypass with full audit trail
- **Auth modes** — None, Password, API Key, Client Certificate, OAuth 2.0 / OIDC, SAML 2.0
- **Audit log** — rolling JSONL persisted log of every security event

---

## Documentation

| Document | Description |
|---|---|
| [docs/api/API.md](docs/api/API.md) | Public REST + MCP API reference |
| [docs/api/SERVER_API.md](docs/api/SERVER_API.md) | HTTP server API details |
| [docs/api/KEYWIN_API.md](docs/api/KEYWIN_API.md) | KeyWin.exe command reference |
| [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | System design |
| [docs/architecture/SECURITY_ARCHITECTURE.md](docs/architecture/SECURITY_ARCHITECTURE.md) | Security model |
| [docs/guides/SERVER_GUIDE.md](docs/guides/SERVER_GUIDE.md) | Deployment & configuration |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

---

## Requirements

- **Windows 10 / 11** (helpers are native Windows binaries)
- **Node.js 18+**
- **VS Code 1.75+** (extension mode only)
- **.NET 4.8+** (for `KeyWin.exe` / `BrowserWin.exe`)

---

## License

[MIT](LICENSE) © 2024-2026 rheingold


