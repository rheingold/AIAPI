# ADR-005 — Unified XPath-Style Action Addressing

**Status:** Partially implemented — MCP argument layer done; full C# wire protocol pending  
**Date:** 2026-01  
**Deciders:** plachy

---

## Context

Every helper has its own ad-hoc path syntax for addressing UI elements:

- KeyWin: bare `AutomationId` string  
- MSOfficeWin: `para:3`, `A1`, `bookmark:Name`, `slide:2/shape:Title`  
- BrowserWin: CSS selector string  

This creates two problems:

1. **Two layers of ad-hoc parsing.** `HelperRegistry.ts` translates canonical MCP paths
   (`body/para[3]`) into abbreviated wire forms (`para:3`). The C# helper then re-parses
   those same abbreviations. Both layers are ad-hoc, untested, and diverge over time.

2. **Security filter rules use a different syntax.** The filter rule engine has its own
   pattern language (`ALLOW calc* → KeyWin::{CLICKID}/num1Button`) that cannot natively
   address deep tree paths, only flat element IDs.

## Decision

All path addressing converges on a single **XPath-aligned syntax**:

```
//[ProcessFilter]//TreeStep.../[TreeStep]
```

Full address format for security filter rules and future C# wire protocol:

```
//[HelperGlob]//[ProcessFilter]//[TreePath]//action:Verb/Params
```

Examples:
```
Body path:   body/para[3]
Office cell: sheet[@name='Q1']/cell[@addr='B2']
UIA path:    Window/Button[@id='num7Button']
Browser DOM: document/**/form/button[@id='submit']
```

### Segment reference

| Kind | Syntax | Examples |
|---|---|---|
| Named child | `name` | `body`, `mainWindow`, `GroupBox1` |
| Index | `[N]` | `para[3]` (1-based) |
| Attribute predicate | `[@attr='val']` | `sheet[@name='Q1']`, `Button[@id='ok']` |
| Wildcard (one level) | `*` | any single node |
| Deep wildcard | `**` | any subtree depth |
| Process filter | `[key:val & key:val]` | `[ProcName:calc*.exe & SHA256:abc123]` |
| Action step | `action:Verb` | `action:click`, `action:read`, `action:fill` |

## Current implementation state

### MCP argument layer — DONE

`src/helpers/HelperRegistry.ts`:
- `HelperCallArgs` interface: `helper`, `proc`, `action`, `path`, `value`
- `resolveCallArgs(args)` — maps to `{target, command, path, value}`
- `pathToAddress()` abbreviation layer — still present but stripped of Office translations

### C# wire protocol — IN PROGRESS

`HelperCommon.cs` reads `proc`/`path`/`value` from incoming JSON and reassembles to
`{CMD:param}` token before dispatch. This is a **transitional shim** — the final state
removes `{CMD:param}` tokens entirely and passes `path`+`value` as separate fields.

### Pending (see TODO.md Gate P2)

- Remove `pathToAddress()` abbreviation layer once all C# helpers parse `//` full paths natively
- Implement `ParseAddress()` in `HelperCommon.cs`
- Update `KeyWin`, `BrowserWin`, `MSOfficeWin` dispatch to accept full address strings
- Update security filter rule evaluation to use segment-by-segment matching

## Canonical specification

`CONVENTIONS.md §2` — Unified Action Addressing.  
`docs/specs/COMMAND_ALIGNMENT.md` — command-level vocabulary.

## Consequences

- Until C# helpers are fully updated, `HelperRegistry.ts` re-assembles the abbreviated
  wire form as a transitional step.
- The `pathToAddress()` function must not be deleted until all helpers support native
  full-path dispatch.
- Security filter rules written in the old format remain valid — the filter engine is
  updated to interpret both old and new formats during the transition period.
