# ADR-006 — AI Consent Tier System

**Status:** Proposed — not yet implemented  
**Date:** 2026-01  
**Deciders:** plachy

---

## Context

AI agents (LLMs calling AIAPI via MCP) can perform actions with varying levels of user
impact — from passive reads to destructive shell commands or privacy-sensitive system
queries. Currently the system has two modes: fully allowed or security-filter blocked.
There is no middle ground where the AI is expected to ask the human first.

This is not purely a security concern — it is also a **trust and UX concern**. Users need to
understand what the AI is doing on their behalf, especially for surprising or potentially
irreversible operations.

## Decision

Define four **consent tiers** annotated on every command in the MCP API schema:

| Tier | Symbol | Required AI behaviour | Example commands |
|---|---|---|---|
| **IMPLICIT** | 🟢 | No prompt needed | `LISTWINDOWS`, `QUERYTREE`, `READ`, `LISTDOCS` |
| **NOTIFY** | 🟡 | Inform user on first use per session | `NEWDOC`, `FOCUS`, `NAVIGATE` |
| **CONFIRM** | 🔴 | Ask in chat before first use per session | `LAUNCH`, `SENDKEYS`, `WRITEFILE`, web fetch |
| **ALWAYS** | ⛔ | Ask on every invocation (no session grant) | Shell exec, system info, location, BT scan |

Each command's `--api-schema` / `_schema` JSON output includes a `"consentTier"` field.

### Three-layer enforcement model

**Layer 1 — Prompt engineering (always active):**  
The tier annotation in the schema description tells the AI model what to do before calling
the tool. Example schema description prefix: `"[🔴 CONFIRM first] ..."`. No server code needed.

**Layer 2 — Chat approval buttons (optional, AI-side):**  
AI embeds a structured token in its reply:
```
[[AIAPI-CONSENT: helper=ShellWin action=EXEC session=true]]
```
A future VS Code extension UI renders this as Approve / Deny buttons. If the chat UI does
not support it, the AI falls back to plain-language asking (Layer 1).

**Layer 3 — Server-side consent gate (configurable):**  
Setting `consentMode` in `config/dashboard-settings.json`:
- `"ai"` (default) — rely on Layer 1; server does not prompt independently
- `"server"` — server opens a tray toast before dispatching CONFIRM/ALWAYS commands
- `"silent"` — no consent; for fully-trusted automated pipelines

Per-helper overrides: `"consentOverrides": { "ShellWin": "always", "SysWin": "always" }`.

## Rationale

### Why tiers rather than binary allow/deny

Security filters handle *what the system permits*. Consent tiers handle *what the AI should
ask about first*. These are orthogonal: an admin may `ALLOW * → ShellWin::{EXEC}` in the
filter (system permits it) while still requiring the AI to ask the user before each execution
(consent tier ALWAYS). Both controls are needed.

### Why Layer 1 is always active and sufficient for most deployments

LLMs generally follow schema descriptions. Embedding the tier obligation directly in the
command description string costs nothing and reaches every AI model — no server infrastructure
required. Layers 2 and 3 add UI and enforcement for stricter deployments.

### Why some commands are ALWAYS rather than session-scoped

Commands that return hardware location, nearby WiFi/Bluetooth SSIDs, or run destructive shell
operations carry asymmetric privacy/safety risk. A session-level grant ("yes, use shell this
session") is too broad — each invocation should have an explicit justification visible to the
user.

## Consequences

- All `--api-schema` / `_schema` command entries must include `"consentTier"` (one of:
  `"implicit"`, `"notify"`, `"confirm"`, `"always"`).
- `docs/guides/AI_ASSISTANT_MANUAL.md` must explain the tier system to AI consumers of the
  API.
- Layer 3 implementation requires a tray/toast agent or WinRT ToastNotification (Windows 10+).
- `CONVENTIONS.md §7` (to be written) defines the tier vocabulary and `consentMode` setting.

## Implementation checklist (see TODO.md P1.e)

- [ ] Annotate all existing command schemas with `consentTier`
- [ ] Update `docs/api/API.md` with tier table
- [ ] Add `consentMode` to settings schema (`CONVENTIONS.md §5`)
- [ ] Dashboard: Consent panel in Security tab (session grants, tier overrides, revoke-all)
- [ ] Layer 3 server gate (requires tray agent — deferred post-1.0)
