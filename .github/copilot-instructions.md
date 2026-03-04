# Copilot workspace instructions

## MANDATORY SEARCH-FIRST PROTOCOL

**Before writing a single line of new code or proposing any new construct,
you MUST execute the search steps below. No exceptions.**

This is not a suggestion. Violating this protocol produces duplicate, overlapping
code and wastes the user's time. The user cannot hold the entire codebase in their
head — you can read it instantly. Do so.

---

### Step 1 — Read the vocabulary constraint file

Read `CONVENTIONS.md` in full before responding to any implementation request.
It lists every existing command, target scheme, file location, settings key,
REST endpoint, and XML construct. If the thing you are about to create already
exists there, STOP and extend the existing one instead.

### Step 2 — Search for existing implementations

For every concept in the user's request, run at minimum:

1. `semantic_search` — broad concept search ("does anything like X exist?")
2. `grep_search` — exact symbol/string search for the specific name/ID you are
   about to introduce ("does a function/class/command named X already exist?")
3. `file_search` — for any file you are about to create ("does this file already
   exist, perhaps under a different path?")

Run these **before** forming a solution, not after. Report what you found.

### Step 3 — State what you are reusing

Before writing any code, state explicitly:
- What existing construct you are extending (file + symbol name)
- Why no existing construct covers the need (if creating something genuinely new)

---

## REUSE RULES (derived from CONVENTIONS.md)

- **Commands**: only `SENDKEYS`, `CLICKID`, `READ`, `LISTWINDOWS`, `LAUNCH`, `KILL`,
  and `CDP_*` prefixed commands exist. Do NOT invent new command names.
- **Targets**: `HANDLE:`, `PAGE:`, `chrome:`, `SYSTEM` — do NOT invent new prefixes.
- **App templates**: check `apptemplates/` before creating a new one.
- **REST endpoints**: check §6 of CONVENTIONS.md before adding a new route.
- **Settings keys**: check §5 of CONVENTIONS.md before adding a new key.
- **Source files**: check §4 of CONVENTIONS.md for canonical file locations.

## GENERAL BEHAVIOUR

- Implement changes rather than only suggesting them.
- Make all independent edits in a single parallel tool call (multi_replace_string_in_file).
- Do NOT create summary/documentation markdown files unless explicitly asked.
- After any file edit, verify with get_errors that TypeScript still compiles cleanly.
