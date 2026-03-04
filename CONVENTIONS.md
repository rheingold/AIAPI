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

## 2. Target addressing

| Prefix        | Helper    | Meaning |
|---------------|-----------|---------|
| `HANDLE:<n>`  | KeyWin    | OS window handle (decimal HWND) |
| `PAGE:<id>`   | BrowserWin| CDP tab id |
| `chrome:`     | BrowserWin| Browser-level or tab by URL/TITLE filter |
| `chrome:URL:<u>` | BrowserWin | Tab matching URL prefix |
| `chrome:TITLE:<t>` | BrowserWin | Tab matching title substring |
| `SYSTEM`      | both      | Broadcast / all — used with LISTWINDOWS, LAUNCH |

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
dist/helpers/                   ← compiled EXEs (KeyWin.exe, BrowserWin.exe)
config/dashboard-settings.json  ← runtime settings (was root dashboard-settings.json)
apptemplates/                   ← app template library (tree.xml + scenarios.xml per app)
tests/integration/              ← full-stack integration tests
```

---

## 5. Settings keys (`config/dashboard-settings.json`)

Documented keys — do NOT add new ones without updating this list:

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `appTemplatesDir` | string | `./apptemplates` | Root for app template library |
| `scenariosPath` | string | `./scenarios` | Legacy scenario JSON files |
| `mcpPort` | number | `3457` | MCP JSON-RPC listen port |
| `helperPaths` | string[] | `["./dist/win/*.exe"]` | Helper EXE discovery paths |
| `logLevel` | string | `info` | Log verbosity |
| `tokenExpiry` | number | `60` | Session token expiry (minutes) |
| `disabledHelpers` | string[] | `[]` | Helper names to skip on startup |

---

## 6. REST API surface (`httpServerWithDashboard.ts`)

Existing endpoints — extend these, do not add parallel ones:

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

---

## 7. Reuse checklist (for agent before implementing anything)

- [ ] Does a command with this intent already exist in §1?
- [ ] Does a target addressing scheme for this already exist in §2?
- [ ] Does an app template file already exist in `apptemplates/`?
- [ ] Does a REST endpoint already exist in §6?
- [ ] Does a settings key already exist in §5?
- [ ] Is the source file I'm about to create already in §4?

If any answer is YES → extend the existing one; do NOT create a parallel version.
