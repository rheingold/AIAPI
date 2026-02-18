# Windows UI Automation System

JSON-RPC 2.0 HTTP server providing automated Windows UI testing capabilities. AI assistants can use this to launch applications, query UI structures, send input, and verify results.

## Quick Start

```powershell
# 1. Start MCP Server
node dist/start-mcp-server.js
# Server runs on http://127.0.0.1:3457

# 2. Launch and test Calculator
Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchProcess","arguments":{"executable":"calc.exe"}}}'

# 3. Send keyboard input
Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"setProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"keys","value":"5+3="}}}'

# 4. Read result
$response = Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"readProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"text"}}}'
($response.Content | ConvertFrom-Json).result.value
```

## Features

- **Launch Applications**: Start any Windows application via API
- **Query UI Structure**: Get element tree with positions and properties
- **Keyboard Input**: Send keys to applications (direct or focus mode)
- **Read Values**: Extract display text and control values
- **Mouse Control**: Click elements by coordinates or name
- **Window Management**: List and enumerate all visible windows
- **Direct Injection**: Universal input injection without focus stealing (uses UI Automation)

## API Tools

- `launchProcess` - Start applications
- `listWindows` - Enumerate windows with titles and PIDs
- `queryTree` - Get UI structure with element positions
- `setProperty` - Send input (keyboard, mouse, values)
- `readProperty` - Read display values
- `clickElement` - Click UI elements
- `getProviders` - List available automation providers

## Documentation

- **[AI_ASSISTANT_MANUAL.md](AI_ASSISTANT_MANUAL.md)** - Complete guide for AI assistants
- **[SERVER_API.md](SERVER_API.md)** - HTTP JSON-RPC API reference
- **[KEYWIN_API.md](KEYWIN_API.md)** - KeyWin.exe command reference (includes injection modes)
- **[API.md](API.md)** - High-level overview
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System design
- **[SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md)** - Security design and implementation
- **[START_HERE.md](START_HERE.md)** - Getting started

## Input Injection Modes

KeyWin.exe supports two injection modes:

### Direct Mode (Default) - `--inject-mode=direct`
- **No focus stealing**: Input injected without activating the target window
- **Universal approach**: Works with Win32 and UWP apps (Notepad, Calculator)
- **UI Automation**: Uses ValuePattern for text controls, InvokePattern for buttons
- **Language-independent**: Uses AutomationId instead of localized button names
- **Best for**: Automation running in background, multi-window workflows

### Focus Mode - `--inject-mode=focus`
- **Traditional approach**: Activates window (SetForegroundWindow), then uses SendKeys
- **Steals focus**: Target window comes to front
- **Universal compatibility**: Works with all apps that accept keyboard input
- **Best for**: Single-window focused testing, legacy apps

### Configuration

Set injection mode via:
1. **Command-line**: `KeyWin.exe --inject-mode=direct notepad "text"`
2. **Environment variable**: `KEYWIN_INJECT_MODE=focus`
3. **MCP Provider**: Set `KEYWIN_INJECT_MODE` before starting server

**Default:** `direct` mode for minimal disruption

## Architecture

```
HTTP Client (PowerShell, Node.js, etc)
  ↓ JSON-RPC 2.0
MCP Server (TypeScript - port 3457)
  ↓
Automation Engine (TypeScript)
  ↓
Windows Forms Provider (TypeScript)
  ↓
WinKeys.exe (C# - UIAutomation wrapper)
  ↓
Windows UIAutomation Framework
```

## Requirements

- Windows 10/11
- Node.js 18+
- .NET Framework 4.0+ (for WinKeys.exe)

## Installation

```bash
npm install
npm run compile
```

## Build WinKeys.exe

```powershell
.\scripts\build-win-tools.ps1
```

## VS Code Extension

Can be packaged as VS Code extension:
```bash
npm run package
# Creates ai-ui-automation-0.1.1.vsix
```

## License

See LICENSE file.

