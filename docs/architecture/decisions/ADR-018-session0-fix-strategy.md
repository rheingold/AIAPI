# ADR-018 — Session 0 Isolation Fix Strategy

**Date:** 2026-05-21  
**Status:** Accepted  
**Deciders:** Architect (ARCH)  
**Supersedes:** Partial ruling in `docs/specs/SESSION0_ISOLATION.md` v1.0  
**Related:** ADR-007 (installer), TODO: `NEW-1`, `QA-3`, `N-0`, `F-2`

---

## Context

AIAPI can be deployed in three modes:

| Mode | Process session | UI automation |
|---|---|---|
| Interactive terminal (`node start-mcp-server.js`) | Session 1 (user) | ✅ Full access |
| Task Scheduler "interactive" task | Session 1 (user) | ✅ Full access |
| Windows Service (`AIAPIService`) | Session 0 (system) | ❌ Broken |

When running as a Windows Service, all child processes — including `KeyWin.exe`,
`BrowserWin.exe`, `MSOfficeWin.exe`, and `LibreOfficeWin.exe` — are spawned in
**Windows Session 0**. This is the non-interactive system session introduced in
Vista/Server 2008. Win32, UIA, COM, and input APIs are all session-scoped.

The full technical impact analysis is documented in
[`docs/specs/SESSION0_ISOLATION.md`](../../specs/SESSION0_ISOLATION.md).

### Problem scope per helper (summary)

| Helper | Session 0 impact |
|---|---|
| `NativeWin` (`fs_*`, `fetch_webpage`) | ✅ Unaffected |
| `exec_cmd` | ⚠️ Console-only; GUI apps invisible |
| `KeyWin.exe` | ❌ All commands broken or silently wrong |
| `BrowserWin.exe` — CDP path | ⚠️ Partially works if browser pre-started by user |
| `BrowserWin.exe` — UIA/launch path | ❌ Broken |
| `MSOfficeWin.exe` | ❌ All commands broken (COM ROT per-session) |
| `LibreOfficeWin.exe` — UNO socket | ⚠️ Partially works if LO pre-started by user |
| `LibreOfficeWin.exe` — COM fallback / launch | ❌ Broken |

---

## Decision

### Adopt a three-phase strategy: Document → VSIX → Bridge

#### Phase 1 — v1.0: Document the Boundary (current)

**Stance:** Service mode is explicitly documented as **NativeWin-only**.
UI automation in service mode is an unsupported configuration.

**What is implemented:**
- `_sessionWarning` field in `LISTWINDOWS` response when `IsSession0()` is true (already done)
- [`tools/diag/check-session.ps1`](../../../tools/diag/check-session.ps1) diagnostic script (already done)
- Task Scheduler workaround documented in `SESSION0_ISOLATION.md` §7.2 (already done)
- QA-3: extend `_sessionWarning` to ALL affected commands — not just `LISTWINDOWS`

**Rationale for Phase 1 only at v1.0:**
- Option A (`WTSQueryUserToken` + `CreateProcessAsUser`) requires `SeTcbPrivilege` — the
  highest Windows OS privilege, a significant security surface area, and non-trivial C++
  native module work. The risk/complexity ratio is not justified before the product has
  field-tested deployments.
- Option B (bridge process) requires a new binary, an IPC protocol, and startup lifecycle
  management — this is follow-on infrastructure that builds on N-0 (VSIX) which is the
  primary delivery channel for v1.0.
- The majority of v1.0 users will **use the VSIX extension**, which runs in the VS Code
  process (always Session 1). Service mode is an advanced deployment option.

---

#### Phase 2 — post-N-0: VS Code Extension as the primary user-session channel

**Stance:** The VSIX extension (N-0) is the canonical solution for Session 0 bypass.
Users who need UI automation in a "service-like" experience install the VSIX.

**How it works:** `extension.ts` `activate()` starts the full MCP server + helper daemons
inside the VS Code process, which always runs in the interactive user session. No session
bypass, no privilege escalation — the session isolation problem simply does not exist.

**Port allocation:**
- Service (Session 0, NativeWin-only): port 4457 (existing)
- VSIX (Session 1, all helpers): port 3457 (existing)

AI clients can target either endpoint; the choice determines what capabilities are available.

**MCP client configuration pattern:**
```json
{
  "mcpServers": {
    "aiapi-ui":   { "url": "http://localhost:3457/sse" },
    "aiapi-svc":  { "url": "http://localhost:4457/sse" }
  }
}
```

---

#### Phase 3 — post-F-2 MSI installer: AiapiBridge.exe companion process

**Stance:** For deployments without VS Code (headless servers, CI/CD), implement
`AiapiBridge.exe` — a lightweight user-session relay that the service routes UI
automation commands through.

**Architecture:**

```
[Session 0]                          [Session 1 / User]
MCP Server (port 4457)
  └── HelperRegistry.ts
        ├── NativeWin (direct)  ──── (no relay needed)
        └── BridgeClient        ──── named pipe ──→ AiapiBridge.exe
                                                        ├── KeyWin.exe
                                                        ├── BrowserWin.exe
                                                        ├── MSOfficeWin.exe
                                                        └── LibreOfficeWin.exe
```

**IPC protocol:** Named pipe `\\.\pipe\AIAPI-Bridge-{sessionId}` with JSON-line
framing identical to the existing helper stdin protocol. The bridge adds a session
routing header `"_bridgeSessionId"` for multi-user (RDP) support.

**Bridge startup:** Registered as a Task Scheduler "At Logon" task by the MSI installer.
VSIX `activate()` can also start it as a child process (bridge persists when VSIX stops
via separate lifetime management).

**Authentication:** Bridge authenticates to the service using the same HKDF session key
mechanism as helpers — no new auth protocol needed.

---

## Consequences

### Positive

1. **Zero security risk at v1.0** — no privilege escalation; service remains under
   standard service account constraints.
2. **VSIX solves 90% of the use-case** — VS Code is the AI agent's primary environment;
   the extension is the natural deployment path.
3. **Clean architecture** — NativeWin / UI automation split is explicit and testable;
   future bridge work has a well-defined interface.
4. **Cross-platform alignment** — Option C (VSIX) is the solution on Linux and macOS too;
   Option B (bridge) maps to systemd user units and LaunchAgents. No platform-specific
   hacks.
5. **N-2i improvement** — when `UiBackendDetector` lands (N-2i), it returns a clean
   `DispatchResult` with an explicit session error rather than today's silent failures.

### Negative / Accepted Trade-offs

1. **Service mode is NativeWin-only at v1.0** — users who deploy service-only without
   VS Code cannot do UI automation until Phase 3 (bridge). Documented and mitigated by
   Task Scheduler workaround.
2. **Two server endpoints** — AI clients need to know which port to target. Mitigated by
   `AutomateUI` tool surfacing all capabilities and flagging session-blocked ones.
3. **Bridge adds a new binary** (Phase 3) — one more component to build, test, and ship.
   Deferred until MSI installer justifies the packaging effort.

---

## Rejected Alternatives

### Option A — `WTSQueryUserToken` + `CreateProcessAsUser`

**Why rejected for v1.0:**
- Requires `SeTcbPrivilege` — the OS-level "act as part of the operating system" privilege.
  This is a significant security boundary violation and a meaningful attack surface.
- Requires C++ native Node.js addon (or `node-ffi-napi`) with non-trivial `wtsapi32.h`
  P/Invoke — adds a build dependency and a crash vector in native code.
- Multi-session (RDP) corner cases are complex: must determine *which* session to spawn into,
  handle session switches, etc.
- **Can be revisited** if Phase 3 (bridge) proves insufficient or if a security review
  determines the risk is acceptable in a specific deployment context.

### Option D — Session-Aware Dynamic Dispatch

**Why rejected:**
- Equivalent complexity to Option B without Option B's clean separation.
- Discovery of the user-session agent is itself a session-scoped operation — circular problem.
- Superseded by Option B which has a cleaner design.

---

## Implementation Tasks (ordered)

### Phase 1 tasks (v1.0 gate)

| ID | Task | File(s) | Priority |
|---|---|---|---|
| QA-3 | Inject `_sessionWarning` in ALL affected commands when `IsSession0()` | `WinCommon.cs`, each helper's `DispatchCommand()` | 🔴 high |
| QA-6 | New test suite `d20-service-mode.js` — verifies session warnings and NativeWin pass-through | `test/e2e/d20-service-mode.js` | 🟡 medium |
| SESSION0-DOC | Update `docs/guides/SERVER_GUIDE.md` §Deployment with Session 0 section | `SERVER_GUIDE.md` | 🟡 medium |

### Phase 2 tasks (post-N-0)

| ID | Task | File(s) | Priority |
|---|---|---|---|
| VSIX-PORT | Document 3457 vs 4457 split in `SERVER_GUIDE.md` + `QUICK_REF.md` | docs | 🟡 medium |
| VSIX-CAPS | `listHelpers` response in service mode flags session-blocked helpers with `"sessionBlocked": true` | `mcpServer.ts`, `HelperRegistry.ts` | 🟡 medium |

### Phase 3 tasks (post-F-2)

| ID | Task | File(s) | Priority |
|---|---|---|---|
| BRIDGE-SPEC | Write `docs/specs/BRIDGE_PROTOCOL.md` — named pipe IPC spec | docs/specs/ | ⚪ backlog |
| BRIDGE-IMPL | Implement `AiapiBridge.exe` C# console app | `components/helpers/windows/src/AiapiBridge.cs` | ⚪ backlog |
| BRIDGE-REGISTRY | Add `BridgeClient` routing mode in `HelperRegistry.ts` | `HelperRegistry.ts` | ⚪ backlog |
| BRIDGE-INSTALLER | MSI installer registers bridge as Task Scheduler "At Logon" task | `build/` installer scripts | ⚪ backlog |

---

## Appendix: Session 0 Detection (`IsSession0()`)

Current implementation in [`components/helpers/shared/src/WinCommon.cs`](../../../components/helpers/shared/src/WinCommon.cs):

```csharp
public static bool IsSession0()
{
    return System.Diagnostics.Process.GetCurrentProcess().SessionId == 0;
}
```

This is called in `ListWindowsJson()`. After QA-3 it will be called in every
UI-impacting command before dispatch. The check is cheap (~1 μs) and safe to call
on every request.
