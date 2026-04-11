# AIAPI — Documentation Index

> Last updated: 2026-04

---

## Quick start

| Purpose | File |
|---------|------|
| New developer / AI assistant | [guides/AI_ASSISTANT_MANUAL.md](guides/AI_ASSISTANT_MANUAL.md) |
| Server setup & running | [guides/SERVER_GUIDE.md](guides/SERVER_GUIDE.md) |
| Dev environment setup | [START_HERE.md](../START_HERE.md) |
| Authoritative vocabulary (commands, targets, REST, wire protocol) | [CONVENTIONS.md](../CONVENTIONS.md) |
| Prioritised task backlog | [TODO.md](../TODO.md) |

---

## API references

| File | Covers |
|------|--------|
| [api/API.md](api/API.md) | High-level MCP tool API concepts |
| [api/KEYWIN_API.md](api/KEYWIN_API.md) | KeyWin.exe — Win32/UIA commands, XPath addressing |
| [api/OFFICE_API.md](api/OFFICE_API.md) | MSOfficeWin.exe / LibreOfficeWin.exe — COM/UNO commands |
| [api/SERVER_API.md](api/SERVER_API.md) | MCP server HTTP REST endpoints (dashboard, filters, sessions) |

---

## Architecture

| File | Covers |
|------|--------|
| [architecture/CODEBASE_MAP.md](architecture/CODEBASE_MAP.md) | **Full codebase walkthrough** — folder layout, chapters 1-7, startup flow, dispatch flow, ADR index |
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | System architecture & design principles |
| [architecture/SECURITY_ARCHITECTURE.md](architecture/SECURITY_ARCHITECTURE.md) | Security model — filter chain, binary signing, auth handshake, trust boundaries |

### Architecture Decision Records

| ADR | Title |
|-----|-------|
| [ADR-001](architecture/decisions/ADR-001-helpercommon-compiled-in.md) | HelperCommon.cs: Compiled-In, Not a DLL |
| [ADR-002](architecture/decisions/ADR-002-helper-auth-in-memory-pk-hkdf.md) | Helper Auth: In-Memory PK + HKDF Session Key |
| [ADR-003](architecture/decisions/ADR-003-securitylib-native-cpp.md) | SecurityLib: Native C++ DLL / .so |
| [ADR-004](architecture/decisions/ADR-004-persistent-daemon-model.md) | Helper Daemon Model: Persistent Process |
| [ADR-005](architecture/decisions/ADR-005-unified-action-addressing.md) | Unified XPath-Style Action Addressing |
| [ADR-006](architecture/decisions/ADR-006-ai-consent-tier-system.md) | AI Consent Tier System |
| [ADR-007](architecture/decisions/ADR-007-universal-installer-idempotent-setup.md) | Universal Installer: Idempotent, Re-runnable Setup |

---

## Guides

| File | Covers |
|------|--------|
| [guides/AI_ASSISTANT_MANUAL.md](guides/AI_ASSISTANT_MANUAL.md) | Complete operational guide for AI assistants — examples & troubleshooting |
| [guides/SERVER_GUIDE.md](guides/SERVER_GUIDE.md) | Server administration, startup flags, security setup |
| [guides/QUICK_REF.md](guides/QUICK_REF.md) | Quick-reference card for common operations |
| [guides/LINUX_MAC_PORTING.md](guides/LINUX_MAC_PORTING.md) | Linux/macOS portability notes and porting guide |

---

## Specs

| File | Covers |
|------|--------|
| [specs/COMMAND_ALIGNMENT.md](specs/COMMAND_ALIGNMENT.md) | Command naming conventions across all helpers |
| [specs/SCENARIO_FORMAT.md](specs/SCENARIO_FORMAT.md) | XML/JSON scenario file format spec |
| [specs/BINARY_HASH_VERIFICATION.md](specs/BINARY_HASH_VERIFICATION.md) | Helper binary integrity verification protocol |
| [specs/ELEMENT_IDENTIFICATION.md](specs/ELEMENT_IDENTIFICATION.md) | Element identification strategy (XPath, ID, name, index) |
| [specs/ERROR_CODES.md](specs/ERROR_CODES.md) | Complete error code reference and remediation |
| [specs/DASHBOARD_SECURITY.md](specs/DASHBOARD_SECURITY.md) | Dashboard security model and filter rule format |
| [specs/PRIVILEGED_MODE.md](specs/PRIVILEGED_MODE.md) | Privileged / admin mode operations |
