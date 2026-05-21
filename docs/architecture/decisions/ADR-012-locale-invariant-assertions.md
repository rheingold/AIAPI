# ADR-012 — Locale-invariant assertions: iron rule + locale-map escape hatch

**Date:** 2026-04-25  
**Status:** Accepted  
**Deciders:** session walkthrough review (D5 locale bug)

---

## Context

D5 walkthrough found two assertions using translated UI header strings:

```xml
<!-- BROKEN — Czech only -->
<step action="ASSERT" proc="{{hwnd}}" path="NavView/Header" op="contains" value="Standardn"/>
<step action="ASSERT" proc="{{hwnd}}" path="NavView/Header" op="contains" value="deck"/>
```

`"Standardn"` is a Czech substring of `"Standardní"`. `"deck"` is a substring shared (accidentally)
by Czech `"Vědecký"` and English `"Scientific"`. Both break on any non-Czech locale. The numeric
computation results (`42`, `120`, `3`) are locale-neutral and unaffected.

Scenario assertions serve two purposes:
1. **Test gate** — fail the test if the outcome was wrong
2. **AI agent signal** — the MCP scenario runner returns `success/fail`; an AI agent relying on
   this signal must not receive false positives due to locale mismatch

Both purposes fail silently when a locale-sensitive string assertion passes on one machine and
fails on another.

---

## Decision

### Iron rule — no UI label string assertions

**Assertions on translated UI display strings are prohibited.**

State/mode confirmation must use locale-invariant structural checks: presence or absence of a
control identified by its **AutomationId** (UIA) or **CSS selector / DOM id** (browser). AutomationIds
are developer-assigned and locale-invariant by the UIA specification. If an application assigns
translated AutomationIds, that is a bug in the application, not in the test.

| Prohibited | Required alternative |
|---|---|
| `ASSERT NavView/Header contains "Standardní"` | `READ clearEntryButton` → assert non-empty (Standard-only control) |
| `ASSERT NavView/Header contains "deck"` | `READ factorialButton` → assert non-empty (Scientific-only control) |
| `CDP_EXECUTE document.title` contains `"Nastavení"` | `READELEM #section-settings` → assert element present |

### Escape hatch — `<LocaleMap>` for unavoidable label assertions

When **no structural alternative exists** (rare: apps with no mode-exclusive controls, or apps
whose AutomationIds are themselves translated — a bug, but a real one), a locale-sensitive string
**must** be declared as a parameter with a `<LocaleMap>` block:

```xml
<Scenario id="my-scenario">
  <Parameters>
    <Param name="modeLabel" type="string" required="false" default="Standard"
           localeMap="my-scenario.modeLabel"
           note="Locale-sensitive UI label — see LocaleMap below"/>
  </Parameters>
  <LocaleMap param="modeLabel">
    <Locale lang="en" value="Standard"/>
    <Locale lang="cs" value="Standardní"/>
    <Locale lang="de" value="Standard"/>
    <Locale lang="fr" value="Standard"/>
  </LocaleMap>
  <Steps>
    <Step action="ASSERT" proc="{{hwnd}}" path="NavView/Header" op="contains" value="{{modeLabel}}"
          note="locale-aware header check via LocaleMap"/>
  </Steps>
</Scenario>
```

Rules for the escape hatch:
- `localeMap="scenarioId.paramName"` — globally unique dotted key; queryable via MCP REST
- The `<Param default=...>` value **must** be the `en` string
- The `<LocaleMap>` block is declared inside the `<Scenario>`, after `<Parameters>`, before `<Steps>`
- The XML file encoding declaration `<?xml version="1.0" encoding="utf-8"?>` is **mandatory** when
  `<LocaleMap>` contains non-ASCII strings (also required by ADR-011)
- A linter error is raised if `ASSERT value=` is a non-numeric string literal and no `localeMap=`
  attribute is present on the enclosing `<Param>`

### Locale detection — standardised `detect-locale` atom

A shared parameterized atom `detect-locale` must be provided in the appropriate `apptemplates/` layer:

- **BrowserWin**: `CDP_EXECUTE "navigator.language"` → bind `{{appLocale}}`
- **KeyWin / native UIA**: `READ` UIA `CurrentCulture` property, or `LAUNCH cmd /c echo %LANG%`
  → bind `{{appLocale}}`

An AI agent resolving a locale-sensitive scenario:
1. Calls `detect-locale` → gets `{{appLocale}}` (e.g. `"cs"`)
2. Calls `GET /api/appTemplates/{app}/scenarios/{id}/localeMap?param=modeLabel&lang=cs`
   → server returns `"Standardní"`
3. Passes `modeLabel=Standardní` as a scenario parameter

### REST endpoint

`GET /api/appTemplates/{app}/scenarios/{id}/localeMap?param={paramName}&lang={iso639}`

Returns:
```json
{ "param": "modeLabel", "lang": "cs", "value": "Standardní" }
```

Returns 404 if no `<LocaleMap>` is declared for that param.

---

## Consequences

- D5 `cm-to-standard` and `cm-to-scientific` assertions replaced with structural checks *(done 2026-04-25)*
- All future scenario authors must follow the iron rule; the linter (G-D.12) enforces it
- `xmlScenarioLoader.ts` must parse `<LocaleMap>` / `<Locale>` and expose via the REST endpoint
- `CONVENTIONS.md §8` must document the iron rule, `<LocaleMap>` grammar, and `localeMap=` attribute
- `scenarios.xsd` must be updated to include `LocaleMap` and `Locale` element definitions

---

## Related

- [ADR-008](ADR-008-dogfood-test-scenario-driven-architecture.md) — scenario-driven test architecture
- [ADR-010](ADR-010-xml-assert-step-collapse-js-harnesses.md) — ASSERT step inline
- [ADR-011](ADR-011-scenario-xml-casing-grammar.md) — PascalCase grammar + utf-8 encoding
- TODO G-D.12 — implement `<LocaleMap>` parser, REST endpoint, `detect-locale` atom, linter rule
