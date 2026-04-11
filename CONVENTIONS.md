# CONVENTIONS — Authoritative vocabulary & structure

**Purpose**: This file exists to prevent duplicate invention across sessions.  
Before proposing anything new, an agent MUST check this file.  
If something already exists here, extend or reuse it — do NOT create a parallel version.

---

## 1. Command taxonomy (UI primitives)

These are the ONLY commands that belong in `<action>` elements in `apptemplates/*/tree.xml`.  
They are technology-level primitives, not application scenarios.

| Command      | Helper(s)        | What it does |
|--------------|-----------------|--------------|
| `SENDKEYS`   | KeyWin, BrowserWin | Emit keystrokes via OS input stack |
| `CLICKID`    | KeyWin, BrowserWin | Click a control by AutomationId (UIA) or CSS/role selector (CDP) |
| `READ`       | KeyWin, BrowserWin | Read text content / Name property of a control, window, or page body |
| `LISTWINDOWS`| KeyWin, BrowserWin | **Unified session enumeration.** KeyWin → OS HWND list. BrowserWin → CDP tab list. Target `SYSTEM` for all; filter by helper or target prefix. Response `type` field distinguishes entries. Do NOT add LISTBROWSERS, LISTTABS, etc. |
| `LAUNCH`     | KeyWin, BrowserWin | Start a process or attach to existing instance |
| `KILL`       | KeyWin, BrowserWin | Terminate. Routing by target prefix: `HANDLE:` → KeyWin; `PAGE:` / `chrome:` → BrowserWin |
| `KEYDOWN`    | KeyWin, BrowserWin | Hold a modifier key: `{KEYDOWN:Ctrl}` / `{KEYDOWN:Alt}` / `{KEYDOWN:Shift}` / `{KEYDOWN:Win}`. Use with `KEYUP` to bracket other keys for chords that SENDKEYS cannot express. |
| `KEYUP`      | KeyWin, BrowserWin | Release a held modifier key: `{KEYUP:Ctrl}`. Always pair with a prior `KEYDOWN`. |
| `KEYPRESS`   | KeyWin, BrowserWin | Atomic keydown+keyup for function / navigation keys. `{KEYPRESS:F5}`, `{KEYPRESS:HOME}`. For plain text use `SENDKEYS`. |
| `RIGHTCLICK` | KeyWin, BrowserWin | Right-click at screen coordinates `{RIGHTCLICK:x,y}` or on element by AutomationId. |
| `DBLCLICK`   | KeyWin, BrowserWin | Double left-click at screen coordinates `{DBLCLICK:x,y}` or on element by AutomationId. |
| `HOVER`      | KeyWin, BrowserWin | Move mouse cursor without clicking. `{HOVER:x,y}`. Triggers hover/tooltip effects. |

**CDP-protocol commands** (BrowserWin.exe only, prefix `CDP_`):

| Command          | CDP method                    | Keyboard scenario alternative |
|------------------|-------------------------------|-------------------------------|
| `CDP_NAVIGATE`   | `Page.navigate`               | `SENDKEYS {CTRL+L}` + url + `{ENTER}` |
| `CDP_NEWPAGE`    | `Target.createTarget`         | `SENDKEYS {CTRL+T}` |
| `CDP_CLOSEPAGE`  | `Target.closeTarget`          | `SENDKEYS {CTRL+W}` |
| `CDP_EXECUTE`    | `Runtime.evaluate`            | — (no keyboard equivalent) |
| `CDP_PAGESOURCE` | `Page.getAccessibilityTree`   | — |
| `CDP_SCREENSHOT` | `Page.captureScreenshot`      | — |

**Rules:**
- Application-level compound operations ("open new document", "navigate to URL", "reset calculator") → `scenarios.xml` ONLY.
- If a new browser command is added, it gets a `CDP_` prefix and is documented here before being used anywhere.
- Do NOT create `READLM`, `QUERYTREE`, `LISTBROWSERS`, `NEWDOC`, `NEWPAGE`, `NAVIGATE`, `CLOSEPAGE`, `SCREENSHOT`, `EXECUTE` — all retired/renamed. Use the table above.

---

## 2. Universal DOM Addressing — XPath-style paths across all helpers

### 2.0 Unified address grammar (formal)

Every call in this system addresses a target using a **hierarchical container + element**
grammar. The two MCP call fields `proc` and `path` together form one coherent address:

```
full-address  ::=  proc  path

proc          ::=  ( '//' level )*          -- zero or more container levels
path          ::=  '//' element-step ( '/' element-step )*
                |  './/' element-step ...   -- relative: continue from context

level         ::=  '[' filter-list ']'      -- always a bracketed filter
                |  '.'                      -- inherit / keep current level

filter-list   ::=  filter ( ';' filter )*
filter        ::=  key ':' raw-value        -- raw-value extends until first ']'
                                            -- '/' and '//' inside raw-value are safe

element-step  ::=  XPath step              -- tag[@attr='val'], *, etc.
                                           -- '//' here = XPath descendant axis
```

**Complete example — every level present:**

```
proc:  "[pid:123;sha256:abc]//[subwindowhandle:0x2A4]//[docname:Budget.xlsx]"
path:  "//body/para[20]"

⟹ conceptual full address:
      //[pid:123;sha256:abc]
      //[subwindowhandle:0x2A4]
      //[docname:Budget.xlsx]
      //body/para[20]
      ↑ L1 OS process   ↑ L2 sub-window   ↑ L3 document   ↑ L4 element
```

**Level key registry** (helper-independent unless noted):

| Layer | `proc` level keys | Meaning |
|-------|-------------------|---------|
| L1 — OS process | `pid` `handle` `hwnd` `procname` `sha256` `sha512` `title` | Win32 / OS identity |
| L2 — sub-window | `subwindowhandle` `frame` `pane` | Helper-dependent (MDI child, browser frame) |
| L3 — document/tab | `docname` `url` `tabid` `page` | Which document/tab inside the process |

`path` element steps follow standard XPath conventions. `//` within an element step
retains its normal XPath meaning (descendant-or-self axis).

**Why `/` and `//` inside a value need no escaping:**  
Each level's `raw-value` ends at the first `]`. The `//` level separator only
appears *between* a closing `]` and the next opening `[` — never inside a value.  
Example — URL with slashes is perfectly safe inside brackets:
```
[url:https://office.google.com/spreadsheets/d/abc]
     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
     slashes are part of raw-value; parser closes at ]
```

**Relative path (planned):**  
Prefix `path` with `.//` to navigate relative to a caller-supplied context level
rather than re-stating the full container chain:
```
path: ".//Edit[@name='username']"   -- relative: apply to nearest context
```

---

### 2.1 Conceptual container layers

Every helper exposes the same container hierarchy:

```
//[L0 — helper / automation domain]   ← implicit in tool name
  //[L1 — OS process]                 ← proc level 1
    //[L2 — sub-window / frame]       ← proc level 2, absent for single-window apps
      //[L3 — document / tab / sheet] ← proc level 3
        //element[@attr='val']        ← element path (the `path` field, L4+)
```

- **L0 — helper**: The automation domain (`MSOfficeWin`, `KeyWin`, `BrowserWin`).  
  Implicit in the MCP tool name; set explicitly only with a generic dispatcher.
- **L1 — OS process**: Win32 HWND, PID, SHA-256 hash, process name.  
  First `[...]` level of `proc`.
- **L2 — sub-window**: MDI child pane, browser iFrame, VS Code editor group, etc.  
  Omit if the process has one visual container. Helper-dependent key names.
- **L3 — document/tab**: The open file, web page, or workbook within the process.  
  Implicit when a process has only one active document.
- **L4+ — element**: Leaf/intermediate node in the helper's native tree. Addressed  
  by position `[N]`, stable id `[@id='…']`, name, or XPath predicate.

### 2.2 Host/process addressing (Layer 1 — the `target` argument)

| Address form          | Helper      | Meaning |
|-----------------------|-------------|---------|
| `HANDLE:<n>`          | KeyWin      | OS window by decimal HWND |
| `window[@process='p']`| KeyWin      | Window by process name (glob ok) |
| `SYSTEM`              | KeyWin, BrowserWin | Broadcast / enumerate all |
| `PAGE:<id>`           | BrowserWin  | CDP tab by id |
| `chrome:URL:<u>`      | BrowserWin  | Tab matching URL prefix |
| `chrome:TITLE:<t>`    | BrowserWin  | Tab matching title substring |
| `word`                | MSOfficeWin | Active Word.Application instance |
| `excel`               | MSOfficeWin | Active Excel.Application instance |
| `powerpoint`          | MSOfficeWin | Active PowerPoint.Application instance |
| `DOCNAME:<file>`      | MSOfficeWin | Office doc by filename (any app) |
| `PROC:WINWORD.EXE`    | MSOfficeWin | Office app by process name |

### 2.3 Element addressing (Layer 3 — the `parameter` argument)

Paths are **relative to the resolved document** (Layer 2 is implicit).
Each helper maps its native API to the canonical path forms below.

#### Windows UIA (KeyWin)
The UIA element tree is analogous to the HTML DOM — controls are nodes with
AutomationId, Name, ControlType properties.

| Canonical path | Current abbreviated form | Native API |
|----------------|--------------------------|------------|
| `Button[@id='calcButton']` | `calcButton` | UIA AutomationId |
| `*[@name='OK']` | `OK` (Name fallback) | UIA Name property |
| `//window[@process='calc']//Button[@id='X']` | *(planned, full path)* | FindAll chain |

> **Current state**: Layer 3 uses bare AutomationId strings. Full `//` paths are planned.

#### HTML DOM (BrowserWin)
The browser page IS a DOM. CSS selectors and ARIA roles map 1:1 to XPath axes.

| Canonical path | CSS selector equivalent | CDP mechanism |
|----------------|------------------------|---------------|
| `body` | `body` | `document.body.innerText` |
| `*[@id='compose']` | `#compose` | `querySelector` |
| `*[@class='btn']` | `.btn` | `querySelectorAll` |
| `//page[@url='…']//input[@name='q']` | *(full cross-tab path)* | CDP Runtime.evaluate |

> **Current state**: CSS selectors or AutomationId are passed as-is. Full `//` paths planned.

#### Office Object Model (MSOfficeWin)
The Office OM hierarchy: Application → Workbook/Document/Presentation →
Sheet/Body/Slide → Cell/Paragraph/Shape → text/value.

> **Implementation note**: Helpers currently parse paths with hard-coded `StartsWith`/`Regex` guards
> (a "wire form" intermediary like `para:3`, `A1`). This is being replaced by a COM reflection walker
> (`ComPathWalker`) that evaluates canonical paths directly against the live COM tree — see TODO.md
> §"Reflection-based path walker". Once the walker is in place, `pathToAddress()` in HelperRegistry.ts
> is removed and canonical paths are sent to the helper unchanged.

**Word** — `Documents("name").Content` structure:

| Canonical path (MCP `path` field) | COM segment mapping | VBA / COM equivalent |
|-----------------------------------|---------------------|----------------------|
| `body` | `body` → `.Content` | `doc.Content.Text` |
| `body/para[3]` | `para[N]` → `.Paragraphs(N)` | `doc.Paragraphs(3)` |
| `body/bookmark[@name='Intro']` | `.Bookmarks("Intro")` | `doc.Bookmarks("Intro")` |
| `body/table[1]/row[2]/cell[3]` | walker: `.Tables(1).Rows(2).Cells(3).Range` | *(walker only — not hard-coded)* |

**Excel** — `Workbooks("name").Sheets` structure:

| Canonical path (MCP `path` field) | COM segment mapping | VBA / COM equivalent |
|-----------------------------------|---------------------|----------------------|
| `cell[@addr='A1']` | `.ActiveSheet.Range("A1")` | `ActiveSheet.Range("A1")` |
| `sheet[@name='Q1']/cell[@addr='B2']` | `.Worksheets("Q1").Range("B2")` | `Sheets("Q1").Range("B2")` |
| `sheet[@name='Q1']/cell[@addr='B2:D5']` | `.Worksheets("Q1").Range("B2:D5")` | `Sheets("Q1").Range("B2:D5")` |
| `sheet[1]/chart[1]/title` | walker: `.ChartObjects(1).Chart.ChartTitle` | *(walker only)* |

**PowerPoint** — `Presentations("name").Slides` structure:

| Canonical path (MCP `path` field) | COM segment mapping | VBA / COM equivalent |
|-----------------------------------|---------------------|----------------------|
| `slide[1]` | `.Slides(1)` | `prs.Slides(1)` |
| `slide[1]/shape[@name='Title']` | `.Slides(1).Shapes("Title")` | `Slides(1).Shapes("Title")` |
| `slide[2]/shape[@name='Body']/text` | `.TextFrame.TextRange` | `.TextFrame.TextRange` |

**Open-ended walker paths** (no C# hard-coding needed, walker resolves at runtime):
```
body/table[2]/row[1]/cell[1]       → doc.Tables(2).Rows(1).Cells(1).Range.Text
sheet[@name='Q1']/chart[1]/title   → Sheets("Q1").ChartObjects(1).Chart.ChartTitle.Text
```
An AI that knows the Office COM OM can construct any valid path. The `<PathEnumeration>` sections
in `apptemplates/*/tree.xml` list well-known paths as documentation and as the whitelist for
strict mode (setting `strictPathEnumeration: true` — see TODO.md §E and CONVENTIONS.md §5).

**Office suite transparency**: `body/para[N]` and `sheet/cell` are intentionally suite-neutral —
a LibreOffice backend would accept the same canonical paths, differing only in its COM segment
mapping table.

### 2.4 Security filter rules (firewall rules) using DOM paths

Firewall rules mirror the full address grammar from §2.0.  The `proc` filter column
uses the same `//`-separated `[key:val]` level syntax as the MCP `proc` field.
Glob wildcards (`*`, `?`) are supported in all value positions.

```
ACTION  helper           proc-filter                                   command  path-glob
──────  ───────────────  ────────────────────────────────────────────  ───────  ────────────────────────────────
ALLOW   MSOfficeWin      [procname:WINWORD.EXE]//[docname:Budget*]     FORMAT   //body/para[*]
ALLOW   MSOfficeWin      [procname:EXCEL.EXE]//[docname:*]             READ     //sheet[*]/cell[*]
DENY    MSOfficeWin      [procname:EXCEL.EXE]//[docname:Payroll*]      WRITE    //sheet[*]/cell[*]
ALLOW   BrowserWin       [pid:8800]//[url:github.com/*]                READ     //**
ALLOW   BrowserWin       [procname:chrome.exe]//[url:https://*/]       CLICKID  //*
DENY    KeyWin           [procname:explorer.exe]                       SENDKEYS //**
ALLOW   KeyWin           [procname:calc.exe]                           CLICKID  //Button[@id='*Button']
DENY    MSOfficeWin      [procname:EXCEL.EXE]//[docname:*]//[frame:*]  WRITE    //sheet[@name='Sheet1']/cell[@addr='A1']
```

Absent levels match anything at that level (they are not constrained).

> **Current state (implemented)**: Filter rules match on `HELPER::COMMAND` and a
> flat wildcard pattern against the parameter string (e.g. `para:*`).  
> **Planned**: Full `//`-grammar matching shown above, aligning with §2.0 grammar.

### 2.5 Implementation status

| Layer | KeyWin | BrowserWin | MSOfficeWin | Status |
|-------|--------|-----------|-------------|--------|
| L0 helper routing | KeyWin tool | BrowserWin tool | MSOfficeWin tool | ✅ implemented |
| L1 OS addressing | HANDLE: / PID: / procname | HANDLE: / PID: / procname | procname / PROC: | ✅ implemented |
| L2 sub-window | ⏳ subwindowhandle | ⏳ frame | ⏳ (not applicable) | ⏳ planned |
| L3 document (implicit) | foreground window | active tab | active doc/workbook | ✅ implemented |
| L3 document (explicit) | ⏳ | PAGE: / chrome:URL: | DOCNAME: | ✅ partial |
| L4 element (abbreviated) | AutomationId bare | CSS selector bare | para:N / A1 / slide:N | ✅ implemented |
| L4 element (full `//` path) | ⏳ | ⏳ | ⏳ | ⏳ planned |
| Multi-level `//` proc parse | TS: ✅ | TS: ✅ | TS: ✅ | C# wire: ⏳ planned |
| Filter rules with `//` grammar | ⏳ | ⏳ | ⏳ | ⏳ planned |

The abbreviated forms (`para:N`, `A1`, AutomationId) are **permanent aliases** —
they will continue to work after full `//` path support is added. Helpers shall
accept both forms and normalise them to the canonical path internally.

---

### 2.6 MCP `tools/call` argument format — universal calling convention

Five orthogonal fields, each concerning a different dimension of the call:

| Field    | Concern | Required |
|----------|---------|----------|
| `helper` | **which** C# binary handles this | no — derived from tool name |
| `proc`   | **which** process / window / document instance | no — helper uses its default |
| `action` | **what** to do (command verb) | **yes** |
| `path`   | **where** inside the document / tree | no |
| `value`  | **payload** to write, apply or send | no |

Tool names are the bare binary stem: `MSOfficeWin`, `KeyWin`, `BrowserWin`.
No prefix, no `.exe`.  Registered at startup from discovered helper binaries.

#### Full MCP JSON-RPC 2.0 call (all fields shown)

```jsonc
{
  "jsonrpc": "2.0",
  "id":      42,
  "method":  "tools/call",
  "params": {
    "name": "MSOfficeWin",               // L0: tool name = binary stem = implicit helper
    "arguments": {
      "helper": "MSOfficeWin",           // redundant here; needed only for generic dispatcher
      "proc":   "[procname:WINWORD.EXE]//[docname:Budget.xlsx]",
                                         // L1 OS process // L3 document
                                         // omit = helper uses active/foreground instance
      "action": "FORMAT",                // command verb
      "path":   "//body/para[20]",       // L4 element path (XPath, no container info)
      "value":  "Heading 2"
    }
  }
}
```

`method` is standardised by MCP (`tools/call`, `tools/list`, …) — not a routing field.

#### `proc` field — container hierarchy filter

`proc` is a sequence of `//`-separated bracketed levels, navigating the container
hierarchy from L1 (OS process) through optional L2 (sub-window) down to L3
(document/tab). Each level uses the `[key:val;key:val]` bracket syntax — the
same syntax used in security firewall rules (§2.4). See §2.0 for the full grammar.

`helper` (the tool name) is the implicit **L0** outermost container — it is never
written inside `proc`.

Absent levels are simply omitted; the helper uses its active/foreground default
for any unspecified level.

| `proc` value | Levels present | Current wire resolves to |
|---|---|---|
| *(omitted)* | none | helper foreground default |
| `"WINWORD.EXE"` | bare name (L1) | process name passed through |
| `"[pid:1234]"` | L1 | `PID:1234` |
| `"[handle:0xABCD]"` / `"[hwnd:0xABCD]"` | L1 | `HANDLE:0xABCD` |
| `"[procname:WINWORD*]"` | L1 | process name glob |
| `"[sha256:abc]"` | L1 | hash-verified process |
| `"[title:*Word*]"` | L1 | Win32 main-window title glob |
| `"[procname:WINWORD.EXE]//[docname:Budget.xlsx]"` | L1 + L3 | `DOCNAME:Budget.xlsx` (innermost wins) |
| `"[pid:8800]//[url:github.com/pulls]"` | L1 + L3 | `chrome:URL:github.com/pulls` |
| `"[pid:8800]//[tabid:3]"` | L1 + L3 | `PAGE:3` |
| `"[pid:123]//[subwindowhandle:0x2A4]//[docname:x.xlsx]"` | L1 + L2 + L3 | `DOCNAME:x.xlsx` |
| combined filters | any | innermost non-empty level wins for current wire |

#### `path` field — element address within the document / tree

XPath-like path addressing an element **inside** the target process.
No app name or process prefix — those are set by `helper`/`proc`.
Leading `//` optional.

`pathToAddress()` currently normalises to abbreviated wire form
(§2.7 describes the plan to drop this abbreviation layer):

| `path` input | Current wire parameter |
|----|-----|
| `//body/para[20]` | `para:20` |
| `//body/bookmark[@name='Summary']` | `bookmark:Summary` |
| `//sheet[@name='Q1']/cell[@addr='B2:D5']` | `Q1!B2:D5` |
| `//slide[2]/shape[@name='Title']` | `slide:2/shape:Title` |
| `//Button[@id='OkButton']` | `OkButton` |
| `//*[@id='compose']` | `#compose` |

#### `resolveCallArgs()` mapping (current, transitional)

```
proc   → target     (via procFilterToTarget)
action → command
path   → address part of parameter  (via pathToAddress — abbreviation layer)
value  → value part of parameter    (appended as |value)
⇒ {target, command, parameter}  → callCommand() → C# wire (§2.7)
```

---

### 2.7 C# helper stdin wire protocol — current state and target design

Each helper runs as a persistent process receiving newline-delimited JSON on stdin
and writing response JSON lines to stdout.

#### Current wire format ⚠️ (implemented in all three C# helpers)

```jsonc
// TS → C# stdin
{"id":"1","target":"DOCNAME:Budget.xlsx","action":"{FORMAT:para:20|Heading 2}"}

// C# → TS stdout
{"id":"1","success":true,"result":"formatted","para":20,"style":"Heading 2"}
```

Issues: `action` field conflates command, address, and value into one `{CMD:addr|value}`
token; `target` differs from MCP field `proc`; `path` and `value` have no individual
representation; `pathToAddress()` abbreviation layer exists only to satisfy this format.

#### Target wire format ⏳ (pending C# update in all three helpers)

```jsonc
// TS → C# stdin
{"id":"1","proc":"DOCNAME:Budget.xlsx","action":"FORMAT","path":"//body/para[20]","value":"Heading 2"}

// C# → TS stdout — response format unchanged
{"id":"1","success":true,"result":"formatted","para":20,"style":"Heading 2"}
```

Once the target format is live:
- `pathToAddress()` abbreviation layer is removed from `HelperRegistry.ts`
- `proc` replaces `target` end-to-end (MCP → wire fields are identical names)
- `{CMD:param}` token assembly in `callCommand()` is removed
- Internal messages (`_schema`, `_exit`, `_auth_*`) keep their existing format

---

## 3. App template structure (`apptemplates/<app>/`)

| File             | Purpose |
|------------------|---------|
| `tree.xml`       | Annotated control/element inventory. Only UI primitives in `<action>` blocks. |
| `scenarios.xml`  | Reusable compound operation fragments. References `ScenarioRef` for composition. |
| `embeddings/`    | Optional: pre-computed vector embeddings for semantic control search. |

> **Planned (deferred — see TODO.md "App Template Namespacing"):** `<app>` will become a
> slash-separated reverse-domain path, e.g. `com.microsoft/windows.v11/calculator`.
> Current layout (`apptemplates/calculator/`) is the flat interim form.
> Do NOT create new parallel app folder conventions — wait for the namespace migration.

### `<Group>` element rules
- Non-wrapping preceding-sibling annotation.
- **MUST** have a `members` attribute: space-separated list of Control `id` values.
- A Control may appear in multiple Group member lists (N:M is intentional).
- Attributes: `id`, `label`, `members`, `note` (optional).

Example:
```xml
<Group id="memory" label="Memory (MS / MR / M+ / M−)"
       members="memButton MemRecall MemPlus MemMinus ClearMemoryButton"
       note="Single memory slot."/>
```

### `<Control>` element rules
- `id` = stable AutomationId (UIA) or semantic CSS selector key (browser).
- `<action>` children: only `SENDKEYS`, `CLICKID`, `READ` (and `CDP_*` for browser).
- `<label lang="en">` — human description.
- `<label lang="ai">` — concise prompt-optimised description for assistant consumption.

---

## 4. Source layout (post-2.8 refactor)

```
src/helpers/HelperRegistry.ts   ← helper process management (was src/server/)
src/server/mcpServer.ts         ← MCP JSON-RPC server
src/server/httpServerWithDashboard.ts ← REST + WebSocket dashboard server
tools/helpers/common/           ← shared C# (HelperCommon.cs, WinCommon.cs)
tools/helpers/win/              ← KeyWin.cs
tools/helpers/browser/          ← BrowserWin.cs
tools/common/security/          ← SecurityLib.cpp + SecurityLib.h (native C++ DLL)
dist/helpers/                   ← compiled EXEs (KeyWin.exe, BrowserWin.exe) + SecurityLib.dll
config/dashboard-settings.json  ← runtime settings (was root dashboard-settings.json)
config/security/config.json     ← security policy: binaryHashes, filterRules, defaultPolicy
config/users.json               ← user/role store when auth.users.storeSource = "json" (signed)
apptemplates/                   ← app template library (tree.xml + scenarios.xml per app)
tests/integration/              ← full-stack integration tests

src/auth/types.ts               ← IAuthProvider, IUserStore, User, Role, AuthResult, all auth interfaces
src/auth/AuthMiddleware.ts      ← HTTP middleware: extracts credentials → IAuthProvider → populates req.authContext
src/auth/providers/NoAuthProvider.ts        ← auth.mode = "none"
src/auth/providers/PasswordAuthProvider.ts  ← auth.mode = "password" (bcrypt + JWT)
src/auth/providers/ApiKeyAuthProvider.ts    ← auth.mode = "apikey" (hashed key lookup + JWT)
src/auth/providers/CertificateAuthProvider.ts ← auth.mode = "certificate" (TLS client cert + JWT)
src/auth/providers/OAuthProvider.ts         ← auth.mode = "oauth" (OAuth2/OIDC redirect + JWT)
src/auth/providers/SamlProvider.ts          ← auth.mode = "saml" (SAML 2.0 redirect + JWT)
src/auth/stores/JsonUserStore.ts            ← IUserStore on signed config/users.json
src/auth/stores/DbUserStore.ts              ← IUserStore on remote DB (MSSQL/Oracle/MySQL/PostgreSQL)

src/settings/types.ts                       ← ISettingsAdapter, SettingsSourceConfig, DbAuthMethod
src/settings/adapters/JsonSettingsAdapter.ts ← ISettingsAdapter on signed config/dashboard-settings.json
src/settings/adapters/DbSettingsAdapter.ts   ← ISettingsAdapter on remote DB
src/settings/SettingsManager.ts              ← factory: reads settingsSource, hydrates correct adapter
```

---

## 5. Settings keys (`config/dashboard-settings.json`)

Documented keys — do NOT add new ones without updating this list:

### 5.1 Core

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `appTemplatesDir` | string | `./apptemplates` | Root for app template library |
| `scenariosPath` | string | `./scenarios` | Legacy scenario JSON files |
| `mcpPort` | number | `3457` | MCP JSON-RPC listen port |
| `helperPaths` | string[] | `["./dist/win/*.exe"]` | Helper EXE discovery paths |
| `logLevel` | string | `info` | Log verbosity |
| `tokenExpiry` | number | `60` | Session token expiry (minutes) |
| `disabledHelpers` | string[] | `[]` | Helper names to skip on startup |

### 5.2 Settings source (where the settings themselves live)

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `settingsSource` | `"json"` \| `"db"` | `"json"` | Backend that stores settings: signed local JSON file OR remote database |
| `db.type` | `"mssql"` \| `"oracle"` \| `"mysql"` \| `"postgresql"` | — | RDBMS type (required when `settingsSource = "db"`) |
| `db.host` | string | — | DB server hostname / IP |
| `db.port` | number | — | DB server port (defaults: mssql=1433, oracle=1521, mysql=3306, postgresql=5432) |
| `db.database` | string | — | Database / schema / service name |
| `db.table` | string | `"aiapi_settings"` | Table name for key-value settings store |
| `db.auth.method` | `"impersonation"` \| `"integrated"` \| `"certificate"` \| `"password"` \| `"constant"` | `"password"` | How the server authenticates **to** the DB |
| `db.auth.username` | string | — | DB login username (for `password` method) |
| `db.auth.password` | string | — | DB login password (for `password` method; may be encrypted) |
| `db.auth.connectionString` | string | — | Full connection string (for `constant` method — unencrypted, abusable) |
| `db.auth.certificatePath` | string | — | Path to client certificate for `certificate` method (reuses settings-encryption cert if omitted) |
| `db.auth.domain` | string | — | Windows domain for `impersonation` method |
| `db.tls` | boolean | `true` | Require TLS/SSL for DB connection |
| `db.tlsCertPath` | string | — | Path to DB server CA cert for TLS verification |

### 5.3 Server client authentication

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `auth.mode` | `"none"` \| `"password"` \| `"apikey"` \| `"certificate"` \| `"oauth"` \| `"saml"` | `"none"` | How connecting clients (AI tools / browsers) authenticate to THIS server |
| `auth.jwt.enabled` | boolean | `true` | Issue JWT tokens after successful auth for session persistence |
| `auth.jwt.secret` | string | *(auto-generated)* | HS256 signing secret; auto-generated on first start and stored in config |
| `auth.jwt.expiryMinutes` | number | `60` | JWT token lifetime in minutes |
| `auth.password.bcryptRounds` | number | `12` | bcrypt work factor for password hashing |
| `auth.apikey.defaultUser` | string | `"default"` | Username for the single built-in API-key user (used when `mode = "apikey"` and no per-user key store) |
| `auth.certificate.caPath` | string | — | Path to CA cert bundle for TLS client-certificate authentication |
| `auth.certificate.requireClientCert` | boolean | `false` | Force TLS client-cert requirement at server level |
| `auth.debugExternalAuth` | boolean | `false` | Log full request/response bodies for OAuth/SAML exchanges (credentials redacted) |

### 5.4 User / role store

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `auth.users.storeSource` | `"json"` \| `"db"` | `"json"` | Where user records live (may differ from `settingsSource`) |
| `auth.users.jsonPath` | string | `"./config/users.json"` | Path to signed user-store JSON (when `storeSource = "json"`) |
| `auth.users.db.*` | — | inherits `db.*` | DB connection overrides for user store (same keys as §5.2 `db.*`) |
| `auth.users.db.table` | string | `"aiapi_users"` | Table name for user records |
| `auth.users.db.rolesTable` | string | `"aiapi_roles"` | Table name for role records |
| `auth.users.db.userRolesTable` | string | `"aiapi_user_roles"` | Join table |
| `auth.users.db.apiKeysTable` | string | `"aiapi_apikeys"` | Table name for API key records |

### 5.5 OAuth2 / OIDC settings (auth.mode = "oauth")

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `auth.oauth.clientId` | string | — | OAuth2 app client ID |
| `auth.oauth.clientSecret` | string | — | OAuth2 app client secret |
| `auth.oauth.authorizationUrl` | string | — | Auth endpoint (e.g. `https://accounts.google.com/o/oauth2/v2/auth`) |
| `auth.oauth.tokenUrl` | string | — | Token endpoint |
| `auth.oauth.userInfoUrl` | string | — | UserInfo endpoint (OIDC); omit if usernamePath applies to ID-token claims |
| `auth.oauth.scope` | string | `"openid profile email"` | Space-separated scopes |
| `auth.oauth.callbackUrl` | string | — | Redirect URI registered with the provider (e.g. `http://localhost:3457/api/auth/oauth/callback`) |
| `auth.oauth.usernamePath` | string | `"email"` | Dot-path into the userInfo JSON to extract the username (e.g. `"preferred_username"`) |
| `auth.oauth.groupsPath` | string | — | Dot-path to extract group membership array from userInfo (e.g. `"groups"` or `"https://myapp.com/groups"`) |
| `auth.oauth.pkce` | boolean | `true` | Use PKCE (recommended) |

### 5.6 SAML 2.0 settings (auth.mode = "saml")

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `auth.saml.entryPoint` | string | — | IdP SSO URL |
| `auth.saml.issuer` | string | — | SP entity ID (this server's URL) |
| `auth.saml.cert` | string | — | IdP signing certificate (PEM string or path prefixed with `file:`) |
| `auth.saml.privateKey` | string | — | SP private key for signing AuthnRequests (PEM or `file:`) |
| `auth.saml.callbackUrl` | string | — | ACS URL (e.g. `http://localhost:3457/api/auth/saml/callback`) |
| `auth.saml.usernamePath` | string | `"nameID"` | Attribute name in SAML assertion to use as username |
| `auth.saml.groupsPath` | string | — | Attribute name in SAML assertion for group membership array |
| `auth.saml.signatureAlgorithm` | string | `"sha256"` | Signature algorithm for AuthnRequest |

---

## 6. REST API surface (`httpServerWithDashboard.ts`)

Existing endpoints — extend these, do not add parallel ones:

### 6.1 App / Helper / Scenario endpoints

| Method | Path | Handler method |
|--------|------|----------------|
| GET | `/api/appTemplates` | `handleListAppTemplates` |
| GET | `/api/appTemplates/{app}/tree` | `handleGetAppTemplate` |
| GET | `/api/appTemplates/{app}/scenarios` | `handleGetAppTemplate` |
| POST | `/api/appTemplates/{app}/scenarios/{id}/run` | `handleRunAppTemplateScenario` |
| GET | `/api/listHelpers` | `handleListHelpers` |
| GET | `/api/getHelperSchema` | `handleGetHelperSchema` |
| GET | `/api/scenarios` | `handleGetScenarios` |
| POST | `/api/scenarios/run` | `handleRunScenario` |
| GET | `/api/status` | (inline) |
| GET/POST | `/api/settings` | `handleGetSettings` / `handleSaveSettings` |

### 6.2 Client authentication endpoints

| Method | Path | Handler method | Auth required |
|--------|------|----------------|---------------|
| POST | `/api/auth/login` | `handleAuthLogin` | No |
| POST | `/api/auth/logout` | `handleAuthLogout` | JWT |
| GET | `/api/auth/status` | `handleAuthStatus` | JWT (soft) |
| GET | `/api/auth/oauth/redirect` | `handleOAuthRedirect` | No |
| GET | `/api/auth/oauth/callback` | `handleOAuthCallback` | No |
| POST | `/api/auth/saml/redirect` | `handleSamlRedirect` | No |
| POST | `/api/auth/saml/callback` | `handleSamlCallback` | No |

### 6.3 `_internal` pseudo-helper — administration endpoints

All `_internal` endpoints require the requesting user to have a role whose permissions include the corresponding `_internal` operation (see §6.4).  
The `_internal` name is also the `helper` value in filter rules that protect these operations.

**User management:**

| Method | Path | Handler method | `_internal` operation |
|--------|------|----------------|----------------------|
| GET | `/api/_internal/users` | `handleInternalListUsers` | `access` |
| POST | `/api/_internal/users` | `handleInternalCreateUser` | `settings_change` |
| PUT | `/api/_internal/users/:id` | `handleInternalUpdateUser` | `settings_change` |
| DELETE | `/api/_internal/users/:id` | `handleInternalDeleteUser` | `settings_change` |
| POST | `/api/_internal/users/:id/apikeys` | `handleInternalCreateApiKey` | `settings_change` |
| DELETE | `/api/_internal/users/:id/apikeys/:keyId` | `handleInternalRevokeApiKey` | `settings_change` |

**Role management:**

| Method | Path | Handler method | `_internal` operation |
|--------|------|----------------|----------------------|
| GET | `/api/_internal/roles` | `handleInternalListRoles` | `access` |
| POST | `/api/_internal/roles` | `handleInternalCreateRole` | `settings_change` |
| PUT | `/api/_internal/roles/:id` | `handleInternalUpdateRole` | `settings_change` |
| DELETE | `/api/_internal/roles/:id` | `handleInternalDeleteRole` | `settings_change` |

**Logs access:**

| Method | Path | Handler method | `_internal` operation |
|--------|------|----------------|----------------------|
| GET | `/api/_internal/logs` | `handleInternalGetLogs` | `access_logs` |
| DELETE | `/api/_internal/logs` | `handleInternalClearLogs` | `settings_change` |

### 6.4 `_internal` operations in filter rules

Filter rules with `helper = "_internal"` control which roles may perform server administration:

| `helper` | `command` | Meaning |
|----------|-----------|---------|
| `_internal` | `access` | Read users, roles, filter-rule list |
| `_internal` | `settings_change` | Create/update/delete users, roles, API keys, filter rules, server settings |
| `_internal` | `access_logs` | Read server logs |

The `role` field on a filter rule (default `(anyandall)`) restricts which role(s) the rule applies to. Role matching:
- `(anyandall)` — matches any authenticated user regardless of role
- `admin` — matches only users whose effective role set includes `admin`
- Multiple roles: comma-separated list; user must have **at least one** listed role
- External auth groups (oAuth/SAML) are treated as additional roles (summed with explicit roles)

**Example filter rules protecting `_internal`:**
```
ALLOW  _internal  (anyandall)   access        *          ← any logged-in user can read
ALLOW  _internal  admin         settings_change *         ← only admin may change
ALLOW  _internal  admin,auditor access_logs   *          ← admin or auditor may view logs
DENY   _internal  (anyandall)   *             *          ← default-deny everything else
```

---

## 7. Reuse checklist (for agent before implementing anything)

- [ ] Does a command with this intent already exist in §1?
- [ ] Does a target addressing scheme for this already exist in §2?
- [ ] Does an app template file already exist in `apptemplates/`?
- [ ] Does a REST endpoint already exist in §6?
- [ ] Does a settings key already exist in §5?
- [ ] Is the source file I'm about to create already in §4?

If any answer is YES → extend the existing one; do NOT create a parallel version.
