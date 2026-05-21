# Session 0 Isolation — AIAPI Helper Processes

## Problem

When AIAPI is installed as a **Windows Service**, the Node.js server and all `*.exe` helper processes it spawns run in **Windows Session 0** — the non-interactive system session.

User applications (Calculator, Notepad, browsers) run in **Session 1** (or higher on RDP/multi-user machines).

Win32 APIs are session-scoped:

| API | Session 0 behaviour |
|---|---|
| `EnumWindows()` | Only enumerates Session 0 windows (none visible to user) |
| `GetForegroundWindow()` | Returns NULL or a Session 0 system window |
| `SetForegroundWindow()` | No effect on Session 1 windows |
| `SendInput()` | Input goes to Session 0 desktop (not the user's screen) |

**Symptom:** `LISTWINDOWS` returns an empty list `{"windows":[]}` plus a `_sessionWarning` field. `SENDKEYS` / `CLICKID` appear to succeed but have no visible effect.

## Diagnosis

Run the diagnostic script from an **interactive** (non-Session-0) PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File tools/diag/check-session.ps1
```

If it reports `AIAPI service process session ID: 0`, you have the Session 0 problem.

## Workarounds

### Option A — Run AIAPI as a regular (non-service) process (simplest)

Start AIAPI from an interactive terminal instead of as a Windows Service:

```powershell
node components/server/dist/start-mcp-server.js
```

Helpers inherit the parent session and can reach the user desktop.

### Option B — Windows Task Scheduler interactive task (recommended for service use)

Create a Scheduled Task that:
- Runs at logon of the target user
- Is configured as `Interactive` (session-aware)
- Launches `node ...start-mcp-server.js`

This keeps the process in the user session while surviving logoffs.

### Option C — `CreateProcessAsUser` launcher (advanced, future work)

The server can spawn helpers in the active console session using:
```
WTSGetActiveConsoleSessionId() → active session ID
WTSQueryUserToken(sessionId)   → user token
CreateProcessAsUser(token, ...) → spawn helper in user session
```

This requires the service to run as `SYSTEM` with `SeTcbPrivilege` (Act as part of the OS). Implementation is tracked in `TODO.md` under NEW-1 (full fix).

## Detection in helper output

When a helper detects it is running in Session 0, `LISTWINDOWS` responses include:

```json
{
  "success": true,
  "windows": [],
  "_sessionWarning": "Helper is running in Windows Session 0 (service context). ..."
}
```

The MCP server and dashboard propagate this field; AI agents should surface it to the user.

## Affected helpers

All four Windows helpers share `WinCommon.cs` which contains `ListWindowsJson()`:

- `KeyWin.exe` — keyboard/mouse/UIA automation
- `BrowserWin.exe` — Chromium browser automation
- `MSOfficeWin.exe` — Office automation
- `LibreOfficeWin.exe` — LibreOffice automation

## References

- [MSDN: Services and the Interactive Desktop](https://learn.microsoft.com/en-us/windows/win32/services/services-and-the-interactive-desktop)
- [MSDN: WTSGetActiveConsoleSessionId](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsgetactiveconsolesessionid)
- [MSDN: CreateProcessAsUser](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasusera)
