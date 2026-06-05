---
mode: agent
description: >
  Full AIAPI end-to-end vibe-coding test suite. Calls every helper
  (KeyWin, BrowserWin, MSOfficeWin, LibreOfficeWin, NativeWin) and every
  significant MCP command using the live MCP tools. Mirrors D1–D20 dogfood
  suite. Run this when you want an AI-driven smoke + functional check without
  executing the Node.js e2e runner.
tools:
  - mcp_aiapi_AutomateUI
  - mcp_aiapi_BrowserWin
  - mcp_aiapi_KeyWin
  - mcp_aiapi_LibreOfficeWin
  - mcp_aiapi_MSOfficeWin
  - mcp_aiapi_listHelpers
  - mcp_aiapi_listScenarios
  - mcp_aiapi_executeScenario
  - mcp_aiapi_screenshotWindow
  - mcp_aiapi_fs_list
  - mcp_aiapi_fs_read
  - mcp_aiapi_fs_write
  - mcp_aiapi_exec_cmd
  - mcp_aiapi_fetch_webpage
  - mcp_aiapi_getHelperSchema
---

# AIAPI Full E2E Test — Agent Execution Prompt

You are the QA agent for the AIAPI project. Execute every section below **in order**, calling the actual MCP tools for each step.

> **Session 0 awareness:** If the MCP server runs as a Windows Service (port 4457), it operates in Session 0. In that mode:
> - `LISTWINDOWS` and `LAUNCH` work (via WinSvcBridge).
> - `QUERYTREE`, `SENDKEYS`, `FILL`, `READELEM`, `FOCUS`, `HOVER`, `DBLCLICK`, `RIGHTCLICK`, `MOUSEDOWN/UP`, `KEYDOWN/UP` for **KeyWin** return `window_not_found` — mark as `⊘ Session0`.
> - **BrowserWin** `SENDKEYS` and `FOCUS` (UIA path) fail — mark as `⊘ Session0`; all CDP commands (KEYDOWN/UP, KEYPRESS, HOVER, DBLCLICK, RIGHTCLICK, MOUSEDOWN/UP, EXEC, FILL, CHECK, etc.) work normally.
> - `exec_cmd` / `taskkill` cannot reach user-session processes — use `MSOfficeWin KILL` or `BrowserWin KILL` instead.
> - Dev-mode server (port 3457) runs in user session — all UIA commands work there.

After each call:

- Print `✓  <label>` if the result has `success: true` or a non-empty expected field.
- Print `✗  <label> — <reason>` on failure.
- Print `⊘  <label> — <reason>` if skipped (app not installed, not running, etc.).

At the end print a summary table: **passed / failed / skipped** counts per section, then a grand total. Do not stop on individual failures — run every section to completion.

---

## §0  Infrastructure Gate

Before running any section, verify the service is reachable. If either check fails, stop and report.

| Step | Action |
|------|--------|
| G1 | Call `listHelpers`. Confirm at least `KeyWin`, `BrowserWin`, and `NativeWin` are present. |
| G2 | Call `fs_read` with path `C:\Program Files\AIAPI\logs` (or any readable path). Confirm `success: true`. |

---

## §1  Helper Discovery & Schema  *(mirrors D9)*

| Step | Action | Pass condition |
|------|--------|----------------|
| HS1 | `listHelpers` (compact) | `helpers` array length ≥ 4 (NativeWin + 3 exe helpers) |
| HS2 | `listHelpers { full: true }` | Each helper has `commands` array |
| HS3 | `getHelperSchema { helperName: "KeyWin.exe" }` | `commands` array, contains `SENDKEYS` and `LISTWINDOWS` |
| HS4 | `getHelperSchema { helperName: "BrowserWin.exe" }` | Contains `NAVIGATE`, `CLICKID`, `QUERYTREE` |
| HS5 | `getHelperSchema { helperName: "LibreOfficeWin.exe" }` | Contains `NEWDOC`, `READ`, `WRITE` |
| HS6 | `getHelperSchema { helperName: "MSOfficeWin.exe" }` | Contains `NEWDOC`, `READ`, `WRITE` |
| HS7 | `getHelperSchema { helperName: "NativeWin" }` | Contains `exec_cmd`, `fs_read`, `fs_list` |

---

## §2  NativeWin — Built-in Server-Side Actions  *(mirrors D10 / D16 NativeWin paths)*

Use `AutomateUI` with `helper: "NativeWin"` for all steps, OR the dedicated `exec_cmd`, `fs_list`, `fs_read`, `fs_write`, `fetch_webpage` tools.

| Step | Action | Pass condition |
|------|--------|----------------|
| NW1 | `exec_cmd` — `cmd.exe /c echo aiapi-test` | `stdout` contains `aiapi-test` |
| NW2 | `exec_cmd` — `cmd.exe /c dir C:\Windows\System32 /b` (first 5 entries) | `stdout` non-empty, `exitCode: 0` |
| NW3 | `fs_list { path: "C:\\Program Files\\AIAPI" }` | `entries` array non-empty |
| NW4 | `fs_read { path: "C:\\Windows\\System32\\drivers\\etc\\hosts" }` | `content` contains `localhost` |
| NW5 | `fs_write` — write `aiapi_test_probe` to a temp file (e.g. `C:\Windows\Temp\aiapi-probe.txt`), then `fs_read` to verify | Round-trip content matches |
| NW6 | `fetch_webpage { url: "https://example.com" }` | Response contains `Example Domain` |

---

## §3  KeyWin — Windows UI Automation  *(mirrors D5, D6, D12)*

### 3a  Discovery

| Step | Action | Pass condition |
|------|--------|----------------|
| KW1 | `AutomateUI { helper: "KeyWin", action: "LISTWINDOWS" }` | `windows` array non-empty; note the HWND of any visible window |
| KW2 | `screenshotWindow { targetId: "SYSTEM" }` | Returns PNG image (non-empty data) |

### 3b  Calculator  *(skip gracefully if calc.exe cannot be launched)*

| Step | Action | Pass condition |
|------|--------|----------------|
| KW3 | `AutomateUI { helper: "KeyWin", action: "LAUNCH", proc: "calc.exe" }` | `success: true` or window appears in LISTWINDOWS |
| KW4 | Wait ~1 s, then `LISTWINDOWS` again | `calc.exe` / `Calculator` window present |
| KW5 | `QUERYTREE` on calc window handle | Tree has nodes |
| KW6 | `SENDKEYS { proc: "[procname:Calculator]", value: "2{+}3{=}" }` | No error |
| KW7 | `READELEM` or `QUERYTREE` | Result area shows `5` (locale may vary) |
| KW8 | `SCREENSHOT { proc: "[procname:Calculator]" }` (via `screenshotWindow`) | Non-empty PNG |
| KW9 | `SENDKEYS { value: "%{F4}" }` (Alt+F4 to close Calculator) | Success |

### 3c  Notepad

| Step | Action | Pass condition |
|------|--------|----------------|
| KW10 | `LAUNCH notepad.exe` | Window appears |
| KW11 | `SENDKEYS { proc: "[procname:Notepad]", value: "Hello AIAPI{ENTER}" }` | No error |
| KW12 | `QUERYTREE` on Notepad handle | Tree has Text Editor / Edit control |
| KW13 | `FILL` on the text control path with value `Overwrite AIAPI` | No error |
| KW14 | `READELEM` on the text control | Returns text containing `Overwrite` or `AIAPI` |
| KW15 | `FOCUS` on Notepad title bar element | No error |
| KW16 | `KEYDOWN` then `KEYUP` `{CTRL}` | No error |
| KW17 | `KEYPRESS` `{ESCAPE}` | No error |
| KW18 | `HOVER` over the Notepad text area element | No error |
| KW19 | `SENDKEYS { value: "%{F4}{TAB}{ENTER}" }` to close without saving | Notepad closes |

### 3d  Extended KeyWin commands

| Step | Action | Pass condition |
|------|--------|----------------|
| KW20 | `CLICKNAME { proc: "[procname:Calculator]" ... }` — skip if calc not running; if running, click numeric button | No error |
| KW21 | `DBLCLICK` on any desktop element | No error or expected "element not found" error (not a crash) |
| KW22 | `RIGHTCLICK` + `SENDKEYS {ESCAPE}` to dismiss | No error |
| KW23 | `MOUSEDOWN` + `MOUSEUP` on a known element | No error |

---

## §4  BrowserWin — Browser CDP Automation  *(mirrors D7, D13)*

> If no browser is running, launch one first (step BW1). Tests target Chrome/Edge by default.

### 4a  Discovery & Launch

| Step | Action | Pass condition |
|------|--------|----------------|
| BW1 | `BrowserWin { action: "LISTBROWSERS" }` | Returns browser list (may be empty — that's OK for BW2) |
| BW2 | `BrowserWin { action: "LAUNCH", value: "about:blank" }` | `success: true`, browser window opens |
| BW3 | `BrowserWin { action: "LISTBROWSERS" }` | At least 1 browser listed |

### 4b  Navigation & Reading

| Step | Action | Pass condition |
|------|--------|----------------|
| BW4 | `NAVIGATE` to `https://example.com` | `success: true` |
| BW5 | `READ` | `value` or `text` contains `Example Domain` |
| BW6 | `QUERYTREE` | Returns DOM tree with nodes |
| BW7 | `PAGESOURCE` | Returns raw HTML containing `<html` |
| BW8 | `SCREENSHOT` | Non-empty PNG image |

### 4c  Interaction commands

Navigate to `https://www.w3schools.com/html/tryit.asp?filename=tryhtml_input_text` or `about:blank` for a safe test surface. Or navigate to the AIAPI Dashboard URL if it's reachable.

| Step | Action | Pass condition |
|------|--------|----------------|
| BW9 | `NAVIGATE` to `about:blank` | `success: true` |
| BW10 | `EXEC { value: "document.title = 'AIAPI-Test'" }` | No error |
| BW11 | `EXEC { value: "document.title" }` | Returns `AIAPI-Test` |
| BW12 | `SENDKEYS { value: "a" }` on body | No error |
| BW13 | `KEYDOWN { value: "Tab" }` | No error |
| BW14 | `KEYUP { value: "Tab" }` | No error |
| BW15 | `KEYPRESS { value: "Escape" }` | No error |
| BW16 | `NEWPAGE` | New tab opens, returns `tabId` |
| BW17 | `NAVIGATE` in new tab to `https://example.com` | Success |
| BW18 | `COOKIES` | Returns cookie array (may be empty) |

### 4d  Pointer & focus commands

| Step | Action | Pass condition |
|------|--------|----------------|
| BW19 | `HOVER` over `body` | No error |
| BW20 | `DBLCLICK` on `body` | No error |
| BW21 | `RIGHTCLICK` on `body` then `KEYPRESS Escape` | No error |
| BW22 | `MOUSEDOWN` + `MOUSEUP` on `body` | No error |
| BW23 | `FOCUS` on `body` | No error |

### 4e  KILL & relaunch

| Step | Action | Pass condition |
|------|--------|----------------|
| BW24 | `KILL` the browser | `success: true` |
| BW25 | `LISTBROWSERS` | Browser count decreased or zero |

---

## §5  MSOfficeWin — Microsoft Office Automation  *(mirrors D14)*

> Skip entire section with `⊘ MSOfficeWin — Microsoft Office not installed` if `listHelpers` does not include `MSOfficeWin.exe` or if the first NEWDOC fails with "not registered" / "COM error".

| Step | Action | Pass condition |
|------|--------|----------------|
| MO1 | `MSOfficeWin { action: "LISTDOCS" }` | `success: true`, `documents` array (may be empty) |
| MO2 | `MSOfficeWin { action: "NEWDOC", proc: "word" }` | Word document opens |
| MO3 | `MSOfficeWin { action: "QUERYTREE", proc: "word" }` | Returns document structure |
| MO4 | `MSOfficeWin { action: "READ", proc: "word", path: "body" }` | Returns text (may be empty) |
| MO5 | `MSOfficeWin { action: "WRITE", proc: "word", path: "body", value: "AIAPI MSOffice Test" }` | No error |
| MO6 | `MSOfficeWin { action: "READ", proc: "word", path: "body" }` | Contains `AIAPI MSOffice Test` |
| MO7 | `MSOfficeWin { action: "FORMAT", proc: "word", path: "para[1]", value: "Heading 1" }` | No error |
| MO8 | `MSOfficeWin { action: "NEWDOC", proc: "excel" }` | Excel workbook opens |
| MO9 | `MSOfficeWin { action: "WRITE", proc: "excel", path: "cell[@addr='A1']", value: "42" }` | No error |
| MO10 | `MSOfficeWin { action: "READ", proc: "excel", path: "cell[@addr='A1']" }` | Returns `42` |
| MO11 | Close Word without saving — `AutomateUI { helper: "KeyWin", action: "SENDKEYS", proc: "[procname:WINWORD.EXE]", value: "%{F4}" }` + `{ALT+N}` | Word closes |
| MO12 | Close Excel without saving — same pattern | Excel closes |
| MO13 | `MSOfficeWin { action: "NEWDOC", proc: "powerpoint" }` | PowerPoint opens with blank presentation |
| MO14 | `MSOfficeWin { action: "QUERYTREE", proc: "powerpoint" }` | Returns presentation structure; verify `slide` node(s) present |
| MO15 | `MSOfficeWin { action: "WRITE", proc: "powerpoint", path: "slide[1]/title", value: "AIAPI Test Slide" }` | No error |
| MO16 | `MSOfficeWin { action: "READ", proc: "powerpoint", path: "slide[1]/title" }` | Contains `AIAPI Test Slide` |
| MO17 | Close PowerPoint without saving — `exec_cmd { executable: "taskkill.exe", args: "/IM POWERPNT.EXE /F" }` *(Session 0: may return exit 128 — acceptable)* | PowerPoint closes |

---

## §6  LibreOfficeWin — LibreOffice Automation  *(mirrors D18)*

> Skip entire section with `⊘ LibreOfficeWin — LibreOffice not installed` if `NEWDOC` fails with "not found" / "COM error".

| Step | Action | Pass condition |
|------|--------|----------------|
| LO1 | `LibreOfficeWin { action: "LISTDOCS" }` | `success: true` |
| LO2 | `LibreOfficeWin { action: "NEWDOC", proc: "writer" }` | Writer window opens (allow 30 s for first launch) |
| LO3 | `LibreOfficeWin { action: "QUERYTREE", proc: "writer" }` | Returns UNO component tree; if bridge error → try `RELAUNCH` then retry |
| LO4 | `LibreOfficeWin { action: "READ", proc: "writer", path: "body" }` | Returns text (may be empty) |
| LO5 | `LibreOfficeWin { action: "WRITE", proc: "writer", path: "body/para[1]", value: "AIAPI LibreOffice Test" }` | No error |
| LO6 | `LibreOfficeWin { action: "READ", proc: "writer", path: "body" }` | Contains `AIAPI LibreOffice Test` |
| LO7 | `LibreOfficeWin { action: "FORMAT", proc: "writer", path: "body/para[1]", value: "Heading 1" }` | No error |
| LO8 | `LibreOfficeWin { action: "NEWDOC", proc: "calc" }` | Calc opens |
| LO9 | `LibreOfficeWin { action: "WRITE", proc: "calc", path: "Sheet1.A1", value: "99" }` | No error |
| LO10 | `LibreOfficeWin { action: "READ", proc: "calc", path: "Sheet1.A1" }` | Returns `99` |
| LO11 | `LibreOfficeWin { action: "NEWDOC", proc: "impress" }` | Impress presentation opens |
| LO12 | `LibreOfficeWin { action: "QUERYTREE", proc: "impress" }` | Returns presentation structure; verify `slide` node(s) present |
| LO13 | `LibreOfficeWin { action: "WRITE", proc: "impress", path: "slide[1]/title", value: "AIAPI Impress Slide" }` | No error |
| LO14 | `LibreOfficeWin { action: "READ", proc: "impress", path: "slide[1]/title" }` | Contains `AIAPI Impress Slide` |
| LO15 | `AutomateUI { helper: "KeyWin", action: "SENDKEYS", proc: "[procname:soffice.exe]", value: "%{F4}{TAB}{ENTER}" }` | LibreOffice closes without saving |

---

## §7  Scenario Execution Engine  *(mirrors D15)*

| Step | Action | Pass condition |
|------|--------|----------------|
| SC1 | `listScenarios` (no args) | Returns `apps` array non-empty AND `index` array with per-app scenario descriptions; confirm `calculator`, `notepad` present |
| SC1b | `listScenarios { keywords: "type text" }` | Returns `matches` array (scored), at least one result with `app` + `scenarioId` + `description` |
| SC2 | `listScenarios { app: "calculator" }` | `scenarios` array non-empty |
| SC3 | `executeScenario { app: "calculator", scenarioId: "compute", params: { expression: "7+3" } }` | `success: true`, `steps` array |
| SC4 | `executeScenario { app: "notepad", scenarioId: "write", params: { content: "Scenario test text" } }` | `success: true` |
| SC5 | `executeScenario { app: "calculator", scenarioId: "nonexistent-xyz" }` | Error response with structured message (not a crash) |
| SC6 | `executeScenario { app: "calculator", scenarioId: "compute", params: {}, verbose: true }` | `steps` array has per-step detail |

---

## §8  Security Filter Layer  *(mirrors D8, D11)*

| Step | Action | Pass condition |
|------|--------|----------------|
| SEC1 | `exec_cmd { executable: "cmd.exe", args: "/c echo allowed" }` | Should succeed (default allow for echo) |
| SEC2 | Call `AutomateUI { helper: "KeyWin", action: "SENDKEYS", proc: "dogfood_security_probe_xyz", value: "test" }` | Should fail with a security/filter DENY error (the target pattern `dogfood_*` is not a real window and not in allow-list) |
| SEC3 | Confirm SEC2 error message mentions `filter`, `denied`, or `not found` — distinguishes security block from other errors | Non-empty error string |

---

## §9  Screenshot Coverage  *(mirrors D12 screenshot step)*

| Step | Action | Pass condition |
|------|--------|----------------|
| SS1 | `screenshotWindow { targetId: "SYSTEM" }` | Non-empty PNG image returned |
| SS2 | `LISTWINDOWS`, pick first real window handle, call `screenshotWindow { targetId: "HANDLE:<hwnd>" }` | Non-empty PNG |

---

## §10  Final Cleanup

| Step | Action |
|------|--------|
| CL1 | Kill any Calculator or Notepad windows opened during testing (`SENDKEYS "%{F4}"` or `KILL`). |
| CL2 | Delete the temp probe file written in NW5 (`exec_cmd "cmd.exe /c del C:\Windows\Temp\aiapi-probe.txt"`). |
| CL3 | Confirm `LISTWINDOWS` no longer shows test windows. |

---

## Summary Template

After completing all sections, print this table:

```
╔══════════════════════════════════════════════════════════╗
║  AIAPI Vibe-Coding E2E Test — Results                    ║
╠══════════════════════════════════════════════════════════╣
║  §0  Infrastructure Gate        ✓ / ✗ / ⊘              ║
║  §1  Helper Discovery            ✓ / ✗ / ⊘              ║
║  §2  NativeWin                   ✓ / ✗ / ⊘              ║
║  §3  KeyWin                      ✓ / ✗ / ⊘              ║
║  §4  BrowserWin                  ✓ / ✗ / ⊘              ║
║  §5  MSOfficeWin                 ✓ / ✗ / ⊘              ║
║  §6  LibreOfficeWin              ✓ / ✗ / ⊘              ║
║  §7  Scenario Execution          ✓ / ✗ / ⊘              ║
║  §8  Security Filter             ✓ / ✗ / ⊘              ║
║  §9  Screenshots                 ✓ / ✗ / ⊘              ║
║  §10 Cleanup                     ✓ / ✗ / ⊘              ║
╠══════════════════════════════════════════════════════════╣
║  TOTAL  passed: X  failed: X  skipped: X                ║
╚══════════════════════════════════════════════════════════╝
```

**Failure guidance:** A failed step is not a blocker for subsequent sections. Note every failure with the actual error text so it can be triaged. If an entire section is skipped due to missing software, that is not a failure.
