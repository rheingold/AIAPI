# Hybrid Desktop App E2E Testing Guide

> **Purpose:** Knowledge base for AI-assisted E2E testing of hybrid desktop applications (Tauri, Electron) that combine native UI shells with embedded WebView content.
> **Created:** 2026-07-27
> **Context:** Lessons learned during NNSpire Agent PH2-2 V2 storage E2E testing.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Hybrid App Architecture Overview](#hybrid-app-architecture-overview)
3. [Automation Challenge Matrix](#automation-challenge-matrix)
4. [Helper Capability Analysis](#helper-capability-analysis)
5. [Testing Strategies](#testing-strategies)
6. [Pre-Test Analysis Checklist](#pre-test-analysis-checklist)
7. [Tauri-Specific Considerations](#tauri-specific-considerations)
8. [Electron-Specific Considerations](#electron-specific-considerations)
9. [Practical Examples](#practical-examples)
10. [Recommended Workflow](#recommended-workflow)

---

## Problem Statement

During E2E testing of NNSpire Agent (a Tauri-based desktop app), we encountered a fundamental limitation: **WebView content inside release builds is inaccessible to both UI Automation (UIA) and Chrome DevTools Protocol (CDP)**.

This means:
- `KeyWin QUERYTREE` only shows empty `<Pane>` elements for WebView regions
- `BrowserWin` cannot connect to Tauri's embedded WebView2 in release builds (no devtools exposed)
- Keyboard shortcuts sent via `SENDKEYS` may not reach the WebView content reliably
- Storage verification requires manual file system inspection or direct API calls

**Impact:** AI agents cannot programmatically interact with the UI to create test data (conversations, folders, etc.) for E2E storage verification.

---

## Hybrid App Architecture Overview

```
+--------------------------------------------------+
|              Desktop App Window                  |
|  (Native shell: Win32/WPF/UWP)                   |
|  +--------------------------------------------+  |
|  |  Title Bar, Menu Bar, Native Controls     |  |  <-- Accessible via UIA (KeyWin)
|  +--------------------------------------------+  |
|  |                                            |  |
|  |        WebView2 / Chromium WebView         |  |  <-- INACCESSIBLE in release builds
|  |        (HTML/CSS/JS App Content)           |  |     - No UIA tree
|  |                                            |  |     - No CDP (Tauri release)
|  |                                            |  |     - Limited CDP (Electron)
|  +--------------------------------------------+  |
|  |  Status Bar, Native Toolbars              |  |  <-- Accessible via UIA (KeyWin)
|  +--------------------------------------------+  |
+--------------------------------------------------+
```

### Key Concepts

| Layer | Technology | Accessibility |
|-------|-----------|---------------|
| **Native Shell** | Win32, WPF, UWP | Full UIA access via KeyWin |
| **WebView Content** | WebView2 (Tauri), Chromium (Electron) | Release builds: No UIA, Limited/No CDP |
| **Backend Storage** | File system, SQLite, Rust commands | Direct file access or Tauri invoke |
| **DevTools** | Browser DevTools, CDP | Dev builds only |

---

## Automation Challenge Matrix

| Action | KeyWin (UIA) | BrowserWin (CDP) | NativeWin | Workaround |
|--------|-------------|------------------|-----------|------------|
| Read native menu bar | Yes | No | No | Direct |
| Click native buttons | Yes | No | No | Direct |
| Read WebView DOM | No | No (release) | No | Dev build + CDP |
| Fill WebView input | No | No (release) | No | Keyboard/Dev build |
| Click WebView elements | No | No (release) | No | Keyboard/Dev build |
| Send keyboard shortcuts | Unreliable | No (release) | No | Focus issues |
| Read file storage | No | No | Yes | `FS_READ` |
| Verify storage files | No | No | Yes | `FS_LIST` + parse |

---

## Helper Capability Analysis

### KeyWin.exe (UI Automation)

**Strengths:**
- Full access to native Windows controls (Win32, WPF, UWP)
- Can read/write properties, click elements, send keys
- Works in Session 0 via WinSvcBridge

**Limitations for Hybrid Apps:**
- WebView regions appear as empty `<Pane>` elements
- Cannot see inside HTML/CSS/JS content
- Keyboard shortcuts (`SENDKEYS`) may not focus WebView correctly

**When to Use:**
- Launching the application
- Interacting with native menus, toolbars, dialogs
- Reading native window properties
- Taking screenshots

### BrowserWin.exe (CDP)

**Strengths:**
- Full DOM access via Chrome DevTools Protocol
- Can execute JavaScript, fill forms, click elements
- Network interception, cookie management

**Limitations for Hybrid Apps:**
- **Tauri Release Builds:** WebView2 does NOT expose devtools endpoint
- **Electron:** May expose devtools but requires `devTools()` call or remote debugging port
- Cannot find/attach to embedded WebView processes automatically

**When to Use:**
- Dev builds with exposed devtools
- Standalone Chrome/Edge automation
- Apps that expose a debug HTTP endpoint

### NativeWin (Built-in Actions)

**Strengths:**
- Direct file system access (`FS_READ`, `FS_WRITE`, `FS_LIST`)
- Execute shell commands (`EXEC_CMD`)
- No session isolation issues

**Limitations:**
- Cannot interact with UI directly
- Cannot read in-memory application state

**When to Use:**
- Verifying file-based storage
- Reading configuration files
- Running verification scripts

---

## Testing Strategies

### Strategy 1: Dev Build + CDP (Recommended for CI)

**Prerequisites:**
- Development build with devtools enabled
- Know the devtools port or process discovery method

**Workflow:**
1. Launch dev build (exposes devtools)
2. Use `BrowserWin LAUNCH` or attach to existing WebView
3. Interact with DOM via CDP commands
4. Verify storage via `NativeWin FS_LIST`

**Tauri Example:**
```json
{
  "helper": "BrowserWin",
  "action": "LAUNCH",
  "value": "tauri://localhost"
}
```

**Pros:**
- Full DOM access
- Reliable interaction
- Suitable for automated testing

**Cons:**
- Requires dev build
- May not match release behavior exactly

### Strategy 2: Direct Backend API Calls

**Prerequisites:**
- App exposes REST API or Tauri commands
- Know the API endpoints

**Workflow:**
1. Call backend commands directly (bypass UI)
2. Verify storage via file system
3. Optionally verify UI state via screenshot

**Tauri Example:**
```typescript
// Direct Tauri invoke (if app exposes commands)
invoke('save_conversation', { conversationId, conversationJson })
```

**Pros:**
- Bypasses UI entirely
- Fast and reliable
- Works in release builds

**Cons:**
- Tests backend only, not full integration
- Requires API exposure

### Strategy 3: Keyboard Automation + File Verification

**Prerequisites:**
- App supports keyboard shortcuts
- Storage is file-based

**Workflow:**
1. Launch app via `KeyWin LAUNCH`
2. Send keyboard shortcuts (`SENDKEYS {CTRL+N}`)
3. Wait for persistence (monitor file system)
4. Verify storage via `NativeWin FS_LIST`

**Pros:**
- Works in release builds
- Tests full stack

**Cons:**
- Unreliable (focus issues)
- Slow (requires waiting for persistence)
- Cannot verify UI state

### Strategy 4: Manual Test Data + Automated Verification

**Prerequisites:**
- Manual user interaction for data creation
- File-based storage

**Workflow:**
1. User creates test data manually
2. AI agent verifies storage structure
3. Compare expected vs actual file structure

**Pros:**
- Most reliable for release builds
- No automation of UI needed

**Cons:**
- Requires human intervention
- Not suitable for CI/CD

---

## Pre-Test Analysis Checklist

**BEFORE attempting E2E testing of a hybrid app, ALWAYS analyze:**

### 1. App Type Identification
- [ ] Is it Tauri, Electron, or custom WebView?
- [ ] Check `package.json`, `Cargo.toml`, or `tauri.conf.json`
- [ ] Identify WebView technology (WebView2, Chromium, CEF)

### 2. Build Configuration
- [ ] Dev build or Release build?
- [ ] Does it expose devtools/CDP?
- [ ] Check for `--debug` or `--devtools` flags
- [ ] Tauri: Check `tauri.conf.json` for `devtools` setting

### 3. Storage Backend
- [ ] File-based (JSON, SQLite)?
- [ ] In-memory only?
- [ ] Remote API?
- [ ] Where is data stored? (check source code)

### 4. Automation Surface
- [ ] Does it have native UI elements?
- [ ] Does it expose REST API?
- [ ] Does it support keyboard shortcuts?
- [ ] Are there CLI arguments for testing?

### 5. Helper Selection
- [ ] KeyWin for native shell interaction
- [ ] BrowserWin for WebView (if CDP available)
- [ ] NativeWin for file verification
- [ ] Combination of helpers for hybrid approach

### 6. Session Considerations
- [ ] Running in Session 0 (Windows Service)?
- [ ] WinSvcBridge available for interactive session?
- [ ] Will dialogs be visible/resolvable?

---

## Tauri-Specific Considerations

### WebView2 in Release Builds

Tauri uses WebView2 on Windows. In release builds:
- DevTools are disabled by default
- No CDP endpoint exposed
- WebView content is isolated from UIA

**Workaround:** Enable devtools in `tauri.conf.json`:
```json
{
  "build": {
    "devtools": true
  }
}
```

### Tauri Commands

Tauri exposes Rust backend commands via `invoke()`. These can be:
- Called from frontend JavaScript
- Tested directly if app exposes HTTP API
- Accessed via custom test harness

### Storage Paths

Tauri apps typically store data in:
- Windows: `%APPDATA%/{identifier}/`
- macOS: `~/Library/Application Support/{identifier}/`
- Linux: `~/.local/share/{identifier}/`

**Example:** NNSpire Agent uses `%APPDATA%/NNSpire/nnagent/`

### Testing Recommendations

1. **For CI/CD:** Use dev build with devtools enabled
2. **For release testing:** Use direct API calls or manual data creation
3. **For storage verification:** Use `NativeWin FS_LIST` + parse JSON

---

## Electron-Specific Considerations

### Chromium WebView

Electron uses Chromium. In release builds:
- DevTools can be disabled
- Remote debugging port may be available
- `electron.remote` module may be restricted

**Workaround:** Enable remote debugging:
```bash
electron app --remote-debugging-port=9222
```

### Electron Specific APIs

- `session.defaultSession` for network interception
- `BrowserWindow.webContents` for DOM access
- IPC for backend communication

### Testing Recommendations

1. **For CI/CD:** Use Spectre or Playwright with Electron
2. **For release testing:** Enable remote debugging port
3. **For storage verification:** Direct file access or IPC

---

## Practical Examples

### Example 1: Testing NNSpire Agent Storage (Tauri)

**Scenario:** Verify V2 per-conversation storage after creating a conversation.

**Approach:** Strategy 4 (Manual + Automated Verification)

```powershell
# Step 1: User creates conversation manually in app
# Step 2: AI agent verifies storage structure

# Check storage directory exists
Test-Path "$env:APPDATA\NNSpire\nnagent"

# List storage contents
Get-ChildItem "$env:APPDATA\NNSpire\nnagent" -Recurse | Format-Table Name, FullName

# Read conversation file
Get-Content "$env:APPDATA\NNSpire\nnagent\conversations\{id}.json" | ConvertFrom-Json

# Read folders index
Get-Content "$env:APPDATA\NNSpire\nnagent\folders.json" | ConvertFrom-Json
```

**Expected V2 Storage Structure:**
```
%APPDATA%/NNSpire/nnagent/
+-- conversations/
|   +-- {conversation_id_1}.json
|   +-- {conversation_id_2}.json
|   +-- ...
+-- folders.json
+-- {folder_id_1}.config.json
+-- {folder_id_2}.config.json
+-- .v2_migration_complete
```

### Example 2: Testing with Dev Build (Tauri)

**Scenario:** Create conversation via UI automation in dev build.

**Approach:** Strategy 1 (Dev Build + CDP)

```json
// Step 1: Launch dev build
{
  "helper": "KeyWin",
  "action": "LAUNCH",
  "value": "path/to/NNSpire Agent.exe"
}

// Step 2: Wait for app to load
// (use QUERYTREE to check for ready state)

// Step 3: Use BrowserWin to interact with WebView (if devtools enabled)
{
  "helper": "BrowserWin",
  "action": "LAUNCH",
  "value": "tauri://localhost"
}

// Step 4: Click "New Conversation" button
{
  "helper": "BrowserWin",
  "action": "EXEC",
  "value": "document.querySelector('[data-testid=new-conversation]').click()"
}

// Step 5: Verify storage via NativeWin
{
  "helper": "NativeWin",
  "action": "FS_LIST",
  "value": "%APPDATA%/NNSpire/nnagent/conversations/"
}
```

### Example 3: Direct API Testing (Tauri)

**Scenario:** Test storage backend without UI.

**Approach:** Strategy 2 (Direct Backend API)

```typescript
// Call Tauri commands directly (if app exposes HTTP API)
import { invoke } from '@tauri-apps/api/core';

// Create conversation
await invoke('save_conversation', {
  conversationId: 'test-123',
  conversationJson: JSON.stringify({
    id: 'test-123',
    name: 'Test Conversation',
    messages: [],
    createdAt: new Date().toISOString()
  })
});

// Verify file exists
const files = await invoke('list_conversations');
console.log(files); // Should include 'test-123'
```

---

## Recommended Workflow

### For New Hybrid App Testing

1. **Analyze App Configuration**
   - Read `package.json`, `Cargo.toml`, `tauri.conf.json`
   - Identify WebView technology
   - Check for devtools/CDP availability

2. **Identify Storage Backend**
   - Read source code for storage paths
   - Check for file-based vs in-memory storage
   - Understand data format (JSON, SQLite, etc.)

3. **Select Testing Strategy**
   - Dev build available? -> Strategy 1 (Dev + CDP)
   - API exposed? -> Strategy 2 (Direct API)
   - Release build only? -> Strategy 3/4 (Keyboard/Manual)

4. **Prepare Test Environment**
   - Ensure correct helper tools available
   - Check session isolation (Session 0 vs interactive)
   - Verify storage path accessibility

5. **Execute Tests**
   - Create test data
   - Verify storage
   - Clean up test artifacts

6. **Document Findings**
   - Record what worked/failed
   - Update this guide with new insights
   - Create reusable test scenarios

---

## Lessons Learned from NNSpire Agent Testing

### What Worked

1. **File System Verification:** `NativeWin FS_LIST` reliably verifies storage structure
2. **App Launch:** `KeyWin LAUNCH` works for starting the app
3. **Screenshot Verification:** Visual confirmation of app state
4. **Source Code Analysis:** Reading storage paths from source code

### What Failed

1. **WebView Automation in Release:** Cannot access DOM via UIA or CDP
2. **Keyboard Shortcuts:** Unreliable due to focus issues in WebView
3. **Programmatic Data Creation:** Blocked by WebView isolation

### Recommendations for Future Projects

1. **Enable Devtools in Test Builds:** Configure `devtools: true` for test builds
2. **Expose Test API:** Add HTTP endpoints for E2E testing
3. **Use Data Attributes:** Add `data-testid` attributes for reliable element selection
4. **Document Storage Paths:** Make storage paths configurable/testable
5. **Create Test Scenarios:** Pre-built XML/JSON scenarios for common test cases

---

## Related Documents

- [CONVENTIONS.md](../../CONVENTIONS.md) - Command and action conventions
- [ARCHITECTURE.md](../../docs/architecture/ARCHITECTURE.md) - System architecture
- [SERVER_GUIDE.md](SERVER_GUIDE.md) - Deployment and configuration
- [KEYWIN_API.md](../api/KEYWIN_API.md) - KeyWin command reference

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-07-27 | 1.0 | Initial creation from NNSpire Agent E2E testing experience |
