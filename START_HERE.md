# Getting Started

## Installation

1. **Install Dependencies**
```bash
cd c:\Users\plachy\Documents\Dev\VSCplugins\AIAPI
npm install
```

2. **Compile TypeScript**
```bash
npm run compile
```

3. **Verify WinKeys.exe exists**
```powershell
Test-Path dist\win\WinKeys.exe
# Should return True
```

If False, rebuild it:
```powershell
.\scripts\build-win-tools.ps1
```

## Running the Server

```bash
node dist/start-mcp-server.js
```

Server starts on `http://127.0.0.1:3457`

> **Persistent daemons:** Once started, `KeyWin.exe` and `BrowserWin.exe` run as
> long-lived child processes (one per helper). This eliminates per-call spawn overhead
> but means the `.exe` files are **locked** while the server is running.

## Rebuild Workflow

Because daemons hold the `.exe` open, you must stop the server before rebuilding:

```powershell
# 1. Stop server cleanly (Ctrl+C in server terminal — sends _exit to helpers)
#    OR force-kill if needed:
Get-Process node -EA SilentlyContinue | Stop-Process -Force
Get-Process KeyWin, BrowserWin -EA SilentlyContinue | Stop-Process -Force

# 2. Rebuild TypeScript + C# helpers
PowerShell -ExecutionPolicy Bypass -File build-all.ps1

# 3. Restart server (daemons start automatically on first tool call)
node dist/start-mcp-server.js
```

Skipping step 1 will produce:
`error CS0016: Cannot write to KeyWin.exe — file in use by another process`

## First Test

Open a new PowerShell terminal and run:

```powershell
# Test 1: Launch Calculator
Invoke-WebRequest -Uri "http://127.0.0.1:3457" `
  -Method POST `
  -ContentType "application/json" `
  -UseBasicParsing `
  -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchProcess","arguments":{"executable":"calc.exe"}}}'

# Wait for Calculator to load
Start-Sleep -Seconds 3

# Test 2: Send calculation
Invoke-WebRequest -Uri "http://127.0.0.1:3457" `
  -Method POST `
  -ContentType "application/json" `
  -UseBasicParsing `
  -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"setProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"keys","value":"5+3="}}}'

# Test 3: Read result
$response = Invoke-WebRequest -Uri "http://127.0.0.1:3457" `
  -Method POST `
  -ContentType "application/json" `
  -UseBasicParsing `
  -Body '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"readProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"text"}}}'

$result = ($response.Content | ConvertFrom-Json).result
Write-Host "Calculator shows: $($result.value)"
# Expected: "Zobrazuje se 8" or similar (Czech locale)

# Cleanup
Get-Process | Where-Object { $_.ProcessName -like "*calc*" } | Stop-Process -Force
```

## Next Steps

- **For AI Assistants**: Read [AI_ASSISTANT_MANUAL.md](AI_ASSISTANT_MANUAL.md)
- **API Reference**: See [SERVER_API.md](SERVER_API.md) for all available tools
- **WinKeys.exe**: See [WINKEYS_API.md](WINKEYS_API.md) for direct binary usage

## VS Code Extension

Package the extension:
```bash
npm run package
```

This creates `ai-ui-automation-0.1.1.vsix` which can be installed in VS Code.

## Troubleshooting

### Server won't start
- Check if port 3457 is available
- Ensure `dist/` folder exists and contains compiled files
- Run `npm run compile` again

### Calculator not found
- Wait longer (3-5 seconds) after launching
- Use "ApplicationFrameHost" as target ID
- Check if Calculator is running: `Get-Process ApplicationFrameHost`

### Helper .exe not found (KeyWin.exe / BrowserWin.exe)
- Rebuild: `PowerShell -ExecutionPolicy Bypass -File build-all.ps1`
- Check: `Test-Path dist\win\KeyWin.exe` and `Test-Path dist\browser\BrowserWin.exe`
- If build fails with "file in use": server is still running — see **Rebuild Workflow** above

## Development

```bash
# Watch mode (auto-compile on file changes)
npm run watch

# Rebuild everything (TypeScript + KeyWin.exe + BrowserWin.exe)
# ⚠️ Stop server first! See Rebuild Workflow above.
PowerShell -ExecutionPolicy Bypass -File build-all.ps1

# TypeScript only
npm run compile
```

## Project Structure

```
AIAPI/
├── dist/                      # Compiled output
│   ├── start-mcp-server.js   # Server entry point
│   ├── win/KeyWin.exe         # Windows UI automation helper
│   └── browser/BrowserWin.exe # Browser (CDP + UIA) helper
├── src/                       # TypeScript source
│   ├── extension.ts           # VS Code extension
│   ├── server/                # MCP server + HelperRegistry
│   ├── engine/                # Automation engine
│   └── providers/             # Platform providers
├── tools/win/KeyWin.cs        # KeyWin source
├── tools/browser/BrowserWin.cs # BrowserWin source
├── tools/common/HelperCommon.cs # Shared helper transport code
├── scripts/                   # Build scripts
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
└── *.md                       # Documentation
```
