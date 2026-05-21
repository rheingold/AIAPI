# ADR-008 — Dogfood Test Architecture: Scenario-Driven, UI-Only, No REST

**Status:** Accepted — active, all D# rewrites follow this spec  
**Date:** 2026-04  
**Deciders:** plachy

---

## Context

The original D# dogfood tests (`test/e2e/d4-scenarios-editor.js`, etc.) were written as
monolithic JS files that mixed two fundamentally different interaction modes:

1. **Direct REST calls** (`dashRest()`) — bypass the browser UI entirely, talking to the
   server's `/api/*` endpoints from Node without a browser process.
2. **Browser UI calls** via `bw()` / `mcpCall()` primitives at the wrong abstraction
   layer, with ad-hoc `LAUNCH`/`DIALOG`/`NAVIGATE` calls inline in JS rather than
   captured as reusable scenario atoms.

This created three problems:

- REST assertions do not mimic user behaviour. They test the HTTP layer in isolation,
  not the interaction between the dashboard UI and the server. A bug that silently
  breaks the UI while keeping the API healthy would not be caught.
- No reusability. Every test re-implements boilerplate (launch browser, nav to section,
  dismiss dialogs) in JS rather than in XML atoms that can be composed.
- Fragile context. The JS files held no persistent notes of the agreed test structure,
  causing every agent session to rediscover or contradict prior decisions.

D2 (Settings UI) and D3 (Auth UI) were rewritten into the correct format and pass
38/38 and 18/18 respectively.

---

## Decision

All D# tests (D4–D19) MUST conform to the following architecture:

### 1. Three-file structure per test

```
test/e2e/d#/scenarios.xml   — UI interaction atoms as <Scenario> elements
test/e2e/d#/run.js          — thin orchestration: runner.runOk() + var assertions only
test/e2e/d#-<name>.js       — 10-line delegator: require('./d#/run').run()
```

### 2. No REST calls in run.js

`dashRest()` is **forbidden** inside `d#/run.js` for any test assertion or state
verification.

The only permitted exceptions are infrastructure helpers in `_shared.js`:
- `waitReady()` — poll server health before the test starts
- `checkMcpNoStackLeak()` — guard at the end of the suite

All state reads (e.g. "verify the saved settings persisted") must be done through the UI:
navigate to the relevant section, READ or CDP_EXECUTE-assert the DOM value.

### 3. Every test section is a scenario

Every logical check, even "can I see the app templates list?", maps to a
`<Scenario id="...">` in `d#/scenarios.xml`. The `run.js` calls
`runner.runOk('d#', 'scenario-id', params)` and asserts on bound `vars` or step notes.

### 4. Scenarios use UI primitives only, per CONVENTIONS.md §1

| Intent | Correct | Forbidden |
|--------|---------|-----------|
| Click button / link / nav | `CLICKID` | `CDP_EXECUTE value="el.click()"` |
| Type text | `SENDKEYS` | `CDP_EXECUTE value="el.value=…"` |
| Read element text / value | `READ` | — |
| Assert boolean / count / computed | `CDP_EXECUTE` (assert-only, throws on fail) | — |
| Dialog shim installation | `CDP_EXECUTE` (one-time, test-only) | — |

`CDP_EXECUTE` may **not** drive UI interactions. Its only permitted uses are:
- Throwing assertions: `(()=>{ if(!cond) throw new Error('…'); return true; })()`
- Reading values that `READ` cannot express (boolean flags, counts, compound expressions)
- Installing window-level test shims (confirm/alert overrides)

### 5a. Formal scenario contract — `<Parameters>` block

Every `{{varName}}` placeholder used in a scenario's steps MUST be declared as a
`<Param>` inside a `<Parameters>` block, directly after `<description>` and before
`<steps>`. This block is the machine-readable call contract for the scenario,
defined in `scenarios.xsd §ParametersType`.

The declaration enables the dashboard editor to render typed input fields, the loader
to validate and fill defaults, AI orchestration to know required params without
parsing step bodies, and `xmllint` schema validation.

Automatic runtime-bound variables (`{{hwnd}}`, `{{tab}}`) are bound by
`LISTWINDOWS` / `LAUNCH` respectively and MUST NOT be declared as `<Param>`.

The `effect=` attribute is REQUIRED on every `<Scenario>` (see CONVENTIONS.md §8
for the full value table). It documents the side-effect contract at a glance.

Existing scenarios in `dashboard/scenarios.xml` and `d2/scenarios.xml` that are
missing `<Parameters>` blocks must be retrofitted before being considered L1-quality.

### 5. Three-layer scenario hierarchy

Scenarios exist at three levels. This hierarchy is defined in full in
[CONVENTIONS.md §8](../../../CONVENTIONS.md). Summary:

```
L1 — components/helpers/*/dist-resources/apptemplates/<app>/scenarios.xml
     Shipped with the product. Atomic UI primitives (CLICKID, SENDKEYS, READ, WAIT).
     No test assertions, no dialog shims.
     Reused by consumers at all layers via <ScenarioRef app=".." ref=".."/>.

L2 — config/scenarios/<app>/   (user-space, assembled use-case workflows)
     Chains of L1 atoms modelling complete user journeys.
     No test-only content.

L3 — test/e2e/d#/scenarios.xml
     Test-suite layer. Composes L1 (and L2) atoms via <ScenarioRef>, adds
     test-only shims (dialog overrides) and CDP_EXECUTE assertion steps.
     Never shipped in the product.
```

**Rule:** before writing a new atomic `<step>` inside a `test/e2e/d#/scenarios.xml`,
check the shipped L1 `scenarios.xml` for that app. If the atom already exists there,
use `<ScenarioRef>` — do NOT duplicate the steps.

Each `<Scenario>` covers one logical interaction unit (e.g. "navigate to a tab",
"open a modal", "type and save a field"). Cross-XML reuse via
`<ScenarioRef app="dashboard" ref="…"/>` is the primary composition mechanism.

### 6. hwnd / tab binding pattern (KeyWin / BrowserWin)

After a scenario that launches an app and binds `{{hwnd}}` or `{{tab}}` via
`LISTWINDOWS` / `LAUNCH`, `run.js` captures the `vars` return:

```js
const r = await runner.run('d#', 'launch-scenario', { hwnd: runner.defaults.hwnd || '' });
runner.defaults.hwnd = r?.vars?.hwnd;   // or r?.vars?.tab for browser
assert('App window found', !!runner.defaults.hwnd, 'did not launch');
```

All subsequent scenarios receive `{{hwnd}}`/`{{tab}}` automatically through
`runner.defaults`.

### 7. Decisions must be recorded

Any architecture constraint, test structure agreement, or implementation rule
established during a session MUST be recorded in:
- This ADR (permanent, structural decisions)
- `TODO.md` § S-2 (progress tracking, immediate next steps)

before any code is written or modified.

---

## Consequences

- D4–D19 must be rewritten. The old monolithic JS files remain in place as reference
  until the new `d#/run.js` + `d#/scenarios.xml` counterparts are validated.
- `dashRest()` should be removed from `_shared.js` eventually, once all tests no longer
  use it. Until then it lives there but its use in test files is banned by this ADR.
- Test coverage is richer: end-to-end browser event chain is exercised for every
  assertion, not just the HTTP API layer.
- Scenarios are reusable across tests via `<ScenarioRef>`.

---

## References

- [CONVENTIONS.md §1 — Command taxonomy](../../../CONVENTIONS.md)
- [CONVENTIONS.md §1.1 — Command selection policy](../../../CONVENTIONS.md)
- [test/e2e/d2/scenarios.xml](../../../test/e2e/d2/scenarios.xml) — reference implementation
- [test/e2e/d2/run.js](../../../test/e2e/d2/run.js) — reference implementation
- [test/e2e/_scenario-runner.js](../../../test/e2e/_scenario-runner.js) — ScenarioRunner API
- [TODO.md § S-2](../../../TODO.md) — progress table
