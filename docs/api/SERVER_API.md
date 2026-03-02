# MCP Server API Documentation

## Overview
JSON-RPC 2.0 compliant HTTP server for UI automation. Runs on `http://127.0.0.1:3457`

## Starting the Server

```bash
# Start server
node dist/start-mcp-server.js

# Or via VS Code extension
# The extension automatically starts the server when activated
```

## JSON-RPC 2.0 Protocol

All requests must use:
- **Method**: POST
- **Content-Type**: application/json
- **Body**: JSON-RPC 2.0 request

### Request Format
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "toolName",
    "arguments": { }
  }
}
```

### Response Format
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { }
}
```

### Error Format
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Error description"
  }
}
```

## API Methods

### 1. Initialize
**Method**: `initialize`

**Purpose**: MCP protocol handshake

**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {}
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {},
      "resources": {},
      "prompts": {}
    },
    "serverInfo": {
      "name": "ai-ui-automation",
      "version": "0.1.1"
    }
  }
}
```

### 2. List Tools
**Method**: `tools/list`

**Purpose**: Get available automation tools

**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

**Response**: Returns array of available tools with schemas.

## Available Tools

### Tool: `launchProcess`

**Description**: Launch an application

**Parameters**:
- `executable` (string, required): Application to launch (e.g., "calc.exe")
- `args` (array, optional): Command-line arguments

**Example**:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "launchProcess",
    "arguments": {
      "executable": "calc.exe"
    }
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "success": true,
    "executable": "calc.exe",
    "pid": 12345,
    "message": "Launched calc.exe"
  }
}
```

### Tool: `listWindows`

**Description**: List all visible windows

**Parameters**: None

**Example**:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "listWindows",
    "arguments": {}
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "success": true,
    "windows": [
      {
        "handle": 1234567,
        "title": "Calculator",
        "pid": 8888
      }
    ]
  }
}
```

### Tool: `queryTree`

**Description**: Query UI element tree structure

**Parameters**:
- `providerName` (string, required): Provider name ("windows-forms")
- `targetId` (string, required): Window identifier (process name or title)
- `options` (object, optional):
  - `depth` (number): Tree depth (default: 3)
  - `includeHidden` (boolean): Include hidden elements

**Example**:
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "queryTree",
    "arguments": {
      "providerName": "windows-forms",
      "targetId": "ApplicationFrameHost",
      "options": {
        "depth": 3
      }
    }
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "id": "",
    "type": "ControlType.Window",
    "name": "Calculator",
    "position": {
      "x": 100,
      "y": 100,
      "width": 400,
      "height": 600
    },
    "properties": {
      "isEnabled": true,
      "isOffscreen": false
    },
    "actions": ["click"],
    "children": [...]
  }
}
```

### Tool: `setProperty`

**Description**: Set property on UI element (e.g., send keyboard input)

**Parameters**:
- `providerName` (string, required): Provider name
- `elementId` (string, required): Element identifier
- `propertyName` (string, required): Property to set
- `value` (any, required): Value to set

**Common Properties**:
- `keys`: Send keyboard input
- `text`: Set text value
- `value`: Set control value

**Example - Send Keyboard Input**:
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "setProperty",
    "arguments": {
      "providerName": "windows-forms",
      "elementId": "ApplicationFrameHost",
      "propertyName": "keys",
      "value": "5+3="
    }
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "result": {
    "success": true
  }
}
```

### Tool: `readProperty`

**Description**: Read property from UI element

**Parameters**:
- `providerName` (string, required): Provider name
- `elementId` (string, required): Element identifier
- `propertyName` (string, required): Property to read

**Example - Read Display Value**:
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "readProperty",
    "arguments": {
      "providerName": "windows-forms",
      "elementId": "ApplicationFrameHost",
      "propertyName": "text"
    }
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "success": true,
    "value": "Display shows 8"
  }
}
```

### Tool: `clickElement`

**Description**: Click a UI element

**Parameters**:
- `providerName` (string, required): Provider name
- `elementId` (string, required): Element identifier

**Example**:
```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "tools/call",
  "params": {
    "name": "clickElement",
    "arguments": {
      "providerName": "windows-forms",
      "elementId": "btn_submit"
    }
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "result": {
    "success": true
  }
}
```

### Tool: `getProviders`

**Description**: Get list of available automation providers

**Parameters**: None

**Example**:
```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "method": "tools/call",
  "params": {
    "name": "getProviders",
    "arguments": {}
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "result": ["windows-forms"]
}
```

## PowerShell Examples

### Launch and Test Calculator
```powershell
# Launch Calculator
Invoke-WebRequest -Uri "http://127.0.0.1:3457" `
  -Method POST -ContentType "application/json" -UseBasicParsing `
  -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchProcess","arguments":{"executable":"calc.exe"}}}'

# Wait for window to load
Start-Sleep -Seconds 3

# Send calculation
Invoke-WebRequest -Uri "http://127.0.0.1:3457" `
  -Method POST -ContentType "application/json" -UseBasicParsing `
  -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"setProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"keys","value":"25+17="}}}'

# Read result
$response = Invoke-WebRequest -Uri "http://127.0.0.1:3457" `
  -Method POST -ContentType "application/json" -UseBasicParsing `
  -Body '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"readProperty","arguments":{"providerName":"windows-forms","elementId":"ApplicationFrameHost","propertyName":"text"}}}'

$result = ($response.Content | ConvertFrom-Json).result
Write-Host "Calculator shows: $($result.value)"
```

## Architecture

```
┌─────────────────┐
│  HTTP Client    │
│  (PowerShell,   │
│   Node.js, etc) │
└────────┬────────┘
         │ HTTP POST (JSON-RPC 2.0)
         ▼
┌─────────────────────────┐
│   MCP Server            │
│   (port 3457)           │
│   src/server/           │
│   mcpServer.ts          │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Automation Engine      │
│  src/engine/            │
│  automationEngine.ts    │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Providers              │
│  src/providers/         │
│  windowsFormsProvider.ts│
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  WinKeys.exe            │
│  dist/win/WinKeys.exe   │
│  (Windows UIAutomation) │
└─────────────────────────┘
```

## Error Codes

- `-32600`: Invalid Request
- `-32601`: Method not found
- `-32602`: Invalid params / Unknown tool
- `-32603`: Internal error / Tool execution error
- `-32700`: Parse error

## Server Configuration

Default port: `3457`

To change port, modify `src/server/mcpServer.ts`:
```typescript
constructor(automationEngine: AutomationEngine, port: number = 3457)
```
