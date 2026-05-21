# CONVENTIONS — Authoritative vocabulary & structure

**Purpose**: This file exists to prevent duplicate invention across sessions.  
Before proposing anything new, an agent MUST check this file.  
If something already exists here, extend or reuse it — do NOT create a parallel version.

---

## 1. Command taxonomy (UI primitives)

These are the ONLY commands that belong in `<action>` elements in `components/helpers/*/dist-resources/apptemplates/*/tree.xml`.  
They are technology-level primitives, not application scenarios.

| Command      | Helper(s)        | What it does |
|--------------|-----------------|--------------|
| `SENDKEYS`   | KeyWin, BrowserWin | Emit keystrokes via OS input stack. **`value=`** carries the keystroke sequence; **`path=`** is an optional element address (AutomationId / XPath) to focus before typing — omit for window-level input. Key tokens: `{ENTER}` `{ESC}` `{TAB}` `{BACK}` `{DELETE}` `{HOME}` `{END}` `{PAGEUP}` `{PAGEDOWN}` `{LEFT}` `{RIGHT}` `{UP}` `{DOWN}` `{F1}`…`{F12}` `{CTRL+X}` `{ALT+X}` `{SHIFT+X}` `{+}`. Literal text and tokens may be freely mixed. |
| `CLICKID`    | KeyWin, BrowserWin | Click a control by AutomationId (UIA) or CSS/role selector (CDP) |
| `READ`       | KeyWin, BrowserWin | Read text content / Name property of a control, window, or page body |
| `LISTWINDOWS`| KeyWin, BrowserWin | **Unified session enumeration.** KeyWin → OS HWND list. BrowserWin → CDP tab list. Target `SYSTEM` for all; filter by helper or target prefix. Response `type` field distinguishes entries. Do NOT add LISTBROWSERS, LISTTABS, etc. |
| `LAUNCH`     | KeyWin, BrowserWin | Start a process or attach to existing instance |
| `KILL`       | KeyWin, BrowserWin | Terminate. Routing by target prefix: `HANDLE:` → KeyWin; `PAGE:` / `chrome:` → BrowserWin |
| `WAIT`       | *(synthetic)*      | Pause execution. **`value=`** carries the millisecond count (e.g. `value="400"`). `path=` is accepted for backward compatibility but is wrong — always use `value=`. `proc=` is ignored. |
| `KEYDOWN`    | KeyWin, BrowserWin | Hold a modifier key: `{KEYDOWN:Ctrl}` / `{KEYDOWN:Alt}` / `{KEYDOWN:Shift}` / `{KEYDOWN:Win}`. Use with `KEYUP` to bracket other keys for chords that SENDKEYS cannot express. |
| `KEYUP`      | KeyWin, BrowserWin | Release a held modifier key: `{KEYUP:Ctrl}`. Always pair with a prior `KEYDOWN`. |
| `KEYPRESS`   | KeyWin, BrowserWin | Atomic keydown+keyup for function / navigation keys. `{KEYPRESS:F5}`, `{KEYPRESS:HOME}`. For plain text use `SENDKEYS`. |
| `RIGHTCLICK` | KeyWin, BrowserWin | Right-click at screen coordinates `{RIGHTCLICK:x,y}` or on element by AutomationId. |
| `DBLCLICK`   | KeyWin, BrowserWin | Double left-click at screen coordinates `{DBLCLICK:x,y}` or on element by AutomationId. |
| `HOVER`      | KeyWin, BrowserWin | Move mouse cursor without clicking. `{HOVER:x,y}`. Triggers hover/tooltip effects. |

| `FILL`       | BrowserWin | Fill an input or textarea. **`path=`** CSS selector of the target element; **`value=`** text to type. Legacy combined form `path="selector:value"` accepted for backward compat but wrong — always use separate `path=` + `value=`. |
| `READELEM`   | BrowserWin | Read the text content / aria-label / value of a single DOM element. **`path=`** CSS selector. Returns `{found:false}` (step fails) when selector matches nothing — use as presence assertion. |
| `QUERYTREE`  | KeyWin, BrowserWin | Walk the UI/DOM tree and return a JSON node tree. **`path=`** scope root (see §1.1b). **`value=`** integer depth limit (default 3). Legacy bare-integer `path="3"` accepted but wrong. |
| `NAVIGATE`   | BrowserWin | Navigate the active tab to a URL. **`path=`** target URL (e.g. `about:blank`, `http://…`). |
| `PAGESOURCE` | BrowserWin | Return the full HTML source of the current page. No arguments needed (`path=""`). |
| `SCREENSHOT` | BrowserWin, KeyWin | Capture the current page / window as a base64 PNG. Returns `{"success":true,"command":"SCREENSHOT","data":"<base64>"}`. KeyWin uses `PrintWindow` + GDI+; BrowserWin uses CDP `Page.captureScreenshot`. |
| `COOKIES`    | BrowserWin | Return the cookie jar for the current page as a JSON array. No arguments needed. |
| `DIALOG`     | BrowserWin | Detect or inject a browser dialog. `path="inject:JS:timeoutMs"` to trigger an alert; bare `path="accept"` / `path="dismiss"` to interact with a pending dialog. |
| `EXEC_CMD`   | *(built-in)*       | Run a shell command on the server. **`proc=`** executable name/path; **`value=`** arguments string. `bind=` captures stdout. High-risk. |
| `FS_READ`    | *(built-in)*       | Read a file's text content. **`path=`** file path (absolute or relative). `bind=` captures text. Max 1 MB by default. |
| `FS_WRITE`   | *(built-in)*       | Write text to a file. **`path=`** file path; **`value=`** text content. Creates parent directories. High-risk. |
| `FS_LIST`    | *(built-in)*       | List directory entries. **`path=`** directory path. `bind=` captures JSON array of `{name, type, size, modified}`. |

### 1.1b QUERYTREE path syntax — cross-stack root addressing

`QUERYTREE` works differently depending on which helper handles it.
The `path=` attribute selects the **subtree root**; `value=` is the depth integer.

#### Native Windows UIA (KeyWin, BrowserWin UIA fallback)

The proc target is a window handle (`HANDLE:N` or process name).
UIA walks the Automation element tree rooted at that window.

| `path=` value | Root element used |
|---|---|
| *(empty)* | Window root (`AutomationElement.FromHandle(hwnd)`) |
| `NavView` | Element with AutomationId or Name `NavView` |
| `NavView/SettingsItem` | Canonical `/`-separated UIA sub-path — same syntax as `CLICKID` |
| `[@Name='Clear']` | XPath-style predicate (Name attribute) |

Returns a tree of `{name, automationId, type, children[]}` nodes.

#### Browser DOM (BrowserWin CDP — proc is `chrome:URL:…` or `PAGE:…`)

The proc target routes to a Chrome tab via the CDP layer.

| `path=` value | Root element used |
|---|---|
| *(empty)* or `BODY` | `document.body` |
| `#main` | `document.querySelector('#main')` |
| `[data-section='settings']` | CSS attribute selector |
| `IFRAME[0]` | `document.querySelectorAll('iframe')[0].contentDocument.body` |

Returns a tree of `{tag, id, class, text, children[]}` nodes.

#### Embedded web content within a native window (Electron, Edge WebView2)

Some apps have `HANDLE:N` proc addresses (native window) but contain an embedded web page.
Prefix the `path=` value with `PAGE:` to force CDP-layer scanning instead of UIA:

```xml
<step action="QUERYTREE" proc="HANDLE:{{hwnd}}" path="PAGE:body" value="3" bind="domTree"/>
<step action="QUERYTREE" proc="HANDLE:{{hwnd}}" path="PAGE:#settings-panel" value="2" bind="panelTree"/>
```

`PAGE:` without a selector = `PAGE:body`.

#### Office document content (MSOfficeWin / LibreOfficeWin)

The document body is accessible as the embedded COM/UNO object tree.
Use `DOCUMENT:` prefix to scope the walk to the document's own element hierarchy:

```xml
<step action="QUERYTREE" proc="winword.exe" path="DOCUMENT:" value="3" bind="docTree"/>
<step action="QUERYTREE" proc="winword.exe" path="DOCUMENT:table[0]" value="2" bind="tbl"/>
```

`DOCUMENT:` alone = full document root. `DOCUMENT:table[0]` = first table node.

#### Quick-reference summary

```
path=""                → UIA: window root        ; BrowserWin: document.body
path="NavView"         → UIA: element by AutomationId/Name
path="NavView/Close"   → UIA: /‐separated sub-path
path="#main"           → BrowserWin CSS: querySelector("#main")
path="PAGE:"           → force CDP even for HANDLE: proc (embedded webview)
path="PAGE:#sidebar"   → CDP: querySelector("#sidebar") on embedded page
path="DOCUMENT:"       → Office document root
path="DOCUMENT:p[2]"   → Office: third paragraph element
```

**CDP-protocol commands** (BrowserWin.exe only — for operations that have no keyboard equivalent):

| Command          | CDP method                    | Keyboard scenario alternative |
|------------------|-------------------------------|-------------------------------|
| `CDP_NAVIGATE`   | `Page.navigate`               | `SENDKEYS {CTRL+L}` + url + `{ENTER}` |
| `CDP_NEWPAGE`    | `Target.createTarget`         | `SENDKEYS {CTRL+T}` |
| `CDP_CLOSEPAGE`  | `Target.closeTarget`          | `SENDKEYS {CTRL+W}` |
| `CDP_EXECUTE`    | `Runtime.evaluate`            | — (no keyboard equivalent) |
| `CDP_PAGESOURCE` | `Page.getAccessibilityTree`   | — |
| `CDP_SCREENSHOT` | `Page.captureScreenshot`      | — |
| `CDP_CACHE_CLEAR` | `Network.clearBrowserCache`  | — |

**Rules:**
- Application-level compound operations ("open new document", "navigate to URL", "reset calculator") → `scenarios.xml` ONLY.
- If a new browser command is added, it gets a `CDP_` prefix and is documented here before being used anywhere.
- Do NOT create `READLM`, `LISTBROWSERS`, `NEWDOC`, `EXECUTE` — retired/renamed. Use `CDP_EXECUTE` for JS eval.
- `RESET` is **retired** — see ADR-009. Replace with explicit `CLICKID` on the app's clear button.

### 1.2 KeyWin application-agnostic rule (ADR-009)

**KeyWin.exe MUST NOT contain any reference to a specific application.** This is a
binding architectural constraint documented in [ADR-009](docs/architecture/decisions/ADR-009-keywin-app-agnostic.md).

The following are **forbidden** inside `KeyWin.cs`:
- Named AutomationIds belonging to one app (`clearButton`, `CalculatorResults`, …)
- Window class names matched by application title (`"Notepad"`, `"Poznámkový blok"`)
- Localisation strings of specific apps ("Display is", calculator prefix-strip)
- Compound operations whose semantics are app-specific (`{RESET}`, `=` → Enter)
- Key-sequence maps for specific app buttons (`_buttonKeyMap`)

Failed check → move the knowledge to `scenarios.xml` and `CLICKID`/`SENDKEYS`/`READELEM`
steps that reference the AutomationId explicitly.

### 1.1 Command selection policy — what to use when

**Clicks are the primary user simulation.** A real user interacts by clicking and
typing. The automation must reproduce those actions through the OS/CDP input stack —
not by injecting JS that calls `.click()` or `.dispatchEvent()` programmatically.

| Intent | Correct command | FORBIDDEN shortcut |
|---|---|---|
| Click a button, link, nav item, checkbox | `CLICKID path="*[@data-section='x']"` | `CDP_EXECUTE value="el.click()"` |
| Focus an input then type | `CLICKID` + `SENDKEYS` | `CDP_EXECUTE value="el.value=…;el.dispatchEvent(…)"` |
| Read page title / URL | `READ proc="{{tab}}" path=""` → bind → `ASSERT` | `CDP_EXECUTE value="document.title"` |
| Read element text / input value | `READELEM proc="{{tab}}" path="css-selector"` | `CDP_EXECUTE value="el.textContent"` |
| Assert element is present in DOM | `READELEM proc="{{tab}}" path="css-selector"` (fails if not found) | `CDP_EXECUTE value="!!document.querySelector(…)"` |
| Assert element has CSS class (e.g. `.active`) | `READELEM proc="{{tab}}" path="[data-section='x'].active"` | `CDP_EXECUTE value="el.classList.contains('active')"` |
| Assert element is absent / count | `CDP_EXECUTE value="…"` | — (no READELEM equivalent) |
| `<select>` value change + onchange | `CLICKID path="#sel"` + `CDP_EXECUTE value="el.value='x';el.dispatchEvent(new Event('change',{bubbles:true}))"` | `SENDKEYS` (UIA-only; `path=` ignored; can't target DOM element) |
| Count elements, compute derived values | `CDP_EXECUTE value="…"` | — (no READELEM equivalent) |
| Test assertion on a bound variable | `ASSERT proc="{{hwnd}}" path="AutomationId" value="expected" op="contains"` — reads the live UIA/DOM element at `path=` and compares; `path=""` reads whole window | **FORBIDDEN:** `ASSERTPATHEVAL path="String('{{readVal}}').includes(…)"` — never put JS string ops in path=; path= is always a control-tree address |
| JS test shim injection (dialogs, fetch stubs) | `CDP_EXECUTE value="…"` | — (legitimate, test-L3 only) |

**Why:** `CLICKID` routes through BrowserWin's CDP `Input.dispatchMouseEvent` (or
KeyWin's UIA `Invoke`), which fires the full browser/OS event chain: mousedown,
mouseup, click, focus, blur — exactly what the user produces. A JS `.click()` call
bypasses layout, accessibility, and pointer-event handlers. It will silently succeed
on hidden or disabled elements and is invisible to security filters.

**READELEM for state assertions:** `READELEM path="css-selector"` issues a real DOM
query via BrowserWin and returns `{"found":false}` (step fails) if the selector matches
nothing. This means a CSS selector with a class filter — e.g. `[data-section='settings'].active`
— acts as a presence assertion: the step passes only when the element exists AND has
the `.active` class. No JS is needed for active-tab / visible-section checks.

**READ for page-level reads:** `READ proc="{{tab}}" path=""` returns
`{"title":"…","url":"…","description":"…"}` as a JSON string. Bind it and use `ASSERT`
to check the title without eval-ing JS in the browser.

**CDP_EXECUTE is the last resort** — only justified when CLICKID / READELEM / READ
cannot express the intent (element absence, element counts, computed values, test shims).

### 1.1a XML patterns — proven recipes for common test assertions

```xml
<!-- ✓ Page title check (no JS) -->
<step action="READ"    proc="{{tab}}" path="" bind="pageInfo" note="read page title"/>
<step action="ASSERT"  path="'{{pageInfo}}'" value="AI API Dashboard" note="title correct"/>

<!-- ✓ Element present in DOM (step fails if not found) -->
<step action="READELEM" proc="{{tab}}" path="#my-element" note="element exists"/>

<!-- ✓ Multiple elements present — one READELEM per element -->
<step action="READELEM" proc="{{tab}}" path="[data-section='logs']"     note="logs button present"/>
<step action="READELEM" proc="{{tab}}" path="[data-section='settings']" note="settings button present"/>

<!-- ✓ Active-tab / active-section check — CSS class filter, no JS -->
<step action="READELEM" proc="{{tab}}" path="[data-section='settings'].active" note="Settings tab is active"/>

<!-- ✓ Input value check — ASSERT two-argument form (default op===) -->
<step action="READELEM" proc="{{tab}}" path="#setting-log-level" bind="lvl" note="read log-level select"/>
<!-- path= is the actual value expression; value= is the expected comparator -->
<step action="ASSERT"   path="({{lvl}}).value" value="debug" note="log level is debug"/>

<!-- ✓ Inequality: assert reverted value differs from dirty -->
<step action="ASSERT" path="({{lvl}}).value" value="{{dirtyLevel}}" op="!==" note="reverted"/>

<!-- ✓ Numeric comparison: use word aliases gt/lt/gte/lte to keep XML valid -->
<step action="ASSERT" path="{{count}}" value="0" op="gt" note="at least one item"/>

<!-- ✓ Complex boolean that cannot split into LHS/RHS — use ASSERTPATHEVAL -->
<step action="ASSERTPATHEVAL" path="'{{pageInfo}}'.includes('AI API')" note="title contains AI API"/>
<step action="ASSERTPATHEVAL" path="(function(){ var m='{{val}}'.match(/\d+/); return m ? Number(m[0])===32 : false; })()" note="calc result is 32"/>

<!-- ✓ Click a nav button by data-section attribute -->
<step action="CLICKID" proc="{{tab}}" path="*[@data-section='settings']" note="click Settings nav"/>

<!-- ✗ NEVER do this — bypasses OS event chain -->
<!-- <step action="CDP_EXECUTE" proc="{{tab}}" value="document.querySelector('[data-section=settings]').click()"/> -->
```

### 1.1b Scenario authoring policy — trailing assertion rule (G-D.7)

**Every `<Scenario>` that is not a pure orchestrator must end with at least one assertion step (`ASSERT`, `ASSERTPATHEVAL`, `READELEM`).**

- Orchestrators (effect="test-suite") that contain only `<ScenarioRef>` children are exempt — the assertion is in the leaf.
- Diagnostic scenarios (`effect="diagnostic"`) are exempt.
- Input-only scenarios (FILL, SENDKEYS, CLICK) must add a **liveness check** as final step (e.g. `READELEM` on an element that only exists once the action succeeded, or `ASSERTPATHEVAL` on a bound value).

**Convention — mark unvalidated scenarios for follow-up:**

```xml
<!-- assert-required: this scenario does not yet end with an assertion — add one before shipping -->
<Scenario id="my-scenario" effect="changes-view">
```

The comment `<!-- assert-required -->` is a searchable flag. Run:

```powershell
Select-String -Path "**\scenarios.xml" -Pattern "assert-required" -Recurse
```

to enumerate scenarios that still need a trailing assertion.

> ⚠️ **NEVER** place `<!-- ... -->` inside an XML attribute value (e.g. `note="... <!-- assert-required -->"`) —
> `<` is a disallowed character in attribute values and causes an XML parse error at runtime.

**Safe integer proxy pattern** — when `innerText` or other string content would break a `'{{var}}'`
string literal in ASSERTPATHEVAL (due to embedded quotes or newlines), always bind the **length**
as an integer instead, then assert the integer:

```xml
<!-- ✓ safe: bind length as integer, assert length > 0 -->
<Step action="CDP_EXECUTE" proc="{{tab}}"
      value="(document.getElementById('my-list')||{innerText:''}).innerText.length"
      bind="myListLen"/>
<Step action="ASSERTPATHEVAL" path="Number('{{myListLen}}') > 0"
      note="list has content"/>

<!-- ✗ UNSAFE: raw innerText may contain single-quotes or newlines -->
<!-- <Step action="CDP_EXECUTE" value="document.getElementById('my-list').innerText" bind="myListText"/>
     <Step action="ASSERTPATHEVAL" path="'{{myListText}}'.length > 0" note="unsafe"/> -->
```

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
in `components/helpers/*/dist-resources/apptemplates/*/tree.xml` list well-known paths as documentation and as the whitelist for
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

#### Reserved optional fields (both wire formats)

These fields are injected by `HelperDaemon.call()` and checked by `RunStdinListener`.
They MUST be included in the HMAC-signed body so they cannot be tampered with in transit.

| Field | Type | Description |
|---|---|---|
| `_caller_user` | `string` | Authenticated username from the MCP/HTTP auth layer.  Empty when the request is unauthenticated or MCP-stdin (no HTTP context). |
| `_caller_roles` | `string` | Comma-separated list of roles granted to the caller, e.g. `"admin,operator"`.  Empty when unauthenticated. |
| `hmac`          | `string` | HMAC-SHA256 hex of the serialised request body (excluding the `hmac` field itself), signed with the HKDF session key. |

`_caller_user` and `_caller_roles` are forwarded verbatim to `sec_validate_action()` in
`SecurityLib.dll`, where they are matched against the optional `role` field of each
`FilterRule`.  A rule whose `role` field is non-empty only fires when the caller holds
that exact role.

---

## 3. App template structure

Templates live **inside the helper component** that implements them, split by OS scope:

- **OS-neutral** (CDP-based, shared across platforms): `components/helpers/shared/dist-resources/apptemplates/<app>/`
- **Windows-specific** (UIA-based): `components/helpers/windows/dist-resources/apptemplates/<app>/`

| File             | Purpose |
|------------------|---------|
| `tree.xml`       | Annotated control/element inventory. Only UI primitives in `<action>` blocks. |
| `scenarios.xml`  | Reusable compound operation fragments. References `ScenarioRef` for composition. |
| `embeddings/`    | Optional: pre-computed vector embeddings for semantic control search. |

> **Planned (deferred — see TODO.md "App Template Namespacing"):** `<app>` will become a
> slash-separated reverse-domain path, e.g. `com.microsoft/windows.v11/calculator`.
> Current layout (`components/helpers/windows/dist-resources/apptemplates/calculator/`) is the flat interim form.
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

### `<assert>` element rules — generic conditional wrapper

`<assert>` wraps any set of `<Control>`, `<Node>`, or `<Group>` elements that are
only present in the live UI tree when a runtime condition is true.

Attributes mirror the `ASSERT` command in `scenarios.xml`:

| Attribute | Required | Description |
|-----------|----------|-------------|
| `path`    | yes | Control-tree address (same `/`-walk semantics as READELEM). |
| `op`      | yes | Comparison operator: `contains`, `equals`, `startsWith`, `exists`, `visible`. |
| `value`   | yes (except `exists`/`visible`) | Expected value. |
| `note`    | no  | Human-readable explanation, e.g. locale variants. |

The condition is satisfied when `READELEM(path) [op] value` would pass in a scenario.
- `exists` — the control at `path` is present in the tree (no value needed).
- `visible` — the control at `path` is present **and** its `IsOffscreen` UIA property is false (no value needed).

These controls are **only addressable** when their `<assert>` condition holds; step
authors must ensure the correct state before referencing them.

Multiple `<assert>` siblings are independent — each defines a mutually exclusive or
overlapping presence domain. There is no implicit `else`.

**Good usage** (Standard vs Scientific mode for Calculator):
```xml
<!-- Standard mode: controls present when Header contains "Standardní" -->
<assert path="NavView/Header" op="contains" value="Standardní"
        note="Czech locale — also 'Standard' in EN builds">
  <Node id="StandardFunctions" type="Group" path="NavView/StandardFunctions">
    ...
  </Node>
</assert>

<!-- Scientific mode: different control set, same generic mechanism -->
<assert path="NavView/Header" op="contains" value="Vědecký"
        note="Czech locale — also 'Scientific' in EN builds">
  <Node id="ScientificAngleOperators" type="Group" path="NavView/ScientificAngleOperators">
    ...
  </Node>
</assert>
```

**DO NOT** create new XML elements (`<modeSelector>`, `<Mode>`, `<conditional>`, etc.)
for this purpose. `<assert>` is the single generic mechanism.

---

### Step-level conditionals — `<assert>` child of `<step>`

> **`conditional="absent"` is deprecated.** The string attribute was a single hardcoded
> terminal that only ever tested whether a `{{hwnd}}` binding was empty.
> Replace it with a child `<assert>` element on every `<step>` that has conditional logic.

**Rule:** A `<step>` is executed only when all child `<assert>` elements evaluate to true.
When the step has no child `<assert>`, it is always executed (current behaviour preserved).

**Child `<assert>` attributes:**

| Attribute | Required | Description |
|-----------|----------|-------------|
| `proc`    | yes | Helper process (may be empty string `""` for variable-only checks — no helper call). |
| `path`    | yes | Target: UI element path **or** `{{varName}}` variable reference when `proc=""`. |
| `op`      | yes | See operator table in `ASSERT` command row above: `equals`, `contains`, `startsWith`, `exists`, `visible`, `matches`. |
| `value`   | conditional | Expected value; omitted for `exists` / `visible`. |
| `note`    | no  | Human-readable rationale. |

**When `proc=""`:** no helper call is made — `path=` is resolved as a scenario variable
(e.g. `{{hwnd}}`), its current bound value is compared via `op=/value=`.

**When `proc` is a process name:** the executor calls `READELEM(proc, path)` and applies the
`op`/`value` comparison on the result string (identical to inline `ASSERT` step semantics).

**Migration guide — replace `conditional="absent"` in scenarios.xml:**

```xml
<!-- BEFORE (deprecated) -->
<step action="LAUNCH" proc="calc.exe" conditional="absent"/>

<!-- AFTER (canonical) -->
<step action="LAUNCH" proc="calc.exe">
  <assert proc="" path="{{hwnd}}" op="equals" value=""
          note="launch only when hwnd is not yet bound"/>
</step>
```

**Multiple child `<assert>` elements:** all must be satisfied (AND semantics).
For OR semantics use a separate scenario with a `<ScenarioRef>` guard scenario.

**Implementation status:** `conditional="absent"` fallback in `xmlScenarioLoader.ts` remains
for backward compatibility; new authoring MUST use child `<assert>` form.

---

## 4. Source layout (post-2.8 refactor)

```
components/server/src/helpers/HelperRegistry.ts   ← helper process management
components/server/src/server/mcpServer.ts         ← MCP JSON-RPC server
components/server/src/server/httpServerWithDashboard.ts ← REST + WebSocket dashboard server
components/helpers/shared/src/HelperCommon.cs       ← shared C# helper base (HelperCommon.cs, WinCommon.cs)
components/helpers/windows/src/KeyWin.cs            ← Windows keystroke helper
components/helpers/windows/src/BrowserWin.cs        ← Windows browser CDP helper
components/helpers/shared/src/security/SecurityLib.cpp ← SecurityLib native C++ DLL
dist/helpers/                   ← compiled EXEs (KeyWin.exe, BrowserWin.exe) + SecurityLib.dll
config/dashboard-settings.json  ← runtime settings (was root dashboard-settings.json)
config/security/config.json     ← security policy: binaryHashes, filterRules, defaultPolicy
config/users.json               ← user/role store when auth.users.storeSource = "json" (signed)
components/helpers/shared/dist-resources/apptemplates/  ← OS-neutral app templates (chrome/, schemas)
components/helpers/windows/dist-resources/apptemplates/ ← Windows-specific app templates (calculator/, notepad/)
test/integration/               ← full-stack integration tests
test/e2e/                  ← dogfood blackbox UI tests (D2–D17)

components/server/src/auth/types.ts               ← IAuthProvider, IUserStore, User, Role, AuthResult, all auth interfaces
components/server/src/auth/AuthMiddleware.ts      ← HTTP middleware: extracts credentials → IAuthProvider → populates req.authContext
components/server/src/auth/providers/NoAuthProvider.ts        ← auth.mode = "none"
components/server/src/auth/providers/PasswordAuthProvider.ts  ← auth.mode = "password" (bcrypt + JWT)
components/server/src/auth/providers/ApiKeyAuthProvider.ts    ← auth.mode = "apikey" (hashed key lookup + JWT)
components/server/src/auth/providers/CertificateAuthProvider.ts ← auth.mode = "certificate" (TLS client cert + JWT)
components/server/src/auth/providers/OAuthProvider.ts         ← auth.mode = "oauth" (OAuth2/OIDC redirect + JWT)
components/server/src/auth/providers/SamlProvider.ts          ← auth.mode = "saml" (SAML 2.0 redirect + JWT)
components/server/src/auth/stores/JsonUserStore.ts            ← IUserStore on signed config/users.json
components/server/src/auth/stores/DbUserStore.ts              ← IUserStore on remote DB (MSSQL/Oracle/MySQL/PostgreSQL)

components/server/src/db/DbProvisioner.ts                     ← DB lifecycle: create DB, migrations, seed; used by DbUserStore +
                                                                DbSettingsAdapter on initialize() and by POST /api/_internal/db/provision

components/server/src/settings/types.ts                       ← ISettingsAdapter, SettingsSourceConfig, DbAuthMethod
components/server/src/settings/adapters/JsonSettingsAdapter.ts ← ISettingsAdapter on signed config/dashboard-settings.json
components/server/src/settings/adapters/DbSettingsAdapter.ts   ← ISettingsAdapter on remote DB
components/server/src/settings/SettingsManager.ts              ← factory: reads settingsSource, hydrates correct adapter
```

---

## 5. Settings keys (`config/dashboard-settings.json`)

Documented keys — do NOT add new ones without updating this list:

### 5.1 Core

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `appTemplateRoots` | string[] | `['./components/helpers/shared/dist-resources/apptemplates', './components/helpers/windows/dist-resources/apptemplates']` | Ordered list of helper apptemplates roots; legacy single-path `appTemplatesDir` still accepted |
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

**Database provisioning:**

| Method | Path | Handler method | `_internal` operation |
|--------|------|----------------|----------------------|
| POST | `/api/_internal/db/provision` | `handleInternalDbProvision` | `settings_change` |

Body: `{ adminDb?: DbConfig, targetDb: DbConfig, createDb?: boolean, seed?: boolean }`
Response: `{ ok: boolean, steps: ProvisionStep[] }`
Purpose: create DB (optional) → `DbProvisioner.ensureSchema()` → `DbProvisioner.seedInitialData()` (optional).

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
- [ ] Does an app template file already exist in `components/helpers/shared/dist-resources/apptemplates/` or `components/helpers/windows/dist-resources/apptemplates/`?
- [ ] Does a REST endpoint already exist in §6?
- [ ] Does a settings key already exist in §5?
- [ ] Is the source file I'm about to create already in §4?
- [ ] Does a Layer-1 scenario atom already exist in the shipped `scenarios.xml` for that app (§8)?

If any answer is YES → extend the existing one; do NOT create a parallel version.

---

## 8. Scenario layer architecture

Scenarios are organised in **three strictly separated layers**. Each layer has its own
location, ownership, and permitted content. Never mix content from a higher layer into
a lower one.

```
L1  components/helpers/*/dist-resources/apptemplates/<app>/scenarios.xml
      Distributed with the product.  Atomic UI primitives only.
      Consumed by: AI orchestration, L2 use-case scenarios, L3 test scenarios.

L2  config/scenarios/<app>/          (user-space, not yet populated)
      Use-case workflows assembled from L1 atoms via <ScenarioRef>.
      Model complete user journeys ("change log level and save").
      No test-only content (no shims, no CDP_EXECUTE assertions).
      Consumed by: AI orchestration, L3 test scenarios.

L3  test/e2e/d#/scenarios.xml
      Test-suite scenarios.  Reference L1 (and optionally L2) via <ScenarioRef>.
      Add test-only shims (confirm/alert overrides) and CDP_EXECUTE assertion steps.
      NEVER shipped in the product — test/ directory only.
      Consumed by: d#/run.js via ScenarioRunner.runOk().
```

### Layer rules

| Layer | May contain | FORBIDDEN |
|-------|-------------|-----------|
| L1 | `CLICKID`, `SENDKEYS`, `READ`, `READELEM`, `ASSERT`, `WAIT`, `CDP_EXECUTE` (read/compute only), `LAUNCH`, `KILL`, `LISTWINDOWS` | Any test assertion that throws; dialog shims; `dashRest()` references |
| L2 | `<ScenarioRef app=".." ref=".."/>` chains; `WAIT` for pacing; tight `CDP_EXECUTE` reads | Test assertions; dialog shims; REST calls |
| L3 | All L1 content + `<ScenarioRef>` to L1/L2 + `CDP_EXECUTE` assertions (throw pattern) + dialog shims (`override-page-dialogs`) | `dashRest()` calls; anything that bypasses the browser UI |

### Assertion step convention

Use the correct action for each intent — never mix assertion logic into extraction steps:

| Intent | Action | Rule |
|--------|--------|------|
| Verify a condition is true | `ASSERTPATHEVAL` | `path=` JS expression — falsy fails the step. Describe the check in `note=`. |
| Extract a value for later steps | `EVAL` + `bind=` | Expression returns the value; **never throws**. |
| Structural equality check | `ASSERT` | `path=` value compared to `value=` via `op=` (default: `===`). |

> **Banned patterns:**
> - `EVAL` without `bind=` used as an assertion — use `ASSERTPATHEVAL` instead.
> - `EVAL` that both throws on failure AND binds a value — split into one `ASSERTPATHEVAL`
>   (the check) followed by one `EVAL` + `bind=` (the extraction).

### XML element and attribute casing (ADR-011)

| Token | Case | Example |
|-------|------|---------|
| Element (tag) names | **PascalCase** | `<Scenario>`, `<Steps>`, `<Step>`, `<Parameters>`, `<Param>`, `<Description>`, `<ScenarioRef>` |
| Attribute names | **camelCase** | `id=`, `effect=`, `action=`, `proc=`, `path=`, `value=`, `bind=`, `op=`, `note=`, `conditional=`, `scroll=` |

### `scroll="true"` Step attribute — opt-in scroll-into-view (ADR-012)

Add `scroll="true"` to any `<Step>` to instruct the helper to scroll the target element
into view **before** performing the interaction.  The attribute is **opt-in only** — it has
no effect when omitted (default `false`).

**Supported commands / helpers:**

| Helper | Commands |
|--------|----------|
| `BrowserWin.exe` | `CLICKID`, `CLICKNAME`, `FILL`, `READELEM` — uses `el.scrollIntoView({block:'nearest',inline:'nearest'})` via CDP |
| `KeyWin.exe`     | `CLICKID`, `FILL` — uses UIA `ScrollItemPattern.ScrollIntoView()` |
| All helpers      | Any future commands can add scroll support by detecting the `SCROLL_` action prefix |

**Wire protocol:** when `scroll="true"` the server prefixes the action verb with `SCROLL_`
in the wire JSON (`{"action":"SCROLL_CLICKID",...}`).  Each helper's driver strips the
prefix internally and applies the scroll before execution.

**Usage:**

```xml
<Step action="FILL"    proc="{{tab}}" path="#filter-description"
      value="{{description}}" scroll="true"
      note="field may be off-screen in long modals — scroll into view before filling"/>
<Step action="CLICKID" proc="{{tab}}" path="#btn-save-filter"
      scroll="true" note="ensure button is visible before clicking"/>
```

> **Rule:** only add `scroll="true"` when the target element is genuinely at risk of being
> off-screen (e.g. inside a scrollable modal, a long settings page, or a dynamic list).
> Do **not** apply it unconditionally — doing so adds latency on every step.

> **Parser tolerance:** `xmlScenarioLoader.ts` normalises tag names to lowercase internally
> (`.tagName.toLowerCase()`) so mixed-case files are tolerated at runtime. This is NOT a
> licence for mixed authoring — all new files MUST use PascalCase elements.

### Cross-helper step routing — `tool=` per-step override

A single `<Scenario>` may target multiple helpers by adding `tool=` to individual
`<Step>` elements. The `tool=` attribute overrides the scenario-level `helper=` for
that step only; steps without `tool=` use the scenario default helper.

```xml
<Scenario id="bc12-restore-dialog" helper="BrowserWin.exe" effect="modifies-dom">
  <Steps>
    <Step tool="BrowserWin.exe" action="LAUNCH" proc="chrome" path=""
          note="relaunch browser after KILL"/>
    <Step tool="KeyWin.exe" action="LISTWINDOWS" proc="SYSTEM"
          path="restore|didn.t shut"
          note="find crash-recovery dialog; binds {{hwnd}}"/>
    <Step tool="KeyWin.exe" action="SENDKEYS" proc="{{hwnd}}" value="{ESC}"
          note="dismiss dialog (or harmlessly targets foreground if no dialog found)"/>
    <Step tool="BrowserWin.exe" action="NAVIGATE" proc="chrome" path="http://localhost:3458"
          note="navigate to dashboard"/>
  </Steps>
</Scenario>
```

**Engine support:** [`parseStep`](components/server/src/scenarios/xmlScenarioLoader.ts:860)
reads `el.getAttribute('tool') || defaultTool`; [`executeXmlScenario`](components/server/src/scenarios/xmlScenarioLoader.ts:235)
uses `step.tool || scenario.helper` to route each step to the correct helper.
Per-step tool override is fully supported today — no engine changes required.

**`{{hwnd}}` binding note:** `LISTWINDOWS` always writes its result to `vars['hwnd']`.
If no window matches the title filter, `vars['hwnd']` remains empty. A subsequent
`SENDKEYS proc="{{hwnd}}"` with an empty hwnd targets the OS foreground window — an
acceptable soft no-op when no dialog is present.

---

### Formal scenario contract — `<Parameters>` block (XSD §ParametersType)

Every `{{varName}}` placeholder used in a scenario's steps MUST be declared as a
`<Param>` in a `<Parameters>` block. This is the machine-readable call contract:

```xml
<Scenario id="set-loglevel-select" effect="modifies-settings">
  <Description lang="en">Select {{logLevel}} in the log-level dropdown.</Description>
  <Parameters>
    <Param name="logLevel" type="enum" required="true"
           values="debug info warn error" example="debug"
           note="Log level to select in the dropdown"/>
    <Param name="tab" type="string" required="true"
           example="chrome" note="BrowserWin tab target"/>
  </Parameters>
  <Steps>
    <Step action="CLICKID" proc="{{tab}}" path="*[@id='setting-log-level']"
          note="open log-level dropdown"/>
    <Step action="SENDKEYS" proc="{{tab}}" value="{{logLevel}}"
          note="select log level {{logLevel}}"/>
    <Step action="ASSERT" proc="{{tab}}" path="#setting-log-level" value="{{logLevel}}"
          op="contains" note="confirm selection applied"/>
  </Steps>
</Scenario>
```

Presence of `<Parameters>` enables:
- Dashboard scenario editor to show typed input fields
- `xmlScenarioLoader` to validate and fill defaults at call time
- AI orchestration to know what params to provide without reading step bodies
- `xmllint --schema scenarios.xsd` to validate the file

**Automatic variables** that MUST NOT be declared as parameters (bound at runtime):
- `{{hwnd}}` — auto-bound by LISTWINDOWS result
- `{{tab}}` — auto-bound by LAUNCH/NAVIGATE result (BrowserWin)

**`effect=` attribute** (required on every `<Scenario>`):

| Value | Meaning |
|-------|---------|
| `launches-app` | Starts a new process |
| `changes-view` | Navigates / switches section |
| `modifies-settings` | Writes and saves a setting |
| `modifies-dom` | Mutates page state without saving |
| `modifies-doc` | Edits document content (KeyWin) |
| `opens-modal` | Opens a modal dialog |
| `closes-modal` | Closes a modal dialog |
| `read-only` | Reads state, no side-effects |
| `test-suite` | Top-level suite that chains other scenarios |
| `diagnostic` | Dev/test only; not part of product behaviour |

### Locale-aware parameter values — `<LocaleMap>` grammar (ADR-013)

**The iron rule:** Scenario step `value=` attributes MUST never contain a hard-coded
UI display string that varies by locale (e.g. button labels, dropdown items, menu
entries).  Such strings fail silently on any non-matching system locale.

**The escape hatch — `<LocaleMap>` block:**

```xml
<Scenario id="set-mode" label="Set mode">
  <Parameters>
    <!--
      localeMap="set-mode.modeLabel" links this param to the LocaleMap below.
      The caller may supply {{modeLabel}} directly, or let the AI resolve the
      correct display string by querying GET /api/appTemplates/{app}/scenarios/
      set-mode/localeMap?param=modeLabel&lang={{appLocale}}.
    -->
    <Param name="modeLabel" type="string" default="Standard"
           localeMap="set-mode.modeLabel"
           note="Display label for the mode button — locale-dependent"/>
  </Parameters>
  <LocaleMap param="modeLabel">
    <Locale lang="en" value="Standard"/>
    <Locale lang="cs" value="Standardní"/>
    <Locale lang="de" value="Standard"/>
  </LocaleMap>
  <Steps>
    <Step command="CLICKID" target="{{hwnd}}" parameter="standardMode"/>
  </Steps>
</Scenario>
```

**Usage pattern for AI orchestration:**

```
1. detect-locale atom: execute scenario "detect-locale" → binds {{appLocale}}
2. locale lookup:
     GET /api/appTemplates/{app}/scenarios/{id}/localeMap?param=modeLabel&lang={{appLocale}}
     → { localeMaps: [{ param: "modeLabel", entries: [{ lang: "cs", value: "Standardní" }] }] }
3. Pass resolved value as {{modeLabel}} when running the automation step.
```

**Iron rule summary:**

| Do ✓ | Don't ✗ |
|------|---------|
| Use `localeMap=` attr + `<LocaleMap>` block | Hard-code `value="Standardní"` in `<Step>` |
| Detect locale first via `detect-locale` atom | Assume locale from system or file name |
| Fall back to `default=` when no entry matches | Error out on missing translation |

**REST endpoint:**

```
GET /api/appTemplates/{app}/scenarios/{scenarioId}/localeMap
  ?param=modeLabel         # optional — filter to one param
  ?lang=cs                 # optional — return only entries for this language

Response: { success: true, app, scenarioId,
            localeMaps: [{ param, key, entries: [{lang, value}] }] }
```

#### Locale-invariance linter (G-D.12)

A static lint pass enforces the iron rule at load time and in CI:

- **At load time**: `XmlScenarioLoader.load()` calls `lintLocaleInvariance()` and throws on `error`-severity violations. Suppress with `AIAPI_LINT_LOCALE=false` during migration only.
- **In CI**: `node tools/lint-locale-invariance.js` scans all `scenarios.xml` files; exits non-zero on any `error`. Add `--strict` to also fail on `warn`.
- **Severity rules**:
  - `error` — literal non-numeric string in `value=` (e.g. `value="Standard"`)
  - `warn` — `{{varRef}}` whose `<Param>` has no `localeMap=` declared
  - safe — numeric literal, empty/boolean, `{{var}}` with `localeMap=`, numeric/truthy/matches ops

### Cross-layer reference syntax

```xml
<!-- Reference an L1 atom from L3 test scenario -->
<ScenarioRef app="dashboard" ref="nav-to-settings"/>

<!-- Reference a sibling scenario in the same file (no app= needed) -->
<ScenarioRef ref="override-page-dialogs"/>
```

### Canonical L1 locations

| App | L1 scenarios.xml location |
|-----|---------------------------|
| dashboard | `components/helpers/shared/dist-resources/apptemplates/dashboard/scenarios.xml` |
| calculator | `components/helpers/windows/dist-resources/apptemplates/calculator/scenarios.xml` |
| notepad | `components/helpers/windows/dist-resources/apptemplates/notepad/scenarios.xml` |
| chrome | `components/helpers/shared/dist-resources/apptemplates/chrome/scenarios.xml` |

Before adding a new atomic interaction in a test (`d#/scenarios.xml`), check whether
the equivalent L1 atom already exists in the shipped app scenarios.xml for that app.  
If it does → use `<ScenarioRef>`.  
If it does not → add it to the L1 file first, then reference it from L3.

---

## 9. AI Agent Operating Protocol (mandatory loop)

This section is normative for **every AI agent** (including future instances reading this
file) that uses the AIAPI server to drive UI automation.  
The protocol is structured as two top-level branches and a mandatory inner loop.

---

### Branch 1 — Known operation (scenario available)

```
IF the intended operation is described in a known scenarios.xml for the target app:
  → execute it via executeScenario / ScenarioRef
  → follow Branch 1 verification (§9.4) after execution
  → IF the scenario completes without unexpected tree changes  → done
  → IF unexpected tree changes appear                         → fall through to Branch 2 inner loop
```

---

### Branch 2 — Unknown operation (exploration loop)

When no matching scenario exists, or after unexpected post-scenario state changes, run
the following loop for **every individual sub-action** within the intended operation.

#### 9.1  Read the current tree (BEFORE state)

1. `QUERYTREE` the target window/tab, scoped to the smallest subtree that contains the
   control you are about to interact with.  Bind the result: `bind="tree_before"`.
2. For **browser / web pages and Office documents** BOTH sources must be captured:
   - The **native window** UIA control tree (via `KeyWin` or `BrowserWin` UIA mode)
   - The **document DOM** tree (via `QUERYTREE` CDP mode or `PAGESOURCE`)
3. Compare to the existing `tree.xml` for the app (if one exists).  Note any differences —
   they may indicate a version change, a dialog, or a state that the template does not cover.

#### 9.2  Execute the action — precedence order

Try action methods in this order; stop at the first that succeeds:

| Priority | Method | When to use |
|----------|--------|-------------|
| 1st | `SENDKEYS` key event | Always try keyboard first — it is the most reliable and least likely to break layout |
| 2nd | `CLICKID` / `CLICKNAME` mouse click | When keyboard does not apply (toolbar icons, tree expand, drag targets) |
| 3rd | `EXEC` JavaScript command | Last resort — for browsers and JS-compatible apps only; document the reason |

Never skip to JS without attempting keyboard and click first.

#### 9.3  Read-back verification (AFTER state)

After every action, perform ALL of the following checks before proceeding to the next step:

**9.3.1 — Primary control read-back** *(always)*  
Read the value of the control that was just manipulated (input box, checkbox, dropdown,
list selection, etc.).  Assert it matches the intended value.
```xml
<Step action="READ"   proc="{{proc}}" path="{{control_path}}" bind="read_after"
      note="read-back: verify control reflects the action just taken"/>
<Step action="ASSERT" proc="{{proc}}" path="{{read_after}}" value="{{expected}}"
      op="contains" note="assert control value changed as intended"/>
```

**9.3.2 — Dependent control read-back** *(only when the dependency is known)*  
If acting on control A is specified to change control B (e.g. pressing a calculator button
updates the display; selecting a menu changes a status bar value), read B and assert the
expected change.  This step is skipped if no dependency is known.
```xml
<Step action="READ"   proc="{{proc}}" path="{{dependent_control_path}}" bind="dep_after"
      note="read-back: verify dependent control updated"/>
<Step action="ASSERT" proc="{{proc}}" path="{{dep_after}}" value="{{expected_dep}}"
      op="contains" note="assert dependent control reflects the cascaded change"/>
```

**9.3.3 — Tree re-read and diff** *(always — most important)*  
Re-run `QUERYTREE` scoped to the same subtree as 9.1, bind as `tree_after`.  
Diff `tree_before` vs `tree_after` (using the TREEDIFF server command — see §10).  
The diff reveals:
- A **dialog** that appeared (error, confirmation, Save Password, etc.) — MUST be handled
  before the next step.
- A **navigation** (page changed, modal opened) — update scope for next 9.1 read.
- **No change** — the action may have failed silently; investigate before continuing.
- **Expected change only** — proceed.

> **CRITICAL**: For web pages, be aware that new `<div>` overlays or injected `<script>`
> nodes may appear anywhere in the DOM, not only inside the interacted element's subtree.
> When the action is known to potentially affect global DOM layout (modal triggers,
> toast notifications, React portal renders), widen the diff scope to the full document.

```xml
<Step action="QUERYTREE" proc="{{proc}}" path="{{scope}}" value="3" bind="tree_after"
      note="post-action tree snapshot for diff"/>
<Step action="TREEDIFF"  bind_a="tree_before" bind_b="tree_after" bind="tree_diff"
      note="diff: detect dialogs, navigation, unexpected changes"/>
```

#### 9.4  Handle diff output

| Diff result | Required action |
|-------------|----------------|
| New node(s) with type `dialog` / `modal` / `popup` | Invoke the appropriate dismiss scenario (`<ConditionalRef>` — see §11); then re-read tree |
| New node(s) that match a known dialog in `tree.xml` | Execute the documented dismissal path from `tree.xml` |
| Navigation detected (URL changed / page replaced) | Re-anchor: new `QUERYTREE` from the new root; update `tree_before` |
| Control value unchanged | Retry with next priority method (§9.2); log failure if all methods exhausted |
| Unexpected structural change | Stop; capture full `QUERYTREE` + `PAGESOURCE`; update `tree.xml` |

#### 9.5  Note the scenario / update templates

After completing an exploration-loop session:

- **User scenario mode**: write the sequence of steps as a new L2 scenario in
  `config/scenarios/<app>/`.  Reference L1 atoms via `<ScenarioRef>` where possible.
- **Master learning mode** (apptemplate creation): create or update the L1 file
  `components/helpers/*/dist-resources/apptemplates/<app>/scenarios.xml`.
  - Each discovered sub-sequence with a clear, reusable purpose → its own `<Scenario>`.
  - Conditional dialog-dismissal sub-sequences → a `<ConditionalRef>` subscenario (§11).
  - User-defined local templates may be submitted for signing and distribution.

---

## 10. Tree snapshot registers (QUERYTREE state stack)

### Purpose

To support the diff operation required by §9.3.3 and §9.4, the server maintains a named
register store for `QUERYTREE` results.  Agents bind named snapshots and request diffs
without having to ferry multi-kilobyte trees over the MCP transport.

### Named bind registers

Every `QUERYTREE` step that specifies `bind=` stores the result in the scenario's variable
map **and** in a per-session named register.  Register names follow the `bind=` value.

```xml
<!-- Capture before-state -->
<Step action="QUERYTREE" proc="{{proc}}" path="{{scope}}" value="3"
      bind="tree_before" note="snapshot: before-action tree"/>

<!-- ... action steps ... -->

<!-- Capture after-state -->
<Step action="QUERYTREE" proc="{{proc}}" path="{{scope}}" value="3"
      bind="tree_after" note="snapshot: after-action tree"/>
```

### TREEDIFF command

`TREEDIFF` is a synthetic command (no helper binary required — processed server-side).

| Attribute | Meaning |
|-----------|---------|
| `bind_a=` | Name of the "before" register |
| `bind_b=` | Name of the "after" register |
| `bind=`   | Output variable name for the diff result |
| `op=`     | Comparison mode: `added` `removed` `changed` `all` (default: `all`) |

**Diff result shape:**

```json
{
  "added":   [ { "path": "…", "node": { … } } ],
  "removed": [ { "path": "…", "node": { … } } ],
  "changed": [ { "path": "…", "before": { … }, "after": { … } } ],
  "summary": "2 added, 0 removed, 1 changed"
}
```

**Register stack rules:**

- A session holds a sliding window of the **last 8** named registers.
- Names do NOT auto-expire — they are overwritten each time `bind=` is reassigned.
- On session reset, all registers are cleared.
- Register names are local to the scenario execution session; they do not persist across
  MCP calls (each scenario run starts fresh — unless `QUERYTREE` is called explicitly).

### Wire protocol

```json
{ "action": "TREEDIFF", "bind_a": "tree_before", "bind_b": "tree_after",
  "bind": "tree_diff", "op": "all" }
```

The server resolves `bind_a` and `bind_b` from the session register store, computes the
structural diff, and stores the result in `bind`.  No `proc=` or `path=` required.

### Implementation status

> **Status: SPECIFIED — not yet implemented.**  
> `TREEDIFF` is recognised in `xmlScenarioLoader.ts` as a pass-through synthetic action
> that references the register store maintained in `ScenarioRunner`.  
> Implementation ticket: **U-TREEDIFF** (see `TODO.md`).

---

## 11. Conditional scenario blocks (`<ConditionalRef>`)

### Purpose

Many real-world automation sessions involve transient, non-deterministic events: Save
Password dialogs, update banners, "unsaved changes" confirmations, etc.  These should
NOT be embedded as mandatory steps in a linear scenario.  Instead, they are expressed as
**conditionally-executed subscenarios** that run only when a specific tree condition is
true.

### Two forms

#### Form A — Inline conditional step

A single `<Step>` with `conditional=` attribute.  The step is **skipped** if the
condition evaluates falsy; **executed** if truthy.

```xml
<Step action="SENDKEYS" proc="{{proc}}" value="{ESC}"
      conditional="{{tree_diff.added | hasType:'dialog'}}"
      note="dismiss unexpected dialog if one appeared in the diff"/>
```

`conditional=` accepts:
- A variable reference: `conditional="{{found_dialog}}"` — truthy/falsy
- A JSONPath-style filter on a bound register: `conditional="{{tree_diff.added | hasType:'dialog'}}"`
- A literal boolean: `conditional="false"` to permanently disable a step during development

#### Form B — Conditional subscenario reference

A full subscenario that has an **entry condition**.  The entire subscenario is skipped if
the condition is false.  The condition is evaluated **before** any of the subscenario's
own steps run.

```xml
<ConditionalRef ref="dismiss-save-password"
                when="{{tree_diff.added | hasTitle:'Uložit heslo?'}}"
                note="only run if a Save-Password dialog appeared in the last diff"/>
```

**Attribute semantics:**

| Attribute | Required | Description |
|-----------|----------|-------------|
| `ref=`    | yes | `id` of the subscenario to invoke (same or cross-file syntax as `<ScenarioRef>`) |
| `when=`   | yes | Condition expression; subscenario is skipped entirely if falsy |
| `app=`    | no  | Cross-app reference (same as `<ScenarioRef app=..>`) |
| `note=`   | no  | Human-readable explanation of when this fires |

#### Subscenario entry-condition declaration

A subscenario that is **intended** to be used conditionally SHOULD declare its entry
condition in its `<Scenario>` header for documentation purposes.  Execution is not
affected — the entry condition on the `<ConditionalRef>` is what gates execution.

```xml
<Scenario id="dismiss-save-password" effect="closes-modal"
          entryCondition="tree contains dialog titled 'Uložit heslo?'">
  <Description lang="en">
    Dismiss Brave's Save Password dialog.  Should only be called when the dialog
    is confirmed present in the current tree diff.
  </Description>
  <Steps>
    <Step action="LISTWINDOWS" proc="{{browser}}" bind="windows"
          note="find the dialog handle"/>
    <Step action="SENDKEYS" proc="HANDLE:{{pwdlg_handle}}" value="{ESC}"
          note="dismiss; safe even if handle resolves to nothing"/>
    <Step action="QUERYTREE"  proc="{{browser}}" path="" value="2" bind="tree_after_dismiss"
          note="confirm dialog gone"/>
  </Steps>
</Scenario>
```

### Layer placement rules for conditional subscenarios

| Where the dialog can appear | Where to place the subscenario |
|-----------------------------|-------------------------------|
| Only in test scenarios (shim alerts, test popups) | L3 only |
| In normal product use (OS Save dialogs, browser password prompts) | L1 (shipped) |
| In user's own workflows, not generally applicable | L2 user-space |

> **Rule:** `<ConditionalRef>` is the **preferred** mechanism for all non-deterministic
> dialog handling.  Do NOT embed `if/else` branching logic inside step `note=` comments
> and then skip steps manually — use `<ConditionalRef>` so the intent is machine-readable.

### Implementation status

> **Status: SPECIFIED — not yet implemented.**
> `<ConditionalRef>` is a new XML element not yet handled by `xmlScenarioLoader.ts`.
> The `conditional=` attribute on `<Step>` is already partially supported (the loader
> skips steps where `conditional="absent"` or `conditional="false"`).
> Full expression evaluation for `conditional=` and `<ConditionalRef>` parsing:
> Implementation ticket: **U-CONDITIONAL** (see `TODO.md`).

---

### Response size management (NEW-2)

To prevent LLM context overflow (30 k token limit in many chat agents):

- **`listHelpers`** returns compact summaries by default (`name`, `version`, `commandCount`, `commands[].name` only). Pass `full: true` for complete `inputSchema` detail.
- **`getHelperSchema`** same — compact by default, `full: true` for complete per-command schema.
- **`queryTree`** results exceeding 24 000 chars are automatically trimmed; `_truncated: true` and `_hint` are appended to the response.
- All trimmed responses include `_truncated: true` and `_hint` explaining how to retrieve full data.
- Budget constant: `DEFAULT_MAX_CHARS = 24 000` in [`components/server/src/utils/truncateResponse.ts`](components/server/src/utils/truncateResponse.ts).
