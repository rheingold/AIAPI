# QA Process — Gap Analysis & Mandatory Post-Deploy Checklist

**Created:** 2026-05-21  
**Author:** ARCH  
**Trigger:** User-reported regressions in service-mode deployment not caught by existing test suite.

---

## 1. What Tests Exist — Scope Map

The test suite runs via [`test/e2e/index.js`](test/e2e/index.js) encompassing D1–D19 suites:

| Suite | Label | What it actually tests |
|-------|-------|----------------------|
| D1 | Dashboard Smoke | HTTP `GET /health`; dashboard HTML loads in browser |
| D2 | Settings UI | Dashboard settings panel — read/write settings via UI |
| D3 | Auth UI | Auth config panel; login/logout flows |
| D4 | Scenarios Editor | Scenario editor panel in dashboard |
| D5 | KeyWin + Calculator | `KeyWin.exe` UIA automation of Calculator app |
| D6 | KeyWin + Notepad | `KeyWin.exe` UIA automation of Notepad app |
| D7 | BrowserWin + Chrome | `BrowserWin.exe` CDP automation of dashboard in Chrome |
| D8 | Security Enforcement | Security filter ALLOW/DENY enforcement |
| D9 | Helper Schema & Discovery | `listHelpers`, `getHelperSchema`, MCP `tools/list` structure |
| D10 | Server Foundations | REST endpoints: `/health`, `/api/status`, settings GET/POST |
| D11 | Security Log & Filter Dry-Run | Filter add/delete dry-run via REST |
| D12 | KeyWin Extended Commands | `QUERYTREE`, `SCREENSHOT`, `KEYDOWN/UP`, `RIGHTCLICK` |
| D13 | BrowserWin Extended | CDP `FILL`, `FOCUS`, `PAGESOURCE`, `NEWPAGE` |
| D14 | MSOfficeWin | Office COM automation (skipped if Office not installed) |
| D15 | Scenario Execution | `executeScenario` with XML scenarios |
| D16 | Extended REST Coverage | REST endpoint surface coverage |
| D17 | Users/Roles/Auth Backend | User CRUD, role assignment, API key management |
| D18 | LibreOfficeWin | LibreOffice UNO automation |
| D19 | Users/Roles DB backend | D17 variant against DB user store |

All suites target a **dev-mode** server (started interactively, inheriting user session). **None test service-mode behaviour.**

---

## 2. Confirmed QA Gaps

### GAP-1: No service-mode tests (CRITICAL)

**What's missing:** Zero tests run against the server when installed as a Windows Service (Session 0). All D1–D19 suites require an interactive server context.

**Why this matters:** Session 0 isolation means `LISTWINDOWS`, `QUERYTREE`, `CLICKID`, `SENDKEYS`, `launchProcess` all silently fail or return empty results. Tests pass in dev mode but the feature is broken in production (service) mode.

**Broken behaviors with NO test coverage:**
- `LISTWINDOWS` → `{"windows":[]}` under service (confirmed by user via ChatGPT agent)
- `launchProcess` → launches in Session 0, not user session (invisible to user)
- `QUERYTREE` on Calculator/Notepad → empty or error (window in Session 1)

### GAP-2: D9 `hs4-mcp-tools-list` does not verify tool hierarchy (HIGH)

**What D9 actually tests:** [`test/e2e/d9-helper-schema.js`](test/e2e/d9-helper-schema.js) runs XML scenarios (`hs1–hs8`) that check:
- `listHelpers` returns a list with `commandCount`
- `getHelperSchema(KeyWin.exe)` returns command names
- `tools/list` returns a result (presence check only — no structure validation)

**What it does NOT check:**
- Whether legacy tools (`queryTree`, `listWindows`, `launchProcess`, `terminateProcess`) correctly route through `KeyWin.exe` vs legacy AutomationEngine
- Whether `NativeWin` virtual helper appears in `listHelpers`
- Whether tool count matches architecture (ADR-017)

### GAP-3: No post-deploy smoke test (HIGH)

**What's missing:** After deploying/restarting the Windows Service (`AIAPIService`), there is no automated check that:
1. The service started on the correct port
2. Helper `.exe` files were discovered
3. At least one real helper responds to a live command

Currently this relies entirely on manual inspection (`check-session.ps1`, manual MCP calls).

### GAP-4: `LISTWINDOWS` Session 0 return value has no test (MEDIUM)

**What's missing:** When `_sessionWarning` is set in the `LISTWINDOWS` response, no test:
- Asserts the warning field is present and non-empty
- Asserts the `windows` array is empty (the known broken state)
- Verifies the diagnostic script `tools/diag/check-session.ps1` correctly detects Session 0

### GAP-5: Legacy tool dispatch routes not verified (MEDIUM)

**What's missing:** D9 `hs4-mcp-tools-list` does not verify that calling the **legacy** MCP tools (`listWindows`, `queryTree`, `clickElement`, etc.) actually reaches the correct implementation. They currently route to the legacy `AutomationEngine` (mock data), NOT `KeyWin.exe`.

### GAP-6: No cross-session test framework (MEDIUM)

**What's missing:** No test runner can start a separate Session 0 process and issue commands to it from Session 1. The gap requires either:
- A VM snapshot with the service installed
- A CI pipeline step that installs and starts the service then runs a reduced smoke suite

---

## 3. Mandatory Post-Deploy Verification Checklist

**Run this checklist after EVERY service redeploy (`Restart-Service AIAPIService`).**

### Checklist

```powershell
# 1. Confirm service is running
Get-Service AIAPIService | Select-Object Name, Status, StartType

# 2. Confirm port 4457 is listening
Test-NetConnection -ComputerName localhost -Port 4457

# 3. Health check
Invoke-RestMethod http://localhost:4457/health

# 4. Confirm helpers were discovered
$helpers = (Invoke-RestMethod http://localhost:4457/api/listHelpers).helpers
$helpers | Select-Object name, commandCount
# Expected: KeyWin, BrowserWin (and optionally MSOfficeWin, LibreOfficeWin) with commandCount > 0

# 5. Check for Session 0 (CRITICAL)
powershell -ExecutionPolicy Bypass -File tools/diag/check-session.ps1
# Expected output must include: "AIAPI service process session ID: 0"
# This is EXPECTED for service-mode — the warning is the confirmation

# 6. LISTWINDOWS smoke — confirm _sessionWarning is present
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"AutomateUI","arguments":{"helper":"KeyWin","action":"LISTWINDOWS","proc":"SYSTEM"}}}'
$result = Invoke-RestMethod -Uri http://localhost:4457 -Method POST -Body $body -ContentType 'application/json'
$result.result.content[0].text | ConvertFrom-Json | Select-Object success, windows, _sessionWarning
# If _sessionWarning absent: service is NOT in Session 0 — verify service account

# 7. NativeWin tools — MUST work in Session 0
$body = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fs_read","arguments":{"path":"README.md"}}}'
Invoke-RestMethod -Uri http://localhost:4457 -Method POST -Body $body -ContentType 'application/json'
# Expected: success=true, content with file text

# 8. SSE endpoint check
$req = [System.Net.WebRequest]::Create('http://localhost:4457/sse')
$req.Accept = 'text/event-stream'
$resp = $req.GetResponse()
$resp.StatusCode  # Expected: 200
$resp.Close()
```

### Acceptance Criteria (service-mode)

| Check | Expected result | Fail action |
|-------|----------------|-------------|
| Service status | Running | `Start-Service AIAPIService` |
| Port 4457 listening | TcpTestSucceeded=True | Check firewall; check service log |
| `/health` response | `{"status":"ok"}` | Check server log `%PROGRAMDATA%\AIAPI\logs\` |
| `listHelpers` has KeyWin | `commandCount > 0` | Rebuild helpers; check `dist/helpers/` |
| `check-session.ps1` | Reports Session 0 | Non-zero session means service is running interactively — verify service account = SYSTEM |
| LISTWINDOWS response | `windows=[]`, `_sessionWarning` set | If `_sessionWarning` absent, helper not detecting Session 0 |
| `fs_read README.md` | `success=true` | NativeWin broken — check `builtinActions.ts` import |

---

## 4. Missing Test Coverage — Action Items

These are tracked in [`TODO.md`](TODO.md) under new items `QA-1` through `QA-6`:

| ID | Description | Priority |
|----|-------------|----------|
| QA-1 | Service-mode smoke test script: PowerShell checklist above as automated `test/smoke/service-mode.ps1` | 🔴 blocking |
| QA-2 | D9 `hs4-mcp-tools-list`: add assertions for tool count, verify legacy tools have `[DEPRECATED]` in description, verify `NativeWin` in `listHelpers` | 🟡 high |
| QA-3 | D12 extension: add `LISTWINDOWS` test that checks for `_sessionWarning` field when running in Session 0 | 🟡 high |
| QA-4 | Post-deploy CI step: after service install, wait 5s, run `test/smoke/service-mode.ps1` | 🟡 high |
| QA-5 | D9 `hs4`: verify that `queryTree`/`listWindows`/`launchProcess` tool descriptions contain `[DEPRECATED]` marker | 🟡 medium |
| QA-6 | New suite D20 `Service-Mode Isolation`: runs against port 4457 (service), verifies Session 0 behavior matrix | ⚪ backlog |

---

## 5. Root Cause Analysis — Why Tests Don't Catch These Issues

The test infrastructure has a **fundamental scope gap**: it tests the server in the same session as the test runner. Because helpers run in the same session as the test runner in dev mode, all UI automation works. The Session 0 isolation problem only manifests in service-mode — a deployment configuration that has no corresponding test environment.

**Contributing factors:**

1. **No CI pipeline** — tests are run manually; no gate prevents deployment of broken code.
2. **Dev-mode-only test design** — all D-suites assume `start-mcp-server.js` is running interactively.
3. **Legacy tool deception** — `listWindows` MCP tool appears to work (it's under `handleToolsCall`) but routes to the mock `AutomationEngine`, not `KeyWin.exe`. Tests pass because the mock returns data.
4. **No service-install step in test setup** — the test runner bootstraps a Node.js process, not a Windows Service.

---

## 6. References

- [`docs/specs/SESSION0_ISOLATION.md`](docs/specs/SESSION0_ISOLATION.md) — Session 0 compatibility matrix
- [`docs/architecture/decisions/ADR-017-mcp-tool-hierarchy.md`](docs/architecture/decisions/ADR-017-mcp-tool-hierarchy.md) — tool hierarchy ruling
- [`test/e2e/index.js`](test/e2e/index.js) — test runner
- [`test/e2e/d9-helper-schema.js`](test/e2e/d9-helper-schema.js) — helper schema tests
- [`tools/diag/check-session.ps1`](tools/diag/check-session.ps1) — Session 0 diagnostic
