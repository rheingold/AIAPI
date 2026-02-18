# Server Dashboard & Control Panel

## Phase: Post-Security Implementation
**Status:** In Progress
**Goal:** Create cross-platform control interface for MCP server

---

## Architecture

### Web-Based Dashboard
- **Technology:** Vanilla HTML/CSS/JavaScript (no build dependencies)
- **Deployment:** 
  - VSCode Extension: Webview panel
  - Standalone: Browser-based UI via HTTP server
  - Future: Electron wrapper for native app

### Features

#### 1. Live Log Viewer
- **WebSocket streaming** for real-time logs
- Filterable by level (debug, info, warn, error)
- Search and export functionality
- Auto-scroll with pause option

#### 2. Server Status
- Running/Stopped indicator
- Uptime counter
- Active connections count
- Request statistics

#### 3. Settings Management
- Edit `security/config.json` via REST API
- Validate changes before applying
- Restart server on config changes
- Visual security policy editor

#### 4. Quick Actions
- Start/Stop server
- Run test scenarios
- Clear logs
- View available MCP tools

---

## Implementation Tasks

### Phase 1: Dashboard Core ✓ TODO
- [x] Move old files to archive/
- [ ] Create `/static` folder for HTML/CSS/JS
- [ ] Implement WebSocket log streaming in `httpServer.ts`
- [ ] Create REST API endpoints for status and settings
- [ ] Build HTML dashboard with live log viewer

### Phase 2: VSCode Integration ✓ TODO
- [ ] Add `aiapi.openDashboard` command to `extension.ts`
- [ ] Create webview panel with dashboard HTML
- [ ] Handle webview lifecycle and messaging

### Phase 3: Windows Installer ✓ TODO
- [ ] Bundle Node.js runtime (portable)
- [ ] Compile KeyWin.exe with embedded certificate
- [ ] Create NSIS installer script
- [ ] Add Windows service registration option
- [ ] Add system tray icon launcher

### Phase 4: Testing ✓ TODO
- [ ] Test dashboard in VSCode webview
- [ ] Test standalone browser access
- [ ] Test settings changes apply correctly
- [ ] Verify log streaming performance

---

## Technical Specifications

### WebSocket Log Protocol
```json
{
  "type": "log",
  "timestamp": "2026-02-18T21:45:00Z",
  "level": "info|warn|error|debug",
  "source": "mcpServer|automationEngine|security",
  "message": "Log message text"
}
```

### REST Endpoints
- `GET /api/status` - Server status and stats
- `GET /api/config` - Current configuration
- `PUT /api/config` - Update configuration
- `POST /api/restart` - Restart server
- `GET /api/logs?since=timestamp` - Historical logs

### VSCode Command
```typescript
vscode.commands.registerCommand('aiapi.openDashboard', () => {
  const panel = vscode.window.createWebviewPanel(
    'aiapi-dashboard',
    'AI API Server Control',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
});
```

---

## Cross-Platform Strategy

### Current: Windows
- Native KeyWin.exe (C# .NET Framework)
- PowerShell for OS enforcement checks
- Windows-specific installers

### Future: Linux
- xdotool/xte for UI automation
- AppImage for distribution
- systemd service integration

### Future: macOS
- AppleScript/Accessibility API wrapper
- DMG installer
- launchd service integration

---

## Security Considerations

- Dashboard requires authentication token
- Settings changes validate against security policy schema
- WebSocket connections use same session tokens
- Installer validates binary signatures before installation
- No remote access by default (localhost only)
