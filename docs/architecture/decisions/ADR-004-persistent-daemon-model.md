# ADR-004 — Helper Daemon Model: Persistent Process per Helper

**Status:** Accepted  
**Date:** 2026-01  
**Deciders:** plachy

---

## Context

The original design spawned a fresh helper `.exe` process for every MCP tool call
(`--inject-mode=direct tmpFile`). Each call required:

1. Spawn a new process
2. Write a temp JSON file to disk
3. Wait for process exit
4. Read result from stdout

Typical round-trip latency: 200–800 ms (process startup dominates).

## Decision

Each discovered helper runs as a **persistent daemon** (`--listen-stdin --persistent`).
`HelperRegistry.ts` spawns one daemon per helper at server startup and reuses it for all
subsequent calls via a sequential JSON-line request queue.

### Transport

`HelperRegistry` communicates with daemons via their stdin/stdout pipe:
- Request: single JSON line written to stdin
- Response: single JSON line read from stdout
- The daemon loops forever, processing one request at a time

Multiple concurrent MCP calls to the same helper are serialised via a `Promise`-based queue
in `HelperDaemon.call()`.

### Lifecycle

```
Server start  →  discoverHelpers()  →  spawn daemon  →  auth handshake  →  ready
                                       (one per helper)
MCP call      →  queue.enqueue()    →  write JSON to stdin  →  read response
Server stop   →  shutdownAll()      →  send {"action":"_exit"}  →  wait for exit
```

Auto-restart: if a daemon crashes (exits unexpectedly), `HelperDaemon` detects `process.exit`
and restarts it (up to N times) before failing the current call with an error.

## Rationale

### Performance

Zero process-spawn overhead per call. A calculator click sequence of 10 calls that previously
took 3–8 s completes in < 500 ms with persistent daemons.

### Single auth handshake

The `_auth_hello / _auth` handshake (see ADR-002) runs once at daemon startup. All subsequent
calls are already authenticated — no per-call key derivation.

### Named-pipe transport for multi-client access

Helpers also support `--listen-pipe=Name` for external scripts/test harnesses. The daemon model
and pipe model are orthogonal — a daemon can simultaneously serve MCP server requests on stdin
and accept named-pipe clients.

## Consequences

- **`.exe` files are locked while daemons are running.** Rebuilding (`build-all.ps1`) requires
  stopping the server first (Ctrl+C sends `_exit` — clean shutdown) or killing the helper processes.
  Documented in `START_HERE.md`.
- `POST /api/helpers/reload` endpoint and `helpers/reload` MCP method allow hot-reload of
  helper schemas without full server restart.
- Test runner (`test-full-stack-stdin.js`) has a `reloadHelpers()` helper function and
  `--self-hosted --rebuild-first` flags for fully-unattended CI.

## Supersedes

The `--inject-mode=direct tmpFile` mechanism. All references to `fs.writeFileSync(tmpFile)`,
`os.tmpdir()`, and `--inject-mode` have been removed from `HelperRegistry.ts`.
