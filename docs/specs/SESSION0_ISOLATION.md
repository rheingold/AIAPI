# Session 0 Isolation — Complete Cross-Helper Analysis

> **Version:** 2.0 (complete rewrite — 2026-05-21)
> **Supersedes:** v1.0 partial analysis (KeyWin/WinCommon only)
> **Decision:** See [`docs/architecture/decisions/ADR-018-session0-fix-strategy.md`](../architecture/decisions/ADR-018-session0-fix-strategy.md)

---

## 1. Problem Statement

When AIAPI is installed as a **Windows Service**, the Node.js server and **all** `*.exe` helper
processes it spawns run in **Windows Session 0** — the non-interactive system session introduced
in Windows Vista/2008 to isolate services from the interactive desktop.

User applications (Calculator, Notepad, Chrome, Office) run in **Session 1** (or higher on
RDP/multi-user machines). Win32, UIA, COM, and CDP APIs are all session-scoped.

### Core Win32 Session Boundary Rules

| Win32 / OS API | Session 0 behaviour | Root cause |
|---|---|---|
| `EnumWindows()` | Only enumerates Session 0 windows — user desktop invisible | Window station isolation |
| `GetForegroundWindow()` | Returns NULL or a Session 0 system window | No interactive desktop |
| `SetForegroundWindow()` | No effect on Session 1 windows | Cross-session call silently ignored |
| `SendInput()` | Input goes to Session 0 desktop (not the user's screen) | Input queue per session |
| `CreateProcess()` | Launches child in Session 0 — invisible to user | Inherits parent session |
| `PrintWindow()` / GDI+ capture | Captures Session 0 desktop (blank / black) | No visible desktop in S0 |
| `UIAutomation` (UIA) | Can only reach elements within the same session | `AutomationElement.FromHandle()` fails cross-session |
| COM `GetActiveObject()` / `Marshal.GetActiveObject()` | Only finds COM servers registered in Session 0 ROT | Running Objects Table is per-session |
| COM `CreateObject()` | Creates COM server **in Session 0** — not the user's running instance | Out-of-proc COM starts in caller's session |
| TCP socket / HTTP | **No session boundary** — works from Session 0 | Network stack is global |
| Filesystem I/O | **No session boundary** — works from Session 0 | Kernel object, not session-scoped |

**Key symptom:** `LISTWINDOWS` returns `{"windows":[], "_sessionWarning":"..."}`.
`SENDKEYS` / `CLICKID` return `success:true` but have **no visible effect** on the user desktop.
COM automation (`MSOfficeWin`, `LibreOfficeWin`) finds no running Office/LO instance.

---

## 2. Diagnosis

Run the diagnostic script from an **interactive** (non-Session-0) PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File tools/diag/check-session.ps1
```

If it reports `AIAPI service process session ID: 0`, the Session 0 problem is active.

To confirm which deployment mode is in use:

```powershell
# Check if running as service
Get-Service -Name AIAPIService | Select-Object Status, StartType
# Check session of the server process
$pid = (Get-Process -Name "node" | Where-Object {$_.MainWindowTitle -eq ""}).Id
(Get-WmiObject Win32_Process -Filter "ProcessId=$pid").SessionId
```

---

## 3. Complete Session 0 Compatibility Matrix

**Legend:** ✅ Works in Session 0 (service mode) | ❌ Broken in Session 0 | ⚠️ Partially works / silent failure

---

### 3.1 — NativeWin (server-side Node.js — no C# helper exe)

These are built-in MCP tools implemented directly in TypeScript (`builtinActions.ts`).
They never spawn a C# helper and have no UIA/COM/CDP dependency.

| MCP Tool | Operation | Session-0 safe? | Reason | Notes |
|---|---|---|---|---|
| `fs_read` | Read a file | ✅ | Filesystem: no session boundary | Fully safe |
| `fs_write` | Write a file | ✅ | Filesystem: no session boundary | Fully safe |
| `fs_list` | List directory | ✅ | Filesystem: no session boundary | Fully safe |
| `exec_cmd` | Run shell command | ⚠️ | Child spawns in Session 0: console apps work; GUI apps launch **invisibly** | `calc.exe` opens in S0 — user never sees it |
| `fetch_webpage` | HTTP/HTTPS GET | ✅ | Network I/O: no session boundary | Fully safe |

**`exec_cmd` detail:** Interactive programs (`notepad.exe`, `calc.exe`) use `CreateProcess()`
which inherits the Session 0 context. The process starts but is attached to the Session 0
window station (`WinSta0\Default` which has no visible desktop). The process PID is returned
as `success:true` but the user sees nothing. **This is a silent failure.**

---

### 3.2 — KeyWin.exe (Win32 + UIA keyboard/mouse/window automation)

KeyWin uses `System.Windows.Automation` (UIA), `SendInput()`, `EnumWindows()`, `CreateProcess()`.
All of these are session-scoped.

| Command | Session-0 safe? | Affected API | Failure mode | Silent? |
|---|---|---|---|---|
| `LISTWINDOWS` | ❌ | `EnumWindows()` | Returns `windows:[]` | No — `_sessionWarning` emitted |
| `QUERYTREE` | ❌ | `AutomationElement.FromHandle()` | Empty tree or `element_not_found` error | **Yes** — no warning currently |
| `READ` / `READELEM` | ❌ | `AutomationElement.GetCurrentPropertyValue()` | Returns empty string or error | **Yes** |
| `CLICKID` / `CLICKNAME` | ❌ | `InvokePattern.Invoke()` + `SendInput()` | Returns `success:true`; no click on user desktop | **Yes** — silent false success |
| `CLICK` (coordinate) | ❌ | `SendInput(INPUT_MOUSE)` | Sends click to Session 0 — user desktop unaffected | **Yes** |
| `SENDKEYS` | ❌ | `SendInput(INPUT_KEYBOARD)` | Keystrokes go to Session 0 keyboard queue | **Yes** — silent false success |
| `KEYDOWN` / `KEYUP` / `KEYPRESS` | ❌ | `SendInput(INPUT_KEYBOARD)` | Session 0 keyboard only | **Yes** |
| `RIGHTCLICK` / `DBLCLICK` | ❌ | `SendInput(INPUT_MOUSE)` | Session 0 mouse only | **Yes** |
| `HOVER` | ❌ | `SetCursorPos()` + `SendInput` | Session 0 cursor | **Yes** |
| `FILL` | ❌ | UIA `ValuePattern.SetValue()` + `SendInput` | UIA cross-session fails; SendInput S0 only | **Yes** |
| `SET` | ❌ | UIA `ValuePattern.SetValue()` | Cross-session UIA fails | **Yes** |
| `CHECK` / `UNCHECK` | ❌ | UIA `TogglePattern.Toggle()` | Cross-session UIA fails | **Yes** |
| `FOCUS` | ❌ | `SetForegroundWindow()` | Call silently ignored cross-session | **Yes** |
| `SCREENSHOT` | ❌ | `PrintWindow()` + `Graphics.CopyFromScreen()` | Captures blank Session 0 desktop; returns non-empty PNG of nothing | **Yes** — silent wrong data |
| `LAUNCH` | ❌ | `Process.Start()` / `CreateProcess()` | Process starts in Session 0 — invisible to user | ⚠️ Partial — PID returned, process runs in S0 |
| `KILL` | ⚠️ | `Process.GetProcessById().Kill()` | Works if PID is known and SYSTEM has rights; cross-session `TerminateProcess()` succeeds with SYSTEM token | Partially safe |
| `NEWDOC` | ❌ | `Process.Start()` + `SendInput` | Process in S0; SendInput S0 | **Yes** |

**Summary:** Every KeyWin command except `KILL` is either broken or silently fails in Session 0.
Only `LISTWINDOWS` currently warns the caller via `_sessionWarning`.

---

### 3.3 — BrowserWin.exe (Chromium CDP automation)

BrowserWin has two automation paths:
- **CDP path** (Chrome/Edge/Brave): connects via WebSocket to `localhost:9222` DevTools port
- **UIA fallback path** (Firefox, non-CDP mode): uses `System.Windows.Automation`

The TCP socket used by CDP has **no session boundary** — this is the key distinction from KeyWin.
However, the **browser itself** must be running in the user's session with the CDP port open.

| Command | Session-0 safe? | Affected mechanism | Failure mode | Silent? |
|---|---|---|---|---|
| `LAUNCH` (browser) | ❌ | `Process.Start()` | Browser starts in Session 0 — invisible; CDP port open on Session 0 localhost | **Yes** — PID returned; S0 browser |
| `LISTBROWSERS` | ⚠️ | TCP port scan `localhost:9222–9229` | **Can find user-session browsers** if they were pre-started with `--remote-debugging-port` | Partial — depends on port |
| `NAVIGATE` | ⚠️ | CDP `Page.navigate` over WebSocket | Works **if** connected to a user-session browser's CDP port | No failure if connected |
| `QUERYTREE` (CDP) | ⚠️ | CDP `DOM.getDocument` / `Runtime.evaluate` | Works **if** connected to user-session browser | No failure if connected |
| `CLICKID` (CDP) | ⚠️ | CDP `Input.dispatchMouseEvent` | Works **if** connected to user-session browser | No failure if connected |
| `FILL` (CDP) | ⚠️ | CDP `Input.dispatchKeyEvent` | Works **if** connected to user-session browser | No failure if connected |
| `READELEM` (CDP) | ⚠️ | CDP `DOM.querySelector` + `Runtime.evaluate` | Works **if** connected to user-session browser | No failure if connected |
| `EXEC` / `CDP_EXECUTE` | ⚠️ | CDP `Runtime.evaluate` | Works **if** connected to user-session browser | No failure if connected |
| `PAGESOURCE` (CDP) | ⚠️ | CDP `Page.getResourceContent` | Works **if** connected to user-session browser | No failure if connected |
| `SCREENSHOT` (CDP) | ⚠️ | CDP `Page.captureScreenshot` | Works **if** connected to user-session browser | No failure if connected |
| `NEWPAGE` | ⚠️ | CDP `Target.createTarget` | Works **if** connected to user-session browser | No failure if connected |
| `COOKIES` | ⚠️ | CDP `Network.getAllCookies` | Works **if** connected to user-session browser | No failure if connected |
| `KILL` | ⚠️ | `Process.GetProcessById().Kill()` | SYSTEM token has cross-session kill rights | Partially safe |
| `SENDKEYS` (UIA path) | ❌ | `SendInput()` | Session 0 keyboard — same as KeyWin | **Yes** |
| `QUERYTREE` (UIA fallback) | ❌ | `AutomationElement.FromHandle()` | Cross-session UIA fails | **Yes** |
| `FOCUS` | ❌ | `SetForegroundWindow()` | Silently ignored cross-session | **Yes** |

**Critical insight for BrowserWin:** CDP commands are transmitted over TCP loopback — this crosses
the session boundary **transparently**. If the user has already started Chrome with
`--remote-debugging-port=9222` in Session 1, the Session 0 service can connect to it via
`localhost:9222` and fully drive it via CDP. The `LAUNCH` command is the only truly broken
step (it starts the browser in S0). This makes BrowserWin **partially recoverable** in service
mode without any architectural fix — provided the browser is launched by the user first,
or launched via `exec_cmd` + `CreateProcessAsUser` (Option A).

---

### 3.4 — MSOfficeWin.exe (Microsoft Office COM automation)

MSOfficeWin uses `Marshal.GetActiveObject()` to bind to a running Office instance, or
`Marshal.GetActiveObject("Word.Application")` / `Type.GetTypeFromProgID()` + `Activator.CreateInstance()`
to create a new one.

COM's **Running Object Table (ROT)** is **per-session**. Session 0 can only see COM servers
registered in the Session 0 ROT, which never includes the user's Word/Excel/PowerPoint.

| Command | Session-0 safe? | Affected COM mechanism | Failure mode | Silent? |
|---|---|---|---|---|
| `LISTDOCS` | ❌ | `Marshal.GetActiveObject("Word.Application")` | `COMException: 0x800401E3 MK_E_UNAVAILABLE` — no COM server in S0 ROT | **Yes** — exception logged, empty result |
| `QUERYTREE` | ❌ | `ComPathWalker.Eval(doc, path)` | No `doc` obtainable from S0 ROT | **Yes** |
| `READ` | ❌ | COM object model traversal | No COM document accessible | **Yes** |
| `WRITE` / `FORMAT` | ❌ | COM setters | No COM document accessible | **Yes** |
| `SAVE` / `EXPORT` | ❌ | `doc.Save()` / `doc.ExportAsFixedFormat()` | No COM document accessible | **Yes** |
| `NEWDOC` | ❌ | `Activator.CreateInstance(officeType)` | Creates COM server **in Session 0** — invisible Word/Excel window | ⚠️ Creates invisible process |
| `EXEC_MACRO` | ❌ | VBA macro execution via COM | No accessible document | **Yes** |
| `FOCUS` | ❌ | `SetForegroundWindow()` | Cross-session call silently ignored | **Yes** |
| `FOCUS` (COM `Activate()`) | ❌ | `app.Activate()` COM call | Activates S0 COM server, not user window | **Yes** |

**DCOM note:** Even if DCOM activation were attempted, DCOM in Session 0 context without
`SeTcbPrivilege` cannot impersonate a user session to access their running Office instance.
The only solution is to either run in the user session (Options A/C) or expose Office docs
via a file-only path (not interactive automation).

---

### 3.5 — LibreOfficeWin.exe (LibreOffice UNO automation)

LibreOfficeWin has two connection paths:
- **UNO socket path** (LO ≥ 7.4): `TcpClient` to `localhost:2002` — TCP, no session boundary
- **COM bridge fallback** (LO < 7.4): `Marshal.GetActiveObject("com.sun.star.ServiceManager")` — session-scoped ROT

| Command | Session-0 safe? | Affected mechanism | Failure mode | Silent? |
|---|---|---|---|---|
| `RELAUNCH` | ❌ | `Process.Start("soffice.bin ...")` | soffice starts in Session 0 — UNO socket opens but on invisible S0 instance | ⚠️ Process exists in S0 |
| `LAUNCH` | ❌ | `Process.Start()` | Same as RELAUNCH | ⚠️ |
| `LISTDOCS` (UNO socket) | ⚠️ | `TcpClient.Connect("localhost", 2002)` | **Succeeds if** user-session LO was started with `--accept=socket,...` | Partial — depends on LO startup |
| `LISTDOCS` (COM fallback) | ❌ | `Marshal.GetActiveObject("com.sun.star.ServiceManager")` | COM ROT S0 isolation — no LO instance found | **Yes** |
| `QUERYTREE` (UNO socket) | ⚠️ | UNO RPC over TCP | Works if user-session LO socket reachable | No failure if connected |
| `READ` / `WRITE` (UNO socket) | ⚠️ | UNO RPC over TCP | Works if user-session LO socket reachable | No failure if connected |
| `SAVE` / `FORMAT` (UNO socket) | ⚠️ | UNO RPC over TCP | Works if user-session LO socket reachable | No failure if connected |
| `FOCUS` | ❌ | `SetForegroundWindow()` | Cross-session silently ignored | **Yes** |

**Key insight for LibreOfficeWin:** Like BrowserWin/CDP, the UNO socket path uses TCP loopback
and is therefore session-transparent. If the user has started LibreOffice with
`--accept=socket,host=localhost,port=2002;urp;` in Session 1, the Session 0 service can
connect and fully drive it. `LAUNCH` / `RELAUNCH` are the broken commands; ongoing document
operations via the socket work cross-session.

---

### 3.6 — Server Infrastructure (TypeScript — no helper dependency)

| Operation | Session-0 safe? | Reason |
|---|---|---|
| MCP JSON-RPC server (HTTP+SSE) listen | ✅ | TCP socket — no session boundary |
| Dashboard HTTP server listen | ✅ | TCP socket — no session boundary |
| Helper discovery (`listHelpers`) | ✅ | Filesystem scan |
| `getHelperSchema` | ✅ | Filesystem / in-memory schema |
| `executeScenario` (XML runner) | ⚠️ | Depends entirely on which commands the scenario uses |
| Helper binary spawn (`HelperRegistry`) | ⚠️ | Binary spawns in Session 0; commands that cross session boundary fail |
| Auth / JWT / settings | ✅ | File-based or DB-based — no session boundary |
| SSE transport (`GET /sse`) | ✅ | TCP socket |
| Security filter evaluation | ✅ | In-memory rule evaluation |
| Audit log writes | ✅ | File I/O |
| `webScrapingClient.ts` (Playwright) | ❌ | Playwright launches Chromium via `CreateProcess()` → Session 0 browser; headless mode works but headed/interactive does not |

---

### 3.7 — Future / Planned Components

#### N-2i — UiBackendDetector + ActionDispatcher

`UiBackendDetector.Detect(hwnd)` probes UIA capabilities per HWND. When running in Session 0,
`AutomationElement.FromHandle(hwnd)` returns null for any Session 1 HWND. The detector
will fail all probes and return `PlatformTag.Unknown` with `HasUIA=false`.

**Session 0 impact:** `ActionDispatcher` strategy table will fall through all UIA-based
strategies and reach a terminal "no strategy available" result. Commands that go through
the dispatcher will fail cleanly (not silently) once N-2i is implemented — this is an
**improvement** over the current silent failures.

**Recommendation:** N-2i implementation should check `IsSession0()` first and return an
early `DispatchResult { Retryable=false, ErrorMessage="Session 0: cannot access UI elements in user session" }`.

#### F-3 — Linux / macOS Helpers (KeyLin, KeyMac, BrowserLin)

The concept of **Session 0** is Windows-specific. On Linux and macOS:

| Platform | Equivalent concern | Impact |
|---|---|---|
| **Linux (systemd daemon)** | Daemon runs without a display (no `$DISPLAY` / `$WAYLAND_DISPLAY`). AT-SPI2 requires D-Bus and an active accessibility daemon — neither available without a display session. | Same effective isolation: daemon cannot reach user's AT-SPI2 apps. |
| **Linux (AT-SPI2)** | `atspi_init()` needs `ACCESSIBILITY_ENABLED=1` and an accessible session bus. If running as a daemon at boot, `$DBUS_SESSION_BUS_ADDRESS` is not set. | `KeyLin` will fail any UI query when running as a system daemon. |
| **Linux (CDP/BrowserLin)** | CDP uses TCP loopback — same "partially recoverable" pattern as `BrowserWin`. | BrowserLin session-transparent for CDP; `LAUNCH` broken without display. |
| **macOS (launchd daemon)** | Daemon runs in system context without Accessibility permission grant (user must grant per-app). `AXUIElementCreateSystemWide()` returns null without accessibility entitlement. | `KeyMac` broken in daemon mode without user-granted permission. |
| **macOS (AX API)** | `CGEventPost` requires `kCGHIDEventTap` event tap which is restricted without Accessibility security permission. | Same kernel-level isolation as Windows `SendInput` cross-session. |

**Cross-platform fix alignment:** Option B (companion bridge process) maps cleanly to all
platforms — a `KeyLinBridge` / `KeyMacBridge` runs in the user login session, connects back
to the daemon via Unix domain socket or TCP. Option C (N-0 VSIX) runs in the VS Code
process which always has a display session — cleanest solution across all platforms.

---

## 4. Unified Fix Options — Evaluation

### Option A — `WTSQueryUserToken` + `CreateProcessAsUser`

The Node.js server (running as SYSTEM in Session 0) uses Win32 terminal services APIs to
spawn each helper `.exe` directly into the active console session:

```
WTSGetActiveConsoleSessionId()  → active session ID (e.g. 1)
WTSQueryUserToken(sessionId)    → user access token for that session
CreateProcessAsUser(token, ...)  → spawn helper.exe in Session 1
```

| Criterion | Assessment |
|---|---|
| Complexity | **High** — requires C++ native addon or `node-ffi-napi` wrapper; cannot use `child_process.spawn()` |
| Privilege required | Service must run as `SYSTEM` with `SeTcbPrivilege` ("Act as part of the OS") — the highest Windows privilege level |
| Security risk | **Significant** — `SeTcbPrivilege` allows impersonating any user; any bug in the launcher is a privilege escalation vector |
| KeyWin fix | ✅ Complete — helper runs in user session, all UIA/SendInput APIs work |
| BrowserWin fix | ✅ Complete — `LAUNCH` spawns browser in user session; CDP connects to user browser |
| MSOfficeWin fix | ✅ Complete — COM ROT visible; `GetActiveObject()` finds user's Office |
| LibreOfficeWin fix | ✅ Complete — `LAUNCH` spawns soffice in user session; UNO socket from user-session LO |
| Multi-user (RDP) | ⚠️ Needs logic to pick the right session — `WTSGetActiveConsoleSessionId()` returns the console session, not necessarily the RDP session |
| N-0 VSIX alignment | ⚠️ Redundant — VSIX already runs in user session; two different fix paths to maintain |
| Cross-platform | ❌ Windows-only; Linux/macOS need separate solutions |
| TODO.md tracking | TODO: `NEW-1 (full fix)` — explicitly deferred |

### Option B — User-Session Bridge Process (AiapiBridge.exe)

A lightweight companion `AiapiBridge.exe` runs in the user session. It is started at login
via Task Scheduler or via the VSIX extension activation. It opens a named pipe or TCP socket
and listens for commands from the Session 0 service. The service routes UI automation
requests through the bridge instead of spawning helpers directly.

```
Session 0: MCP Server → IPC pipe → AiapiBridge.exe (Session 1) → KeyWin.exe / BrowserWin.exe
```

| Criterion | Assessment |
|---|---|
| Complexity | **Medium** — new bridge component; IPC protocol design; startup management |
| Privilege required | **None** — bridge runs as the user; Task Scheduler "At logon" task, no elevation needed |
| Security risk | **Medium** — IPC channel is an attack surface; must authenticate bridge identity |
| KeyWin fix | ✅ Complete — bridge runs in user session |
| BrowserWin fix | ✅ Complete |
| MSOfficeWin fix | ✅ Complete |
| LibreOfficeWin fix | ✅ Complete |
| Multi-user (RDP) | ⚠️ Needs one bridge instance per session; routing logic required |
| N-0 VSIX alignment | ✅ VSIX activation can start the bridge; extension acts as the bridge host naturally |
| Cross-platform | ✅ Linux: bridge as a systemd user unit; macOS: bridge as a LaunchAgent |
| Additional failure mode | ⚠️ If bridge dies, all UI automation stops; adds latency on every call |

### Option C — Dual Deployment (service NativeWin-only + VSIX for UI)

The Windows Service remains intentionally limited to the NativeWin tool group (`fs_*`,
`exec_cmd`, `fetch_webpage`). The VSIX extension (N-0) runs the full server stack in the
VS Code process (user session, port 3457) with full UI automation access. Users who need UI
automation install the VSIX; users who need server-automation only use the service.

```
[Service, Session 0]   → port 4457 → fs_*, exec_cmd, fetch_webpage
[VSIX, Session 1]      → port 3457 → all helpers including KeyWin, BrowserWin, Office
```

| Criterion | Assessment |
|---|---|
| Complexity | **Low** — no new components; document the split; service simply rejects UI commands with clear error |
| Privilege required | **None** — VSIX runs in VS Code's user session normally |
| Security risk | **Low** — clean separation; service does not escalate privileges |
| KeyWin fix | ✅ Via VSIX path |
| BrowserWin fix | ✅ Via VSIX path |
| MSOfficeWin fix | ✅ Via VSIX path |
| LibreOfficeWin fix | ✅ Via VSIX path |
| Multi-user (RDP) | ✅ Each user's VS Code instance is its own session |
| N-0 VSIX alignment | ✅ **Perfect** — this IS N-0's deployment model |
| Cross-platform | ✅ VS Code extension model is cross-platform by design |
| Limitation | ⚠️ Requires VS Code to be running; not suitable for headless server automations |

### Option D — Session-Aware Dispatch

The MCP server detects `IsSession0()` at runtime and dynamically routes UI automation commands
to a user-session agent. This is a hybrid of Option A (no new binary) and Option B (routing logic).

| Criterion | Assessment |
|---|---|
| Complexity | **High** — dynamic routing; agent must be discovered; fallback logic per command |
| Security risk | **Medium** — discovery mechanism can be spoofed |
| Verdict | **Not recommended** — complexity of Option A without the completeness of Option B; superseded by Option B |

---

## 5. Architectural Ruling

### Recommended Path: Option C + Option B phased

**Phase 1 (v1.0 — current): Option C documented stance**

The current `_sessionWarning` detection + Task Scheduler workaround remains the operative
deployment guide. The service is explicitly documented as **NativeWin-only** in service mode.
Users who need full UI automation use:
- The VSIX extension (N-0) — preferred for VS Code users
- Task Scheduler interactive task — for headless/server deployments

**Phase 2 (post-N-0): Option B bridge for headless UI automation**

Once N-0 VSIX is stable and deployed, implement `AiapiBridge.exe` as a thin relay that:
1. Is auto-started by the VSIX extension on activation (bridges VSIX auth to service)
2. Can independently be started via Task Scheduler for non-VS Code deployments
3. Communicates with the Session 0 service via a named pipe (`\\.\pipe\AIAPI-Bridge-{sessionId}`)
4. Routes only UI-automation commands through the bridge; NativeWin commands stay in the service

**Phase 3 (post-F-2 MSI installer): Full integration**

The MSI installer (F-2) creates both the service and a Task Scheduler "At Logon" entry
that starts the bridge automatically. Users never need to understand Session 0 isolation.

### Which helpers are unblocked immediately (no fix required)

| Helper | Status without fix | Condition |
|---|---|---|
| NativeWin (`fs_*`, `fetch_webpage`) | ✅ Unblocked | Always works in service mode |
| `exec_cmd` | ⚠️ Console-only | Works for CLI tools; GUI apps invisible |
| BrowserWin (CDP commands) | ⚠️ Unblocked if browser pre-started by user with `--remote-debugging-port` | User must open browser with debug flag first |
| LibreOfficeWin (UNO socket) | ⚠️ Unblocked if LO pre-started with `--accept=socket,...` | User must start LO with accept flag first |
| KeyWin | ❌ Fully blocked | Requires session fix |
| MSOfficeWin | ❌ Fully blocked | Requires session fix |

---

## 6. Silent Failure Gaps — Warning Injection Required (QA-3)

The current `_sessionWarning` only fires in `LISTWINDOWS`. All of the following commands
**appear to succeed but have no visible effect**. This is the most dangerous failure mode
because AI agents proceed confidently on incorrect assumptions.

**Required fix (QA-3):** Add `IsSession0()` check + `_sessionWarning` injection to all
affected commands in `WinCommon.cs` and each helper's `DispatchCommand()`:

| Helper | Commands needing `_sessionWarning` |
|---|---|
| KeyWin | `QUERYTREE`, `READ`, `READELEM`, `CLICKID`, `CLICKNAME`, `CLICK`, `SENDKEYS`, `KEYDOWN`, `KEYUP`, `KEYPRESS`, `RIGHTCLICK`, `DBLCLICK`, `HOVER`, `FILL`, `SET`, `CHECK`, `UNCHECK`, `FOCUS`, `SCREENSHOT`, `LAUNCH`, `NEWDOC` |
| BrowserWin | `LAUNCH` (when CDP not pre-connected), `FOCUS`, `SENDKEYS` (UIA path) |
| MSOfficeWin | `LISTDOCS`, `QUERYTREE`, `READ`, `WRITE`, `FORMAT`, `SAVE`, `EXPORT`, `NEWDOC`, `EXEC_MACRO`, `FOCUS` |
| LibreOfficeWin | `LAUNCH`, `RELAUNCH`, `FOCUS`, `LISTDOCS` (COM fallback path) |
| NativeWin | `exec_cmd` when spawning a GUI process (detect by checking if process has a window) |

The warning shape is already established:
```json
{
  "success": true,
  "_sessionWarning": "Helper is running in Windows Session 0 (service context). This command requires access to the interactive user desktop (Session 1). Result may be incorrect or have no visible effect. See docs/specs/SESSION0_ISOLATION.md for fix options.",
  "result": "..."
}
```

---

## 7. Workarounds (Current — Pre-Fix)

### 7.1 — Run AIAPI as interactive process (simplest, dev mode)

```powershell
node components/server/dist/start-mcp-server.js
```

All helpers inherit the parent session and can reach the user desktop.

### 7.2 — Task Scheduler interactive task (recommended for single-user deployments)

```powershell
$action = New-ScheduledTaskAction -Execute 'node' `
    -Argument 'C:\Program Files\AIAPI\components\server\dist\start-mcp-server.js'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RunOnlyIfNetworkAvailable $false
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName 'AIAPI-UserSession' -Action $action `
    -Trigger $trigger -Settings $settings -Principal $principal
```

This keeps the Node process in the user session while surviving logoffs.

### 7.3 — VS Code Extension (VSIX — N-0)

Install the `.vsix` extension. The extension activates in the VS Code process which runs
in the user's interactive session. Full UI automation works immediately, no service needed.

### 7.4 — Pre-launch browser/LibreOffice with debug flags (BrowserWin/LibreOfficeWin only)

For BrowserWin, launch Chrome manually with the CDP debug port:
```powershell
Start-Process "chrome.exe" "--remote-debugging-port=9222 --user-data-dir=$env:TEMP\aiapi-debug"
```

For LibreOfficeWin, launch LibreOffice with the UNO socket accept flag:
```powershell
Start-Process "soffice.exe" '--accept="socket,host=localhost,port=2002;urp;StarOffice.ServiceManager" --norestore'
```

The Session 0 service can then connect to these user-session processes via TCP.

---

## 8. Detection in Helper Output

`LISTWINDOWS` currently emits `_sessionWarning`. After QA-3 is implemented, all affected
commands will emit it.

```json
{
  "success": true,
  "windows": [],
  "_sessionWarning": "Helper is running in Windows Session 0 (service context). EnumWindows() only enumerates Session 0 windows — user desktop applications are not visible. Use Task Scheduler interactive task or the VSIX extension for full UI automation. See docs/specs/SESSION0_ISOLATION.md."
}
```

Implementation: [`components/helpers/shared/src/WinCommon.cs`](../../components/helpers/shared/src/WinCommon.cs) `ListWindowsJson()` — `IsSession0()` method.

---

## 9. Migration Path to Phase 2 (Option B Bridge)

When N-0 VSIX is stable and the MSI installer (F-2) is underway:

1. **Define bridge IPC protocol** — thin JSON-line protocol identical to the helper stdin protocol; bridge acts as a transparent relay with session routing header `"_bridgeSessionId": 1`
2. **Implement `AiapiBridge.exe`** — C# console app using `HelperCommon.cs` `RunNamedPipeListener()`; spawns helpers in the user session; relays to service via named pipe
3. **Update `HelperRegistry.ts`** — add `BridgeClient` mode: when `IsSession0()` + bridge pipe available, route UI commands via pipe instead of direct spawn
4. **VSIX activation** — `activate()` in `extension.ts` starts `AiapiBridge.exe` as a child process; bridge exits when VS Code closes (or stays as independent Task Scheduler task)
5. **MSI installer** — registers Task Scheduler "At Logon" task for bridge; service uses bridge automatically after user login

---

## 10. References

- [`docs/architecture/decisions/ADR-018-session0-fix-strategy.md`](../architecture/decisions/ADR-018-session0-fix-strategy.md) — authoritative decision record
- [`docs/architecture/decisions/ADR-007-universal-installer-idempotent-setup.md`](../architecture/decisions/ADR-007-universal-installer-idempotent-setup.md) — installer spec
- [`TODO.md`](../../TODO.md) — `NEW-1 (full fix)`, `QA-3`, `N-0`, `F-2` tracking
- [`tools/diag/check-session.ps1`](../../tools/diag/check-session.ps1) — diagnostic script
- [`docs/guides/LINUX_MAC_PORTING.md`](../guides/LINUX_MAC_PORTING.md) — cross-platform daemon considerations
- [MSDN: Services and the Interactive Desktop](https://learn.microsoft.com/en-us/windows/win32/services/services-and-the-interactive-desktop)
- [MSDN: WTSQueryUserToken](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsqueryusertoken)
- [MSDN: CreateProcessAsUser](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasusera)
