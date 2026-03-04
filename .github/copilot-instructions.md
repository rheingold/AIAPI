# Copilot workspace instructions

## Key files — read before every session
| File | Purpose |
|------|---------|
| `CONVENTIONS.md` | **Authoritative vocabulary**: all commands, targets, file locations, settings keys, REST endpoints, XML constructs. Read in full before any implementation. |
| `ai.txt` | Terminal usage rules (background vs. foreground, isBackground policy). |
| `TODO.md` | Current priority queue and backlog. |
| `docs/architecture/SECURITY_ARCHITECTURE.md` | Security model, filter chain, binary signing. |
| `docs/api/API.md` | Public API reference. |

## Search-first protocol — MANDATORY, no exceptions
Before writing any code or proposing any new construct:
1. Read `CONVENTIONS.md` fully.
2. `semantic_search` — does anything like X already exist?
3. `grep_search` — does a symbol/command/id named X already exist?
4. `file_search` — does the file you are about to create already exist?
5. State what you are **reusing** (file + symbol) or why nothing covers the need.

If the thing to be created already exists in CONVENTIONS.md — extend it, do NOT create a parallel version.

## Hard reuse constraints (from CONVENTIONS.md)
- **Commands**: `SENDKEYS` `CLICKID` `READ` `LISTWINDOWS` `LAUNCH` `KILL` `CDP_*` — no new names without updating CONVENTIONS.md.
- **Targets**: `HANDLE:` `PAGE:` `chrome:` `SYSTEM` — no new prefixes.
- **App templates**: check `apptemplates/` first.
- **REST endpoints**: check CONVENTIONS.md §6 first.
- **Settings keys**: check CONVENTIONS.md §5 first.
- **Source files**: check CONVENTIONS.md §4 for canonical locations.

## General behaviour
- Implement, don't suggest.
- Independent edits — single `multi_replace_string_in_file` call.
- No unsolicited summary/doc markdown files.
- After TS edits — run `get_errors` to verify clean compile.
