# TODO — AIAPI

> **Legend:** 🔴 blocking · 🟡 parallel-ready · ⚪ backlog · ✅ done
> Architecture: [`docs/architecture/CODEBASE_MAP.md`](docs/architecture/CODEBASE_MAP.md)
> Vocabulary: [`CONVENTIONS.md`](CONVENTIONS.md)
> ADRs: [`docs/architecture/decisions/`](docs/architecture/decisions/)

---

## 📊 Status Snapshot — April 2026

| ID  | Chapter                                        | State       | Key pending items                                      |
|-----|------------------------------------------------|-------------|--------------------------------------------------------|
| G-A | 🔴 Security Enforcement Gate                  | ✅ done     | G-A1 skipAuth env-explicit ✅, G-A2 build hash ✅, G-A3 caller roles wire ✅ |
| G-B | 🗄️ Auth Subsystem Wiring                      | ✅ done     | U0–U5 done ✅; U6 UI panel ✅ (2026-05-21); U6 backend gap ✅ (2026-05-21) DEBT-2 resolved |
| G-C | 🔒 Security Infrastructure (SecurityLib+HKDF) | ✅ done     | SecurityLib.cpp all fns ✅, P/Invoke ✅, HKDF ✅, HMAC ✅ |
| G-D | 🧹 KeyWin Purity + XML Self-Sufficiency       | 🟡 active   | ADR-009 + ADR-010; ASSERT step; RESET removal; d5 fix  |
| S-1 | 🔐 Security & Configuration UI                | 🟡 active   | file-dialog, installer, auth UI panel, log pagination  |
| S-2 | 🐕 Dogfooding — Self-Test Suite               | 🟡 active   | D1 dashboard test, D2 schema round-trip, D3 filter test|
| S-3 | 🌐 Web Scraping & Network Tools               | 🟡 active   | fetch_webpage ✅; advanced network protocols pending   |
| H-1 | 📡 Protocol KB Scenario Helpers               | ⚪ backlog  | One apptemplate scenario file per protocol from KB:PROTOCOLS bookmarks |
| N-0 | 📦 VS Code Extension — VSIX & Marketplace     | ⚪ next     | activate() rewrite, vsce package, .vscodeignore, publisher |
| N-1 | 📚 App Knowledge Base Extensions              | ⚪ next     | usr layer, namespacing, embedding vectors, super-scenarios (N-1y), authoring API (N-1z) |
| N-2 | 🎯 Unified Addressing & Input Model           | ⚪ next     | parser, filter engine update, remaining input verbs    |
| N-2i| ⚡ UiBackendDetector + ActionDispatcher        | 🟡 design   | capability cache per HWND; strategy table replaces ad-hoc if/else chains — **do first in N-2** |
| N-3 | 🖥️ Browser Automation — Remaining            | ⚪ next     | alert handling, session auth, CDP/UIA DOM fallbacks    |
| N-4 | 🔧 Runtime & Daemon Lifecycle                 | ⚪ next     | R1 config migration, minor daemon items                |
| N-5 | 🍪 Web Fetch — Cookie & Auth Walls            | ⚪ backlog  | consent detection, session cookie jar, POST forms      |
| N-6 | 🤖 Supervised Scenario Mode (AI agent UX)     | ⚪ backlog  | inline `scenario` body + `supervised` flag on run endpoint; pause-on-fail + session resume |
| U-TREEDIFF | 🌲 Tree Snapshot Registers + TREEDIFF command | ⚪ backlog | QUERYTREE bind= register store; TREEDIFF synthetic command; 8-slot sliding window |
| U-COND | 🔀 Conditional Scenario Blocks                 | ⚪ backlog | `<ConditionalRef>` XML element; full expression eval for `conditional=` on `<Step>` |
| F-1 | 🔧📄 MS Office Automation                     | ⚪ future   | blocked — Office not installed on this machine         |
| F-2 | 🚀 Deployment & Packaging                     | 🟢 active  | **Windows service ✅**, installer, Linux, macOS       |
| F-3 | 🌍 Platform Portability                       | ⚪ future   | separate build machine required                        |
| ADR-018 | 🔒 Session 0 Fix Strategy                | ✅ decided  | Option C (VSIX) v1.0; Option B (bridge) Phase 3; QA-3 pending |
| ADM | 📝 Admin / Legal                              | ⚪ backlog  | LICENSE.md — requires owner input on licence choice    |
| NEW-2 | ✂️ Output Truncation                        | ✅ done     | `truncateResponse()` + slim `listHelpers`/`getHelperSchema` + `queryTree` budget cap |

- [x] NEW-7: SSE transport — GET /sse + POST /messages added to mcpServer.ts; single _dispatchRequest() path; backward-compat POST / preserved; integration tests added *(2026-05-21)*
- [x] NEW-7 deploy: compile + deploy SSE transport to AIAPIService; SSE endpoint verified on port 4457 *(2026-05-21)*
- [x] NEW-5: git commit + push + local redeploy; fix update-service.ps1 build paths + -BuildTarget param *(2026-05-21)*
- [x] NEW-4: Native built-in actions — EXEC_CMD + FS_READ + FS_WRITE + FS_LIST implemented in builtinActions.ts; wired into xmlScenarioLoader.ts + mcpServer.ts; unit tests added; CONVENTIONS.md updated *(2026-05-21)*
- [x] NEW-2: Output truncation — `truncateResponse()` utility + slim `listHelpers`/`getHelperSchema` (compact by default, `full:true` for detail) + `queryTree` budget cap (24 000 chars) *(2026-05-21)*
- [x] NEW-1 (safe subset): Session 0 detection in WinCommon.cs ListWindowsJson() → _sessionWarning field; tools/diag/check-session.ps1; docs/specs/SESSION0_ISOLATION.md *(2026-05-21)*
- [ ] NEW-1 (full fix): WTSQueryUserToken + CreateProcessAsUser launcher — spawn helpers in active console session from Session 0 service *(deferred — needs SeTcbPrivilege + full service test)*
- [x] DEBT-1 **Phase 1 done 2026-05-21**: NativeWin virtual helper grouping — `NativeWin` entry added to `listHelpers`/`getHelperSchema` in `mcpServer.ts`; `AutomateUI` enum updated; `CONVENTIONS.md` §1 updated. *(Phase 2 = full helperRegistry virtual entry — see QA-5/VSIX-CAPS)*

- [x] **ADR-017-P1 (MCP hierarchy Phase 1 — deprecation markers):** `[DEPRECATED - use KeyWin helper via AutomateUI instead]` added to all 8 legacy tool descriptions in `handleToolsList()` in [`components/server/src/server/mcpServer.ts`](components/server/src/server/mcpServer.ts:554). ✅ done 2026-05-21

- [ ] **ADR-017-P2 (MCP hierarchy Phase 2 — remove legacy tools from tools/list):** Remove the 8 legacy stubs from `handleToolsList()` response. Keep `handleToolsCall()` dispatch for them but return an error with migration hint. Update D9 `hs4-mcp-tools-list` scenario to verify the legacy tools are absent and new count is correct. *(⚪ v2.0 — after P1 grace period)*

- [x] **QA-1 (Service-mode smoke test script):** `test/smoke/service-mode.ps1` created — 8 checks (health, tools/list, listHelpers, exec_cmd, fs_list, /api/settings, session detection, port assertion). ✅ done 2026-05-21

- [ ] **QA-2 (D9 hs4 tool-hierarchy assertions):** Extend `test/e2e/d9/scenarios.xml` scenario `hs4-mcp-tools-list` to assert: (a) tool count ≥ 13 and ≤ 21; (b) `listHelpers`, `getHelperSchema`, `AutomateUI`, `executeScenario` are present; (c) `NativeWin` appears in `listHelpers` response after DEBT-1 is done; (d) after ADR-017-P1, check at least one deprecated tool has `[DEPRECATED]` in its description. *(🟡 high)*

- [x] **QA-3 (Session 0 warning on all affected commands):** `_sessionWarning` injected into all UI-impacting commands in WinCommon.cs (QUERYTREE, READ, SETPROPERTY/FILL, CLICKID/FOCUS, SENDKEYS), BrowserWin (LAUNCH, FOCUS), MSOfficeWin (all commands), LibreOfficeWin (LAUNCH, RELAUNCH, FOCUS). builtinActions.ts also detects Session 0 for GUI processes. ✅ done 2026-05-21

- [x] **QA-4 (Post-deploy CI gate):** `update-service.ps1` now runs `test/smoke/service-mode.ps1` post-deploy (line 241); exits non-zero on failure. ✅ done 2026-05-21 *(Note: GitHub Actions CI step remains TODO)*

- [ ] **QA-5 (D9 deprecated tool description check):** After ADR-017-P1 is done, add scenario `hs9-deprecated-tool-markers` to `test/e2e/d9/scenarios.xml`: call `tools/list`, parse JSON, assert that `queryTree` description contains `[DEPRECATED]`. *(🟡 medium — tied to ADR-017-P1)*

- [ ] **QA-6 (D20 Service-Mode Isolation suite):** New test suite `test/e2e/d20-service-mode.js` targeting port 4457 (service endpoint). Asserts: (a) `LISTWINDOWS` returns `windows:[]` and `_sessionWarning` set; (b) `fs_read` works; (c) `SENDKEYS` response includes `_sessionWarning` (after QA-3); (d) `launchProcess` result includes `_sessionWarning`. Prerequisite: QA-1, QA-3. *(⚪ backlog)*

- [x] **SESSION0-DOC (Server Guide deployment section):** [`docs/guides/SERVER_GUIDE.md`](docs/guides/SERVER_GUIDE.md) line 189 — "Deployment Modes and Session 0" section added; capability matrix per helper; Task Scheduler workaround; port split. ✅ done 2026-05-21

- [ ] **VSIX-CAPS (session-blocked helper flags in listHelpers):** When `IsSession0()` is true, `listHelpers` response should include `"sessionBlocked": true` on all UI helpers (`KeyWin`, `BrowserWin`, `MSOfficeWin`, `LibreOfficeWin`) so MCP clients can detect the limitation programmatically. Implement in [`components/server/src/helpers/HelperRegistry.ts`](components/server/src/helpers/HelperRegistry.ts) and [`components/server/src/server/mcpServer.ts`](components/server/src/server/mcpServer.ts). *(🟡 medium — post-N-0)*

- [ ] **ADR-018 CODEBASE_MAP update:** Add `ADR-018` row to the ADR table in [`docs/architecture/CODEBASE_MAP.md`](docs/architecture/CODEBASE_MAP.md): `ADR-018 — Session 0 Isolation Fix Strategy: Option C (VSIX) for v1.0; Option B (bridge) for Phase 3 post-MSI`. *(🟡 low — housekeeping)*

- [ ] **BRIDGE-SPEC (Phase 3 — post-F-2):** Write `docs/specs/BRIDGE_PROTOCOL.md` — named pipe IPC spec for `AiapiBridge.exe`. Define: pipe name `\\.\pipe\AIAPI-Bridge-{sessionId}`, JSON-line framing same as helper stdin, `_bridgeSessionId` routing header, auth via HKDF session key, multi-session RDP routing logic. Prerequisite: F-2 MSI installer underway. *(⚪ backlog — Phase 3)*

- [ ] **BRIDGE-IMPL (Phase 3 — post-F-2):** Implement `components/helpers/windows/src/AiapiBridge.cs` — lightweight user-session relay using `HelperCommon.cs` `RunNamedPipeListener()`; spawns helpers in user session; routes commands from Session 0 service pipe. Prerequisite: BRIDGE-SPEC. *(⚪ backlog — Phase 3)*
- [x] DEBT-2: **U6 backend gap — two missing TypeScript server-side items** ✅ resolved 2026-05-21
  - [x] `handleInternalListUserApiKeys()` in `internalHandlers.ts` (lines 302–321): `GET /api/auth/users/:id/apikeys` — returns `{ id, label, createdAt }`, never exposes `keyHash` ✅
  - [x] `handleGetAuthConfig()` in `httpServerWithDashboard.ts` (lines 2041–2045): `jwt.issuer` now always present in GET /api/auth/config response ✅
  - [x] New routes wired in `httpServerWithDashboard.ts`: `GET /api/auth/users/:id/apikeys` + `DELETE /api/auth/users/:id/apikeys/:keyId` ✅
  - ⚠️ Audit note: `handleInternalRevokeApiKey` now returns **204 No Content** (was 200) — intentional, matches REST spec; dashboard JS checks status code only, not body. Breaking only for legacy `_internal` DELETE callers.
  - Add `GET /api/auth/users/:id/apikeys` route + handler in `httpServerWithDashboard.ts` + `internalHandlers.ts`; returns array of `{ id, label, createdAt, lastUsed }` for the given user; `loadUserApiKeys()` in dashboard.js calls this endpoint
  - Both items require re-sign of `config/security/config.json` after any schema change
  - Unblocked: no dependency on G-E or DB changes; can be done as a standalone Code sprint

---

## G-D — KeyWin Purity + XML Self-Sufficiency (ADR-009, ADR-010)

> **ADRs:** [ADR-009](docs/architecture/decisions/ADR-009-keywin-app-agnostic.md) · [ADR-010](docs/architecture/decisions/ADR-010-xml-assert-step-collapse-js-harnesses.md)
> **Trigger (2026-04-18):** Code review found KeyWin.cs contains ~10 Calculator- and Notepad-specific
> hardcodes (RESET command, `_buttonKeyMap`, `CalculatorResults` AutomationId, Notepad class detection,
> `=`→Enter mapping) violating the rule that KeyWin must be application-agnostic.
> Simultaneously, d5 and other JS harnesses contain assertions that belong in XML.

### G-D.1 — Add ASSERT step to xmlScenarioLoader (ADR-010) ✅

- [x] Add `action="ASSERT"` handler in `executeXmlScenario()` in `xmlScenarioLoader.ts`
  - Form 1 (UIA/DOM path): `proc=` set → call `READELEM path=` on helper → compare `value=` with `op=`
  - Form 2 (JS eval): no `proc` → boolean eval of `path=` expression (legacy, ASSERTPATHEVAL)
  - `op=` aliases: `eq`/`neq`/`contains`/`startsWith`/`endsWith`/`matches`/`truthy`
- [x] Add unit tests for ASSERT in `xmlScenarioLoader.test.ts` (27/27 ✅)
- [x] Add `ASSERT` to `step action` enum in CONVENTIONS.md §8 layer rules table
- [x] `ReadElementValue` in WinCommon.cs: added `/`-separated hierarchical tree-path walking
- [x] D5 paths updated from flat `CalculatorResults` → hierarchical `NavView/CalculatorResults`
- [x] D6 `path=""` documented: Notepad WinUI3 Document control has no AutomationId → whole-window READ is correct

### G-D.2 — Fix d5/scenarios.xml: remove RESET, add inline assertions ✅

- [x] Replace every `<step action="RESET">` with ESC SENDKEYS (clear)
- [x] Inline ASSERTPATHEVAL after each READ (C3=32, C4=13, C5=5, C6=0)
- [x] Use READELEM path="CalculatorResults" consistently (READ path="" was unreliable)
- [x] Update test comment header: "assertions in XML, JS harness is bootstrap-only"
- [x] **D5 3/3 ✅ (2026-04-19)**

### G-D.3 — Collapse d5-keywin-calculator.js to 10-line bootstrap ✅

- [x] Removed `parseResult()` and all JS `assert()` calls
- [x] Reduced `run()` to: `waitReady()` → `runOk('d5', 'd5-suite')`
- [x] `d5-suite` composite scenario chains C1–C7 in `d5/scenarios.xml`

### ✅ G-D.4 — Remove app-specific hardcodes from KeyWin.cs *(done 2026-04-26)*

- [x] Remove `{RESET}` command entirely (already done in earlier session)
- [x] Remove `_buttonKeyMap` dictionary — Calculator-specific button→key fallback (earlier session)
- [x] Remove `=` → `{ENTER}` in `BuildSendKeysSequence()` (earlier session)
- [x] Remove `=` → `Enter` in the PostMessage path (earlier session)
- [x] Remove `CalculatorResults` preferred-read branch from `ReadDisplayText()` (earlier session)
- [x] Remove Calculator-specific clipboard regex strip `[\d\+\-\*/\.,\(\)eE]+$` ("Displej je 32" → "32") *(2026-04-26)*
- [x] Remove Notepad window-title detection — only generic class-based detection remains (earlier session)
- [x] Update API schema: RESET removed from schema command list (earlier session)
- [x] Rebuild KeyWin.exe — exit: 0, no warnings *(2026-04-26)*

### G-D.5 — Fix `calculator/scenarios.xml` L1 intro scenario ✅

- [x] Removed 8 trailing empty `<Step>` elements from `intro` scenario *(2026-04-25)*
- [x] Added `READELEM NavView/CalculatorResults` as final assertion (G-D.7 compliance) *(2026-04-25)*
- [x] D5 re-run: 3/3 passed *(2026-04-25)*

### G-D.6 — Fix remaining dN-xxx.js harnesses that have in-JS assertions

**2026-04-22 audit results (d1–d9):**
- ✅ D1, D2, D4, D5, D6, D7 — clean bootstraps, all assertions in scenarios.xml
- ✅ D1/D2/D5/D6/D7 refactored to use `test/e2e/_make-suite.js` parametric factory (saves ~15 lines/file)
- ✅ D8 — `d8-ui-suite` (BrowserWin section) was **orphaned**; now wired into `d8-security-enforcement.js` run()
- ✅ D8 `scenarios.xml` CDP_EXECUTE uses (sf4 count rows, sf5 read input.value) are ADR-008-compliant (read-only computed values, not UI driving)
- ⚠️ **D3 VIOLATES ADR-008**: 312-line JS with `dashRest()` for A1/A2/A5/A6/A7REST/A9REST/A10/A11 — must move to `HTTP_FETCH + ASSERT` XML steps
- ⚠️ **D9 VIOLATES ADR-008**: all HS1–HS8 tests are REST/MCP JS assertions; `d9/scenarios.xml` = placeholder only — must create real `HTTP_FETCH` scenarios and thin bootstrap

- [x] D3: move `dashRest()` assertion calls to `HTTP_FETCH` + `ASSERT` XML steps (A1, A2, A5, A6, A7 REST half, A9 REST half, A10, A11) *(2026-04-26)* — 15/15 ✅
- [x] D9: rewrite `d9-helper-schema.js` as thin bootstrap (~45 lines); create `d9/scenarios.xml` with `HTTP_FETCH`+`ASSERTPATHEVAL` steps for HS1–HS8 (listHelpers, getHelperSchema×2, MCP tools/list, MCP listHelpers, MCP getHelperSchema, helpers/reload, helpers/toggle) *(2026-04-26)* — **10/10 ✅**
- [x] `xmlScenarioLoader.ts` ASSERTPATHEVAL now passes `$vars` to Function context (same as EVAL) — enables `JSON.parse($vars.xxx)` in path= expressions for complex JSON responses *(2026-04-26)*

**2026-04-22 audit results (D10–D19):**
- ✅ D10 (31 lines), D11 (31 lines) — thin bootstraps; fixed: `DASH_URL` and label now from `_make-suite.js`
- ✅ D11 `scenarios.xml`: all `$vars.xxx` → `{{xxx}}`; all EVAL+throw assertion steps → `ASSERTPATHEVAL`+EVAL+bind pairs; DELETE cleanup steps each end with `ASSERTPATHEVAL`; fixed bare `<` in XML attribute (→ `&lt;`) *(2026-04-26)* — **5/5 ✅**
- ✅ D12 (127 lines) — JS kept for dynamic `LISTWINDOWS`-based handle discovery (`getCalcHandle`/`getNotepadHandle`) — legitimately in JS; `testClickName`/`testFill` are graceful/ok-only; label + DASH_URL fixed
- ✅ D13 (85 lines) — thin orchestration delegating to scenarios.xml atoms; one inline `ok()` is graceful; label + DASH_URL fixed
- ✅ **D14** — MSOfficeWin: d14/scenarios.xml (d14-preflight GET /health + suite); JS adds ScenarioRunner; M1–M15 stay in JS (runtime doc handles); 38/38 green (2026-05-xx)
- ✅ **D15** — Scenario Execution: d15/scenarios.xml (sr5-legacy-run only; sr6 moves back to JS graceful); JS slimmed; 16/16 green (2026-04-26)
- ✅ **D16** — Extended REST: d16/scenarios.xml (ex1,ex2,ex4–ex8 + suite); JS slimmed; d16-suite 3/3 green (2026-05-xx)
- ✅ **D17** — Users/Roles: d17/scenarios.xml (ur0-access-gate,ur1,ur6,ur10-get + suite); JS stripped of 5 assert()s; 26/26 green (2026-04-26)
- ✅ **D18** — LibreOfficeWin: d18/scenarios.xml (d18-preflight GET /health + suite); JS adds ScenarioRunner; L1–L15 stay in JS (runtime doc handles, UNO bridge); 36/36 green (2026-05-xx)
- ✅ **D19** — Users/Roles DB backend: d19/scenarios.xml (d19-preflight always runs; DB CRUD stays in JS — all runtime-ID-dependent); 26/26 green (2026-04-26)

**No-hardcoded-strings policy (2026-04-22):**
- `_make-suite.js` factory now derives suite label from `__filename` (no label param)
- All path `default=` values in `d2/scenarios.xml` d2-suite removed; paths now passed from JS harness via `__dirname`-derived bogus paths
- D10–D13 DASH_URL de-duplicated; all now import from `_make-suite.DASH_URL`

- [x] D14: rewrite — d14/scenarios.xml (d14-preflight GET /health + suite); ScenarioRunner added; 38/38 green
- [x] D15: rewrite — `d15/scenarios.xml` created (sr5 static suite); SR1–SR4,SR6,SR7 stay in JS; 16/16 green
- [x] D16: rewrite — `d16/scenarios.xml` created (ex1,ex2,ex4–ex8 + suite); JS slimmed; 3/3 green
- [x] D17: rewrite — `d17/scenarios.xml` (ur0,ur1,ur6,ur10-get + suite); UR2–UR5,UR7–UR9,UR10-DELETE stay in JS (runtime IDs); 26/26 green
- [x] D18: rewrite — d18/scenarios.xml (d18-preflight GET /health + suite); ScenarioRunner added; 36/36 green
- [x] D19: rewrite — `d19/scenarios.xml` (d19-preflight); DB CRUD stays in JS; 26/26 green (DB skipped in noauth env)

### G-D.7 — Every scenario must end with an ASSERT (policy audit)

Every scenario in every `scenarios.xml` — including functional sub-scenarios (e.g. `nav-to-settings`, `restore-*`) and use-case leaf scenarios (e.g. `bc3-sendkeys`, `ia1-*`) — **must end with at least one `<step action="ASSERT">`** (or `ASSERTPATHEVAL`) that verifies the intended outcome.

**2026-04-25 audit — per-file gap list (test/e2e only):**

| Suite | Scenarios with NO inline assert | Status |
|-------|--------------------------------|--------|
| d1  | `diag-exec` (diagnostic — exempt) | ✅ all real scenarios covered |
| d2  | `override/restore-page-dialogs`, `s2-s8`, `s13`, `s15`, `d2-suite` | ⚠️ most covered by READELEM/ASSERT inline; suites are orchestrators — exempt |
| d3  | `override-page-dialogs` (no assert retval), `restore-page-dialogs` (no assert retval), `a9-auth-reload` (binds reloadedMode, no assert) | ❌ fix required |
| d4  | `override/restore-page-dialogs`, `se3-se4b` | these have ASSERTPATHEVAL ✅ — confirmed via audit |
| d5  | all covered ✅ | ✅ |
| d6  | all covered ✅ | ✅ |
| d7  | all covered ✅ | ✅ |
| d8  | `sf2` (binds sfReadResult, no assert), `sf3` (binds treeStr, no assert), `sf4` (binds filterCount, no assert), `sf5` (binds fillVerify, no assert) | ❌ fix required |
| d9  | placeholder stub — whole file is ADR-008 violation | ❌ see G-D.6 |
| d10 | covered by EVAL chains ✅ | ✅ |
| d11 | covered by EVAL chains ✅ | ✅ |
| d12 | `qt1` (binds treeStr, no assert); `qt4-qt10` (input commands — no trailing liveness check) | ❌ fix required |
| d13 | `bc3-sendkeys` (binds sendResult, no assert); `bc11-focus` (binds focusOk, no ASSERTPATHEVAL); `bc4-bc10` input commands (no trailing liveness READELEM) | ❌ fix required |
| d14-d19 | preflight liveness check in XML; Office/LO runtime ops stay in JS ✅ | ✅ |

**Fix tasks:**
- [x] D8: add inline ASSERTPATHEVAL after sf2/sf3/sf4/sf5 bind steps *(2026-04-25)*
- [x] D3: add ASSERTPATHEVAL on return value of `override-page-dialogs` and `restore-page-dialogs`; add ASSERTPATHEVAL on `reloadedMode` in `a9-auth-reload` *(2026-04-25)*
- [x] D12: add EVAL after qt1 treeStr bind; add READELEM liveness check after qt4–qt10 *(2026-04-25)*
- [x] D13: add ASSERTPATHEVAL to bc3-sendkeys (sendResult) and bc11-focus (focusOk); add READELEM liveness to bc4–bc10 *(2026-04-25)*
- [x] config/scenarios/**/*.xml — audit separately (G-D.7b below) — folder is empty; vacuously done *(2026-04-26)*
- [x] Add a linter rule or comment convention (`<!-- assert-required -->`) to flag future scenarios that omit a final assertion — added to CONVENTIONS.md §1.1b *(2026-04-26)*

### ✅ G-D.11 — PascalCase all XML element names + parser case-insensitivity (ADR-011) *(done 2026-04-26)*

> **ADR:** [ADR-011](docs/architecture/decisions/ADR-011-scenario-xml-casing-grammar.md)
> **Rule:** All element (tag) names → PascalCase. All attribute names → camelCase.
> Parser normalizes tag names to lowercase at load time (tolerance — not a license for mixed authoring).

**Elements to rename across all XML files:**

| Old | New |
|---|---|
| `<steps>` | `<Steps>` |
| `<step>` | `<Step>` |
| `<description>` | `<Description>` |

**Files to update:**
- [x] `test/e2e/d*/scenarios.xml` (all 19 suites) — migrated by user 2026-04-26
- [x] `config/scenarios/**/*.xml` (dashboard, calculator, notepad) — verified already PascalCase
- [x] `apptemplates/**/*.xml` (shared + windows helper templates) — verified already PascalCase

**Parser:**
- [x] `components/server/src/scenario/xmlScenarioLoader.ts` — already uses `.tagName.toLowerCase()` throughout; no changes needed
- [x] `CONVENTIONS.md §8` — grammar table updated: PascalCase elements, camelCase attributes; example block updated; ASSERT added to L1 commands table *(2026-04-26)*

- [x] Re-run D5/D6 after changes — 3/3 ✅ *(2026-04-26)*

### ✅ G-D.9 — Relocate `diag-exec` from per-suite XML to app template base *(done 2026-04-26)*

- [x] Confirmed: `diag-exec` was not referenced by any `<ScenarioRef>` in any suite orchestrator
- [x] Removed `diag-exec` from all 17 `test/e2e/d*/scenarios.xml` files (d1–d19, PowerShell batch)
- [x] Added canonical `diag-exec` to `components/helpers/shared/dist-resources/apptemplates/chrome/scenarios.xml`
  — with `tab` param defaulting to `{{tabId}}` and a note: "do NOT copy into per-suite XML files"
- [x] For KeyWin-type suites (d5, d6, d12): equivalent `diag-keywin` atom in keywin app template — done 2026-05-21

> **Trigger:** D3/D4/D7 walkthrough revealed that every `d*/scenarios.xml` contains a
> `<Scenario id="diag-exec">` with no assert and `effect="diagnostic"`. It is never
> called by any suite orchestrator — dead weight from the dev phase of each suite.
> Its `{{jsCode}}` param is a call-time parameter (reusable CDP shell), not a local var.
>
> **Problem:** copy-pasted in 7+ suites, adds noise, and its assert exemption is a
> loophole. But the scenario itself *is* useful as an ad-hoc developer probe.
>
> **Decision (D7 walkthrough):** Rather than simply deleting it, move it to the
> *app template base* so it is defined once and available to all apps that inherit
> from the browser/chrome template. Per-suite copies are redundant and must be removed.

- [x] Confirm: grep `test/e2e/d*/scenarios.xml` for `id="diag-exec"` — none referenced by any `<ScenarioRef>` in any suite orchestrator *(2026-04-26)*
- [x] Remove `diag-exec` from every `test/e2e/d*/scenarios.xml` file (d1–d19) *(2026-04-26)*
- [x] Add `diag-exec` to `components/helpers/shared/dist-resources/apptemplates/chrome/scenarios.xml` — single canonical definition available to all chrome-type apps *(2026-04-26)*
- [x] For KeyWin-type suites (d5, d6, d12): equivalent `diag-keywin` (SENDKEYS + READ) in the `keywin` app template base (if it doesn't exist already) — done 2026-05-21
- [x] After changes: run full D1-D19 suite — confirmed 0 failures *(2026-04-26)*

---

### G-D.14 — D7 coverage gaps: Security CRUD, wizard fields, toolbar, tools/templates sections *(2026-04-25)*

> **Trigger:** D7 walkthrough + dashboard HTML audit. D7's `bw13-fill-suite` only navigates to
> the Security section, opens the Add Filter wizard, fills `#filter-description`, and presses ESC.
> The following dashboard surface is completely untested.

#### Security section — wizard fields (5 inputs never touched)
- [x] `bw13c-fill-verify` tests only `#filter-description`. Extended with **bw18-test-rule** *(2026-04-30)* which fills:
  - `#filter-action` — SELECT `deny` (CDP set + change event) ✅
  - `#filter-process` — INPUT `bw18-test.exe` (FILL) ✅
  - `#filter-helper` — asserts default `KeyWin.exe` ✅
  - `#filter-command` — SELECT `{QUERYTREE}` (CDP set + change event) ✅
  - `#filter-pattern` — FILL `*` ✅
- [x] After filling all fields: click the wizard submit/save button → `btn-filter-editor-save` → **bw18-test-rule** *(2026-04-30)*
- [x] ASSERTPATHEVAL that the new filter row appears in `#filter-rules-list` (count > 0 after add) → **bw18-test-rule** *(2026-04-30)*

#### Security section — CRUD lifecycle
- [x] `btn-save-filters` — click Save All → HTTP_FETCH `GET /api/filters` → assert server count equals browser `advancedFilters.length` → **bw23-save-filters** *(2026-04-30)*
- [x] Edit an existing filter row → change process + description → save → assert updated card → **bw18-test-rule** *(2026-04-30)*
- [x] Delete a filter row → assert it disappears from `#filter-rules-list` → **bw18-test-rule** (cleanup via splice+saveFilters) *(2026-04-30)*

#### Security section — toolbar (never touched)
- [x] `btn-validate-filters` — suppress alert → click → assert button survived (no crash) → **bw20-toolbar-validate** *(2026-04-30)*
- [x] `btn-filter-table-toggle` — click → text → "Card View" → click again → "Quick-Edit" → **bw21-toolbar-table-toggle** *(2026-04-30)*
- [x] `#filter-search` — FILL a term → assert list filters → **bw17-filter-search** *(2026-04-26)*
- [x] `btn-export-filters` — intercept createObjectURL → click → assert blob URL created; `btn-import-filters` present → **bw20-toolbar-validate** *(2026-04-30)*

#### Security section — Test Rule panel (never touched)
- [x] FILL `#test-process`, click `btn-test-filter`, assert `#filter-test-result` element present → **bw18-test-rule** *(2026-04-26)*

#### Security section — Audit Log (never touched)
- [x] Open `#security-log-panel`, assert `#security-log-list` element exists → **bw19-security-log** *(2026-04-26)*
- [x] Click Refresh → assert `#security-log-list` has content (non-empty text) → **bw22-audit-log-controls** *(2026-04-30)*
- [x] Toggle `#security-log-autorefresh` checkbox → assert checked state → **bw22-audit-log-controls** *(2026-04-30)*
- [x] Change `#security-log-pagesize` → assert log reloads → **bw22-audit-log-controls** *(2026-04-30)*

#### Nav sections never visited by D7
- [x] `data-section="tools"` → assert `#tools-list` non-empty → **bw15-tools-nav** *(2026-04-26)*
- [x] `data-section="templates"` → assert `#templates-list` non-empty → **bw16-templates-nav** *(2026-04-26)*

**Note:** `settings`=D2, `auth`=D3, `logs`=D1, `scenarios`=D4 — already owned. D7 now 4/4 with bw15–bw19 added to d7-suite *(2026-04-26)*.

---

### G-D.15 — D13 BC12: browser "Restore pages?" dialog not handled after KILL *(2026-04-25)*

> **Trigger:** D13 BC12 KILLs the browser process then immediately relaunches. On all major
> browsers (Chrome, Edge, Brave) a crash-recovery dialog appears on relaunch:
> *"Restore pages? Chrome didn't shut down correctly."*
> D13 currently relaunches and navigates to `about:blank` — but the crash dialog sits on top and
> blocks all subsequent CDP interactions on the first real tab.

#### The problem

After `KILL` → relaunch, the controlling agent must decide:
- **Dismiss** (click "No thanks" / close the dialog) — continue with a clean blank tab
- **Restore** (click "Restore" / "Yes") — bring back the previous session tabs, then continue

Neither path is exercised. The `about:blank` NAVIGATE in the post-KILL JS sidesteps the issue
only because it targets a new tab, not the dialog-blocked restored tab.

#### Why this requires BrowserWin + KeyWin together

The crash-recovery dialog is a **native OS window** rendered by the browser process frame, not a
DOM element accessible via CDP. It cannot be dismissed with `CDP_EXECUTE` or BrowserWin's
`CLICKID`. It requires:
1. `KeyWin` `LISTWINDOWS` → find the browser window with title matching `/restore|didn.t shut/i`
2. `KeyWin` `CLICKNAME` or `SENDKEYS {ENTER}` / `SENDKEYS {ESC}` on the dialog button

This is the first scenario that **requires cross-helper orchestration** (BrowserWin + KeyWin in
the same scenario run) and is a concrete use case for the `<ScenarioRef app="..."/>` cross-app
reference mechanism.

#### Fix required in D13

- [ ] After `bc12-kill`, add a new scenario `bc12-restore-dialog`:
  1. `BrowserWin` LAUNCH (relaunch browser without navigating)
  2. `WAIT` 1500ms for crash dialog to appear
  3. `KeyWin` `LISTWINDOWS` → bind `restoreHwnd` (match by title `/restore|didn.t shut/i`)
  4. If `restoreHwnd` found: run `bc12-restore-dialog-dismiss` OR `bc12-restore-dialog-confirm`
     depending on a `restoreAction` param (`"dismiss"` | `"restore"` — default `"dismiss"`)
  5. `KeyWin` `SENDKEYS` `{ENTER}` (confirm restore) or `{ESC}` / CLICKNAME "No thanks" (dismiss)
  6. `WAIT` 500ms → `BrowserWin` `NAVIGATE` dashboard URL → assert title contains dashboard name
- [ ] JS orchestration in `d13-browserwin-extended.js`: pass `restoreAction: 'dismiss'` by
  default; expose as `RESTORE_PAGES=confirm` env var for supervised AI use
- [ ] Document in CONVENTIONS.md §commands: *"Cross-helper scenario orchestration: use
  `<ScenarioRef app='...'/>` to chain BrowserWin + KeyWin steps within one scenario run"*

#### Strategic note

This pattern — BrowserWin sees DOM, KeyWin sees the OS shell around it — will recur for:
- browser permission dialogs (camera/mic/location) that render as native OS windows
- "Open with" / file-download OS dialogs triggered by browser actions
- Windows Security / UAC prompts triggered during install-from-browser flows

A general solution should be: after any BrowserWin `KILL` + relaunch, the scenario runner
should optionally run a `post-launch-cleanup` hook that calls into KeyWin to dismiss known
crash/restore dialogs. This hook should live in the `dashboard` app template (shipped, not
per-test), so all suites inherit it.

---

### ✅ G-D.13 — D6 false-positive assertions: {CTRL+A} and {CTRL+Z} not reaching Win11 UWP Notepad editor *(2026-04-25, fixed 2026-04-26)*

> **Root cause:** Win11 Notepad uses a WinUI3/XAML island (`RichEditD2DPT` HWND) that ignores
> `SendInput` CTRL combos and does not update `GetKeyState()` for PostMessage-based key injection.
>
> **Fix (KeyWin.cs + scenarios.xml):**
> - **SENDKEYS plain text** (Document path): `EM_REPLACESEL(undoable=1, text)` via `SendMessageW` —
>   replaces current selection or inserts at caret; creates ONE undo entry for the entire string.
> - **{CTRL+A}**: `TextPattern.DocumentRange.Select()` (UIA) + `EM_SETSEL(0,-1)` (Win32) — sets
>   both UIA and Win32 selection so the next `EM_REPLACESEL` replaces all text.
> - **{CTRL+Z}**: UIA Edit-menu undo — expand AutomationId="Edit" menu, invoke the localised Undo
>   item ("Vrátit zpět" / "Undo" / etc.) via `InvokePattern`; stops early when item is disabled.
> - **Session restore**: Win11 Notepad restores last unsaved session on relaunch — n3-type-content
>   now starts with `{CTRL+A}` to clear any restored content before typing.
> - **D6 3/3 ✅** (Passed: 3 Failed: 0)

---

### G-D.12 — Locale-invariant assertions: iron rule + escape-hatch locale map (ADR-012) *(2026-04-25)*

> **Trigger:** D5 walkthrough found `cm-to-scientific` asserting `NavView/Header contains "deck"`
> (Czech substring hack) and `cm-to-standard` asserting `contains "Standardn"` — both break
> on any non-Czech locale. Numeric results (42, 120, 3) are fine; UI label strings are not.

#### Iron rule (Option C)
**Assertions on UI display strings are prohibited.** Mode/state confirmation must use structural
UIA checks — presence/absence of locale-invariant AutomationId controls:

| Instead of | Use |
|---|---|
| `NavView/Header contains "Standardn"` | `READ clearEntryButton` → assert non-empty (Standard-only control exists) |
| `NavView/Header contains "deck"` | `READ factorialButton` → assert non-empty (Scientific-only control exists) |

AutomationIds are locale-invariant by UIA spec. If an app breaks this contract, that is a bug in
the app, not in the test.

#### Escape hatch (Option A) — locale map in scenario XML
When a UI label string assert is unavoidable (no structural alternative exists), the scenario
**must** declare it via a standardised `<LocaleMap>` element and expose it as a queryable
parameter. Grammar:

```xml
<Scenario id="my-scenario">
  <Parameters>
    <Param name="modeLabel" type="string" required="false" default="Standard"
           localeMap="my-scenario.modeLabel"/>
  </Parameters>
  <LocaleMap param="modeLabel">
    <Locale lang="en" value="Standard"/>
    <Locale lang="cs" value="Standardní"/>
    <Locale lang="de" value="Standard"/>
    <Locale lang="fr" value="Standard"/>
  </LocaleMap>
  ...
</Scenario>
```

Rules:
- `localeMap="scenarioId.paramName"` — globally unique dotted key, queriable via MCP
- The `<LocaleMap>` default (the `<Param default=...>` value) must be the `en` value
- An AI agent may resolve the correct locale value by:
  1. Calling a standardised `detect-locale` shared scenario (see below) to get `{{appLocale}}`
  2. Querying `GET /api/appTemplates/{app}/scenarios/{id}/localeMap?param=modeLabel&lang={{appLocale}}`
     → server returns the resolved string → pass as parameter

#### Standardised locale detection
A shared atom `detect-locale` (in `apptemplates/shared/scenarios.xml` or per-helper):
- For UIA apps: `READ` the window's `CurrentCulture` UIA property or run a known locale-exposing
  shell command via `LAUNCH`
- For browser apps: `CDP_EXECUTE "navigator.language"` → bind `{{appLocale}}`
- Returns ISO 639-1 code (`en`, `cs`, `de`, …)

#### XML file encoding declaration
Each scenarios.xml that contains a `<LocaleMap>` with non-ASCII locale strings **must** declare
its encoding in the XML prolog:
```xml
<?xml version="1.0" encoding="utf-8"?>
```
(already required by ADR-011; reiterated here as a hard prerequisite for `<LocaleMap>` content)

#### Tasks
- [x] Fix D5 `cm-to-standard` and `cm-to-scientific`: replace header-label asserts with structural
      `READ clearEntryButton` / `READ factorialButton` presence checks — done *(2026-04-30)*
      Also removed Czech `<assert op="contains" value="Standardní">` wrapper from `tree.xml`;
      clearEntryButton AutomationId is locale-invariant — its presence IS the mode gate (ADR-012)
- [x] Design `<LocaleMap>` / `<Locale>` element grammar in CONVENTIONS.md §8 and `scenarios.xsd`
      — documented in CONVENTIONS.md §8 "ADR-013" sub-section (iron rule, grammar, REST endpoint, usage pattern)
- [x] Implement `xmlScenarioLoader.ts` `<LocaleMap>` parser: extract map at load time, expose via
      `GET /api/appTemplates/{app}/scenarios/{id}/localeMap?param=&lang=` REST endpoint
      — `getLocaleMaps()` + `extractLocaleMaps()` added; `LocaleMapEntry` / `LocaleMapData` types exported;
        `XmlParam.localeMap` field added; REST handler `handleGetLocaleMap` + route inserted before generic GET
- [x] Write `detect-locale` shared atom for BrowserWin (CDP `navigator.language`) and KeyWin
      (UIA `CurrentCulture` or `cmd /c echo %LANG%`)
      — BrowserWin: `detect-locale` scenario in `chrome/scenarios.xml` (CDP_EXECUTE navigator.language, bind=appLocale)
        KeyWin: `detect-locale` scenario in `calculator/scenarios.xml` (READLOCALE SYSTEM, bind=appLocale)
- [x] Linter: `lintLocaleInvariance()` exported from `xmlScenarioLoader.ts`; called in `load()` (throws on error-severity); standalone CLI at `tools/lint-locale-invariance.js`; unit tests added; CONVENTIONS.md updated *(2026-05-21)*
- [x] CONVENTIONS.md §8: document iron rule + escape-hatch pattern + `localeMap=` attribute

### ✅ G-D.7b — ASSERT audit: config/scenarios/*.xml *(done 2026-04-26)*
- [x] Audit `config/scenarios/` — folder is empty; no production scenarios to audit. Vacuously complete.

### G-D.8 — Behavioral-effect assertions for dashboard-touching scenarios *(2026-04-25)*

> **Trigger:** D2 walkthrough revealed that UI round-trip checks (write→DOM-read-back) do not prove
> the server *acts* on the changed setting. A setting can persist to disk and yet be ignored by the
> running process — which a DOM assertion can never detect.
>
> **Policy:** Every scenario that mutates a dashboard setting that influences server behavior must
> include a second-stage assertion that confirms the SOFTWARE BEHAVES DIFFERENTLY as a result.

**Required behavioral probes (one per setting category):**

| Setting | Behavioral assertion |
|---|---|
| `setting-log-level` → `warn` | After save: POST a request that would emit an INFO log; `GET /api/logs` → assert no new INFO entry appeared |
| `setting-require-signature` → `true` | After save: attempt to run an unsigned scenario via REST → assert response is a 403 / error (auth gate active) |
| `setting-require-os-enforcement` → `true` | After save: attempt a tool call without OS-level auth → assert rejected |
| `setting-helper-paths` → bogus path | After save: `GET /api/status` → assert `helpers.count` dropped to 0 (server rescanned and found nothing); restore real path → count recovers |
| `setting-scenarios-path` → bogus path | After save: `GET /api/appTemplates` → assert list empty or error; restore → list returns |
| `setting-token-expiry` → 1 (min) | After save + generate token: decode JWT exp claim → assert expiry ≈ 1 min from now |
| `setting-port` (MCP port change) | After save + server restart: assert MCP endpoint responds on new port; restore old port |
| Working directory change | After click-change-dir: `GET /api/settings` → assert `workingDirectory` field matches new value |

**Implementation notes:**
- All probes must be added as trailing XML steps inside the same scenario that performs the mutation
- Restore must always follow the behavioral probe before the scenario ends (idempotency)
- Server-restart probes require a `WAIT` after restart and a subsequent `HTTP_FETCH /health status=ok` liveness check
- Where a restart is too expensive, use `GET /api/settings` + `EVAL` to cross-check the persisted value instead
- Tag each new scenario with `effect="mutates-server-config"` so the linter (G-D.7 policy) can exempt them from the current "ends-with-restore" rule

**D8 live observation — two distinct error paths for blocked processes *(2026-04-25)*:**
> SF8 (`cmd.exe`) returns `window_not_found` (KeyWin never finds the window because KeyWin itself
> refuses to target a blacklisted process before the security filter chain even runs).
> SF4 (dummy `dogfood_d8_*` pattern) returns `"Security filter blocked: SENDKEYS on dogfood_d8_..."` 
> (the filter chain fires and produces an explicit block message).
> These are two different enforcement paths producing two different error messages for what is
> conceptually the same outcome — "this call is not permitted".
> **Required fix (separate TODO item):** unify both paths to return the same error shape
> `{ code: "SECURITY_BLOCKED", reason: "blacklist|filter", rule: "..." }` so callers
> (including AI agents) can distinguish security blocks from genuine operational failures without
> regexp-matching on message strings.

---

## Q-2 — E2E Dogfood Coverage Gaps (all UI controls must have tests)

> **Trigger:** D2 review revealed only ~5% of Settings UI controls are exercised.
> **Goal:** every input, button, toggle, and visual component in every dashboard tab has a corresponding dogfood assertion.
> **Current D2 gap:** covers only GET /api/settings field presence, one helper toggle, one no-op POST, stack-leak guard.

### D2 — Settings UI — MISSING COVERAGE

**Known bugs fixed this session:**
- `lastExecValue()` in `_scenario-runner.js` filtered on `'EXEC'` only, silently missing all `CDP_EXECUTE` step results — FIXED.
- `setting-scenarios-path` was saved by the server but ignored by `resolveAppTemplateRoots()` — the setting had zero behavioral effect — FIXED: `resolveAppTemplateRoots()` now prepends the configured path.
- S6 test was saving a nonsense path then doing no behavioral assertion, so it always passed regardless of whether the server used the value — FIXED: S6 now saves a bogus path, asserts `validate` returns `error` for the scenarios check, restores the real path, asserts `validate` no longer errors.

**Coverage requirements — each item below requires a passing dogfood assertion before D2 can be considered done:**
- [x] `setting-scenarios-path`: save bogus → validate error; save real → validate ok; browse button updates field
- [x] `setting-log-level`: change → save → REST confirms; reload cancels unsaved change
- [ ] `setting-port` and `setting-dashboard-port`: assert read-back matches REST (read-only display; no save needed; assert DOM value matches GET /api/settings)
- [ ] `setting-token-expiry`: type value → save → GET /api/settings confirms round-trip
- [ ] `setting-helper-paths`: type value → save → read back; browse button updates field
- [ ] `setting-security-path`: bogus → validate error; real → ok; browse button
- [ ] `setting-session-dir`: type value → save → read back; browse button
- [ ] `setting-public-key` / `setting-private-key`: browse button updates field; validate reports present/missing
- [ ] `setting-require-signature` (checkbox): toggle → save → REST confirms; toggle back
- [ ] `setting-allow-unsigned-scenarios` (checkbox): toggle → save → REST confirms; toggle back
- [ ] `setting-require-os-enforcement` (checkbox): toggle → save → REST confirms; toggle back
- [ ] `#btn-validate-config`: click → assert checks array non-empty with status fields in DOM
- [ ] **Working directory** — type a new path → verify REST reflects it; press "Change" button → verify; restore original
- [ ] **Scan for helpers** button → assert helper list returned; verify log entry via GET /api/logs
- [ ] **Reload helpers** button → assert helpers/reload returns success:true; check helpers list
- [ ] **Per-helper panel** (min. BrowserWin + KeyWin): commands list displayed; schema endpoint returns valid JSON; disable → confirm → re-enable → confirm
- [ ] **Cancel / Reload** — mutate a field → Cancel → confirm value reverted

### Live Logs tab — NO TESTS AT ALL

- [ ] Logs tab: open → assert log lines visible in DOM
- [ ] Filter checkboxes: uncheck INFO → INFO lines disappear; re-check → reappear
- [ ] Clear logs button → DOM log list emptied
- [ ] Export logs button → download triggered or content returned

### D3 / D10 — audit same completeness for Auth UI and Server Foundations tabs

---

## UX Finetuning Backlog (non-blocking, pre-release polish)

- [ ] **Menu order**: "Settings" first, "Live Logs" last (currently reversed)
- [ ] **Settings — Server control**: add Restart server button; add orange "Regenerate Security Wizard" button (disabled outside admin mode) to redo full security setup (keys, passwords, binary hashes)
- [ ] **Quick Actions cleanup**: keep only "Enter Admin Mode" bottom-left; move "Restart server" → Settings; move "Clear logs / Export logs" → Logs tab; remove the rest
- [ ] **Working directory input**: replace overflowing bespoke component with a standard CSS `<input type="text">` matching all other inputs on the same page

---

# PART I — BLOCKING (v1.0 gate items)

---

## G-A — ✅ Security Enforcement Gate — COMPLETE

> All items confirmed done by code audit (2026-05-xx).

### G-A1 — Remove `SKIP_SESSION_AUTH` default bypass ✅
- [x] All 4 helpers (`KeyWin`, `BrowserWin`, `MSOfficeWin`, `LibreOfficeWin`) check
  `SKIP_SESSION_AUTH == "true"` explicitly; `skipAuth = false` unless env var is set.
  Production installers must **not** set this env var.

### G-A2 — SecurityLib.dll post-build hash ✅
- [x] `build/windows/build.ps1` last block computes SHA-256 for all 5 binaries and writes
  them into `config/security/config.json` under `binaryHashes` after every build.

### G-A3 — `_caller_user` / `_caller_roles` wire protocol ✅
- [x] `HelperRegistry.ts` `callCommand()`: appends `_caller_user` + `_caller_roles` to every
  request JSON (`HelperRegistry.ts` line 651-652).
- [x] `HelperCommon.cs` `RunStdinListener()`: extracts `_caller_user`/`_caller_roles` before
  dispatch; passes into `SecurityLib.sec_validate_action()` (line ~970).
- [x] `SecurityLib.cpp` `sec_validate_action()`: full `callerUser`/`callerRoles` parameter
  support with comma-split role matching.
- [x] P/Invoke wrapper in `HelperCommon.cs` `SecurityLib` class includes all params.

---

## G-B — 🗄️ Auth Subsystem — Wiring & Completion

> Architecture is fully designed (`src/auth/`, `src/settings/`) — what follows is wiring,
> config completeness, dashboard UI, and test coverage.
> PostgreSQL will be installed on request for DB-backed tests.

### U0 — `AuthConfig` type completeness ✅
- [x] `users.db: DbConfig` sub-field present in `AuthConfig` (`src/auth/types.ts` line 254)
- [x] `storeSource: 'json' | 'db'` field present in `AuthConfig.users`
- [x] `httpServerWithDashboard.ts` `initAuth()` reads `auth.users.storeSource` and wires
  `DbUserStore` or `JsonUserStore` accordingly

### U1 — Auth provider endpoint wiring ✅
- [x] All 8 auth routes registered in `httpServerWithDashboard.ts` (lines 813-828):
  `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/refresh`,
  `GET /api/auth/status`, OAuth redirect/callback, SAML redirect/callback
- [x] Handlers fully implemented in `internalHandlers.ts`
- [x] `AuthMiddleware` extracts and verifies JWT on every request
- [x] `initAuth()` called from `start-mcp-server.ts`

### U2 — `_internal` pseudo-helper filter enforcement ✅
- [x] `httpServerWithDashboard.ts` `checkInternalAccess()` (line 483): evaluates
  `advancedFilters` rules where `helper === '_internal'` or `'*'` before every
  `_internal` REST endpoint; maps path to `access_logs` / `settings_change` / `access`
- [x] DENY → 403; ALLOW → log; null → fall through to RBAC check
- [x] `_internal` is exposed as a helper option in securityFilter infrastructure

### U3 — Role-aware filter evaluation ✅
- [x] `filterEval.ts` `evaluateFilterRules()` accepts `callerRoles` (comma-separated);
  rules with a `role` field are skipped unless caller has that role
- [x] Unit tests in `filterEval.test.ts` `describe('role-restricted rules')` cover
  user-without-role (rule skipped) and user-with-role (rule applied)

### U4 — DbUserStore + DbSettingsAdapter integration tests ✅
> PostgreSQL at `192.168.254.16` (credentials in `ai_priv/db.json`, gitignored). **29/29 ✅ (2026-04-27)**

- [x] `pg` driver already installed
- [x] Test DB `aiapi_test` provisioned via `DbProvisioner.provision()` (schema v1)
- [x] `DbUserStore.integration.test.ts` — Role CRUD, User CRUD (create/find/list/update/delete),
  PasswordAuthProvider round-trip, JWT verify, seed idempotency, API key hash lookup (21 tests)
- [x] `DbSettingsAdapter.integration.test.ts` — get/set round-trip, list, delete, concurrent
  isolation, schema idempotency (8 tests)
- [ ] Repeat tests for MSSQL, MySQL, Oracle when machines available
- [ ] Test all 5 DB auth methods for PostgreSQL beyond `password`:
  - `password` (username + password in config)
  - `certificate` (client TLS cert = settings-signing cert)
  - `integrated` (Kerberos/SSPI on Windows domain)
  - `impersonation` (Windows impersonation, MSSQL only)
  - `constant` (raw connection string — documented as "abusable", warn in logs)

### U4b — pgAdmin UI table verification ✅ (2026-04-28)
> BrowserWin e2e verification of `aiapi_test` schema via pgAdmin 4 web UI.
> Confirmed: `{"tables":["aiapi_apikeys","aiapi_migrations","aiapi_roles","aiapi_settings","aiapi_user_roles","aiapi_users"],"missing":[],"ok":true}`

- [x] Login via React-compatible EXEC fill (HTMLInputElement.prototype.value setter + dispatchEvent)
- [x] Server registration via `POST /browser/server/obj/<sgid>/` with `connect_now:true`
- [x] Database listing via `GET /browser/database/nodes/<sgid>/<sid>/` → `aiapi_test` (id=127376)
- [x] Schema listing via `GET /browser/schema/nodes/<sgid>/<sid>/<dbid>/` → `public` (id=2200)
- [x] Table verification via `GET /browser/table/nodes/<sgid>/<sid>/<dbid>/<schid>/` → `ok:true`
- [x] `apptemplates/pgadmin/scenarios.xml` — correct paths, all 6 scenarios
- [x] `apptemplates/pgadmin/tree.xml` — correct REST API paths documented
- [x] `tools/diag/_pgadmin-verify.js` — clean end-to-end verify script
- [ ] Formal `test/e2e/d20-pgadmin.js` test file (uses verify script as test case)
  - `password` (username + password in config)
  - `certificate` (client TLS cert = settings-signing cert)
  - `integrated` (Kerberos/SSPI on Windows domain)
  - `impersonation` (Windows impersonation, MSSQL only)
  - `constant` (raw connection string — documented as "abusable", warn in logs)

### U5 — Auth provider tests ✅ *(2026-04-30)*
- [x] Unit tests: `PasswordAuthProvider` — correct password ✓, wrong ✗, locked user ✗, no creds ✗, JWT reuse ✓/✗
- [x] Unit tests: `ApiKeyAuthProvider` — valid key ✓, unknown key ✗, no creds ✗, JWT reuse ✓/✗
- [x] Unit tests: `JwtService` — sign/verify/expiry/tamper/malformed/refresh (11 tests)
- [x] Unit tests: `OAuthProvider` — redirectUrl, auto-provision, nested path, groups, token-exchange error, JWT reuse
- [x] Unit tests: `SamlProvider` — redirectUrl, fallback-parser auto-provision, groups, missing response, JWT reuse
- [x] Unit tests: `CertificateAuthProvider` — CN extraction, reuse existing user, invalid cert, no cert, JWT reuse
- [x] Unit tests: `AuthService.create()` — none/password/apikey/certificate/oauth/saml modes; missing oauth/saml config → throws; unknown mode → throws
- [x] Unit tests: `AuthService.refreshToken()` — round-trip, preserves claims, invalid token, wrong secret
- [ ] Integration test: `OAuthProvider` — mock IdP returns code → token → userInfo → user provisioned → JWT; `usernamePath` + `groupsPath` extraction verified
- [ ] Integration test: `SamlProvider` — mock IdP POSTs SAMLResponse → signature verified → user provisioned → JWT; `samlify` absent → fallback warning logged
- [ ] Integration test: `CertificateAuthProvider` — mTLS handshake → CN extracted → user looked up → JWT; invalid cert → 401
- [ ] Verify `auth.debugExternalAuth = true` writes sanitised req/resp bodies to logger (credentials redacted)

### U6 — Dashboard auth configuration UI *(partially done 2026-05-21)*

- [x] New **"Auth"** panel (sub-tab of Settings) with: *(2026-05-21)*
  - Auth mode selector: None / Password / API Key / Certificate / OAuth / SAML
  - JWT settings: enabled toggle, expiry minutes, secret (masked), **issuer field** (`#auth-jwt-issuer`)
  - Password settings: bcrypt rounds
  - OAuth form: clientId, clientSecret (masked), authorizationUrl, tokenUrl,
    userInfoUrl, scope, callbackUrl, usernamePath, groupsPath, PKCE toggle
  - SAML form: entryPoint, issuer, SP cert (📂 Browse), IdP cert (📂 Browse),
    privateKey (📂 Browse), callbackUrl, usernamePath, groupsPath, signatureAlgorithm
  - Debug external auth toggle
  - User store source: JSON (path field) / DB (shows DbConfig form)
  - DB form: engine selector, host, port, database, auth method + fields
- [x] **"Users & Roles"** sub-panel: *(2026-05-21)*
  - User list (5-col): username, enabled, roles (badge inline edit via `editUserRoles()`), API key count (expand toggle via `toggleUserApiKeys()`)
  - Inline "Add user" form: username, password (masked), initial roles
  - Role list (5-col): name, description, permissions matrix; **Edit** via `openEditRoleModal()` + `#edit-role-modal`; **Delete**
  - API key management per user: expand row → list → `revokeApiKey()` (generate flow wired; show-once is server-side)
  - Permissions matrix: `AUTH_PERMISSIONS` constant, `_renderPermMatrix()`, `_collectPermMatrix()` in both Add and Edit role modals
- [x] `POST /api/auth/config` — `saveAuthConfig()` wired to `btn-save-auth`; reads all form fields incl. `jwt.issuer` *(2026-05-21)*
- [x] `GET /api/auth/config` — `loadAuthConfig()` populates all form fields *(2026-05-21)*
- [x] `.role-badge` CSS rule added *(2026-05-21)*
- [x] E2E scenarios: `a12-jwt-issuer`, `a13-role-permissions`, `a14-apikey-revoke`, `a15-user-role-edit` in [`test/e2e/d3/scenarios.xml`](test/e2e/d3/scenarios.xml); [`test/e2e/d3-auth-ui.js`](test/e2e/d3-auth-ui.js) extended with 4 `runOk` calls *(2026-05-21)*
- [x] Docs: "Configuring authentication" section added to [`docs/guides/SERVER_GUIDE.md`](docs/guides/SERVER_GUIDE.md) *(2026-05-21)*

**~~Deferred~~ RESOLVED — DEBT-2 closed 2026-05-21:**
- [x] `handleGetAuthConfig()` now always returns `jwt.issuer` (defaults to `''` if absent) — dashboard issuer field round-trips correctly ✅
- [x] `GET /api/auth/users/:id/apikeys` endpoint live — returns metadata only, no `keyHash` ✅
- [x] `DELETE /api/auth/users/:id/apikeys/:keyId` returns 204 No Content (REST-correct) ✅
- [ ] `GET /api/auth/users/:id/apikeys` endpoint not yet implemented in TypeScript backend — `loadUserApiKeys()` will 404 until added

---

## G-E — 🔏 PKI Signing Chain (Scenarios, Trees, Binaries)

> **Links to existing items:** G-A2 (SecurityLib.dll post-build hash), G-A3 (caller
> roles wire), G-C (SecurityLib API), S-1 `setting-require-signature` checkbox,
> `setting-allow-unsigned-scenarios` checkbox.

### Design Principles
- **Minimum terminals:** re-use X.509 concepts everywhere; no custom crypto.
- **4-level chain:** Root CA → Open-source intermediate → Enterprise intermediate → Leaf.
  Deployments may skip intermediate levels; chain depth is 1…4.
- **Objects signed:** `.exe` binaries (already hash-tracked in G-A2), `scenarios.xml`,
  `tree.xml`; future: compiled `embeddings/*.bin`.
- **Bundled root:** a default trusted root CA cert is bundled in the app and in SecurityLib;
  operators may add additional trusted roots via `security/config.json`.

### Certificate Chain Tasks
- [ ] Decide key format: RSA-4096 or ECDSA P-384 leaf certs (P-384 preferred — smaller).
  Document in `docs/architecture/SECURITY_ARCHITECTURE.md`.
- [ ] `tools/pki/` — PowerShell scripts to generate the full 4-cert chain for development:
  - `New-AIAPIRootCA.ps1` — self-signed root
  - `New-AIAPIIntermediate.ps1` — intermediate (one or two hops)
  - `New-AIAPILeafCert.ps1` — per-team leaf signing cert
- [ ] Store certs in `security/pki/` (PEM); add to `.gitignore` (live keys never committed).
- [ ] `SignatureVerificationManager.ts` (new file):
  - `verifyXmlFile(path, certChain)` — detached CMS / XMLDSig signature
  - `verifyExecutable(path)` — wrap G-A2 `sec_validate_signature()` + cert chain check
  - `getTrustChain(leafCert)` — build and validate the chain up to bundled root

### Event Hook API
- [ ] `SignatureVerificationManager` emits typed events:
  ```ts
  onSignatureWarning(detail: { path: string; reason: string }): void
  onSignatureError(detail: { path: string; reason: string }): void
  onUnsignedLoaded(detail: { path: string; type: 'scenario'|'tree'|'exe' }): void
  ```
- [ ] Per-deployment UI dispatch (no new terminals — adapters only):
  - **VSCode extension**: `vscode.window.showWarningMessage` / `showErrorMessage`
  - **CLI standalone**: `process.stderr.write()`
  - **Windows Service**: Windows Event Log via `SecurityLib.LogEvent()`
  - **Linux daemon**: `syslog(LOG_WARNING, ...)`

### Wire to Existing Settings
- [ ] `setting-require-signature` (S-1 checkbox, already tracked): when ON, unsigned
  files MUST be rejected (`onSignatureError` fires; load aborted).
- [ ] `setting-allow-unsigned-scenarios` (S-1 checkbox, already tracked): when ON,
  `onUnsignedLoaded` fires as warning only; load continues.
- [ ] `security/config.json` new key `"trustedRoots": ["path/to/extra-root.pem"]` —
  merged with bundled root in `SignatureVerificationManager`.

### Integration Points
- [ ] `XmlScenarioLoader.load()` — call `verifyXmlFile(scenarioPath, chain)` before parse;
  emit `onUnsignedLoaded` if no sig, `onSignatureError` if invalid sig.
- [ ] `XmlScenarioLoader.loadTree()` equivalent for `tree.xml`.
- [ ] `HelperRegistry.ts` helper startup — call `verifyExecutable(exePath)` before spawn;
  `onSignatureError` → refuse to start helper.
- [ ] `sec_validate_signature()` in SecurityLib.cpp (G-A2): extend to accept optional
  PEM cert chain; verify that the signing cert chains to a trusted root.
- [ ] Dashboard Security tab — new row in audit log for every signature event;
  "Signing" sub-panel showing chain status per loaded file.
- [ ] Unit tests: valid chain passes; expired leaf → error; untrusted root → error;
  unsigned file → warning-or-deny depending on setting.

---

## G-C — 🔒 Security Infrastructure (SecurityLib.dll + Helper HKDF Auth)

> SecurityLib provides the crypto primitives (`sec_load`, `sec_hkdf_sha256`,
> `sec_validate_action`) that the Helper HKDF Auth handshake depends on.
> These two topics are inseparable and tracked here together.

### Why a Native C++ DLL
- Must work cross-platform (future Linux helpers in other languages)
- C# helpers load it via P/Invoke; future Python/Node helpers via ctypes/N-API
- DLL's own hash stored in `security/config.json` — helpers verify DLL hash BEFORE loading

### SecurityLib API

```cpp
int  sec_load(const char* configPath, const char* password);
int  sec_validate_signature(const char* exePath);
int  sec_validate_action(const char* action, const char* target,
       const char* processName, const char* processPath,
       const char* processHash, int processId,
       const char* callerUser, const char* callerRoles);
     // returns: SEC_ALLOW(1) | SEC_DENY(0) | SEC_ASK(2) | SEC_ERROR(<0)
int  sec_hkdf_sha256(const uint8_t* ikm, int ikmLen,
       const uint8_t* salt, int saltLen,
       const char* info, uint8_t* out, int outLen);
int  sec_get_session_key(uint8_t* outKey, int keyLen);
void sec_unload();
```

### SecurityLib Implementation Tasks ✅ ALL DONE
- [x] `components/helpers/shared/src/security/SecurityLib.cpp` + `SecurityLib.h` — created
- [x] `sec_load()`: parses `security/config.json`, verifies `.sig` (SHA-256 comparison V1),
  parses filter rules + binary hashes into globals
- [x] `sec_validate_signature()`: SHA-256 file hash vs config.json binaryHashes by basename
- [x] `sec_validate_action()`: wildcard rule matching, comma-split role checking, default-deny
- [x] `sec_hkdf_sha256()`: full RFC 5869 HKDF-SHA256 via BCrypt HMAC; caches session key
- [x] `sec_validate_signature_self()`: verifies DLL own hash (captured in DllMain); used via
  `SecurityLib.ValidateSelfOrExit()` wrapper in `HelperCommon.cs`
- [x] Built as `.dll` (Windows MinGW); output at `dist/helpers/SecurityLib.dll`
- [x] P/Invoke declarations in `HelperCommon.cs` `SecurityLib` static class (lines 1035+)
- [x] DLL SHA-256 stored in `config/security/config.json` binaryHashes (G-A2 build step)
- [x] `build/windows/build.ps1` compiles SecurityLib.dll via g++ (MinGW/MSYS2)

### Enforcement Rule
Every helper calls `sec_validate_action()` BEFORE executing any command.
If `SEC_DENY` → return `{"success":false,"error":"SECURITY_FILTER_DENY"}` without executing.
`SEC_ASK` → treat as DENY for now (future: OS dialog).
MCP server ALSO applies filters for defense-in-depth.

### Helper HKDF Auth Handshake

```
[Helper]                                  [MCP Server]
  │  1. sec_validate_signature(selfPath)   │  (private.key.enc decrypted on startup;
  │     — verify own exe + DLL hashes      │   password from user / Windows DPAPI)
  │
  ├── {"action":"_auth_hello",
  │    "helperNonce":"<base64 32B>",
  │    "exeHash":"<sha256-hex>",
  │    "dllHash":"<sha256-hex>"}       ──> │  verify exeHash against config.json entry
  │
  │ <── {"action":"_auth",           <──   │  raw decrypted RSA private key (never on disk)
  │      "pk":"<base64-pkcs8-raw>",
  │      "serverNonce":"<base64 32B>",
  │      "securityConfig":"<path>",
  │      "helperExePath":"<path>"}
  │
  │  2. sec_load(pk_bytes, configPath)
  │  3. HKDF(ikm=pk, salt=SHA256(serverNonce||helperNonce),
  │        info="AIAPI-v1-session") → sessionKey [both sides derive same key]
  │
  ├── {"action":"_auth_ok"}           ──>  │  All further messages HMAC-signed
```

### Helper Auth Implementation Tasks ✅ ALL DONE
- [x] `CertificateManager.ts`: `getRawPrivateKeyBytes()` — decrypted PKCS#8 bytes in memory
- [x] `HelperRegistry.ts`: `HelperDaemon` full auth flow — `startupPhase`, `readyPromise`,
  `handleStartupMessage()` with exeHash verify + HKDF derivation + HMAC verify
- [x] `HelperCommon.cs`: `RunAuthHandshake(skipAuth)` — full `_auth_hello` → `_auth` →
  `_auth_ok` exchange + HKDF session key derivation using BCrypt
- [x] `HelperRegistry.ts`: exeHash verification against `config.json binaryHashes` ✅;
  PK bytes sent to helper via `_auth` message ✅
- [x] `MCP_SESSION_TOKEN` / `MCP_SESSION_SECRET` kept as legacy fallback in
  `windowsFormsProvider.ts`; HKDF path is the primary auth channel now
- [x] All messages HMAC-signed: `IdInjectingWriter` (C#) appends `hmac` on outgoing;
  `HelperRegistry.ts` `dispatchResponse()` verifies incoming HMAC
- [x] MCP server startup: `loadCryptoCredentials()` prompts for password via readline
  (with unit tests in `loadCryptoCredentials.test.ts`)


---

# PART II — ACTIVE SPRINT

---

## S-1 — 🔐 Security & Configuration UI

**Goal:** User-friendly configuration, security management, and scenario editing.

### Unit & Integration Test Coverage (current state)
- [x] `wildcardMatch` — 19 tests (`src/utils/wildcardMatch.test.ts`)
- [x] `xmlScenarioLoader` — 48 tests (`src/scenario/xmlScenarioLoader.test.ts`)
  _jsdom v28 ESM-only deps → solved via `src/__mocks__/jsdom-mock.js` + `moduleNameMapper`_
  _**2026-05-21:** Added well-formedness regression suite (6 new tests) that discovers every shipped `scenarios.xml` under both apptemplates roots and asserts zero JSDOM parse errors. Fixed two pre-existing malformations surfaced by the new suite: (a) `apptemplates/pgadmin/scenarios.xml` — escaped `--` inside two `<!-- … -->` comment bodies (lines 45, 88-89, XML §2.5 forbids `--` in comments) and escaped bare `<` in a `parameter=""` attribute (line 256, `indexOf(n)<0` → `&lt;0`); (b) `apptemplates/libreoffice/scenarios.xml` — escaped `HANDLE:<hwnd>` → `HANDLE:&lt;hwnd&gt;` in `<Description>` text (line 108, was parsed as unclosed element). All 25 shipped `scenarios.xml` now parse with zero errors; no scenario logic changed._
- [x] `Logger` — 18 tests (`src/utils/Logger.test.ts`)
- [x] `filterEval` — 33 tests (`src/utils/filterEval.test.ts`)
  _extracted `evaluateFilterRules()` from duplicate private loops_
- [x] `securityFilter` — 40 tests (`src/server/securityFilter.test.ts`)
  _admin-token bypass, advanced filter eval, read-only exemption, permissive default_
- [x] MCP server integration — 39 tests (`src/server/mcpServer.integration.test.ts`)
  _HTTP transport, JSON-RPC compliance, MCP core, tools/call, admin token API, filter wire_
- [x] `SessionTokenManager` — 16 tests (`src/security/SessionTokenManager.test.ts`)
- [x] MCP server perf — 7 tests (`src/server/mcpServer.perf.test.ts`)
  _p95<200ms serial, 0 errors concurrent (20/50/100), memory growth <20MB/200 reqs_
- [ ] **UI Tests** — dashboard using AIAPI itself (dogfooding): see S-2
- [ ] **End-to-End Tests** — full workflow from UI to execution

### Settings Tab
- [x] Paths, ports, key files, helper search paths, session token expiry, log level
- [x] Remember last browsed locations per field (localStorage)
- [x] Helper Discovery: scan, list, enable/disable toggle, view schema popup
- [ ] **Real native file/folder dialog integration (Windows API)**
  (placeholder prompts today; needs WinAPI `GetOpenFileName` / `SHBrowseForFolder`)

### Security Tab — Filters
- [x] Filter wizard: action, process, helper, command (risk-grouped), pattern, live preview
- [x] Quick-Edit table: inline select/input per cell, move-up/down, delete
- [x] Binary hash / process path / window title criteria
- [x] Pre-defined command template dropdown; parameter autocomplete from helper schemas
- [x] Test filter dry-run; Validate All; Import / Export JSON
- [x] `/regex/` and `/regex/i` pattern syntax in all pattern fields
- [x] "Rules by Process" collapsible panel — groups active rules by process
- [x] Security Audit Log panel — `GET /api/security/log`, auto-refresh 5s, colour-coded
- [ ] Security audit log: add `?limit=N&offset=N` pagination;
  persist events to rolling file log (survives server restarts)
- [ ] XPath-like UI tree path filtering (future, requires N-2 first)
- [ ] Office/Browser document structure filters (future)

### Privileged Mode ✅
- [x] Admin Session Token: time-limited, 15-min expiry, bypasses all filters
- [x] Dashboard: "🔐 Enter Admin Mode", red warning banner, auto-logout
- [x] Audit logging; whitelisted `/api/config/*`; `--emergency-admin-mode` failsafe
- [x] Documented in [docs/specs/PRIVILEGED_MODE.md](docs/specs/PRIVILEGED_MODE.md)

### Scenario Editor (Scenarios Tab)
- [x] Tabular step editor: command / target / parameter / conditional / note fields
- [x] Step reorder (↑↓), duplicate (🔀), undo/redo (Ctrl+Z/Ctrl+Y), history stack
- [x] Save/load; import .json / XML; export .json / XML
- [x] Metadata panel: helper, process, window title, linked assistant, binary checksum
- [x] Auto-refresh App Templates list after save
- [x] "Linked filter rules" sidebar per step — shows matching rules, create from step
- [ ] **Create new template from UI** — "New Template" button/flow; currently no way to create a
  fresh App Template entry without hand-editing XML or files on disk
- [ ] **Create new scenario inside a template from UI** — "Add Scenario" action is missing in the
  editor; user can only edit existing scenarios, not add new ones to the current template
- [ ] **Column label fixes** — "Target" column header should read **"Target (Path)"**;
  "Parameter" column header should read **"Param (Value)"**
- [ ] **Command list refresh** — the `Command` dropdown is missing several valid step actions:
  `ASSERT`, `ASSERTPATHEVAL`, `READELEM`, `READVAL`, `HTTP_FETCH`, `LISTWINDOWS`, `LAUNCH`,
  `KILL`, `WAIT`, `CDP_EXECUTE`, `FILL`, `SENDKEYS`; add all commands from CONVENTIONS.md §1
- [ ] **ASSERT / ASSERTPATHEVAL: OP parameter** — when "ASSERT" is selected as the command, a
  second `Op` field should appear as a dropdown:
  `eq` · `neq` · `gt` · `gte` · `lt` · `lte` · `contains` · `matches` · `truthy`;
  the field is required (no default) to prevent accidentally passing on empty comparison
- [ ] **Field-level context help / sub-editor hints:**
  - _Target (Path)_: tooltip explains `HANDLE:<hwnd>` vs `PAGE:<url>` vs bare AutomationId;
    show wildcard (`*`, `?`) vs `/regex/` syntax; offer autocomplete from `LISTWINDOWS` result
  - _Linked AI assistant_: `?` icon opens popover explaining what the field does (attaches
    assistant context to this scenario); no value-list needed (free text)
  - _Step-Scenario Id_ (for `ScenarioRef`): dropdown populated from the **current template's**
    scenario `id` attributes; updated live as scenarios are added/renamed
  - _Conditional_: dropdown `absent` / `present` / (empty = always) with inline explanation
- [ ] Drag-and-drop step reordering
- [ ] IntelliSense-style autocomplete: action types, parameter names, valid values
- [ ] Context-aware suggestions: running apps, element IDs from live UI trees

### Installer & First-Run Setup _(full packaging → F-2; setup wizard tracked here)_
- [ ] Automatic security setup wizard: generate key files on first run, sign `config.json`,
  create admin user (ADR-007 steps S4 + S5)
- [ ] Register file associations (`.aiapi-scenario`)

---

## S-2 — 🐕 Dogfooding — Platform Self-Test

> Key release criterion: AIAPI must configure and validate itself end-to-end
> using its own BrowserWin + MCP tools.

---

### ⚠️ ARCHITECTURE DECISIONS — READ BEFORE EVERY SESSION

These rules were established during the D2/D3 rewrite sprint and MUST be followed for all D# tests:

#### Rule 1 — NO REST API CALLS IN run.js
All test logic — including state verification, list checks, round-trips — MUST go through browser UI scenarios.
`dashRest()` is **FORBIDDEN** in `d#/run.js` for any test assertion.
Reason: REST calls do not mimic user behaviour and bypass the UI code paths under test.
ALLOWED exception: `waitReady()` and `checkMcpNoStackLeak()` helpers in `_shared.js` (infrastructure, not tests).

#### Rule 2 — EVERY TEST SECTION IS A SCENARIO
Every logical check (even "can I see the list of apps?") maps to a `<Scenario>` in `d#/scenarios.xml`.
`d#/run.js` is thin orchestration only: call `runner.runOk()` per scenario, read bound `vars`, assert on them.

#### Rule 3 — THREE-LAYER SCENARIO HIERARCHY (see CONVENTIONS.md §8)
Scenarios are distributed across three layers:
- **L1** — `components/helpers/*/dist-resources/apptemplates/<app>/scenarios.xml`: shipped product primitives. Atomic UI actions only. No test assertions.
- **L2** — `config/scenarios/<app>/`: use-case workflows assembled from L1 atoms via `<ScenarioRef>`. No test-only content.
- **L3** — `test/e2e/d#/scenarios.xml`: test-suite layer. References L1/L2 via `<ScenarioRef>`, adds dialog shims and CDP_EXECUTE throw-on-fail assertions.

**Before writing any `<step>` in a `d#/scenarios.xml`:** check whether the equivalent L1 atom already exists in the shipped `scenarios.xml` for that app. If it does → use `<ScenarioRef app="..." ref="..."/>`. If it does not → add it to the L1 file first, then reference it from L3.

#### Rule 4 — SCENARIOS USE UI PRIMITIVES ONLY
- `CLICKID` for buttons, links, nav items (routes through CDP Input.dispatchMouseEvent — real event chain)
- `SENDKEYS` for typing
- `CDP_EXECUTE` ONLY for: assertions (throw on failure), boolean/count reads that READ cannot express, dialog shims
- `CDP_EXECUTE` is FORBIDDEN as a substitute for clicks (i.e., `el.click()` in CDP_EXECUTE is banned)

#### Rule 5 — NOTE ALL DECISIONS IN THIS FILE
Every time an architectural decision, test structure agreement, or implementation constraint is established, it MUST be recorded in this section before any code is written.

#### Rule 6 — SCENARIO FILE STRUCTURE
Each test `D#` consists of exactly:
```
test/e2e/d#/scenarios.xml   — all UI interaction atoms as <Scenario> elements
test/e2e/d#/run.js          — thin orchestration: runner.runOk() + var assertions only
test/e2e/d#-<name>.js       — 10-line delegator: require('./d#/run').run()
```

---

### D# Rewrite Progress (scenario-driven format)

| Test | scenarios.xml | run.js | delegator | Status |
|------|--------------|--------|-----------|--------|
| D2 — Settings UI          | ✅ | ✅ | ✅ | 42/42 passing |
| D3 — Auth UI              | ✅ | ✅ | ✅ | 35/35 passing |
| D4 — Scenarios Editor     | ✅ | ✅ | ✅ | 17/17 passing |
| D5 — KeyWin Calculator    | ✅ | ✅ | ✅ | 3/3 passing |
| D6 — KeyWin Notepad       | ✅ | ✅ | ✅ | 3/3 passing |
| D7 — BrowserWin Chrome    | ❌ | ❌ | ❌ | pending |
| D8 — Security Enforcement | ❌ | ❌ | ❌ | pending |
| D9 — Helper Schema        | ❌ | ❌ | ❌ | pending |
| D10 — Server Foundations  | ❌ | ❌ | ❌ | pending |
| D11 — Security Audit Log  | ❌ | ❌ | ❌ | pending |
| D12 — KeyWin Extended     | ❌ | ❌ | ❌ | pending |
| D13 — BrowserWin Extended | ❌ | ❌ | ❌ | pending |
| D14 — MSOfficeWin        | ✅ | ✅ | ✅ | **DONE** — d14-preflight + suite; 38/38 green |
| D15 — Scenario Execution  | ✅ | ✅ | ✅ | **DONE** — d15-static-suite 16/16 green |
| D16 — Extended REST       | ✅ | ✅ | ✅ | **DONE** — d16-suite 3/3 green |
| D17 — Users Roles         | ✅ | ✅ | ✅ | **DONE** — d17-static-suite 26/26 green |
| D18 — LibreOffice         | ✅ | ✅ | ✅ | **DONE** — d18-preflight + suite; 36/36 green |
| D19 — Users Roles DB      | ✅ | ✅ | ✅ | **DONE** — 26/26 green (DB skip in CI) |

### ✅ DONE: D3 (35/35), D4 (17/17), D5 (3/3), D6 (3/3) — ADR-008/ADR-010 compliant; all assertions inline in XML.
### IMMEDIATE NEXT: D7–D19: create d#/scenarios.xml + d#/run.js + delegator for each remaining test.

### ALSO NEEDED — retrofit `<Parameters>` blocks (XSD contract)
All scenarios that use `{{varName}}` placeholders MUST have a `<Parameters>` block declaring each param (see CONVENTIONS.md §8 and ADR-008 §5a). Current files missing this:
- [ ] `components/helpers/shared/dist-resources/apptemplates/dashboard/scenarios.xml` — all scenarios with params (e.g. `set-loglevel-select` uses `{{logLevel}}`)
- [ ] `test/e2e/d2/scenarios.xml` — all scenarios with params (e.g. `s5a-loglevel-set`, `s6-path-field-edit`, `s7-workdir-change`)
- [ ] `test/e2e/d3/scenarios.xml` — all scenarios with params
- [ ] `test/e2e/d4/scenarios.xml` — all scenarios (uses `{{appName}}`, `{{scenId}}`)
- [ ] `test/e2e/d5/scenarios.xml` — all scenarios (uses `{{content}}`, `{{newContent}}`)
- [ ] `test/e2e/d6/scenarios.xml` — all scenarios (uses `{{content}}`, `{{newContent}}`)

---

### D1 — Dashboard automation test suite (original spec)
- [ ] Write `tests/integration/test-dogfooding-dashboard.js`:
  - Launch AIAPI server (`--self-hosted`)
  - Open dashboard URL via `BrowserWin LAUNCH:chrome`
  - Settings tab: verify helpers list loads
  - Security tab: add a filter rule via wizard, verify it appears in Quick-Edit table
  - Scenarios tab: create a minimal scenario, save, verify in app templates picker
  - Close browser; verify session log + summary JSON written

### D2 — MCP schema round-trip test (original spec)
- [ ] Verify: AI issues `getHelperSchema(KeyWin)` → schema returned →
  AI calls `KeyWin.LISTWINDOWS` → response received
- [ ] Verify: `executeScenario(app="calculator", scenarioId="compute",
  params={expression:"3+4"})` → result `"7"`

### D3 — Security filter enforcement test 🟡 (original spec)
- [ ] Test: add DENY rule for `{SENDKEYS}` on notepad → MCP call blocked →
  `SECURITY_FILTER_DENY`
- [ ] Test: admin token bypass → same call succeeds with `X-Admin-Token` header
- [ ] Test: role-based rule → anonymous denied; user with role allowed

---

## S-3 — 🌐 Web Scraping & Network Tools

**Goal:** `fetch_webpage` MCP tool with security filters; advanced network protocol support.

### Core fetch_webpage ✅ IMPLEMENTED
- [x] `fetch_webpage` MCP tool: HTTP/HTTPS, text/HTML/element extraction
- [x] Basic auth and headers; timeout and retry; user-agent customisation
- [x] Domain whitelist/blacklist; protocol restrictions; content-type filtering
- [x] Response size limits; rate limiting per domain; header injection prevention
- [x] Redirect validation and limits

### Advanced Network Protocol Support _(backlog)_
- [ ] SSH client for secure remote access
- [ ] FTP/SFTP for file transfer
- [ ] Telnet for legacy system access
- [ ] Raw TCP/UDP socket connections
- [ ] WebSocket support for real-time communication
- [ ] SMTP for email automation
- [ ] LDAP for directory service queries

### Security Configurations for Network _(backlog)_
- [ ] Network access policy configuration
- [ ] Trusted certificate management; proxy server support with authentication
- [ ] Extend Security Filters UI to include network operations
- [ ] Network command audit trails; admin-mode lockdown capability


---

## H-1 — 📡 Protocol KB Scenario Helpers _(backlog)_

**Goal:** Create `apptemplates/<protocol>/scenarios.xml` helper scenario files for each
protocol in the `KB : PROTOCOLS` bookmark tree (Brave Nightly). Each scenario file should
offer at least `describe` + `find-spec` scenarios against common reference sites / RFCs.

Protocol inventory (from Brave Nightly Favourites → KB:general → KB: PROTOCOLS):

### Base (wire/link) layer
- WWAN GSM+LTE+GPS
- Ethernet (802.3)
- Wi-Fi (802.11/16 a,b,g,n,ac)
- Bluetooth (802.15.1)
- VLAN (802.1q)
- PortSecurity (802.1x)
- STP (802.1d)
- LLDP (802.1ab)
- QoS (802.1p)
- LinkAggr (802.1ax)
- ARP (RFC826)
- **v4:** IPv4 · DHCPv4 · ICMPv4 · IGMPv4
- **v6:** IPv6 · SLAAC+DAD · ICMPv6 · DHCPv6
- IPsec · UDP · TCP

### APP layer
- Novell: IPX/SPX/NCP/NBF/(NBT→NetBIOS)
- NetBIOS/NBT/SMB(SAMBA)/CIFS
- DNS
- (s)FTP(S)
- SNMP
- SSH/telnet
- LDAP(s) + Ddev/Admin apps
- ODBC
- DH (Diffie-Hellman key exchange)
- SSL/TLS
- KERBEROS
- HTTP
- SAML
- oAuth
- REST
- SOAP/WSDL
- SMTP/POP3/IMAP/DMARC/SPF/DKIM
- Oracle DB Protocol
- MSSQL TDS
- PostgreSQL

### Business / vertical
- WITSML 2.0

### Reference / META
- DATA structures / .h / Interfaces (+HTML+CSS!)

### Tasks
- [ ] H-1a: draft canonical folder layout `apptemplates/protocols/<name>/scenarios.xml`
- [ ] H-1b: implement helper for DNS (most commonly referenced; good pilot)
- [ ] H-1c: implement helper for HTTP (covers REST, fetch_webpage)
- [ ] H-1d: implement helper for SSL/TLS (ties into security architecture)
- [ ] H-1e: remaining protocols — batch creation once pilot shape is settled

> **How identified:** scanned Brave Nightly Bookmarks JSON via BrowserWin/CDP file:// tab
> (port 3457 standalone server, NEWPAGE → EXEC document.body.innerText, JS parse). Pattern:
> open `file:///…/Brave-Browser-Nightly/User Data/Default/Bookmarks` in a CDP tab, then
> `JSON.parse(document.body.innerText)` and walk tree for `"PROTOCOLS"` folders.
>
> **Approaches that do NOT work on Brave Nightly (no CDP, no accessibility flag):**
> - `SENDKEYS HANDLE:<hwnd> {CTRL}+{SHIFT}o` (Bookmark Manager shortcut) — `success=True` but
>   browser ignores navigation shortcuts on background windows (no `SetForegroundWindow`).
> - `SENDKEYS HANDLE:<hwnd> {CTRL}l` + URL + `{ENTER}` — same reason; address bar needs focus.
> - `QUERYTREE HANDLE:<hwnd> depth=8` — Brave exposes only `Window→Pane→Pane` (4 nodes total)
>   without `--force-renderer-accessibility` process flag; bookmarks bar/tab strip are invisible.
>   **Tested WITH `--force-renderer-accessibility` (second instance, separate profile)** — still only
>   4 nodes. Reason: that flag forces AX tree for *web page content* (screen-reader text), NOT for
>   the browser chrome UI (bookmarks bar, address bar, tabs). Chromium's browser-shell UIA provider
>   exists but is not wired in Brave Nightly's build. No Chromium flag exposes the toolbar UIA tree.
> - `SCREENSHOT HANDLE:<hwnd>` — returns 196 bytes (no data); Brave doesn't support UIA screenshot.
>
> **The only working approach for profile-locked browsers:** open the Bookmarks JSON file
> via `file://` URL in a CDP-enabled Brave instance (even a different profile) and parse
> it with JavaScript (`JSON.parse(document.body.innerText)`). Works because the bookmarks
> file is readable by any process when the owning Brave profile is not the CDP one
> (different profile directories don't lock each other's files).

---

# PART III — NEXT SPRINT

---

## N-0 — 📦 VS Code Extension — VSIX & Marketplace

> The extension is the **primary and simplest distribution channel** — any Windows user
> with VS Code can install a `.vsix` drop-in without Node, build tools, or a service.
> This chapter tracks the work needed to make that possible.

### Current State
- [x] Extension scaffolding exists: `src/extension.ts` + `package.json` with
  `"engines": {"vscode":"^1.75.0"}`, `activationEvents`, `contributes`
- [x] MCP@IPC command pair (`extension.mcp.callTool`, `extension.mcp.listTools`) registered
- [x] **`activate()` rewritten** — starts `MCPServer` + `HttpServerWithDashboard` via
  `process.chdir(context.extensionPath)`; status bar item; output channel; IPC
  commands relay over loopback HTTP; `deactivate()` stops both servers gracefully.

### N-0.1 — Fix `activate()` to start the real server stack
- [x] Replace `AutomationEngine`/`HttpServer` in `activate()` with `MCPServer` +
  `HttpServerWithDashboard` (mirrors `start-mcp-server.ts`)
- [x] `process.chdir(context.extensionPath)` so all relative paths resolve inside VSIX
- [x] `extension.mcp.callTool` / `extension.mcp.listTools` relay via loopback HTTP
  (same tool dispatch, security filter, helper registry exercised)
- [x] Status bar item: `$(rocket) AIAPI :<port>` with click → open dashboard
- [x] Output channel `AIAPI` for server logs
- [x] `deactivate()`: stops `HttpServerWithDashboard` then `MCPServer` gracefully

### N-0.2 — `package.json` cleanup
- [x] Set `"publisher": "rheingold"`
- [x] Fix `"repository".url` → `https://github.com/rheingold/AIAPI`
- [x] Fix `"files"` array — removed entirely (`.vscodeignore` is the correct VSIX mechanism)
- [x] Bump `"version"` → `0.2.0`
- [x] Add `"extensionKind": ["ui"]`
- [x] Add `@vscode/vsce` devDependency + `package:vsix` / `publish:vsix` scripts
- [x] Remove stale settings: `aiAutomation.enableLegacyHttp`, `aiAutomation.httpPort`
- [x] Replace 4 old automation commands with `aiAutomation.openDashboard`
- [ ] Add `"icon"` field (128×128 PNG, not yet created)

### N-0.3 — `.vscodeignore`
- [x] Created `.vscodeignore` — excludes source, tests, docs, build tooling from VSIX
- [x] `"files"` array removed from `package.json` (vsce does not allow both)
- [x] VSIX verified: 237 files, 562 KB — includes `dist/` (204 files), `config/`,
  `security/`, `components/` apptemplates (12 files), `README.md`, `LICENSE`, `CHANGELOG.md`

### N-0.4 — Build & CI
- [x] Added `vsce package` step to `build-all.ps1` — outputs
  `dist/release/ai-ui-automation-<version>.vsix`, graceful skip if vsce missing
- [x] GitHub Actions workflow `.github/workflows/release.yml`:
  uploads `.vsix` artifact on every run; creates GitHub Release on `v*` tags
- [x] `CHANGELOG.md` created, referenced in `package.json` `files`
- [x] Test install: `code --install-extension dist/release/ai-ui-automation-0.2.0.vsix` —
  exit 0, `rheingold.ai-ui-automation` listed; stale `undefined_publisher` copy uninstalled
- [ ] Optional: `vsce publish` from CI with Marketplace PAT secret (after publisher verified)

### N-0.5 — Marketplace listing
- [ ] `README.md`: add badges (VS Code Marketplace version, installs, rating)
- [ ] Screenshot or GIF showing dashboard + scenario run in the Marketplace description
- [ ] `CHANGELOG.md`: document all changes since v0.1.1
- [ ] Category: `"Other"` → consider `"Programming Languages"` + `"Debuggers"` or
  `"Machine Learning"` for discoverability

---

## N-1 — 📚 App Knowledge Base — Extensions

**Goal:** Usr override layer, reverse-domain namespace hierarchy, embedding vectors.

### Usr Override Layer _(config/templates/ as first root — already wired, needs docs & test)_
> Shipped defaults: `components/helpers/*/dist-resources/apptemplates/`
> User overrides: `config/templates/` (first in `appTemplateRoots`; currently empty)

- [ ] Document `config/templates/` purpose and format in `docs/guides/SERVER_GUIDE.md`
- [ ] Example: `config/templates/calculator/scenarios.xml` overrides shipped scenarios
- [ ] Test: server picks usr override first; correctly falls back to shipped default

### R1 — Runtime Directory Migration _(prerequisite: ADR-007 S4 + S5)_
> Runtime-authored files should not live under the repo root.

- [ ] Migrate `config/` → `runtime/config/`, `security/` → `runtime/keys/`
- [ ] Update hardcoded path `config/scenarios` → `runtime/config/scenarios` in `mcpServer.ts`
- [ ] Update `httpServerWithDashboard.ts` settings and apptemplates paths
- [ ] Update setup wizard (`POST /api/_internal/setup`) to write into `runtime/`
- [ ] Add `runtime/` to `.gitignore` (mutable user data, not committed)
- [ ] Add `test/dev-runtime/` tracked stub with dev-time config + keys

### N-1x — Scenario Suggest & Local Override Workflow

> **Goal:** An authorised user can propose step overrides for a specific scenario in their
> environment without modifying the signed XML on disk.  Overrides are stored as
> `local-overrides.json`, applied at runtime, and optionally submitted upstream for review.

#### Design constraints
- No new XML terminals.  Override data reuses `<step>` / `<assert>` / `<Parameters>` vocabulary.
- Signed canonical XML is never modified client-side.
- Environment fingerprint reuses child `<assert>` semantics (proc/path/op/value).

#### REST endpoint
- [ ] `POST /api/scenarios/{app}/{id}/suggest` — body:
  ```json
  {
    "steps": [ /* array of <step>-shaped objects */ ],
    "fingerprint": [ /* array of <assert>-shaped conditions that define the env */ ],
    "note": "reason for override"
  }
  ```
  Validates JSON shape; writes `config/overrides/{app}/{id}/local-overrides.json`.
- [ ] `GET /api/scenarios/{app}/{id}/overrides` — list active local overrides for a scenario.
- [ ] `DELETE /api/scenarios/{app}/{id}/overrides/{overrideId}` — remove a specific override.

#### LocalOverrideManager (`src/scenario/LocalOverrideManager.ts`)
- [ ] `load(app, scenarioId)` — reads `local-overrides.json`; returns `LocalOverride[]`.
- [ ] `findMatchingOverride(scenario, vars)` — evaluates each override's fingerprint
  (same `evaluateFilterRules`-style logic); returns first matching override or `null`.
- [ ] `apply(scenario, override)` — substitutes matching steps; preserves unmatched steps.

#### Scenario Runner integration
- [ ] `executeXmlScenario()`: before dispatch, call `LocalOverrideManager.findMatchingOverride()`;
  if match found, log `"override applied: {overrideId}"` and swap steps.
- [ ] Override application is audited: write to `security-audit.jsonl` with
  `{event:"override_applied", app, scenarioId, overrideId, user, fingerprint}`.

#### Submit-for-review workflow
- [ ] `POST /api/scenarios/{app}/{id}/overrides/{overrideId}/submit` — packages override +
  fingerprint + audit trail into a review request JSON; writes to
  `config/overrides/{app}/{id}/pending/`; optionally POSTs to an upstream URL configured
  in settings (`settings.overrideReviewUrl`).
- [ ] Dashboard Scenarios tab: per-scenario "Local Overrides" badge; "Submit for Review" button.
- [ ] Unit tests: fingerprint match / no-match; step substitution; audit write; submit packaging.

---

### N-1y — Super-Scenarios: User-Defined AI-Triggable Prompt-Scenarios *(2026-04-25)*

> **Trigger:** Walkthrough observation that power users will want to "teach" the LLM a
> repeatable task once and re-trigger it with a simple prompt — a form of
> pseudo-automation-programming accessible to non-developers.
>
> **Concept:** A Super-Scenario is a **user-authored, AI-targeted document** that
> blends natural language instructions for the AI with structured scenario hints/steps.
> It is NOT a test scenario and NOT an app template override — it is a reusable
> "triggable prompt with scaffolding" that the AI agent can execute autonomously using
> the existing scenario infrastructure.
>
> **CRITICAL DESIGN CONSTRAINT (must be stated explicitly in every implementation
> decision for this feature):** Super-Scenarios **must build upon and reuse the existing
> scenario tools to the maximum extent possible** — the XML grammar, `<Step>` structure,
> `<Parameters>`, `<ScenarioRef>`, the `xmlScenarioLoader` runner, the existing MCP
> `run_scenario` / `run_scenario_supervised` actions. New infrastructure is only added
> as a thin enhancement layer (additional attributes, a storage location, a new MCP
> tool description) on top of what already exists.

#### What distinguishes a Super-Scenario from a regular scenario

| Property | Regular scenario | Super-Scenario |
|---|---|---|
| Author | Developer / tester | End user |
| Location | `apptemplates/{app}/scenarios.xml` or `test/e2e/d*/scenarios.xml` | **User data/documents space** — path chosen by user at install / first run (see Storage below) |
| Scope | Single app | May span multiple apps / helpers |
| Steps | Concrete `<Step action="...">` only | Mix of concrete steps AND natural language hints (`<Hint>` elements) |
| Triggering | `POST /api/appTemplates/{app}/scenarios/{id}/run` | By AI agent matching user prompt → Super-Scenario title/tags |
| AI role | Executes steps as written | Interprets hints, fills in steps where only a hint is given, applies judgment |
| Assertions | ASSERTPATHEVAL / ASSERT inline | Optional — user may add them or leave outcome to AI interpretation |

#### Storage structure and location selection

Super-scenarios live in **user data/documents space** — NOT inside the AIAPI installation
folder, and NOT in `config/` (which is runtime-server-owned). This makes them:
- Portable across reinstalls / upgrades
- Backed up alongside the user's own documents
- Shareable by copying a folder

**Default path (platform-aware, unless overridden):**
```
Windows : %USERPROFILE%\Documents\AIAPI\user-scenarios\
Linux   : ~/Documents/AIAPI/user-scenarios/
macOS   : ~/Documents/AIAPI/user-scenarios/
```

**Folder layout inside the chosen root:**
```
<userScenariosRoot>/
  {namespace}/             ← user-chosen grouping (e.g. "work", "daily", "finance")
    {super-scenario-id}/
      scenario.xml         ← the super-scenario document
      notes.md             ← (optional) human notes / changelog
```

**How the location is determined — three-way priority:**

1. **Setting `userScenariosPath`** in AIAPI settings (persisted in `config/dashboard-settings.json`).
   If set, this wins. The user can change it any time via the dashboard Settings tab.

2. **Install / first-run wizard** — the dashboard setup wizard (`section-settings` first-run panel)
   prompts the user to choose or confirm a folder. Default shown is the platform default above.

3. **MCP "nagging" prompt** — if `userScenariosPath` is not yet configured when the AI agent
   calls `list_user_scenarios` or `run_user_scenario`, the MCP server **does not block** the
   call but appends a non-blocking advisory in the response:
   ```json
   {
     "result": [],
     "_advisory": {
       "type": "user-input-needed",
       "message": "No user scenarios folder is configured. Where would you like to store your Super-Scenarios? (e.g. 'C:\\Users\\Me\\Documents\\AIAPI') — or say 'use default'.",
       "settingKey": "userScenariosPath",
       "defaultValue": "C:\\Users\\Me\\Documents\\AIAPI\\user-scenarios"
     }
   }
   ```
   The AI agent surfaces this to the user in natural language, collects the answer, and calls
   `POST /api/settings` with `{ userScenariosPath: "<chosen path>" }` — one MCP round-trip.
   On subsequent calls the advisory is gone.

   The `_advisory` field is ignored by the regular runner and by all non-MCP REST callers.
   It is present only when the MCP tool wraps the response.

Super-scenarios are **never** inside `apptemplates/` (vendor/shipped layer) and **never**
inside `config/` (server-runtime layer).

#### Super-Scenario XML format

Extends the existing `<Scenario>` grammar with two additions only:

```xml
<Scenario id="morning-standup" superScenario="true"
          title="Open my standup tools and draft today's update"
          tags="daily,productivity,chrome,notepad">

  <Description lang="en">
    Opens Chrome to Jira board, reads my open tickets, opens Notepad, and drafts
    a standup message. AI fills in the actual ticket list from the live page.
  </Description>

  <!-- Natural language hints: AI interprets these and chooses steps -->
  <Hint>Navigate Chrome to my Jira board (URL from settings key 'user.jiraUrl')</Hint>
  <Hint>Read the first 3 open ticket titles assigned to me</Hint>
  <Hint>Open Notepad and type a standup draft using those ticket titles</Hint>

  <!-- Concrete steps where the user knows exactly what to do -->
  <Steps>
    <Step action="LAUNCH" proc="notepad.exe" note="open Notepad for draft"/>
    <Step action="WAIT" value="2000"/>
    <!-- AI fills remaining steps based on Hints above -->
  </Steps>

  <!-- Optional: parameters the user wants to expose to the AI -->
  <Parameters>
    <Param name="jiraUrl" type="string" required="false"
           default="https://jira.example.com/issues/?assignee=me"/>
  </Parameters>

</Scenario>
```

New XML additions (only two):
- `superScenario="true"` — flag attribute on `<Scenario>` (camelCase, ADR-011 compliant)
- `<Hint>` element — natural language instruction for the AI; ignored by the regular runner;
  consumed by the AI agent as part of its prompt context

#### REST surface (minimal, reuses existing endpoints)

```
GET  /api/userScenarios                           — list all super-scenarios (name, title, tags)
GET  /api/userScenarios/{namespace}/{id}          — get full super-scenario document
POST /api/userScenarios/{namespace}/{id}/run      — run concrete steps via existing runner;
                                                    Hint elements returned in response for AI
POST /api/userScenarios                           — create/save a new super-scenario
PUT  /api/userScenarios/{namespace}/{id}          — update
DELETE /api/userScenarios/{namespace}/{id}        — delete
```

The `/run` endpoint reuses `executeXmlScenario()` for concrete `<Step>` elements and
returns `<Hint>` content as a structured `hints[]` array in the response — the calling AI
agent acts on the hints between concrete step blocks.

#### MCP tool surface

- `list_user_scenarios` — returns name, title, tags — used by AI to match user prompt to a super-scenario
- `run_user_scenario` — wraps the `/run` endpoint; returns step results + hints array
  (AI processes hints between step groups using normal atomic MCP tools)
- Reuses `run_scenario_supervised` (N-6) for pause-on-fail during super-scenario execution

#### Dashboard UI

- [ ] New nav section or subsection in "Scenarios" tab: "My Super-Scenarios"
- [ ] List view: title, tags, namespace, last-run date
- [ ] Editor: extends existing scenario editor (D4) — adds `<Hint>` block, `superScenario` flag, title + tags fields
- [ ] "Run with AI" button — triggers the MCP tool, shows AI interpretation of hints + step results

#### Implementation order

1. Setting key `userScenariosPath` — add to settings schema + dashboard Settings UI
2. MCP `_advisory` mechanism — generic non-blocking advisory field in MCP tool responses
3. Storage layer: `UserScenarioStore` — reads/writes `<userScenariosPath>/**/*.xml`
4. REST endpoints (list, get, save, delete, run)
5. `<Hint>` element support in `xmlScenarioLoader.ts` — parse and pass through; do not break existing runner
6. `list_user_scenarios` + `run_user_scenario` MCP tools (with advisory on missing path)
7. Dashboard "My Super-Scenarios" UI panel (extends existing scenario editor)
8. First-run wizard step: prompt for `userScenariosPath`

**ADR required:** ADR-014 (to be written when implementation begins).

---

### N-1z — Scenario Authoring API & Consolidation Tooling *(2026-04-25)*

> **Problem:** Scenarios (shipped app-template, user-overrides, stubs, super-scenarios) are
> currently authored only by hand-editing XML. There is no MCP-callable authoring surface, no
> way for an AI agent to create or amend them, and no tooling to consolidate all layers into a
> single signed bundle ready for submission.

#### Scope

Three distinct scenario layers need unified authoring support:

| Layer | Storage | Owner |
|---|---|---|
| **Shipped app-template** (`apptemplates/`) | install dir | vendor / internal authoring |
| **User overrides** (`config/templates/`) | `userScenariosPath` or local config dir | end user |
| **Super-scenarios** (`%USERPROFILE%\Documents\AIAPI\user-scenarios\`) | user Documents | end user |

#### MCP Authoring Tools (new)

- [ ] `create_scenario` — create a new `<Scenario>` element in the appropriate layer XML file
- [ ] `update_scenario_step` — add / edit / delete a single `<Step>` within an existing scenario
- [ ] `list_scenario_layers` — enumerate all three layers and their scenarios (id, source, layer)
- [ ] `get_scenario_source` — return raw XML of a named scenario (for inspection / editing by AI)
- [ ] `set_scenario_param` — set or update a `<Param>` declaration on a scenario
- [ ] `annotate_scenario` — add / update `<description lang="en">` or `<Hint>` elements

All authoring tools write to the **user overrides** layer by default (never to the shipped
app-template layer, which is signed). Super-scenario layer is opt-in via `layer:"super"` param.

#### REST Authoring Endpoints (new)

```
GET    /api/scenarios/layers                         — list all layers + file paths
GET    /api/scenarios/{app}/{id}/source              — raw XML of a scenario
PUT    /api/scenarios/{app}/{id}                     — upsert scenario XML (user-override layer)
DELETE /api/scenarios/{app}/{id}                     — remove from user-override layer
POST   /api/scenarios/consolidate                    — merge all layers → single in-memory manifest
GET    /api/scenarios/consolidated                   — current consolidated manifest (JSON)
```

#### Consolidation & Submission Bundle

- [ ] `POST /api/scenarios/consolidate` — reads all three layers, deduplicates (user-override wins
  over shipped; super-scenarios appended), returns a single `consolidated-scenarios.json` manifest
- [ ] Manifest includes: source layer, scenario id, app, steps, params, hints, sha256 per scenario
- [ ] **No signing happens on the MCP server** — the manifest is unsigned JSON
- [ ] Dashboard: **"Submit Bundle"** button (disabled / muted until future infrastructure exists)
  — clicking it will eventually POST the consolidated manifest to a public submission endpoint
  (either a paid SaaS feature or internal authoring pipeline for vendor-authored apps)
- [ ] The button UI should show a clear status: `"Submission not yet available — bundle
  downloaded locally for now"` — triggers a browser download of `consolidated-scenarios.json`

#### Dashboard UI

- [ ] "Scenarios" tab: add **"Authoring"** sub-panel alongside existing scenario list
- [ ] Sub-panel shows three collapsible sections: Shipped / User Overrides / Super-Scenarios
- [ ] Each scenario row: "Edit" (opens XML editor inline) + "Delete" (user-override / super layer only)
- [ ] "New Scenario" button — dropdown to pick target layer
- [ ] "Consolidate & Preview" button — calls `POST /api/scenarios/consolidate`, shows diff view
- [ ] "Submit Bundle" button (disabled with tooltip until submission endpoint is live)

#### Implementation Order

1. REST read endpoints (`layers`, `source`) — no writes, safe baseline
2. `list_scenario_layers` + `get_scenario_source` MCP tools
3. REST write endpoints (`PUT`, `DELETE`) for user-override layer
4. `create_scenario` + `update_scenario_step` MCP tools
5. `POST /api/scenarios/consolidate` + consolidated manifest format
6. Dashboard Authoring sub-panel (read-only first, then write)
7. "Submit Bundle" button (download-only, grayed-out submission path)

**ADR required:** ADR-015 (Scenario Authoring & Consolidation).

---

### App Template Namespacing _(LOW PRIORITY — reverse-domain hierarchy)_

**Proposed layout:**
```
components/helpers/windows/dist-resources/apptemplates/
  com.microsoft/windows.v11/calculator/   tree.xml  scenarios.xml
  com.microsoft/windows.v11/notepad/
components/helpers/shared/dist-resources/apptemplates/
  com.google/chrome/
  com.brave/browser/
config/templates/
  eu.plachy.aiapi/default/notepad/        ← user overrides / additions
```

- [ ] Decide separator: `/` subdirectories (preferred) vs `.` flat folder names
- [ ] Move existing `calculator/`, `notepad/`, `chrome/` under namespace paths
- [ ] Update `XmlScenarioLoader.load(app, scenarioId)` — `app` is slash-path
- [ ] Update REST routing: greedy prefix match up to `/scenarios/` or `/tree`
- [ ] Update `GET /api/appTemplates` to return namespaced ids
- [ ] Update Dashboard "App Templates" card to render namespace hierarchy as a tree
- [ ] Update `tree.xsd` + `scenarios.xsd` `app` attribute to allow slash-separated paths
- [ ] Document resolution order (user namespace beats vendor; OS-specific beats generic)

### Embedding Vectors _(optional)_
- [ ] Define file format: JSON `[{"id":"...", "label":"...", "vec":[...]}]`
  or binary `.bin` (float32 LE, prepended JSON header)
- [ ] CLI: `node tools/embed-tree.js --app calculator --engine openai-ada-002 --out <path>`
- [ ] `POST /api/appTemplates/{app}/tree/search` — top-K controls by embedding similarity
- [ ] Multiple engines coexist in same `embeddings/` folder

---

## N-2 — 🎯 Unified Addressing & Input Model

> Two topics merged: the XPath-style address syntax and the unified input verb set
> are inseparable — the address syntax defines *where* and the input verbs define *what*.

### Unified Action Address Syntax

> ⏰ **PLANNED — NOT YET IMPLEMENTED.** `{CMD:param}` shorthands continue to work as aliases.

**Full format:**
```
//[HelperGlob]//[ProcessFilter]//[TreePath...]//action:[Verb]/[Params...]
```

**Examples:**
```
//[ProcName:calc*.exe]//mainWindow/ButtonPanel//action:click/buttonNumPad7
//[ProcName:notepad.exe]//action:keypress/Ctrl+A
//Browser*.exe//[tab=0]//document//#username//action:fill/value:admin
ALLOW //Keys*.exe//[SHA256:abc&ProcName:calc*.exe]//mainWindow//*//action:click
DENY  //Browser*.exe//[ProcName:brave.exe]//action:exec/*
```

**Address segment reference:**

| Segment | Syntax | Examples |
|---|---|---|
| Helper selector | `//HelperGlob` (first `//` only) | `//Keys*.exe`, `//Browser*.exe` |
| Process filter | `//[key:val & key:val]` | `//[SHA256:abc&ProcName:calc*.exe&ProcPath:C:\Win\*]` |
| Named child | `//name` | `//mainWindow1`, `//ButtonOK` |
| Index child | `//[n]` | `//[0]`, `//[2]` |
| By attribute | `//[attr=val]` | `//[id=btn-ok]`, `//[class=submitBtn]` |
| Wildcard (one level) | `//*` | any single node |
| Deep wildcard | `//**` | any subtree depth |
| XPath predicate | `//name(xpath:expr)` | `//li(xpath:last())` |
| Browser tab/frame | `//[tab=n]`, `//[frame=name]` | `//[tab=0]//document` |
| Action | `//action:[Verb]/[Params]` | `//action:click`, `//action:fill/value:x` |

**Process filter keys:** `ProcName`, `ProcPath`, `SHA256`, `SHA512`, `PID`, `HWND`, `WindowTitle`

**Action verbs:** `click`, `rightclick`, `dblclick`, `hover`, `keypress`, `keydown`, `keyup`,
`read`, `fill`, `exec`, `scroll`, `check`, `uncheck`

### N-2i — UiBackendDetector + ActionDispatcher ⚡ _do first — prerequisite for address parser_

> **Why first:** The address parser (N-2 proper) produces an `ActionStep` with a verb and
> parameters. The `ActionDispatcher` is what executes it. Without a clean strategy table the
> parser output has nowhere to land. Implementing the dispatcher before the parser also removes
> all the ad-hoc if/else chains currently scattered through `KeyWin.cs`.
>
> **Spec:** [`docs/architecture/PLATFORM_UI_COVERAGE.md § Part 3`](docs/architecture/PLATFORM_UI_COVERAGE.md)

**`UiBackendDetector` — capability probe (Windows, ~6 ms per new HWND, cached):**
- [ ] Define `BackendCapabilities` struct: `HasUIA`, `HasValuePattern`, `HasTextPattern`,
  `HasRichEditHwnd`, `HasMenuBar`, `IsXamlIsland`, `AcceptsSendInput`, `PlatformTag`
- [ ] `UiBackendDetector.Detect(hwnd)` — run probes, cache by `hwnd` (evict on `WM_DESTROY`)
- [ ] Expose `PlatformTag` enum: `Win32`, `WPF`, `WinUI3`, `Electron`, `Unknown`

**`ActionDispatcher` — strategy table:**
- [ ] `Dispatch(BackendCapabilities caps, string verb, string parameter)` replaces the
  if/else chains in `SendKeysForWindow`, `ReadWindow`, `ClickWindow`
- [ ] Strategy order per verb encoded as ordered list, not nested if/else
- [ ] Each strategy returns `DispatchResult { Success, Retryable, ErrorMessage }`
- [ ] On `Retryable=true`, dispatcher tries next strategy automatically

**Cross-platform contract (same interface, different probe implementations):**
- [ ] `IUiBackend` interface (C# / language-specific equivalent per platform)
  — same capability flags, same `Dispatch` signature
- [ ] Windows: `WinUiBackend` (current KeyWin logic, refactored)
- [ ] Linux: `AtSpi2Backend` (future KeyLin) — `HasValuePattern` maps to AT-SPI2 `Value`
  interface; `HasTextPattern` maps to AT-SPI2 `Text`; `HasMenuBar` maps to `MenuBar` role;
  `AcceptsSendInput` maps to availability of `XSendEvent` / `ydotool`
- [ ] macOS: `AxApiBackend` (future KeyMac) — `HasValuePattern` maps to `kAXValueAttribute`
  settable; `HasTextPattern` maps to `kAXSelectedTextRangeAttribute`; `AcceptsSendInput`
  maps to `CGEventPost` accessibility permission granted

**Implementation tasks:**
- [ ] Formal ABNF grammar in `docs/specs/ACTION_ADDRESS.md`
- [ ] `ParseAddress(string addr)` → `AddressNode[]` in `HelperCommon.cs`
- [ ] Map node types: `HelperSelector`, `ProcessFilter`, `TreeStep`, `ActionStep`
- [ ] `KeyWin.cs`: accept full address strings (not only bare `{CMD:param}` tokens)
- [ ] `BrowserWin.cs`: map tree path segments to CSS selector / CDP node ID;
  handle `(xpath:...)` via `DOM.performSearch`
- [ ] Add `"addressGrammar"` array to each helper's `_schema` output
- [ ] `HelperRegistry.ts`: expose merged grammar via `getHelperSchema` MCP tool response
- [ ] Security filter engine: migrate storage format; implement `MatchAddress(rule, addr)`
- [ ] Dashboard filter editor: replace freetext pattern with structured address-builder

### Unified Input Verb Model (remaining items)

> **All 12 listed commands already implemented in KeyWin.exe and BrowserWin.exe.**
> The remaining items are delivery-mode variations and schema confirmation.

- [ ] **`{CLICK:x,y}` / `{CLICK:elementPath}`** — standardise format across both helpers
- [ ] **`{KEYPRESS:key}` delivery modes:**
  - `global` — `SendInput` to focused window
  - `direct` — `PostMessage(WM_KEYDOWN/WM_CHAR)` to specific HWND / JS `dispatchEvent`
    (specify element: `{KEYPRESS:Enter::#submitBtn}`)
- [ ] **Mouse delivery modes:**
  - `sendinput` — `SendInput(INPUT_MOUSE)` global queue
  - `message` — `PostMessage(WM_LBUTTONDOWN/WM_LBUTTONUP)` direct to HWND
  - `js` (browser only) — `element.dispatchEvent(new MouseEvent('click'))`

### Unified Tree Node Schema (finalise)
Every QUERYTREE response from every helper must produce:
```json
{
  "id": "...",  "handle": "0x1A2B",  "path": "//win/...",
  "type": "Button",  "tag": "BUTTON",  "name": "OK",  "value": "...",
  "attributes": {},
  "position": { "x": 0, "y": 0, "width": 100, "height": 30 },
  "zOrder": 0,  "tabOrder": 0,
  "events": ["click","change","focus"],
  "actions": ["click","setValue","readValue"],
  "children": []
}
```
- [ ] Audit `KeyWin.cs` QUERYTREE output — add any missing fields
- [ ] Audit `BrowserWin.cs` QUERYTREE output — add any missing fields
- [ ] Update schema validation test in `test-full-stack-stdin.js`

---

## N-3 — 🖥️ Browser Automation — Remaining & Cross-Platform DOM

**Goal:** Close remaining BrowserWin gaps; implement CDP-less accessibility fallbacks.

### Remaining BrowserWin.exe Items
- [ ] Alert/popup handling — needs WebSocket CDP event loop
- [ ] Session token authentication (currently guarded by `SKIP_SESSION_AUTH`)
- [ ] Internet Explorer: dead; document as Win32/MSAA via `KeyWin.exe` only

### Cross-Platform Browser DOM (CDP-less fallbacks)

#### Chromium WM_GETOBJECT nudge (no debug flags)
- [ ] Find `Chrome_RenderWidgetHostHWND` child of browser window
- [ ] Send `WM_GETOBJECT(OBJID_CLIENT)` — triggers Chromium accessibility tree
- [ ] Re-query UIA tree after 500ms; flag `"mode":"uia_nudge"` in output

#### Firefox ISimpleDOMNode COM traversal (no flags)
- [ ] `AccessibleObjectFromWindow(renderHwnd, OBJID_CLIENT)` → `IAccessible`
- [ ] `QueryInterface(IID_ISimpleDOMNode)` → walk with `get_nodeInfo()`, `get_attributes()`
- [ ] Build same `{id,type,name,...}` JSON as UIA/CDP; flag `"mode":"ia2"`
- [ ] Use `get_attributes()` to resolve `for=` label→input associations

#### Browser path discovery (Linux / macOS targets)
- [ ] Linux: `/usr/bin/`, `/usr/local/bin/`, `~/.local/share/`
- [ ] macOS: `/Applications/`, `~/Applications/`

---

## N-4 — 🔧 Runtime & Daemon Lifecycle

### Runtime Directory Migration (R1)
> Detailed spec in N-1. Prerequisite: ADR-007 setup wizard steps S4 + S5.

- [ ] Migrate `config/` → `runtime/config/`, `security/` → `runtime/keys/`
- [ ] Add `runtime/` to `.gitignore`; add `test/dev-runtime/` tracked stub

### Daemon Lifecycle (completed) + Minor Guard
- [x] `_ping` / `_schema` / `_exit` built-ins ✅
- [x] `POST /api/helpers/reload` endpoint; dashboard "Reload Helpers" button ✅
- [x] `--self-hosted` / `--rebuild-first` flags; `reloadHelpers()` test helper ✅
- [x] Test-session recording: start/finish/JSONL log; auto-screenshot on failure ✅
- [ ] **Guard:** `--token=` / `--secret=` CLI args — do NOT add them;
  credential passage is always via `_auth` message (in-pipe auth only)

### Documentation
- [ ] `docs/api/BROWSER_API.md` — BrowserWin command reference
- [ ] Update `docs/api/API.md` with all new MCP tools added since last update
- [ ] Add cross-platform usage examples to `docs/guides/QUICK_REF.md`

---

## N-5 — 🍪 Web Fetch — Cookie Consent & Auth Walls

**Goal:** Navigate sites gating content behind cookie consent dialogs or login walls.

### Cookie Consent / GDPR Popup Detection
- [ ] Detect common frameworks in fetched HTML:
  - Google Consent Mode (`consent.google.com`, `fc=allyesundefined`)
  - CookieBot (`data-cookieconsent` attributes)
  - OneTrust (`OptanonConsent` cookie / `onetrust` CSS classes)
  - TrustArc (`truste.com` iframes)
  - Generic: any `<div>` matching `cookie|consent|gdpr|banner` id/class
- [ ] Add `consentWall?: ConsentWallInfo` to `WebFetchResult`
- [ ] Auto-accept strategy (opt-in, disabled by default):
  - `WebFetchOptions.consentHandling: 'none' | 'auto-accept' | 'report'`
- [ ] Cookie jar: store `Set-Cookie` across redirect hops; respect `Secure`, `HttpOnly`, `SameSite`
- [ ] `WebFetchOptions.cookies?: Record<string, string>` for manual injection
- [ ] Handle Google `302 → consent.google.com/ml?continue=…` — extract and offer direct URL

### Session / State Management
- [ ] `WebFetchOptions.sessionId?` — persist cookie jar across `fetchWebpage` calls
- [ ] `clearSession(sessionId)` for AI-managed session reset
- [ ] `WebFetchOptions.method?: 'GET' | 'POST'`; `WebFetchOptions.body?`
  (needed for login form submission via `detectLoginForm()`)


---

## N-6 — 🤖 Supervised Scenario Mode (AI agent UX) *(2026-04-25)*

> **Trigger:** D6 walkthrough exposed a genuine agent UX gap: scenarios are cheap (one HTTP
> call, one context payload) but all-or-nothing — a failure at step 17 of 20 loses all live
> process state (`hwnd`, open windows) and forces a full restart from step 1 including
> re-launch, wait times, and all side-effects. That is expensive in wall-clock time and
> side-effects, not just in tokens.
>
> **Corrected framing:** The value is **preserving live process state across an assertion
> failure**, not minimising HTTP round-trips per se. Token savings are a side-effect on
> the happy path, situational on the failure path.
>
> **Design principle:** One existing endpoint, two optional new parameters. No new URL.
> Inline body and registered-by-id are two parse paths into the same `executeXmlScenario()`
> executor. Session store is opt-in, timeout-bounded, with explicit cleanup metadata.
>
> **ADR required:** ADR-013 (to be written).

### N-6.1 — Extended run endpoint (single endpoint, two new optional params)

The **existing** `POST /api/appTemplates/{app}/scenarios/{scenarioId}/run` gains two optional
body fields:

```json
{
  "params": { "content": "Hello" },

  "scenario": {
    "steps": [
      { "action": "LAUNCH",   "proc": "notepad.exe" },
      { "action": "WAIT",     "value": "3000" },
      { "action": "SENDKEYS", "proc": "SYSTEM", "value": "{{content}}" },
      { "action": "ASSERT",   "proc": "SYSTEM", "path": "", "value": "{{content}}", "op": "contains" }
    ]
  },

  "supervised": true
}
```

Resolution rules (in order):

| `scenario` body | `scenarioId` in URL | Behaviour |
|---|---|---|
| absent | registered id | today's behaviour — look up XML on disk |
| present | any label | use inline body; `scenarioId` is a client-supplied label only |
| present | with `ScenarioRef` steps | inline body may reference registered scenarios by id — steps are expanded as today |

- `scenario` is **transient** — never stored, never written to disk.
- Step schema is identical to `<step>` in scenarios.xml (same field names, same actions).
- `supervised: false` (default) = existing fire-and-forget behaviour, result returned synchronously.
- `supervised: true` = supervised mode — see N-6.2.

### N-6.2 — Supervised mode: pause-on-fail with session state

When `supervised: true` and an `ASSERT` or `ASSERTPATHEVAL` step fails:

- Execution **pauses** (does not abort, does not undo previous steps; launched processes stay alive).
- Server holds in-memory session state: full step list, current step index, all bound vars.
- Returns **HTTP 202**:

```json
{
  "sessionId": "ssn_a3f7c9",
  "status": "paused",
  "pausedAtStep": 4,
  "failedStep": {
    "action": "ASSERT",
    "error": "expected contains 'Hello', got 'Hello WrongOverwrite'"
  },
  "vars": { "hwnd": "HANDLE:2559024", "readVal": "Hello WrongOverwrite" },
  "stepsRemaining": 3,
  "expiresIn": 300
}
```

- `vars` contains the full live binding — agent uses `hwnd` etc. directly in atomic calls.
- `expiresIn` (seconds): session auto-abandons on timeout; cleanup kills processes launched by
  `effect="launches-app"` steps. Default: 300 s, configurable per-call via `"sessionTimeout"`.
- On **success** (`supervised: true`, no failures): returns HTTP 200 with normal result — no sessionId issued.

### N-6.3 — Atomic intervention while paused

Regular atomic endpoints work unchanged — no session scoping required:

```
POST /api/apps/d6/execute  { "command": "READ",     "target": "HANDLE:2559024", "parameter": "" }
POST /api/apps/d6/execute  { "command": "SENDKEYS", "target": "HANDLE:2559024", "value": "{CTRL+Z}" }
```

The agent correlates its atomic calls to the paused session via the `vars` it received in the 202.
No special session header or query param is needed — these remain fully stateless.

### N-6.4 — Resume

```
POST /api/scenarios/sessions/{sessionId}/resume
{
  "vars":     { "readVal": "Hello" },   // optional: inject/override vars before continuing
  "fromStep": 4                         // optional: re-run from step N (default: paused step)
                                        // fromStep: 0 = restart whole scenario with new vars
}
```

- Returns HTTP 200 (normal result) on completion, or another HTTP 202 if it pauses again.
- `vars` overrides are merged into session state before execution resumes.
- `fromStep` can go backwards (retry a step) or forwards (skip a step).

### N-6.5 — Session management

```
GET    /api/scenarios/sessions/{sessionId}   — inspect current state, vars, step index
DELETE /api/scenarios/sessions/{sessionId}   — abandon session + trigger cleanup
GET    /api/scenarios/sessions               — list active sessions (admin only)
```

### N-6.6 — Implementation notes

- Session store: in-memory `Map<sessionId, SessionState>`. No persistence.
- `SessionState`: `{ scenarioId, steps, currentStep, vars, effectTags, timer, createdAt }`.
- `effectTags`: collected from all steps that ran (e.g. `launches-app`) — drives cleanup.
- Cleanup on timeout or DELETE: for each `launches-app` step, call `KILL` on its `proc`.
- `sessionId`: `ssn_` + 6 random hex chars. Local scope only — no crypto strength needed.
- Inline step body is parsed into the same internal step object shape as XML — same executor.
- MCP tool surface: `run_scenario_supervised` wraps the run endpoint; `resume_scenario` wraps
  the resume endpoint. Both are single structured tool calls for MCP clients.

---

## U-TREEDIFF — 🌲 Tree Snapshot Registers + TREEDIFF command *(2026-04-28)*

> Specification: CONVENTIONS.md §10 and API.md §AI Agent Operating Protocol.

Enables the mandatory AI agent loop (CONVENTIONS.md §9.3.3): named `QUERYTREE` results are
stored server-side and diffed without re-transmitting full trees over MCP.

### U-TREEDIFF.1 — Register store in ScenarioRunner
- [ ] Add `treeRegisters: Map<string, any>` to `ScenarioRunner` session state
- [ ] When a `QUERYTREE` step completes with `bind=`, store result in `treeRegisters[bindName]`
      in addition to the normal variable map
- [ ] Sliding window: evict oldest when store exceeds 8 entries; reset on scenario run start

### U-TREEDIFF.2 — TREEDIFF synthetic command
- [ ] Recognise `action="TREEDIFF"` in step dispatch (`xmlScenarioLoader.ts`)
- [ ] Read `bind_a=` and `bind_b=` from `treeRegisters`; error if either missing
- [ ] Compute structural JSON diff: `added`, `removed`, `changed` arrays (by node path)
- [ ] Store result in variable named by `bind=`; apply `op=` filter (`added`/`removed`/`changed`/`all`)
- [ ] Wire protocol: `{ "action": "TREEDIFF", "bind_a": "…", "bind_b": "…", "bind": "…", "op": "all" }`

### U-TREEDIFF.3 — Tests
- [ ] Unit: register store eviction (8-slot window)
- [ ] Unit: TREEDIFF with known before/after trees → expected diff shape
- [ ] Integration: QUERYTREE + action + QUERYTREE + TREEDIFF asserts diff in scenario result

---

## U-COND — 🔀 Conditional Scenario Blocks *(2026-04-28)*

> Specification: CONVENTIONS.md §11 and API.md §AI Agent Operating Protocol.

Machine-readable handling of non-deterministic dialogs via `<ConditionalRef>` XML element
and full expression support for the `conditional=` Step attribute.

### U-COND.1 — `conditional=` expression evaluation on `<Step>`
- [ ] Define expression grammar: literal `true`/`false`; `{{varName}}`; `{{varName | hasType:'dialog'}}`
- [ ] Implement `evaluateCondition(expr, vars): boolean` in
      `components/server/src/scenario/conditionEval.ts`
- [ ] Support filter helpers: `hasType`, `hasTitle`, `hasClass`
- [ ] Pipe `evaluateCondition` into step execution for every step with non-empty `conditional=`

### U-COND.2 — `<ConditionalRef>` XML element
- [ ] Parse `<ConditionalRef ref="…" when="…" app="…" note="…"/>` in `xmlScenarioLoader.ts`
- [ ] At run time evaluate `when` via `evaluateCondition`; if falsy, skip entire inlined subscenario
- [ ] `entryCondition=` attribute on `<Scenario>`: parse + store as documentation; does not gate execution

### U-COND.3 — Update pgadmin/scenarios.xml with canonical example
- [ ] Add `entryCondition=` to `dismiss-save-password` scenario
- [ ] Add `<ConditionalRef ref="dismiss-save-password" when="{{tree_diff.added | hasTitle:'Uložit heslo?'}}"/>`
      to the `full-verify` scenario chain

### U-COND.4 — Tests
- [ ] Unit: `evaluateCondition` — literal, variable, JSONPath filter, unknown variable (falsy)
- [ ] Unit: `xmlScenarioLoader` parses `<ConditionalRef>` without error
- [ ] Integration: condition false → subscenario steps absent from result
- [ ] Integration: condition true → subscenario steps present in result

---

# PART IV — FUTURE

---

## F-1 — 🔧📄 MS Office Automation

> ⏰ **Pre-requisite:** Microsoft Office must be installed before `OfficeWin.exe` can be
> built or tested (COM Interop assemblies only present when Office is installed).

### OfficeWin.exe Helper
- [ ] Create `components/helpers/windows/src/OfficeWin.cs`
- [ ] Follow HelperCommon patterns: `--listen-stdin --persistent`, `--api-schema`,
  `DispatchCommand()`, `GetSchema()`; add `HelperCommon.cs` to compile line
- [ ] **Word:** open/create; query structure (paragraphs, tables, headings);
  insert/modify/format text; table manipulation; find/replace; save as docx/pdf
- [ ] **Excel:** open/create; read/write cells; apply formulas; format cells;
  charts; named ranges
- [ ] **PowerPoint:** open/create; query slides; add/modify text and shapes; themes/layouts
- [ ] Update `src/providers/officeProvider.ts` to use `OfficeWin.exe`
- [ ] App templates:
  - `components/helpers/windows/dist-resources/apptemplates/msword/tree.xml` + `scenarios.xml`
  - `msexcel/` and `mspowerpoint/` equivalents
- [ ] Integration tests: `tests/integration/test-office-scenarios.js`

---

## F-2 — 🚀 Deployment & Packaging

> Trigger: after core feature parity stable on Windows (all current Part I–III items done).

### Windows: Standalone Console App
- [x] `pkg` to bundle `dist/start-mcp-server.js` + `node_modules` + dashboard assets ✅
- [x] Auto-detect `dist/helpers/` helpers relative to bundle (pkg path detection) ✅
- [x] CI artifact: `dist/release/aiapi-server.exe` (~59MB) ✅

### Windows: Windows Service ✅
- [x] WinSW-based service (`build/service/install-service.ps1`) ✅:
  ```powershell
  # Located at: C:\Program Files\AIAPI\
  # Service: AIAPIService (AI UI Automation API)
  # Ports: 4457 (MCP), 4458 (Dashboard)
  ```
- [x] Interactive process launch via Task Scheduler (Session 0 → User Session) ✅
- [x] Non-interactive mode support (`AIAPI_NON_INTERACTIVE=1`) ✅
- [x] Automated update workflow (`build/service/update-service.ps1`) ✅
- [x] All 17 tools operational (13 core + 4 helpers) ✅
- [x] Windows Event Log integration (via SecurityLib.LogEvent() infrastructure) ⚪
- [ ] Installer + Uninstaller PowerShell scripts (scripts exist, MSI packaging pending)

### Windows: System-Tray GUI App
- [ ] `tools/tray/TrayApp.cs` with `NotifyIcon` + `ContextMenuStrip`
- [ ] Start / Stop / Restart / Open Dashboard / View Logs / Exit
- [ ] Icon states: grey (stopped) → green (running) → red (error)

### Windows Installer (MSI / NSIS)
- [ ] NSIS or WiX script; bundles: `aiapi-server.exe`, `KeyWin.exe`, `BrowserWin.exe`,
  dashboard assets, `components/helpers/*/dist-resources/apptemplates/`
- [ ] Install to `C:\Program Files\AIAPI\`; Start Menu shortcut
- [ ] Optional: install as Windows Service; add firewall rule for ports 3457/3458
- [ ] Uninstaller: removes service, firewall rule, files (option to keep config + scenarios)
- [ ] First-run setup wizard: generate key files, sign `config.json`, create admin user
- [ ] Version injected from `package.json`
- [ ] CI artifact: `dist/release/aiapi-setup-<version>-win-x64.exe`

### Linux: systemd Daemon _(build on Linux machine)_
- [ ] `scripts/linux/aiapi.service` unit file
- [ ] Linux helpers: `KeyLin` (AT-SPI2 / xdotool) + `BrowserLin` (CDP, same as Windows)
- [ ] `scripts/linux/install.sh`; CI: GitHub Actions `build-linux` job on `ubuntu-latest`

### macOS: launchd Plist _(build on macOS machine)_
- [ ] `scripts/macos/com.rheingold.aiapi.plist` LaunchAgent
- [ ] macOS helpers: `KeyMac` (AX API) + `BrowserMac` (CDP)
- [ ] Code-signing + notarisation for Gatekeeper

### Linux: GUI Tray App (GTK3 / AppIndicator) _(LOW PRIORITY)_
- [ ] `tools/tray/TrayAppLin.c` using `libappindicator3`
- [ ] Autostart via `~/.config/autostart/aiapi-tray.desktop`

### Windows: Explorer Shell Extension _(LOW PRIORITY)_
- [ ] COM in-process extension `tools/shellext/AiapiShellExt.cs`
- [ ] Right-click → "Automate with AIAPI" sub-menu: Open Dashboard, Run scenario…

---

## F-3 — 🌍 Platform Portability

> Separate build machines required. All fallbacks produce the same unified tree node
> schema and input verbs defined in N-2.
>
> **Reference:** [`docs/architecture/PLATFORM_UI_COVERAGE.md`](docs/architecture/PLATFORM_UI_COVERAGE.md)
> — taxonomy of every UI technology per platform, current KeyWin.exe coverage status,
> and the proposed `UiBackendDetector` + `ActionDispatcher` unified input strategy layer.

### Windows Backwards Compatibility — Fallback Chain
```
Win10/11:  CDP  →  UIA  →  MSAA IAccessible
Win7/8:    CDP  →  UIA  →  MSAA  →  IHTMLDocument2 (IE ActiveX)
WinVista:  UIA  →  MSAA  →  IHTMLDocument2
WinXP:     MSAA  →  IHTMLDocument2 (IE6/7)  →  WM_GETTEXT + EnumChildWindows
Win2000:   MSAA (partial)  →  IHTMLDocument2 (IE5)  →  WM_GETTEXT
Win98/95:  IHTMLDocument2 (IE4+)  →  WM_GETTEXT  →  GetDlgItemText
Win3.1:    WM_GETTEXT  →  GetDlgItemText  →  nothing
```
- [ ] Runtime API detection: probe `UIAutomationCore.dll` before using UIA
- [ ] `IHTMLDocument2` fallback (Win95+, IE4+): in-process DOM for hosted WebBrowser controls
- [ ] MSAA `IAccessible` fallback (Win95 + MSAA SDK)
- [ ] `WM_GETTEXT` / `EnumChildWindows` (Win3.1+, classic Win32 controls only)

### Linux — AT-SPI2 + XDoTool _(FUTURE)_
```
Modern (2015+):    CDP  →  AT-SPI2 (D-Bus)  →  XDoTool + XQueryTree
Older (2005-2015): AT-SPI2  →  XDoTool  →  XQueryTree + XGetWindowProperty
Classic (1990-2005): XQueryTree + XSendEvent  →  XGetWindowProperty
```
- [ ] AT-SPI2 D-Bus tree walker: `org.a11y.atspi.Accessible` C binding
  (Python ref: `pyatspi`; Firefox exposes full ARIA→AT-SPI2 bridge)
- [ ] XDoTool-equivalent: `XSendEvent(display, window, KeyPress/ButtonPress)`
- [ ] WebKitGTK `webkit_web_view_evaluate_javascript` for in-process browser

### macOS — AX API + AppleScript _(FUTURE)_
```
Modern (2015+):    CDP  →  AX API (AXUIElement)  →  AppleScript
Older (2005-2015): AX API  →  AppleScript  →  CGEventPost
```
- [ ] AX API walker: `AXUIElementCreateSystemWide()` → `kAXChildrenAttribute`
- [ ] AppleScript `do JavaScript` (Safari + macOS 10.0+): zero flags, full JS eval
  ```applescript
  tell application "Safari"
    do JavaScript "document.getElementById('x').value" in current tab of front window
  end tell
  ```
- [ ] `CGEventPost`: `CGEventCreateKeyboardEvent` / `CGEventCreateMouseEvent`
  (Accessibility permission required on macOS 10.15+)


---

## ADM — 📝 Admin / Legal

> **Requires owner input before acting.**

- [ ] **LICENSE.md / LICENSE** — choose and add a licence file for the repository.
  Options include MIT, Apache-2.0, BSL-1.1, proprietary EULA, etc.  
  Considerations: commercial use of vendored C# helper binaries, security library (MinGW), any future marketplace listing on VS Code Marketplace (which requires a licence).  
  _Waiting for owner decision on licence type._

---

# ICEBOX — Deferred ideas, not yet decided

> Items here have been discussed and deliberately set aside. Not rejected — just not now.
> Each entry records **what** was proposed, **why** it was deferred, and **what would need to be true** to thaw it.

## ICE-001 — `<ScenarioMethod>` tag as a grammar-level distinction for parameterized atoms

**Proposed:** Add a second XML tag name `<ScenarioMethod>` (interchangeable with `<Scenario>` at the parser level, purely a syntax signal) to distinguish parameterized building-block scenarios (atoms / "methods") from concrete directly-runnable scenarios.

```xml
<!-- atom — must be called via <ScenarioRef params=...> -->
<ScenarioMethod id="diag-exec" effect="diagnostic">
  <Parameters><Param name="jsCode" required="true"/></Parameters>
  ...
</ScenarioMethod>

<!-- concrete — directly runnable, no required params -->
<Scenario id="se1-list-apps" effect="changes-view">
  ...
</Scenario>
```

**Why deferred:**
- Migration cost: every existing `d*/scenarios.xml` file needs touching
- Parser needs to handle two tag names for the same underlying construct
- The distinction is already structurally encoded: `<Param required="true">` = atom; steps-only-ScenarioRef = suite; everything else = concrete — a linter can enforce this without a grammar change (Option C chosen for now)

**What would thaw it:**
- If the linter (Option C) proves insufficient in practice — i.e. newcomers repeatedly misread atoms as runnable scenarios despite documentation
- Or if a formal XML schema / IDE plugin is built that benefits from tag-level discrimination
- Or if `<ScenarioMethod>` would map cleanly to a generated client API (e.g. TypeScript method signatures auto-generated from the XML)

**Related:** G-D.9 (diag-exec cleanup), ADR-008, ADR-010

---

# APPENDIX — COMPLETED MILESTONES

> These chapters are closed. Details live in git history and the referenced source files.
> The ✅ items throughout Parts I–IV track incremental completions within each active chapter.

| Milestone | Key files / commits | Notes |
|---|---|---|
| **KeyWin.exe core** | `components/helpers/windows/src/KeyWin.cs` | QUERYTREE, READ, LISTWINDOWS, CLICK*, SET, SENDKEYS, LAUNCH, KILL, NEWDOC, ~~RESET~~ (retired ADR-009); KEYDOWN/UP/PRESS, RIGHTCLICK, DBLCLICK, HOVER, MOUSEDOWN/UP, FILL, READELEM, CHECK, UNCHECK |
| **BrowserWin.exe core** | `components/helpers/shared/src/BrowserWin.cs` | CDP WebSocket (pure .NET 4.5, no NuGet); UIA fallback; LAUNCH, QUERYTREE, CLICK*, FILL, COOKIES, SCREENSHOT, PAGESOURCE, NEWPAGE; all 4 browsers |
| **HelperCommon.cs** | `components/helpers/shared/src/HelperCommon.cs` | RunStdinListener (one-shot + persistent), RunHttpListener, RunNamedPipeListener, AuthState, IdInjectingWriter, HcJson, ParseArgs |
| **Unified Helper Communication** | `src/helpers/HelperRegistry.ts` | --listen-stdin (Step 1), persistent daemon + HelperDaemon class (Step 2), named-pipe (Step 3); _ping / _schema / _exit built-ins; auto-restart on crash |
| **Dynamic Helper API Discovery** | `src/helpers/HelperRegistry.ts` | --api-schema scan on startup; MCP tools `listHelpers`, `getHelperSchema`; enable/disable toggle; schema-command autocomplete in filter wizard |
| **Command Alignment Audit** | `docs/api/KEYWIN_API.md` | Uniform `{target,command,parameter}` wire shape; `id` correlation via IdInjectingWriter; schema completeness verified for all 11 KeyWin + 16 BrowserWin commands |
| **Test-Session Recording** | `src/helpers/HelperRegistry.ts` | start/finish/JSONL log; auto-screenshot on BrowserWin failure; `/api/session/*` REST + MCP endpoints |
| **Test infra (self-hosted)** | `tests/integration/test-full-stack-stdin.js` | --self-hosted, --rebuild-first, reloadHelpers(), testSession helpers; 122 tests passing |
| **Security Filter System** | `src/utils/filterEval.ts`, `src/server/securityFilter.ts` | DENY-wins evaluation; admin bypass; wildcard + /regex/ patterns; wizard + Quick-Edit UI; binary-hash + process-path criteria; 73 unit tests |
| **Session Token Auth** | `src/security/SessionTokenManager.ts` | 16 unit tests; admin token generate/validate; 15-min expiry; audit logging |
| **VS Code Extension scaffold** | `src/extension.ts`, `package.json` | Extension activates; MCP@IPC commands (`extension.mcp.callTool`, `extension.mcp.listTools`) registered and working; `"engines":{"vscode":"^1.75.0"}` + `contributes` defined. **`activate()` rewrite pending** — currently starts stale `AutomationEngine`+`HttpServer`; N-0.1 tracks the fix. |
| **App Knowledge Base (core)** | `components/helpers/*/dist-resources/apptemplates/` | `tree.xsd`, `scenarios.xsd` defined; calculator, notepad, chrome templates authored; ScenarioRef recursion; XmlScenarioLoader + 27 tests; `executeScenario` MCP tool; REST endpoints; dashboard App Templates card; metadata panel; scenario↔filter sidebar |
| **Project Folder Reconciliation** | commits `cb37bd0`, `be66ceb`, `63624e2` | `components/tools/` → `components/helpers/`; apptemplates split to shared/windows; multi-root `resolveAppTemplateRoots()`; CONVENTIONS.md, CODEBASE_MAP.md updated; legacy JSON scenarios removed |
| **MCP Server Integration Tests** | `src/server/mcpServer.integration.test.ts` | 39 tests: HTTP transport, JSON-RPC compliance, MCP core, tools/call, admin token API, security filter wire |
| **MCP Server Performance Tests** | `src/server/mcpServer.perf.test.ts` | 7 tests: p95<200ms serial; 0 errors at 20/50/100 concurrent; memory growth <20MB |
| **Scenario Editor** | `static/dashboard.js` | tabular step editor; ↑↓ reorder; 🔀 duplicate; undo/redo with history stack; metadata panel; auto-refresh on save; filter sync sidebar |

