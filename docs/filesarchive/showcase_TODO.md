# MCP Showcase — Runbook

## Prerequisites & hard rules

1. **Always start clean — ensured by the user before the showcase begins.**
   The user closes Calculator, Notepad, and any leftover browser tabs manually
   before saying "run the showcase". The assistant does NOT call `terminateProcess`.

2. **MCP calls must be made directly from the assistant here** (Invoke-RestMethod
   against `http://127.0.0.1:3457/` in the terminal), **not via a standalone
   script**, unless the user explicitly says otherwise.
   Each call is issued individually, step by step, with the output shown before
   proceeding to the next call.

3. **Server must be running.** Before the first call, confirm `:3457` is listening:
   `netstat -ano | findstr ":3457"`.
   If not listening, start via the VS Code task `start:mcp:noauth`.

---

## Step-by-step showcase

### Step 0 — Verify clean slate (assistant checks, user confirms)

The assistant calls `LISTWINDOWS` and prints the full window list in chat.
Both parties verify that no Calculator or Notepad window is present before continuing.
**If either is found, stop and ask the user to close it before proceeding.**

| # | MCP tool | Arguments | Expected |
|---|----------|-----------|----------|
| 0a | `helper_KeyWin` | `LISTWINDOWS` / `SYSTEM` | Full window list printed in chat; no calc/notepad entries |

---

### Step 1 — Calculator

> **User-supplied expression** — the arithmetic expression to evaluate is provided
> by the user's prompt at runtime (e.g. `"42 * 7"`, `"123 + 456"`, etc.).
> Always use **CLICKID-based button presses** (digit/operator AutomationIds) —
> never SENDKEYS for digits/operators because key mapping is locale-dependent on
> Czech Windows.

| # | MCP tool | Arguments | Expected |
|---|----------|-----------|----------|
| 1a | `launchProcess` | `"executable":"calc.exe"` | `success:true`, PID returned |
| 1b | `helper_KeyWin` | `LISTWINDOWS` / `SYSTEM` | Window with title matching "alc\|Kalku"; record `HANDLE:<n>` |
| 1c | `helper_KeyWin` | `RESET` / `HANDLE:<n>` | `method:"clickId:clearButton"`, success |
| 1d | `helper_KeyWin` | `CLICKID num<X>Button` … per digit/operator of expression | all success |
| 1e | `helper_KeyWin` | `CLICKID equalButton` / `HANDLE:<n>` | success |
| 1f | `helper_KeyWin` | `READ` / `HANDLE:<n>` | `value` field = numeric result; **report in chat** |

> **Result verification (mandatory).**
> After READ, compute the expected answer independently and compare it to the
> `value` returned by the window.
> - If correct → report `"Calculator shows <value> ✓"` in chat and continue.
> - If incorrect → report `"Calculator shows <value> but expected <expected> — stopping."`,
>   then **wait for the user's input before proceeding**.
>   The user may have deliberately set a wrong expression to test this check;
>   in that case follow their next instruction.

**Button AutomationId map (locale-proof):**
- Digits: `num0Button` … `num9Button`
- Operators: `plusButton`, `minusButton`, `multiplyButton`, `divideButton`
- Equals: `equalButton`
- Clear all: `clearButton`

---

### Step 2 — Notepad (type, clipboard copy/paste, read back)

> **User-supplied text** — the text to type into Notepad may be specified by the
> user's prompt at runtime. Default demo text if none provided:
> `"Hello from MCP showcase!"`.
> The **Ctrl+C / Ctrl+V clipboard round-trip** must always be demonstrated.

| # | MCP tool | Arguments | Expected |
|---|----------|-----------|----------|
| 2a | `launchProcess` | `"executable":"notepad.exe"` | `success:true`, PID returned |
| 2b | `helper_KeyWin` | `LISTWINDOWS` / `SYSTEM` | Window with title matching "otepad\|oznámk"; record `HANDLE:<n>` |
| 2c | `helper_KeyWin` | `SENDKEYS "<user text>"` / `HANDLE:<n>` | success — text appears in document |
| 2d | `helper_KeyWin` | `SENDKEYS {CTRL+A}` / `HANDLE:<n>` | success — selects all text |
| 2e | `helper_KeyWin` | `SENDKEYS {CTRL+C}` / `HANDLE:<n>` | success — text copied to clipboard |
| 2f | `helper_KeyWin` | `SENDKEYS {CTRL+END}` / `HANDLE:<n>` | success — cursor to end of doc |
| 2g | `helper_KeyWin` | `SENDKEYS {ENTER}` / `HANDLE:<n>` | success — new line |
| 2h | `helper_KeyWin` | `SENDKEYS {CTRL+V}` / `HANDLE:<n>` | success — pastes clipboard content (text is now duplicated) |
| 2i | `helper_KeyWin` | `READ` / `HANDLE:<n>` | `value` contains original text twice (once typed, once pasted) |

---

### Step 3 — Browser (Brave / Chrome via CDP)

| # | MCP tool | Arguments | Expected |
|---|----------|-----------|----------|
| 3a | `helper_BrowserWin` | `LISTBROWSERS` / `brave:9222` | CDP port noted; if null → proceed to 3b |
| 3b | `helper_BrowserWin` | `LAUNCH` / `brave` | `port:9222`, `success:true` |
| 3c | `helper_BrowserWin` | `NEWPAGE` / `brave:9222` | tab id returned |
| 3d | `helper_BrowserWin` | `NAVIGATE https://example.com` / `brave:9222` | `success:true`, URL confirmed |
| 3e | `helper_BrowserWin` | `READ` / `brave:9222` | page title + URL in `page` field |
| 3f | `helper_BrowserWin` | `READELEM h1` / `brave:9222` | element text = `"Example Domain"` |
| 3g | `helper_BrowserWin` | `EXEC <js count links>` / `brave:9222` | JS result e.g. `"1 links: Learn more"` |
| 3h | `helper_BrowserWin` | `SCREENSHOT` / `brave:9222` | PNG saved to `%TEMP%`, file path returned |

---

## Notes for the assistant

- **Do not batch calls into a script** — issue each `Invoke-RestMethod` individually
  in the terminal and wait for its output before the next.
- The arithmetic **expression** (Step 1) comes from the user prompt; parse it into
  individual digit/operator clicks at runtime.
- The **Notepad text** (Step 2) comes from the user prompt if provided; fall back to
  the default above.
- The clipboard copy/paste round-trip (steps 2d–2i) is **mandatory** in every run.
- The browser URL (Step 3d) can also be user-specified; default is `https://example.com`.
- After the showcase, leave all apps open (teardown policy: `leave_open`) unless the
  user says otherwise.

---

## Step-by-step showcase

### Step 0 — Verify clean slate (assistant checks, user confirms)

The assistant calls `LISTWINDOWS` and prints the full window list in chat.
Both parties verify that no Calculator or Notepad window is present before continuing.
**If either is found, stop and ask the user to close it before proceeding.**

| # | MCP tool | Arguments | Expected |
|---|----------|-----------|----------|
| 0a | `helper_KeyWin` | `LISTWINDOWS` / `SYSTEM` | Full window list printed in chat; no calc/notepad entries |

---

### Step 1 — Calculator

> **User-supplied expression** — the arithmetic expression to evaluate is provided
> by the user's prompt at runtime (e.g. `"42 * 7"`, `"123 + 456"`, etc.).
> Always use **CLICKID-based button presses** (digit/operator AutomationIds) —
> never SENDKEYS for digits/operators because key mapping is locale-dependent on
> Czech Windows.

| # | MCP tool | Arguments | Expected |
|---|----------|-----------|----------|
| 1a | `launchProcess` | `"executable":"calc.exe"` | `success:true`, PID returned |
| 1b | `helper_KeyWin` | `LISTWINDOWS` / `SYSTEM` | Window with title matching "alc\|Kalku"; record `HANDLE:<n>` |
| 1c | `helper_KeyWin` | `RESET` / `HANDLE:<n>` | `method:"clickId:clearButton"`, success |
| 1d | `helper_KeyWin` | `CLICKID num<X>Button` … per digit/operator of expression | all success |
| 1e | `helper_KeyWin` | `CLICKID equalButton` / `HANDLE:<n>` | success |
| 1f | `helper_KeyWin` | `READ` / `HANDLE:<n>` | `value` field = numeric result; **report in chat** |

> **Result verification (mandatory).**
> After READ, compute the expected answer independently and compare it to the
> `value` returned by the window.
> - If correct → report `"Calculator shows <value> ✓"` in chat and continue.
> - If incorrect → report `"Calculator shows <value> but expected <expected> — stopping."`,
>   then **wait for the user's input before proceeding**.
>   The user may have deliberately set a wrong expression to test this check;
>   in that case follow their next instruction.

**Button AutomationId map (locale-proof):**
- Digits: `num0Button` … `num9Button`
- Operators: `plusButton`, `minusButton`, `multiplyButton`, `divideButton`
- Equals: `equalButton`
- Clear all: `clearButton`

---

### Step 2 — Notepad (type, clipboard copy/paste, read back)

> **User-supplied text** — the text to type into Notepad may be specified by the
> user's prompt at runtime. Default demo text if none provided:
> `"Hello from MCP showcase!"`.
> The **Ctrl+C / Ctrl+V clipboard round-trip** must always be demonstrated.

| # | MCP tool | Arguments | Expected |
|---|----------|-----------|----------|
| 2a | `launchProcess` | `"executable":"notepad.exe"` | `success:true`, PID returned |
| 2b | `helper_KeyWin` | `LISTWINDOWS` / `SYSTEM` | Window with title matching "otepad\|oznámk"; record `HANDLE:<n>` |
| 2c | `helper_KeyWin` | `SENDKEYS "<user text>"` / `HANDLE:<n>` | success — text appears in document |
| 2d | `helper_KeyWin` | `SENDKEYS {CTRL+A}` / `HANDLE:<n>` | success — selects all text |
| 2e | `helper_KeyWin` | `SENDKEYS {CTRL+C}` / `HANDLE:<n>` | success — text copied to clipboard |
| 2f | `helper_KeyWin` | `SENDKEYS {CTRL+END}` / `HANDLE:<n>` | success — cursor to end of doc |
| 2g | `helper_KeyWin` | `SENDKEYS {ENTER}` / `HANDLE:<n>` | success — new line |
| 2h | `helper_KeyWin` | `SENDKEYS {CTRL+V}` / `HANDLE:<n>` | success — pastes clipboard content (text is now duplicated) |
| 2i | `helper_KeyWin` | `READ` / `HANDLE:<n>` | `value` contains original text twice (once typed, once pasted) |

---

### Step 3 — Browser (Brave / Chrome via CDP)

| # | MCP tool | Arguments | Expected |
|---|----------|-----------|----------|
| 3a | `helper_BrowserWin` | `LISTBROWSERS` / `brave:9222` | CDP port noted; if null → proceed to 3b |
| 3b | `helper_BrowserWin` | `LAUNCH` / `brave` | `port:9222`, `success:true` |
| 3c | `helper_BrowserWin` | `NEWPAGE` / `brave:9222` | tab id returned |
| 3d | `helper_BrowserWin` | `NAVIGATE https://example.com` / `brave:9222` | `success:true`, URL confirmed |
| 3e | `helper_BrowserWin` | `READ` / `brave:9222` | page title + URL in `page` field |
| 3f | `helper_BrowserWin` | `READELEM h1` / `brave:9222` | element text = `"Example Domain"` |
| 3g | `helper_BrowserWin` | `EXEC <js count links>` / `brave:9222` | JS result e.g. `"1 links: Learn more"` |
| 3h | `helper_BrowserWin` | `SCREENSHOT` / `brave:9222` | PNG saved to `%TEMP%`, file path returned |

---

## Notes for the assistant

- **Do not batch calls into a script** — issue each `Invoke-RestMethod` individually
  in the terminal and wait for its output before the next.
- The arithmetic **expression** (Step 1) comes from the user prompt; parse it into
  individual digit/operator clicks at runtime.
- The **Notepad text** (Step 2) comes from the user prompt if provided; fall back to
  the default above.
- The clipboard copy/paste round-trip (steps 2d–2i) is **mandatory** in every run.
- The browser URL (Step 3d) can also be user-specified; default is `https://example.com`.
- After the showcase, leave all apps open (teardown policy: `leave_open`) unless the
  user says otherwise.
