# AIAPI - AI UI Automation API

Standalone release package for Windows.

## Quick Install

1. **Extract** this package to any directory (e.g., `C:\AIAPI`)
2. **Right-click** `install-service.bat` → **"Run as administrator"**
3. The service will start automatically

## Endpoints

| Service | URL |
|---------|-----|
| MCP Server | http://127.0.0.1:4457 |
| Dashboard | http://127.0.0.1:4458 |

## Service Management

```cmd
net start AIAPIService     REM Start
net stop AIAPIService      REM Stop
sc.exe query AIAPIService  REM Status
```

## Uninstall

Run `uninstall-service.bat` as administrator.

## Tools

The MCP server exposes these tools:

| Tool | Description |
|------|-------------|
| `_System` | Built-in system tools (EXEC_CMD, FS_READ, FS_WRITE, FS_LIST, FETCH_WEBPAGE, FETCH_WEBPAGE_RENDER) |
| `BrowserWin` | Browser automation (Chrome/Edge/Firefox) |
| `KeyWin` | Windows UI automation (SendKeys, click, query tree) |
| `LibreOfficeWin` | LibreOffice document automation |
| `MSOfficeWin` | Microsoft Office document automation |
| `AutomateUI` | Router for dispatching actions to any helper |
| `executeScenario` | Run automation scenarios |
| `getHelperSchema` | Get schema for any helper |
| `getActionDetail` | Get detailed action reference |
| `listHelpers` | List all available helpers |

## Logs

Log files are stored in the same directory as `aiapi-server.exe`:
- `aiapi-service.out.log` - Standard output
- `aiapi-service.err.log` - Error output

## Configuration

Edit `aiapi-service.xml` to change:
- Port numbers (via environment variables)
- Log rotation settings
- Service startup type

## Requirements

- Windows 10/11 (64-bit)
- Administrator privileges for installation
- No compilation or Node.js required
