# ADR-010 — Inline ASSERT step in XML scenarios; collapse trivial JS harnesses

**Status:** Accepted — implementation in progress  
**Date:** 2026-04-18  
**Deciders:** plachy

---

## Context

### The JS harness problem

Every `test/e2e/dN-xxx.js` file was created to do three things:
1. Bootstrap: call `runner.waitReady()` + `runner.launch()` + first `POST /run`.
2. Assert on step results: e.g. `assert('C3: 4×8 = 32', v3 === 32, ...)`.
3. Provide a standalone `node dN-xxx.js` entry point.

Points 1 and 3 are legitimate and unavoidable (something external must bootstrap).
Point 2 is the problem: **assertions belong in the XML**, not in the JS harness.

A review on 2026-04-18 found:

- **D2** (`d2-settings-ui.js`): 10 lines, pure bootstrap. No assertions in JS at all.
  This is what all files *should* look like.
- **D3** (`d3-auth-ui.js`): ~150 lines of JS assertions (`dashRest()` calls, response
  shape checks, wrong-password probing). These REST assertions violate ADR-008 Rule 2.
  Some (shape checks of a live REST call) are legitimate test-only validations, but
  they should move into `HTTP_FETCH` + `ASSERT` steps in the XML.
- **D5** (`d5-keywin-calculator.js`): `parseResult()` helper + numeric comparison
  assertions (`assert('C3: 4×8 = 32', v3 === 32, ...)`). The JS exists *only* because
  the XML had no way to assert that a bound `{{readVal}}` equals a known number.

### The missing primitive: inline assertion

The `xmlScenarioLoader` handles WAIT, LISTWINDOWS, EVAL, HTTP_FETCH, and all helper
dispatch. It has **no ASSERT step type**. This is the gap that forces assertion logic
into JS.

An `ASSERT` step that evaluates a JS expression (like `EVAL`) but **fails the scenario
if the result is falsy** closes this gap completely:

```xml
<step action="ASSERT" path="Number('{{readVal}}') === 32"
      note="C3: 4×8 must equal 32"/>
```

If the expression is falsy the step is recorded as `success: false` and the scenario
fails — surfaced to the caller via `XmlScenarioResult.success = false`.

### Why the JS harnesses still exist for bootstrapping

The XML runs **server-side**. Something external must:
1. Wait for the server to be ready (`pollUntilMcpReady`).
2. Make the first `POST /api/appTemplates/{app}/scenarios/{id}/run`.

This minimal bootstrap cannot live in XML. Therefore one JS file per test suite
is correct and necessary. Its ideal size is **10–15 lines**.

For suites that are *fully* XML-driven (like D2 today), the `dN-xxx.js` file
is technically redundant with a one-line entry in `index.js` — but it provides
the standalone `node dN-xxx.js` convenience. That convenience is worth keeping.

---

## Decisions

### Decision 1 — Add `ASSERT` step type to `xmlScenarioLoader.ts`

A new built-in step `action="ASSERT"` is added to `executeXmlScenario()`, processed
before the generic helper dispatch:

```typescript
if (step.action === 'ASSERT') {
  let passed: boolean;
  let err: string | undefined;
  try {
    // eslint-disable-next-line no-new-func
    passed = !!new Function(`return (${stepPath})`)();
  } catch (e: any) {
    passed = false;
    err = e.message;
  }
  stepResults.push({ ..., action: 'ASSERT', success: passed,
                     error: passed ? undefined : err ?? `assertion failed: ${stepPath}` });
  continue;
}
```

- `path=` holds the JS expression (same as EVAL).
- `{{var}}` substitution is applied to `path` before evaluation (as with all steps).
- Falsy result → `success: false` → scenario `failedSteps > 0` → result `success: false`.
- No helper call is made; no `proc` is needed (set to empty).
- `note=` is the human-readable label for the assertion (surfaced in step result).

### Decision 2 — ASSERT is permitted only in L3 test scenarios

Per the layer rules in CONVENTIONS.md §8:

| Layer | ASSERT permitted? |
|---|---|
| L1 — shipped app atoms | **No** — L1 scenarios must be pure UI interactions |
| L2 — workflow compositions | **No** |
| L3 — `test/e2e/d#/scenarios.xml` | **Yes** |

The `xmlScenarioLoader` does NOT enforce this at runtime (it would require
knowing the layer, which is caller-dependent). Convention + code review enforce it.

### Decision 3 — Collapse numeric parsing from JS harnesses into XML ASSERT

D5's `parseResult()` JS function exists only because the XML had no assertion.
Once ASSERT is available:

```xml
<!-- Old JS: const v3 = parseResult(r3.vars?.readVal); assert('4×8=32', v3 === 32) -->
<step action="ASSERT"
      path="(function(){ var s=String('{{readVal}}'); var m=s.match(/[\d]+(?:[.,]\d+)?$/); return m ? Number(m[0].replace(',','.')) === 32 : false; })()"
      note="assert: 4×8 = 32"/>
```

### Decision 4 — Reduce JS harness to bootstrap only

The correct structure for every `dN-xxx.js` file is:

```javascript
async function run() {
  return runSuite(`DN — <name>  [${TEST_TAG}]`, async () => {
    const runner = new ScenarioRunner({ browser: BROWSER, dashUrl: DASH_URL });
    await runner.waitReady();
    await runner.launch();          // if browser-based
    await runner.runOk('dN', 'dN-suite', params);
  });
}
```

All assertions, variable checks, and sub-step orchestration move into `dN/scenarios.xml`.

`dashRest()` calls in `run.js` are a violation of ADR-008 Rule 2 and must be moved
to `HTTP_FETCH` + `ASSERT` steps in the XML.

### Decision 5 — `index.js` does NOT absorb individual entry points

The separate `dN-xxx.js` files are kept for their standalone `node dN-xxx.js`
convenience. `index.js` imports them all. The two co-exist.

---

## Consequences

**Positive:**
- The XML becomes self-sufficient for assertions — the scenarios are fully testable.
- JS harnesses shrink to ~10 lines each, removing the temptation to add more JS logic.
- New test suites need only: one `dN/scenarios.xml` + one 10-line `dN-xxx.js` bootstrap.
- Agent sessions can read the XML to understand what is being tested — no hidden JS.

**Negative / Migration:**
- D3's `dashRest()` assertions must be rewritten as `HTTP_FETCH` + `ASSERT` in XML.
- D5's `parseResult()` + numeric assertions must be rewritten as XML `ASSERT` steps.
- The numeric extract regex must live in the XML (verbose but transparent).

---

## Related

- [CONVENTIONS.md §1.1](../../CONVENTIONS.md) — command selection policy
- [ADR-008](ADR-008-dogfood-test-scenario-driven-architecture.md) — dogfood test arch
- TODO.md §G-D — remediation backlog
