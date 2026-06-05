# ADR-017 — MCP Tool Hierarchy

**Date:** 2026-05-21  
**Status:** Accepted  
**Deciders:** ARCH  
**Supersedes:** none (DEBT-1 partial; this is the full ruling)

---

## Context

### Current State (Flat — confirmed by code audit)

`handleToolsList()` in [`components/server/src/server/mcpServer.ts`](components/server/src/server/mcpServer.ts:546) registers the following tools at the **MCP root** (flat list, no grouping):

| # | Tool name | Actual owner |
|---|-----------|-------------|
| 1 | `queryTree` | Legacy AutomationEngine (NOT KeyWin) |
| 2 | `clickElement` | Legacy AutomationEngine |
| 3 | `setProperty` | Legacy AutomationEngine |
| 4 | `readProperty` | Legacy AutomationEngine |
| 5 | `getProviders` | Legacy AutomationEngine |
| 6 | `listWindows` | Legacy AutomationEngine (calls `KeyWin.exe` indirectly) |
| 7 | `launchProcess` | Legacy AutomationEngine |
| 8 | `terminateProcess` | Legacy AutomationEngine |
| 9 | `executeScenario` | Server (XML runner) |
| 10 | `AutomateUI` | Router (all helpers) |
| 11 | `BrowserWin` | BrowserWin.exe (dynamic, from helperRegistry) |
| 12 | `KeyWin` | KeyWin.exe (dynamic, from helperRegistry) |
| 13 | `MSOfficeWin` | MSOfficeWin.exe (dynamic) |
| 14 | `LibreOfficeWin` | LibreOfficeWin.exe (dynamic) |
| 15 | `listHelpers` | Server meta |
| 16 | `getHelperSchema` | Server meta |
| 17 | `fetch_webpage` | NativeWin (server-side JS) |
| 18 | `exec_cmd` | NativeWin (server-side JS) |
| 19 | `fs_read` | NativeWin (server-side JS) |
| 20 | `fs_write` | NativeWin (server-side JS) |
| 21 | `fs_list` | NativeWin (server-side JS) |

**Total: 21 root-level tools** — far too token-heavy for LLM context budgets.

### Architecture document intent

[`CONVENTIONS.md §1`](CONVENTIONS.md) designates the canonical helper ownership:

| Helper | Commands |
|--------|----------|
| KeyWin | `QUERYTREE`, `LISTWINDOWS`, `LAUNCH`, `KILL`, `SENDKEYS`, `CLICKID`, `READ`, `SCREENSHOT`, `KEYDOWN/UP`, `RIGHTCLICK`, `DBLCLICK`, `HOVER` |
| BrowserWin | `QUERYTREE`, `LISTWINDOWS`, `NAVIGATE`, `FILL`, `READELEM`, `PAGESOURCE`, `SCREENSHOT`, `COOKIES`, `DIALOG`, `SENDKEYS`, `CLICKID` |
| NativeWin | `EXEC_CMD`, `FS_READ`, `FS_WRITE`, `FS_LIST`, `fetch_webpage` |

Tools `queryTree`, `clickElement`, `setProperty`, `readProperty`, `getProviders`, `listWindows`, `launchProcess`, `terminateProcess` are **legacy AutomationEngine stubs** that predate the helper architecture. They bypass the helper registry and call the engine's own provider system — which uses mock data for most cases. They do NOT go through `KeyWin.exe`.

### The Two Options

**Option A — Keep flat (status quo):**  
All 21 tools remain at MCP root. Simple to call, but AI agents consume the entire schema on every context window, wasting ~3,000–5,000 tokens.

**Option B — Hierarchical (two-step discovery):**  
Root exposes only: `listHelpers`, `getHelperSchema`, `AutomateUI`, `executeScenario`.  
Individual helper tools are discoverable via `getHelperSchema`. AI first calls `listHelpers`, then `getHelperSchema(helper)` to learn commands, then `AutomateUI` to invoke.

---

## Decision: **Option B (Hierarchical) — with compatibility shim period**

### Rationale

1. **Token budget is a hard constraint.** With 21 tools × avg 200 tokens each = 4,200 root tokens consumed every context. CONVENTIONS.md §11 already established the 24,000-char truncation budget. Root-level tool list consumes ~18% of that budget before any content.

2. **The legacy tools are WRONG abstractions.** `listWindows` at root calls the legacy `AutomationEngine.listWindows()` — NOT `KeyWin.exe LISTWINDOWS`. This is architecturally deceptive. An AI agent calling `listWindows` expects the real KeyWin result; it gets a mock/fallback.

3. **`AutomateUI` already provides the router.** The two-step pattern (`listHelpers` → `getHelperSchema` → `AutomateUI`) is already fully supported and documented. The flat tools are redundant.

4. **Direct helper tools (`BrowserWin`, `KeyWin`, etc.) remain as performance shortcuts** for callers that already know the helper API — they do NOT need to be removed from root.

### Chosen Architecture

```
MCP Root (tools/list response)
├── executeScenario          ← XML scenario runner (stays at root — high value, unique)
├── AutomateUI               ← Router (stays at root — primary interface for AI agents)
├── listHelpers              ← Discovery meta (stays at root)
├── getHelperSchema          ← Discovery meta (stays at root)
├── BrowserWin               ← Direct access (stays — advanced/known callers)
├── KeyWin                   ← Direct access (stays — advanced/known callers)
├── MSOfficeWin              ← Direct access (stays — advanced/known callers)
├── LibreOfficeWin           ← Direct access (stays — advanced/known callers)
│
│   NativeWin group (stays at root — server-side, no session boundary issues)
├── fetch_webpage
├── exec_cmd
├── fs_read
├── fs_write
└── fs_list

REMOVED from root (deprecation path):
├── queryTree        → replaced by AutomateUI + action=QUERYTREE or KeyWin/BrowserWin direct
├── clickElement     → replaced by AutomateUI + action=CLICKID
├── setProperty      → replaced by AutomateUI + action=SENDKEYS/FILL
├── readProperty     → replaced by AutomateUI + action=READ/READELEM
├── getProviders     → replaced by listHelpers
├── listWindows      → replaced by AutomateUI + action=LISTWINDOWS  [BROKEN in service mode]
├── launchProcess    → replaced by AutomateUI + action=LAUNCH       [BROKEN in service mode]
└── terminateProcess → replaced by AutomateUI + action=KILL
```

### Migration Path

**Phase 1 (DEBT-1 expanded — next sprint):** Add deprecation notice to legacy tool descriptions. Mark in description: `"[DEPRECATED — use AutomateUI action=QUERYTREE instead. Will be removed in v2.0]"`. This is low-risk, backward-compatible.

**Phase 2 (v2.0 — separate sprint):** Remove legacy tools from `handleToolsList()`. Keep `handleToolsCall()` dispatch for them during a grace period (return error with migration hint).

**Phase 3 (v2.1):** Remove dispatch cases entirely.

### Tool ownership canonical registry

| MCP Tool name | Owner helper | Serviced by | Session-0 safe? |
|---------------|-------------|------------|-----------------|
| `executeScenario` | Server | xmlScenarioLoader | depends on steps |
| `AutomateUI` | Router | helperRegistry | depends on helper |  
| `listHelpers` | Server | helperRegistry | ✅ yes |
| `getHelperSchema` | Server | helperRegistry | ✅ yes |
| `BrowserWin` | BrowserWin.exe | helperRegistry | ❌ UI-dependent |
| `KeyWin` | KeyWin.exe | helperRegistry | ❌ UI-dependent |
| `MSOfficeWin` | MSOfficeWin.exe | helperRegistry | ❌ UI-dependent |
| `LibreOfficeWin` | LibreOfficeWin.exe | helperRegistry | ❌ UI-dependent |
| `fetch_webpage` | NativeWin | builtinActions | ✅ yes (network) |
| `exec_cmd` | NativeWin | builtinActions | ✅ yes (spawns in S0) |
| `fs_read` | NativeWin | builtinActions | ✅ yes (filesystem) |
| `fs_write` | NativeWin | builtinActions | ✅ yes (filesystem) |
| `fs_list` | NativeWin | builtinActions | ✅ yes (filesystem) |
| `queryTree` | **LEGACY** | AutomationEngine | ❌ mock data |
| `clickElement` | **LEGACY** | AutomationEngine | ❌ mock data |
| `setProperty` | **LEGACY** | AutomationEngine | ❌ mock data |
| `readProperty` | **LEGACY** | AutomationEngine | ❌ mock data |
| `getProviders` | **LEGACY** | AutomationEngine | ❌ irrelevant |
| `listWindows` | **LEGACY** | AutomationEngine | ❌ mock/broken |
| `launchProcess` | **LEGACY** | AutomationEngine | ❌ Session-0 broken |
| `terminateProcess` | **LEGACY** | AutomateEngine | ❌ Session-0 broken |

---

## Consequences

**Positive:**
- Root tool list shrinks from 21 → 13 tools (~38% reduction in AI token overhead)
- Eliminates deceptive legacy tools that appear to work but deliver mock/broken results
- Aligns MCP surface with the architecture documented in CONVENTIONS.md
- `NativeWin` virtual helper now has a clear home for all server-side operations

**Negative:**
- Callers using legacy tool names (`listWindows`, `queryTree`, etc.) will eventually break (Phase 2+)
- Phase 1 work requires marking + documentation; Phase 2 requires compatibility grace period

**Risks:**
- D9 test suite (`hs4-mcp-tools-list`) currently checks for specific tool names in `tools/list` response — tests must be updated after Phase 2
- Any external integrations (ChatGPT plugins, Claude Desktop configs) using legacy tool names must be notified

---

## Related

- [`CONVENTIONS.md §1`](CONVENTIONS.md) — command taxonomy and NativeWin definition
- [`TODO.md DEBT-1`](TODO.md) — NativeWin virtual helper grouping (this ADR expands scope)
- [`ADR-005`](docs/architecture/decisions/ADR-005-unified-action-addressing.md) — unified action addressing
- [`docs/specs/SESSION0_ISOLATION.md`](docs/specs/SESSION0_ISOLATION.md) — why legacy tools are broken in service mode
