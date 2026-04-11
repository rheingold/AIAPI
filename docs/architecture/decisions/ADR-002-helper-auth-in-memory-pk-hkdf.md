# ADR-002 — Helper Authentication: In-Memory Private Key + HKDF Session Key

**Status:** Accepted  
**Date:** 2026-01  
**Deciders:** plachy

---

## Context

The MCP server needs to authenticate each helper process before it starts accepting commands.
The original design passed a session HMAC secret via environment variables (`MCP_SESSION_TOKEN`,
`MCP_SESSION_SECRET`). This approach has several problems:

- Environment variables appear in `tasklist /v` and Process Explorer — secrets are visible
  to any process running as the same user.
- The secret must be generated and stored somewhere accessible — it leaks across restarts.
- The `.exe` helpers cannot independently verify the integrity of the security config they
  receive (no private key available on their side).

## Decision

Replace env-var credential passing with a **two-message `_auth_hello` / `_auth` handshake**
over the stdin pipe, using the decrypted RSA private key as the shared secret from which both
sides independently derive a HKDF session key.

### Handshake flow

```
[Helper starts]                                [MCP Server]
   │                                               │
   │  1. sec_validate_signature(selfPath)           │  (private.key.enc decrypted at
   │     — verify own exe + DLL hashes FIRST        │   server startup; raw PK bytes
   │     before reading ANY stdin                   │   held in memory only)
   │                                               │
   ├─ _auth_hello  ──────────────────────────────> │
   │   helperNonce, exeHash, dllHash               │  server verifies exeHash vs config.json
   │                                               │
   │ <─────────────────────────────────────────── _auth
   │   pk (raw PKCS#8), serverNonce,               │  raw private key bytes sent over
   │   securityConfig path, helperExePath          │  in-process pipe only; never on disk
   │                                               │
   │  2. sec_load(pk_bytes, configPath)            │
   │     verify config.json.sig with pk            │
   │  3. HKDF-SHA256(pk, SHA256(svrN‖hlpN),        │  same computation on server side
   │       "AIAPI-v1-session") → sessionKey        │
   │                                               │
   ├─ _auth_ok  ────────────────────────────────>  │
   │                                               │
   │  All subsequent messages: HMAC-SHA256(        │  server verifies on receipt
   │    sessionKey, JSON body) in "hmac" field     │
```

## Rationale

| Old (env-var HMAC secret) | New (in-memory PK + HKDF) |
|---|---|
| Secret visible in process listing | PK bytes only in pipe buffer (never env) |
| Helper needs pubkey on disk | Helper needs no key files |
| Session secret transmitted | Session key never transmitted — derived |
| Helper cannot verify security config | Helper verifies config.json.sig with PK |
| No tamper detection | sec_validate_signature exits 77 on tamper |

### Why HKDF over sending the session key directly

Both sides independently derive `sessionKey = HKDF(pk, SHA256(serverNonce ‖ helperNonce), "AIAPI-v1-session")`.
The PK bytes (the HKDF input key material) are already shared as part of the `_auth` message.
Neither side transmits the session key — a passive observer who captures the pipe traffic
cannot replay messages because each request sequence number produces a unique HMAC input.

### Why stdin pipe only (no `--token=` CLI arg for the PK)

Command-line arguments are:
1. Visible in `tasklist /v` / Process Explorer / `/proc/PID/cmdline`
2. Capped at ≈ 4096 bytes (older Windows) — a 4096-bit RSA private key alone exceeds this

The stdin pipe is in-process memory; never hits disk, never appears in process listings.

## Consequences

- `MCP_SESSION_TOKEN` and `MCP_SESSION_SECRET` env vars have been removed from `HelperRegistry.buildEnv()`.
- `SKIP_SESSION_AUTH=true` env var is retained as a developer bypass flag (NOT for production).
- Helpers launched without the auth handshake (e.g. direct CLI invocation) will block until
  auth completes, or exit if `SKIP_SESSION_AUTH=true` is set.
- `security/config.json` must contain the SHA-256 hashes of all helper executables before the
  server starts (populated by the post-build hash step in `build-all.ps1`).
- `SecurityLib.dll` / `SecurityLib.so` must be built and present; helpers P/Invoke into it for
  `sec_load()`, `sec_validate_signature()`, `sec_hkdf_sha256()`.

## Status of implementation

- `HelperRegistry.ts` — `HelperDaemon.startupPhase`, `handleStartupMessage()`, `readyPromise`,
  HKDF derive on `_auth_ok`, per-message HMAC in `call()` ✅
- `HelperCommon.cs` — `RunAuthHandshake(skipAuth)`, `sec_load()`, HKDF wired ✅
- Gate A incomplete: `SKIP_SESSION_AUTH` not flipped to `false` by default yet.
