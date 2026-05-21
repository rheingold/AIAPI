# MCP Server Guide - Out-of-the-Box Setup

## Quick Start

### 1. Start the Server

```powershell
node dist/start-mcp-server.js
```

Server runs on: **http://127.0.0.1:3457**

### 2. Health Check

Visit any of these URLs in your browser:
- http://127.0.0.1:3457/
- http://127.0.0.1:3457/health
- http://127.0.0.1:3457/ping

Returns JSON with server status and available endpoints.

### 3. View Documentation

**HTML (Human-Readable):**
- http://127.0.0.1:3457/docs - Documentation index
- http://127.0.0.1:3457/docs/api - WinKeys API reference
- http://127.0.0.1:3457/docs/scenarios - Scenario format documentation
- http://127.0.0.1:3457/docs/errors - Error codes and remediation

**Markdown (Raw):**
- http://127.0.0.1:3457/api - API reference (markdown)
- http://127.0.0.1:3457/api/errors - Error codes (markdown)

### 4. List Available Scenarios

```powershell
Invoke-RestMethod http://127.0.0.1:3457/scenarios
```

Returns JSON list of all scenarios in `/scenarios` folder with descriptions.

## Using the MCP Server

### JSON-RPC 2.0 Protocol

The server implements the Model Context Protocol (MCP) using JSON-RPC 2.0 over HTTP POST.

**Endpoint:** `POST http://127.0.0.1:3457/`

### Available Tools

#### 1. Execute Scenario

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "executeScenario",
    "arguments": {
      "scenarioPath": "scenarios/calculator-basic.json",
      "verbose": true
    }
  }
}
```

**Parameters:**
- `scenarioPath` - Path to scenario JSON file (relative or absolute)
- `scenarioJson` - Inline scenario object (alternative to file)
- `verbose` - Enable detailed logging (optional)

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "scenarioName": "Calculator Basic Arithmetic",
    "success": true,
    "steps": [...],
    "duration": 12332
  }
}
```

#### 2. Query UI Tree

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "queryTree",
    "arguments": {
      "providerName": "windowsForms",
      "targetId": "HANDLE:396108",
      "options": { "depth": 2 }
    }
  }
}
```

#### 3. List Windows

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "listWindows",
    "arguments": {}
  }
}
```

Returns all visible windows with titles, handles, and PIDs.

#### 4. Launch Process

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "launchProcess",
    "arguments": {
      "executable": "calc.exe",
      "args": []
    }
  }
}
```

## Scenario Format

Scenarios are JSON files defining automation sequences with:
- **Variables** - Store and reuse values
- **Steps** - Sequential actions (launch, find, click, type, read, etc.)
- **Assertions** - Validate results
- **Delays** - Automatic timing + manual overrides

**Example:** `scenarios/calculator-basic.json`

See full documentation at: http://127.0.0.1:3457/docs/scenarios

## Process Name vs Window Title

**Always use process names when possible!**

✅ **Good (locale-independent):**
```json
{
  "action": "findWindow",
  "params": {
    "processName": "calc"
  }
}
```

❌ **Avoid (locale-dependent):**
```json
{
  "action": "findWindow",
  "params": {
    "titlePattern": "*Calculator*"
  }
}
```

The process name approach works regardless of Windows language:
- English: "Calculator"
- Czech: "Kalkulačka"  
- German: "Rechner"
→ All use process name: `calc`

## Integration with VS Code Extension

The MCP server runs automatically when the VS Code extension activates. The extension provides:
- **Auto-start** - Server launches on extension activation
- **Status bar** - Shows server status (running/stopped)
- **Commands** - Start/stop/restart server
- **Configuration** - Custom port, logging, etc.

## Testing the Server

### PowerShell Health Check
```powershell
Invoke-RestMethod http://127.0.0.1:3457/ping
```

### Execute Scenario
```powershell
$body = @{
    jsonrpc = "2.0"
    id = 1
    method = "tools/call"
    params = @{
        name = "executeScenario"
        arguments = @{
            scenarioPath = "scenarios/calculator-basic.json"
            verbose = $true
        }
    }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri http://127.0.0.1:3457/ -Method POST -Body $body -ContentType "application/json"
```

### Node.js Client
```javascript
const http = require('http');

const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
        name: 'executeScenario',
        arguments: {
            scenarioPath: 'scenarios/calculator-basic.json'
        }
    }
};

// ... (see test-mcp-scenario.js for complete example)
```

## Default Scenarios

### Calculator Basic Arithmetic
- Launch Calculator
- Perform 25 + 17 = 42
- Perform 144 ÷ 12 = 12
- Validate results
- Close Calculator

### Notepad Text Editing
- Launch Notepad
- Type multi-line text
- Select all (Ctrl+A)
- Copy (Ctrl+C)
- Query UI tree
- Close without saving

## Authentication Configuration

AIAPI's dashboard includes a built-in **Auth** panel (`🔑 Auth` in the sidebar) and a
REST API for configuring authentication.

### Quick Setup via Dashboard

1. Open the dashboard: `http://localhost:3458`
2. Click **🔑 Auth** in the sidebar
3. Select an **Authentication Mode** from the dropdown
4. Fill in the mode-specific settings (JWT secret, OAuth URLs, etc.)
5. Click **💾 Save Auth Config**

Changes take effect immediately — no server restart required.

### REST API: `GET /api/auth/config`

Returns the current auth configuration. Secrets are masked (`"***"`) in the response.

```http
GET http://localhost:3458/api/auth/config
```

```json
{
  "mode": "password",
  "debugExternalAuth": false,
  "jwt": { "enabled": true, "expiryMinutes": 60, "secret": "***" },
  "password": { "bcryptRounds": 10 },
  "users": { "storeSource": "json", "jsonPath": "./config/users.json" }
}
```

### REST API: `POST /api/auth/config`

Saves the auth configuration and re-initialises the auth service.
Omit secret fields (or send `"***"`) to preserve the existing value.

```http
POST http://localhost:3458/api/auth/config
Content-Type: application/json
```

#### Example — enable password auth with JWT

```json
{
  "mode": "password",
  "jwt": {
    "enabled": true,
    "expiryMinutes": 480,
    "secret": "change-this-to-a-random-64-char-hex-string"
  },
  "password": { "bcryptRounds": 10 },
  "users": {
    "storeSource": "json",
    "jsonPath": "./config/users.json"
  }
}
```

#### Example — OAuth 2.0 / OIDC (e.g. Entra ID)

```json
{
  "mode": "oauth",
  "jwt": { "enabled": true, "expiryMinutes": 60 },
  "oauth": {
    "clientId": "your-app-client-id",
    "clientSecret": "your-client-secret",
    "authorizationUrl": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    "tokenUrl":         "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
    "userInfoUrl":      "https://graph.microsoft.com/oidc/userinfo",
    "scope": "openid profile email",
    "callbackUrl": "http://localhost:3458/api/auth/oauth/callback",
    "usernamePath": "preferred_username",
    "groupsPath": "groups",
    "pkce": true
  },
  "users": { "storeSource": "json", "jsonPath": "./config/users.json" }
}
```

#### Example — SAML 2.0

```json
{
  "mode": "saml",
  "jwt": { "enabled": true, "expiryMinutes": 480 },
  "saml": {
    "entryPoint": "https://idp.example.com/sso/saml",
    "issuer": "https://your-aiapi-server.com",
    "cert": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
    "callbackUrl": "http://localhost:3458/api/auth/saml/callback",
    "usernamePath": "nameID",
    "groupsPath": "memberOf",
    "signatureAlgorithm": "sha256"
  },
  "users": { "storeSource": "json", "jsonPath": "./config/users.json" }
}
```

#### Example — Database user store (PostgreSQL)

```json
{
  "mode": "password",
  "jwt": { "enabled": true, "expiryMinutes": 60 },
  "users": {
    "storeSource": "db",
    "db": {
      "type": "postgresql",
      "authMethod": "password",
      "host": "localhost",
      "port": 5432,
      "database": "aiapi",
      "username": "aiapi_user",
      "password": "secret"
    }
  }
}
```

On first run with `storeSource: "db"`, AIAPI automatically creates the required
tables: `aiapi_users`, `aiapi_roles`, `aiapi_user_roles`, `aiapi_apikeys`.

### Managing Users & Roles

Once auth mode is enabled, use the **👥 Users & Roles** sub-tab in the Auth panel, or
call the `_internal` REST endpoints directly:

| Endpoint | Method | Description |
|---|---|---|
| `/api/_internal/users` | GET | List all users |
| `/api/_internal/users` | POST | Create user (`username`, `password`, `roles`, `enabled`) |
| `/api/_internal/users/{id}` | PUT | Update user |
| `/api/_internal/users/{id}` | DELETE | Delete user |
| `/api/_internal/users/{id}/apikeys` | POST | Generate new API key |
| `/api/_internal/roles` | GET | List all roles |
| `/api/_internal/roles` | POST | Create role (`name`, `description`) |
| `/api/_internal/roles/{name}` | DELETE | Delete role |

All `_internal` endpoints respect security filter rules (add `_internal` → `access` /
`settings_change` rules in the **🛡️ Security Filters** panel to restrict access).

---

## Error Handling

All errors return JSON with:
```json
{
  "success": false,
  "error": "error_code",
  "message": "Human-readable description"
}
```

See complete error reference: http://127.0.0.1:3457/docs/errors

## Architecture

```
┌─────────────────────────────────────────┐
│  HTTP Client (Browser/AI/Script)       │
└────────────────┬────────────────────────┘
                 │ HTTP GET/POST
                 ↓
┌─────────────────────────────────────────┐
│  MCP Server (port 3457)                 │
│  - Health check (/ping)                 │
│  - Documentation (/docs, /api)          │
│  - Scenarios list (/scenarios)          │
│  - JSON-RPC 2.0 (POST /)                │
└────────────────┬────────────────────────┘
                 │
         ┌───────┴────────┐
         │                │
         ↓                ↓
┌─────────────────┐  ┌──────────────────┐
│ ScenarioReplayer│  │ AutomationEngine │
│ (JSON scenarios)│  │ (Direct calls)   │
└────────┬────────┘  └────────┬─────────┘
         │                    │
         └────────┬───────────┘
                  ↓
         ┌─────────────────┐
         │  WinKeys.exe    │
         │  (Win32 API)    │
         └─────────────────┘
```

## Best Practices

1. **Always use process names** instead of window titles for locale independence
2. **Check /health** before making API calls to ensure server is running
3. **Use default delays** in scenarios - they're tuned for reliability
4. **Test scenarios standalone** before integrating into MCP calls
5. **Read /docs/api** for complete WinKeys.exe command reference
6. **Monitor verbose output** when debugging scenario failures

## Troubleshooting

### Server won't start
- Check if port 3457 is already in use
- Verify WinKeys.exe exists at `dist/win/WinKeys.exe`
- Run `npm run compile` to rebuild

### Scenario fails
- Check /docs/errors for error code meaning
- Enable `verbose: true` in scenario execution
- Test WinKeys.exe directly: `dist\win\WinKeys.exe calc "{READ}"`

### Window not found
- Use `listWindows` tool to see all available windows
- Verify process is running: `Get-Process calc`
- Use process name instead of title pattern

## Next Steps

1. ✅ Start server: `node dist/start-mcp-server.js`
2. ✅ Test health: `http://127.0.0.1:3457/ping`
3. ✅ Read docs: `http://127.0.0.1:3457/docs/api`
4. ✅ List scenarios: `http://127.0.0.1:3457/scenarios`
5. ✅ Execute test: Use `test-mcp-scenario.js`
6. 🎯 Create your own scenarios in `/scenarios` folder
7. 🎯 Integrate with your AI or automation tools
