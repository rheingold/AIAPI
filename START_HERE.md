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

### WinKeys.exe not found
- Rebuild: `.\scripts\build-win-tools.ps1`
- Check: `Test-Path dist\win\WinKeys.exe`

## Development

```bash
# Watch mode (auto-compile on file changes)
npm run watch

# Rebuild WinKeys.exe
.\scripts\build-win-tools.ps1

# Run TypeScript compiler
npm run compile
```

## Project Structure

```
AIAPI/
├── dist/                      # Compiled output
│   ├── start-mcp-server.js   # Server entry point
│   └── win/WinKeys.exe        # Windows automation binary
├── src/                       # TypeScript source
│   ├── extension.ts           # VS Code extension
│   ├── server/                # MCP server
│   ├── engine/                # Automation engine
│   └── providers/             # Platform providers
├── tools/win/WinKeys.cs       # WinKeys source
├── scripts/                   # Build scripts
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
└── *.md                       # Documentation
```
