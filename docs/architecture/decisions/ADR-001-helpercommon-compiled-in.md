# ADR-001 — HelperCommon.cs: Compiled-In, Not a DLL

**Status:** Accepted  
**Date:** 2026-01  
**Deciders:** plachy

---

## Context

Multiple C# helper executables (`KeyWin.exe`, `BrowserWin.exe`, `MSOfficeWin.exe`,
`LibreOfficeWin.exe`) share boilerplate for transport handling (stdin, named pipe, HTTP),
JSON parsing, auth handshakes and HMAC signing. The obvious refactoring is to put this in
a shared `HelperCommon.dll`.

## Decision

`tools/helpers/common/HelperCommon.cs` is **added as a source file** to each helper's `csc`
compile line. The shared code is baked into every `.exe` binary — no separate DLL is produced
or loaded at runtime.

## Rationale

### Binary integrity verification

Each helper is SHA-256 hashed and the hash stored in `security/config.json`. The helper itself
calls `sec_validate_signature(selfPath)` before processing any input and exits with code 77
(`SECURITY_TAMPER`) if the hash does not match.

A separate `HelperCommon.dll` could be **swapped without changing the `.exe` hash**, which
would defeat binary integrity verification entirely.

### Simplicity of deployment

Single-file executables: no DLL installation path, no GAC registration, no version mismatch
between `.exe` and `.dll`. Each helper is independently deployable — copy the `.exe` and it
works.

### Cross-platform

`HelperCommon.cs` can be compiled into .NET Framework 4.0 (Windows) and .NET 6+ (Linux/macOS)
binaries without any platform adapter. A separate DLL would require per-platform build and
distribution.

## Consequences

- Every change to `HelperCommon.cs` requires a full rebuild of all helpers — acceptable given
  the build takes < 10 s total.
- Binary size increases slightly (≈ 15 KB per helper) — irrelevant for desktop automation.
- Each helper's binary hash changes when shared boilerplate changes — all hashes in
  `security/config.json` must be updated via the post-build hash step.

## File location

```
tools/helpers/common/HelperCommon.cs    ← shared source
tools/helpers/win/KeyWin.cs             ← includes HelperCommon in compile line
tools/helpers/browser/BrowserWin.cs     ← same
tools/helpers/office/MSOfficeWin.cs     ← same
tools/helpers/office/LibreOfficeWin.cs  ← same
```
