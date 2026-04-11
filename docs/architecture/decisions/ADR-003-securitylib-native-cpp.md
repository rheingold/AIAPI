# ADR-003 — SecurityLib: Native C++ DLL / .so, Not C#

**Status:** Accepted  
**Date:** 2026-01  
**Deciders:** plachy

---

## Context

A single security enforcement component (`SecurityLib`) must be used by all helper executables.
It needs to: verify binary hashes (SHA-256), execute HKDF key derivation (HMAC-SHA256), parse
and evaluate security filter rules, and verify `config.json.sig`.

The C# helpers already use P/Invoke for Win32 APIs. The obvious choice for a shared security
library would be a C# class library, but this conflicts with the compiled-in model
(see ADR-001).

## Decision

`SecurityLib` is a **native C++ DLL** (Windows: `SecurityLib.dll`, Linux/macOS: `SecurityLib.so`).
C# helpers load it via P/Invoke at runtime.

## Rationale

### Cross-platform from day one

Future helpers will be written in C (Linux `KeyLin`), Python (script helpers), or TypeScript (Node-based).
A C ABI (`.dll` / `.so`) is callable from all of these via `ctypes`, `N-API`, `dlopen`, or P/Invoke.
A C# class library is callable only from .NET callers.

### OS-native crypto (no NuGet dependencies)

- **Windows:** `BCrypt.dll` (part of Windows 7+) — SHA-256, HMAC-SHA256, no third-party
  dependency. Available on every supported Windows version.
- **Linux:** `libgcrypt` or OpenSSL — standard on all distros; no package install required.
- **macOS:** `CommonCrypto` — built into macOS SDK.

A C# equivalent would pull in `System.Security.Cryptography` which is fine for .NET 6+
but has limitations on .NET Framework 4.0 (HKDF was only added in .NET 5).

### Independent verification without loading the .NET runtime

The DLL hash itself is stored in `security/config.json`. Before P/Invoking into `SecurityLib`,
the helper verifies the DLL's SHA-256 using only Win32 APIs (BCrypt file hash). This bootstrap
step cannot depend on any .NET class library — it must use raw WinAPI or C code.

### API surface

```c
int  sec_load(const char* configPath, const char* password);
int  sec_validate_signature(const char* exePath);
int  sec_validate_action(const char* action, const char* target,
       const char* processName, const char* processPath,
       const char* processHash, int processId,
       const char* callerUser, const char* callerRoles);
int  sec_hkdf_sha256(const uint8_t* pk, int pkLen, const uint8_t* salt, int saltLen,
       const char* info, uint8_t* out, int outLen);
void sec_unload();
```

Return value semantics: `0` = success, negative = error code.
`sec_validate_action` returns: `1` = ALLOW, `0` = DENY, `2` = ASK (treated as DENY), negative = error.

## Consequences

- Build requires MSVC (`cl.exe`) on Windows; `build-all.ps1` checks for its presence and
  skips the SecurityLib build with a warning if MSVC is not installed.
- Linux/macOS build requires `gcc`/`clang`; separate CI jobs required.
- `SecurityLib.dll` hash must be written to `security/config.json` as part of the build process
  (post-build PowerShell step — **currently a Gate A TODO item**).
- C# P/Invoke declarations live in `HelperCommon.cs` in the `SecurityLib` static class.

## Current state

`tools/helpers/common/security/SecurityLib.cpp` + `SecurityLib.h` — implemented.
`sec_load`, `sec_validate_signature`, `sec_validate_action`, `sec_hkdf_sha256`,
`sec_validate_signature_self()` all implemented. Post-build hash step pending (Gate A).
