# ADR-009 — KeyWin must be application-agnostic

**Status:** Accepted — violations must be remediated (see TODO.md §G-D)  
**Date:** 2026-04-18  
**Deciders:** plachy

---

## Context

`KeyWin.exe` is the generic Windows UIA/HWND helper. Its design contract is:

> KeyWin knows nothing about the *meaning* of any particular application.
> It provides OS-level primitives (CLICKID, SENDKEYS, READ, LISTWINDOWS, CLICKNAME, …).
> Knowledge of *which button to click* to "reset a calculator" or "open a new Notepad
> document" belongs exclusively in `scenarios.xml` (L1 atoms or higher).

A code review on 2026-04-18 found **at least 10 distinct violations** of this rule
in `components/helpers/windows/src/KeyWin.cs`:

### Violations found

| Location | Hardcoded app knowledge |
|---|---|
| Line 583 | `'='` → `{ENTER}` "for calculator sequences" in `BuildSendKeysSequence()` |
| Line 1090 | Same `'='` → ENTER mapping duplicated in the PostMessage path |
| Lines 1405–1422 | `_buttonKeyMap` dictionary mapping Calculator AutomationIds to key sequences — Calculator-specific, not generic UIA |
| Line 1421 | `clearButton` → `{ESC}` and `clearEntryButton` → `{ESC}` hardcoded in that map |
| Lines 1520–1535 | `ReadDisplayText()` detects "Notepad" by window class name AND by title string ("Notepad", "Poznámkový blok") to decide text-reading strategy |
| Lines 1544–1594 | `ReadDisplayText()` explicitly searches for `CalculatorResults` AutomationId as the **first** preferred read target — fully Calculator-specific |
| Lines 1643–1666 | Strips "Display is X" localized prefix from `CalculatorResults` value — Calculator-specific localisation knowledge |
| Lines 1695–1785 | Three distinct Notepad-specific READ fallback paths (WM_GETTEXT, TextPattern, clipboard+Ctrl+A) |
| Lines 2189–2244 | `{RESET}` command: hardcoded list `{ "clearButton", "clearEntryButton", "ClearButton", "btnClear", "btnAC", "clearall" }` and ESC×2 comment "For UWP apps (Calculator)" |
| Line 2235–2241 | ESC×2 fallback in RESET explicitly documented as "for Calculator" |
| KeyWin schema line 2835 | API schema documents `RESET` as "For Calculator: clicks the AC/Clear button" |

### Root cause

`{RESET}` was added as a convenience shortcut during initial Calculator testing.
Once it worked, the same convenient-but-wrong pattern was extended to other
Calculator-specific behaviours (`_buttonKeyMap`, strip "Display is", etc.) and
to Notepad-specific READ logic. Each addition made the helper slightly less
generic and the scenario files slightly less necessary.

---

## Decision

### Rule (binding)

**KeyWin.cs MUST NOT contain any reference to a specific application name,
window title, AutomationId pattern, or UI element ID that is specific to one
application.**

This includes but is not limited to:

- Named AutomationIds of specific apps (`clearButton`, `CalculatorResults`, …)
- Window class names associated with a specific app (`"Notepad"`, `"ApplicationFrameWindow"` matched by title)
- Localisation strings of specific apps ("Display is", "Poznámkový blok")
- Compound operations whose semantics depend on which app is running (`{RESET}`)
- Key-sequence mappings for specific app button IDs (`_buttonKeyMap`)

### Permitted generic knowledge

KeyWin **may** contain:

- Generic UIA patterns applicable to *any* app: `ControlType.Button`,
  `ValuePattern`, `TextPattern`, `InvokePattern`, `ControlType.Document`,
  `ControlType.Edit`, `ControlType.Text`
- OS-level window class names that denote *generic control types* not tied to
  one app: `"Edit"`, `"RichEdit"`, `"RICHEDIT50W"`, `"RichEditD2DPT"`, etc.
- `ResolveCoreWindow()`: UWP hosting architecture is a **platform** concern
  (ApplicationFrameWindow + CoreWindow is standard UWP, not Calculator-specific)

### Replacement design

Every piece of Calculator- or Notepad-specific logic removed from KeyWin.cs
MUST be replaced by explicit steps in the appropriate `scenarios.xml`:

| Removed from KeyWin | Replaced by in scenarios.xml |
|---|---|
| `{RESET}` → tries `clearButton` etc. | `<step action="CLICKID" proc="{{hwnd}}" path="clearButton"/>` in the scenario that needs it |
| `'='` → `{ENTER}` in SENDKEYS | Scenario uses `{ENTER}` explicitly — XML author knows the app |
| `_buttonKeyMap` Calculator fallback | Not needed: CLICKID via UIA InvokePattern works directly |
| `CalculatorResults` preferred READ | `<step action="READELEM" path="CalculatorResults"/>` — scenario names what to read |
| "Display is" strip | Not needed once READELEM is used with correct ID |
| Notepad class/title detection in READ | READ with no path on a plain Win32 text editor already works via Edit/Document UIA; Notepad-specific clipboard path can be removed once we confirm which READ path is generic |

### `{RESET}` command — full removal

The `{RESET}` command is **removed** from KeyWin. The word "RESET" must not
appear as a commandType in `DetermineCommandType()`, `ExtractParameter()`,
`DetermineCommandType()`, the main switch, or the API schema.

Any `<step action="RESET">` in scenarios.xml files is a bug. Replace with:
```xml
<!-- Calculator clear — use the app's actual AC button AutomationId -->
<step action="CLICKID" proc="{{hwnd}}" path="clearButton" note="AC — clear display"/>
```

### `=` → `{ENTER}` mapping — removal

The mapping of the `=` character to `{ENTER}` in `BuildSendKeysSequence()` and
in the PostMessage loop is **removed**. `=` must be sent as the literal `=` key
(`WM_CHAR '='`). Scenarios that want Enter (e.g. to evaluate a calculator
expression) use `{ENTER}` explicitly in their `path=` value.

---

## Consequences

**Positive:**
- KeyWin becomes a true generic UIA helper, usable for any Windows app without
  code changes.
- Application knowledge is entirely in `scenarios.xml`, the correct layer.
- Adding support for a new app never requires recompiling KeyWin.

**Negative / Migration cost:**
- All `<step action="RESET">` in existing test scenarios must be replaced before
  the next KeyWin build is deployed (see TODO.md §G-D).
- D5 (`test/e2e/d5/scenarios.xml`) uses RESET in six places — must be fixed first.
- The `intro` scenario in `calculator/scenarios.xml` uses RESET — must be fixed.
- SENDKEYS with `=` for calculator must change to `{ENTER}` — affects d5.

---

## Related

- [CONVENTIONS.md §1](../../CONVENTIONS.md) — command taxonomy
- [ADR-008](ADR-008-dogfood-test-scenario-driven-architecture.md) — test architecture
- TODO.md §G-D — remediation backlog
