# ADR-007 — Universal Installer: Idempotent, Re-runnable Setup

**Status:** Accepted  
**Date:** 2026-04  
**Deciders:** plachy

---

## Context

AIAPI can be installed through several vectors:

1. **VS Code extension install** — user installs from Marketplace; the extension activates
   but the setup wizard may be dismissed or skipped.
2. **npm global install** — `npm install -g aiapi-server`; no GUI, no wizard.
3. **Standalone `.exe`** — single packaged binary (`aiapi-server-win-x64.exe`) via GitHub
   Releases or NSIS installer; user may skip optional steps.
4. **Windows Service** — installed via `scripts/install-win.ps1` + NSSM; may be set up by
   an admin who did not run the initial setup wizard.

In all four cases, the first-run experience may be incomplete:
- Crypto keys not generated
- `security/config.json` not signed
- Helper hashes not recorded
- Firewall rules not created
- Dashboard password not set

Currently `scripts/install-win.ps1` handles some of this, but it is not idempotent (re-running
it errors on existing files/services) and it is not reachable post-install from the dashboard
or via a simple npm script.

---

## Decision

A single **setup entry point** (`npm run setup` / `npx aiapi-setup`) is the canonical way
to run or re-run the setup wizard. It must be:

1. **Idempotent** — safe to run multiple times. Re-running never destroys existing data; it
   detects what is already present and skips or patches only the missing parts.
2. **Re-reachable from the dashboard** — the Dashboard Settings tab exposes a
   "Re-run Setup Wizard" button that calls `POST /api/_internal/setup` and streams output.
3. **Vector-agnostic** — the same setup logic runs regardless of install vector. VS Code
   extension install hook, npm postinstall, and NSIS installer post-install step all call
   the same underlying function/script.
4. **Resumable** — each setup step is independently checkpointed. If a step fails
   (e.g., firewall rule creation requires elevation), the user can fix the issue and re-run;
   prior completed steps are not repeated.

### Setup steps (ordered, each guarded by a completion check)

| Step | Check | Action |
|------|-------|--------|
| S1 | `security/private.key.enc` exists | Generate RSA-2048 key pair, encrypt with user password |
| S2 | `security/config.json` exists + `.sig` valid | Generate `config.json`; sign with `ConfigSigner` |
| S3 | All helper exe hashes in `config.json` | Run `IntegrityChecker.recordHashes()` |
| S4 | `config/dashboard-settings.json` exists | Write default settings template |
| S5 | Dashboard admin user in store | Create default admin account (prompts for password) |
| S6 | Firewall rules for ports 3457/3458 | `netsh advfirewall` (requires elevation; skipped if non-admin) |
| S7 | Windows Service registered (optional) | NSSM install (skipped if `--no-service` flag) |

### Implementation structure

```
scripts/setup/
  setup-core.js      Pure Node.js — all setup steps S1–S5 (no elevation needed)
  setup-win.ps1      Windows-only steps S6–S7 (elevation prompt if required)
  setup-index.js     Entry point: runs setup-core.js, then calls setup-win.ps1 if on Windows

package.json:
  "setup": "node scripts/setup/setup-index.js"
  "postinstall": "node scripts/setup/setup-index.js --silent"

Dashboard REST:
  POST /api/_internal/setup   → streams setup-core.js output as SSE
```

### Idempotency guarantee

Every step writes a **sentinel** on completion (e.g., a key in `config.json`, a file, a
registry value). The step function checks for the sentinel before running. This means:

- Re-running after a partial failure completes from where it stopped.
- Re-running on a fully configured system prints "all steps already complete" and exits 0.
- Force-override is possible via `--force-step=S3` flag (e.g., to re-record hashes after
  a helper rebuild).

---

## Rationale

### Why idempotent?

VS Code extension postinstall hooks, npm postinstall, and Windows Service restarts all
potentially re-trigger setup. A non-idempotent setup would corrupt keys or settings on
any re-invocation.

### Why dashboard-reachable?

Users who skipped the setup wizard during VS Code install have no obvious path back to
it short of uninstalling and reinstalling. A dashboard button (Settings tab →
"Re-run Setup Wizard") provides a safe, visible recovery path.

### Why a single entry point?

Avoids the current situation where setup logic is split across `install-win.ps1`,
first-run code in `start-mcp-server.ts`, and manual docs steps. A single canonical
`npm run setup` means the README, the CI, and the dashboard all point to the same thing.

---

## Consequences

- `scripts/install-win.ps1` is deprecated and archived once `setup-win.ps1` covers the
  same surface area.
- VS Code extension `package.json` `scripts.postinstall` calls `setup-index.js --silent`
  (no prompts; generates keys with a random password displayed once, stored in OS keychain).
- CI pipeline runs `npm run setup -- --non-interactive --force-step=all` before integration
  tests to ensure a clean known state.
- Dashboard must implement the `POST /api/_internal/setup` streaming endpoint (SSE) and
  the "Re-run Setup Wizard" UI in the Settings tab.

## Related

- TODO.md items: `### Installer & Deployment` (lines ~351–390) and `### Windows Installer (MSI/NSIS)` (lines ~1603–1618)
- [ADR-002](ADR-002-helper-auth-in-memory-pk-hkdf.md) — key generation that setup step S1 must perform
- [ADR-003](ADR-003-securitylib-native-cpp.md) — binary hashes that setup step S3 records
- TODO.md U5 — DB integration tests require setup to provision DB schema before tests run
