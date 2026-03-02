# AI Assistant Manual - Windows UI Automation System

## Quick Start

This system provides automated Windows UI testing through a JSON-RPC API server and a native Windows binary (WinKeys.exe).

### Starting a Test Session

1. **Start MCP Server**:
```powershell
cd C:\Users\plachy\Documents\Dev\VSCplugins\AIAPI
node dist/start-mcp-server.js
# Server starts on http://127.0.0.1:3457
```

2. **Verify Server is Running**:
```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

### Complete Test Workflow Example

```powershell
# 1. Launch application
Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchProcess","arguments":{"executable":"calc.exe"}}}'

# Wait for UI to load
Start-Sleep -Seconds 3

# 2. Query UI structure
$response = Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"queryTree","arguments":{"providerName":"windows-forms","targetId":"ApplicationFrameHost","options":{"depth":3}}}}'
$tree = ($response.Content | ConvertFrom-Json).result
Write-Host "Window: $($tree.name) at position $($tree.position.x),$($tree.position.y)"

# 3. Send keyboard input
Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"setProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"keys","value":"25+17="}}}'

# 4. Read result
$response = Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"readProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"text"}}}'
$result = ($response.Content | ConvertFrom-Json).result
Write-Host "Result: $($result.value)"

# 5. Cleanup
Get-Process | Where-Object { $_.ProcessName -like "*calc*" } | Stop-Process -Force
```

### Ending a Test Session (IMPORTANT!)

Always clean up after tests:
```powershell
# Stop application under test
Get-Process | Where-Object { $_.ProcessName -like "*calc*" } | Stop-Process -Force

# Stop MCP Server (if running as job)
Get-Job | Stop-Job
Get-Job | Remove-Job
```

## Key Concepts

### 1. Window Targeting

The system uses **process names or window titles** to target windows:
- **Process name**: "CalculatorApp", "notepad", "ApplicationFrameHost"
- **Window title**: "Kalkulačka", "Untitled - Notepad"

For Calculator on Windows 10/11, use **"ApplicationFrameHost"** as the target.

### 2. Available Operations

- **launchProcess**: Start applications
- **listWindows**: Enumerate all windows with titles
- **queryTree**: Get UI structure with element positions
- **setProperty**: Send input (keyboard, mouse, values)
- **readProperty**: Read display values or element properties
- **clickElement**: Click UI elements

### 3. WinKeys.exe Direct Usage

For debugging or simple scripts, use WinKeys.exe directly:

```powershell
# Send keys
& "dist\win\WinKeys.exe" "Calculator" "5+3="

# Read display (parse JSON output)
$output = & "dist\win\WinKeys.exe" "Calculator" "{READ}" 2>&1 | Where-Object { $_ -match '^\{' }
$result = $output | ConvertFrom-Json
Write-Host "Value: $($result.value)"

# Query UI structure
& "dist\win\WinKeys.exe" "Calculator" "{QUERYTREE:3}" 2>&1 | Where-Object { $_ -match '^\{' } | ConvertFrom-Json

# List all windows
& "dist\win\WinKeys.exe" "dummy" "{LISTWINDOWS}" 2>&1 | Where-Object { $_ -match '^\{' } | ConvertFrom-Json
```

## Common Patterns

### Pattern 1: Test Calculation Application

```powershell
# Launch
launchProcess("calc.exe")

# Wait for UI
Start-Sleep -Seconds 3

# Query structure to understand layout
queryTree("ApplicationFrameHost", depth=3)

# Perform calculations
setProperty("ApplicationFrameHost", "keys", "7+9=")

# Verify result
$result = readProperty("ApplicationFrameHost", "text")
# Expected: result.value contains "16"

# Clear
setProperty("ApplicationFrameHost", "keys", "{ESC}")
```

### Pattern 2: Mouse Click Automation

```powershell
# 1. Query UI to get button positions
$tree = queryTree("ApplicationFrameHost", depth=5)

# 2. Find button in tree
$button = $tree.children | Where-Object { $_.name -like "*Plus*" }

# 3. Click at absolute coordinates
$x = $button.position.x + $button.position.width / 2
$y = $button.position.y + $button.position.height / 2

# 4. Send click via WinKeys
& "dist\win\WinKeys.exe" "Calculator" "{CLICK:$x,$y}"
```

### Pattern 3: List and Find Windows

```powershell
# Get all windows
$windows = listWindows()

# Find Calculator
$calcWindow = $windows.windows | Where-Object { $_.title -like "*alcul*" } | Select-Object -First 1

# Use handle or title for targeting
Write-Host "Calculator PID: $($calcWindow.pid)"
Write-Host "Calculator Handle: $($calcWindow.handle)"
```

## Troubleshooting

### Issue: "Calculator window not found"
**Solution**: Windows 10/11 Calculator loads slowly. Wait 3-5 seconds after launching, then use "ApplicationFrameHost" as target.

### Issue: "Server cannot be reached"
**Solution**: Check if MCP server is running:
```powershell
Get-Job  # Should show running job
# If not, restart:
Start-Job -ScriptBlock { Set-Location C:\Users\plachy\Documents\Dev\VSCplugins\AIAPI; node dist/start-mcp-server.js }
```

### Issue: "Read returns Czech text instead of numbers"
**Note**: This is expected. The display value includes locale text like "Zobrazuje se 42" (Czech for "Displaying 42"). Parse the number from the string using regex:
```powershell
if ($result.value -match "\d+") {
    $number = $matches[0]
}
```

### Issue: Hidden terminals in VS Code
**Solution**: Settings are configured to never hide terminals. Check `.vscode/settings.json` has:
```json
{
  "terminal.integrated.tabs.hideCondition": "never"
}
```

## Architecture Overview

```
MCP Server (HTTP JSON-RPC)
  ↓
AutomationEngine (TypeScript)
  ↓
WindowsFormsProvider (TypeScript wrapper)
  ↓
WinKeys.exe (C# UIAutomation binary)
  ↓
Windows UIAutomation Framework
```

**Design Principles**:
1. **Server**: Business logic and API
2. **WinKeys.exe**: OS-level facilitation only (no business logic)
3. **JSON output**: Language-independent structured data

## File Structure

Essential files only:
```
├── dist/                          # Compiled output
│   ├── start-mcp-server.js       # Server entry point
│   └── win/
│       └── WinKeys.exe            # Windows automation binary
├── src/                           # TypeScript source
│   ├── extension.ts               # VS Code extension entry
│   ├── engine/                    # Automation engine
│   ├── providers/                 # Platform providers
│   └── server/                    # MCP server implementation
├── tools/
│   └── win/
│       └── WinKeys.cs             # WinKeys source code
├── scripts/
│   └── build-win-tools.ps1        # Build WinKeys.exe
├── README.md                      # Project overview
├── API.md                         # High-level API guide
├── SERVER_API.md                  # MCP Server API reference
├── WINKEYS_API.md                 # WinKeys.exe API reference
├── AI_ASSISTANT_MANUAL.md         # This file
├── ARCHITECTURE.md                # System architecture
├── START_HERE.md                  # Getting started guide
├── package.json                   # Node.js dependencies
└── tsconfig.json                  # TypeScript configuration
```

## Development Commands

```powershell
# Compile TypeScript
npm run compile

# Rebuild WinKeys.exe
.\scripts\build-win-tools.ps1

# Package VS Code extension
npm run package
```

## Testing Best Practices

1. **Always start with cleanup**: Stop any running instances
2. **Query structure first**: Understand UI layout before interacting
3. **Add delays**: Modern Windows apps need time to render UI
4. **Verify operations**: Read display values to confirm actions
5. **Clean up after tests**: Stop applications and server
6. **Use structured output**: Parse JSON from WinKeys.exe, don't rely on raw text

## Example: Complete Test Suite

```powershell
# Pre-test cleanup
Get-Process | Where-Object { $_.ProcessName -like "*calc*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Job | Stop-Job -ErrorAction SilentlyContinue
Get-Job | Remove-Job -ErrorAction SilentlyContinue

# Start server
Start-Job -ScriptBlock { 
    Set-Location C:\Users\plachy\Documents\Dev\VSCplugins\AIAPI
    node dist/start-mcp-server.js 
} | Out-Null
Start-Sleep -Seconds 3

# Launch app
Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchProcess","arguments":{"executable":"calc.exe"}}}'
Start-Sleep -Seconds 4

# Test 1: Addition
Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"setProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"keys","value":"5+3="}}}'
Start-Sleep -Seconds 1
$resp = Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"readProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"text"}}}'
$result = ($resp.Content | ConvertFrom-Json).result
if ($result.value -match "8") { Write-Host "✓ Test 1 passed" } else { Write-Host "✗ Test 1 failed" }

# Test 2: Multiplication
Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"setProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"keys","value":"{ESC}12*5="}}}'
Start-Sleep -Seconds 1
$resp = Invoke-WebRequest -Uri "http://127.0.0.1:3457" -Method POST -ContentType "application/json" -UseBasicParsing -Body '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"readProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"text"}}}'
$result = ($resp.Content | ConvertFrom-Json).result
if ($result.value -match "60") { Write-Host "✓ Test 2 passed" } else { Write-Host "✗ Test 2 failed" }

# Cleanup
Get-Process | Where-Object { $_.ProcessName -like "*calc*" } | Stop-Process -Force
Get-Job | Stop-Job
Get-Job | Remove-Job

Write-Host "`n✓ Test suite complete"
```
