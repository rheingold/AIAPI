# ADR-011 — Scenario XML casing grammar

**Date:** 2026-04-25  
**Status:** Accepted  
**Deciders:** session walkthrough review

---

## Context

The existing scenario XML files have inconsistent casing:

| Tag | Current | Problem |
|---|---|---|
| `Scenario` | PascalCase | ✅ correct |
| `ScenarioRef` | PascalCase | ✅ correct |
| `Parameters` | PascalCase | ✅ correct |
| `Param` | PascalCase | ✅ correct |
| `steps` | lowercase | ❌ — `Steps` is a named structural container, should match |
| `step` | lowercase | ❌ — `Step` is a fully-fledged named domain construct with attributes (`action`, `proc`, `path`, `bind`, etc.) |
| `description` | lowercase | ❌ — `Description` is a named domain construct |

The original informal rationale was "named constructs = PascalCase, structural wrappers = lowercase".
This breaks down on inspection: `step` is as much a named domain construct as `Param` (both have
defined attributes, both are directly queried by the loader), and `Steps`/`Parameters` are both
container wrappers — yet `Parameters` is PascalCase and `steps` was lowercase.

---

## Decision

**All XML element (tag) names in the scenario grammar use PascalCase. Attributes use camelCase.**

| Category | Convention | Examples |
|---|---|---|
| Element names | **PascalCase** | `Scenario`, `ScenarioRef`, `Steps`, `Step`, `Parameters`, `Param`, `Description` |
| Attribute names | **camelCase** | `action`, `proc`, `path`, `bind`, `stepCountBefore`, `required` |

Rationale:
- Consistent with the dominant XML vocabulary tradition for typed/named grammars (WSDL, Android layouts, SOAP, XSD)
- Eliminates the ambiguous "named construct vs. wrapper" distinction — just apply PascalCase to everything
- camelCase for attributes follows the same tradition (WSDL, Android, XSD all do this)
- No conflict with the HTML lowercase convention — our scenario XML is not HTML

### Parser: case-insensitive normalization

The `xmlScenarioLoader.ts` parser **must normalize all tag names to lowercase** at parse time
(`element.tagName.toLowerCase()`) so that files authored with any casing variation (uppercase,
lowercase, PascalCase) are accepted without error. This makes the parser forgiving for human authors
and tooling consumers.

The **canonical form** in all AIAPI-authored files is PascalCase for elements, camelCase for attributes.
Case-insensitivity is a parser tolerance, not a license for mixed casing within authored files.

### Tags affected by this change

| Old (to be corrected on next touch) | New canonical |
|---|---|
| `<steps>` | `<Steps>` |
| `<step>` | `<Step>` |
| `<description>` | `<Description>` |

`Scenario`, `ScenarioRef`, `Parameters`, `Param` are already correct — no change.

---

## Migration

- Fix timing: alongside G-D.9 / G-D.10 (next batch that touches XML files)
- All `test/e2e/d*/scenarios.xml`, `config/scenarios/**/*.xml`, `apptemplates/**/*.xml`
- `xmlScenarioLoader.ts`: add one-line tag-name normalization at parse entry point
- `CONVENTIONS.md §8`: update grammar table with the casing rules

---

## Related

- [ADR-008](ADR-008-dogfood-test-scenario-driven-architecture.md) — scenario-driven test architecture
- [ADR-010](ADR-010-xml-assert-step-collapse-js-harnesses.md) — ASSERT step + XML self-sufficiency
- TODO G-D.11 — apply PascalCase to `Steps`/`Step`/`Description` across all XML files + parser normalization
