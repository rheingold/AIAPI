# Security Architecture Implementation TODO

**Status:** In Progress  
**Started:** 2026-02-15  
**Reference:** SECURITY_ARCHITECTURE.md

---

## Phase 1: Filtering Configuration ✓ COMPLETE

**Goal:** Implement secure configuration file with process whitelist/blacklist

### Tasks:
- [x] 1.1 Create `SecureConfig` class with JSON schema
- [x] 1.2 Implement default security policy (DENY_UNLISTED)
- [x] 1.3 Add process whitelist/blacklist support
- [x] 1.4 Add path validation (prevent traversal)
- [x] 1.5 Add development mode configuration
- [x] 1.6 Create default config: `security/config.json`
- [x] 1.7 Unit tests for SecureConfig
- [x] 1.8 Smoke test: Load config, validate process against whitelist

**Files Created:**
- `src/security/SecureConfig.ts` ✓
- `src/security/types.ts` ✓
- `security/config.json` ✓
- `src/security/SecureConfig.test.ts` ✓ (17/17 tests passing)

**Development Bypass:**
- Config includes `developmentMode.enabled: true` by default
- Allows all processes in workspace paths
- Easy toggle for production mode

---

## Phase 2: Filter + Code Signing ✓ COMPLETE

**Goal:** Add binary signature verification to filtering

### Tasks:
- [x] 2.1 Implement signature verification (TypeScript/PowerShell)
- [x] 2.2 Add `requireTargetSignature` option to config
- [x] 2.3 Add `requireTargetSignatureDevelopment` bypass
- [x] 2.4 Integrate signature check into SecureConfig
- [x] 2.5 Unit tests for signature verification
- [x] 2.6 Smoke test: Verify signed binary (calc.exe), reject unsigned

**Files Created:**
- `src/security/SignatureVerifier.ts` ✓ - PowerShell Get-AuthenticodeSignature wrapper
- `src/security/SignatureVerifier.test.ts` ✓ (11/11 tests passing)
- `src/security/SecureConfig.ts` ✓ - Added checkProcessWithSignature() method
- `security/config.json` ✓ - Added requireTargetSignature config

**Development Bypass:**
- `requireTargetSignatureDevelopment: false` in config.json
- Signature checks skipped when developmentMode.enabled = true

---

## Phase 3: Certificate Generation & Key Encryption ✓ COMPLETE

**Goal:** Generate RSA-4096 certificate, encrypt with AES-256-GCM

### Tasks:
- [x] 3.1 Implement RSA-4096 key pair generation
- [x] 3.2 Create self-signed X.509 certificate
- [x] 3.3 Implement AES-256-GCM encryption with PBKDF2
- [x] 3.4 Encrypt private.key → private.key.enc (1M iterations)
- [x] 3.5 Encrypt public.key → public.key.enc (600K iterations)
- [x] 3.6 Store certificate thumbprint in config metadata
- [x] 3.7 Unit tests for key generation and encryption
- [x] 3.8 Smoke test: Generate keys, encrypt, decrypt, verify

**Files Created:**
- `src/security/CertificateManager.ts` ✓ - RSA-4096 generation, AES-256-GCM encryption
- `src/security/CertificateManager.test.ts` ✓ (26/26 tests passing)
- Keys generated on-demand with initialize() method

**Development Bypass:**
- Keys generated in test directories during tests
- Lower iteration counts (10K) for faster test execution
- Keys not committed to git (security/test/ ignored)

---

## Phase 4: Configuration Signing & Encryption ✓ COMPLETE

**Goal:** Sign and encrypt security/config.json with generated certificate

### Tasks:
- [x] 4.1 Implement config signing with private key (RSA-SHA256)
- [x] 4.2 Create config.json.sig (RSA signature)
- [x] 4.3 Add binary hashes to config (KeyWin.exe, mcpServer.js)
- [x] 4.4 Implement signature verification with public key
- [x] 4.5 Verify config hash matches signature
- [x] 4.6 Add certificate thumbprint verification
- [x] 4.7 Unit tests for config signing/verification
- [x] 4.8 Smoke test: Sign config, tamper, verify rejection

**Files Created:**
- `src/security/ConfigSigner.ts` ✓ - Sign/verify config with RSA
- `src/security/ConfigSigner.test.ts` ✓ (17/17 tests passing)
- Binary hash tracking integrated

**Development Bypass:**
- `SKIP_CONFIG_SIGNATURE=true` bypasses signature verification
- Warning logged when bypassed

---

## Phase 5: MCP/Binary Integrity Check ✓ COMPLETE

**Goal:** Verify MCP server and KeyWin.exe integrity against signed hashes

### Tasks:
- [x] 5.1 Implement SHA-256 binary hash calculation
- [x] 5.2 Load hashes from signed config.json (binaryHashes section)
- [x] 5.3 Implement binary verification against expected hashes
- [x] 5.4 Add self-integrity check method (for startup)
- [x] 5.5 Integration with ConfigSigner for hash storage
- [x] 5.6 Unit tests for hash verification
- [x] 5.7 Smoke test: Tamper with binary, verify rejection

**Files Created:**
- `src/security/IntegrityChecker.ts` ✓ - Calculate and verify hashes
- `src/security/IntegrityChecker.test.ts` ✓ (17/17 tests passing)

**Development Bypass:**
- `SKIP_INTEGRITY_CHECK=true` when dev mode enabled
- Hash mismatch warning only (not fatal) in development
- Auto-update hashes on rebuild when config is unsigned

**Note:** Self-check integration into KeyWin.exe (C#) and MCP server startup deferred to Phase 8

---

## Phase 6: Session Token Authentication
- `src/security/ConfigSigner.ts` - Sign/verify config
- `security/config.json` - Add binaryHashes section
- `security/config.json.sig` - RSA signature of config
- `security/hashes.json` - Known-good binary hashes
- `scripts/sign-config.ts` - Build-time signing script

**Development Bypass:**
- `SKIP_CONFIG_SIGNATURE=true` in development
- Unsigned config allowed when dev mode enabled
- Signature verification skipped for test configs

---

## Phase 5: MCP/Binary Integrity Check

**Goal:** Verify MCP server and KeyWin.exe integrity against signed hashes

### Tasks:
- [ ] 5.1 Implement SHA-256 binary hash calculation
- [ ] 5.2 Load hashes from signed config.json (binaryHashes section)
- [ ] 5.3 Add startup integrity check in MCP server
- [ ] 5.4 Add self-integrity check in KeyWin.exe (C#)
- [ ] 5.5 Store expected hashes during build (in config.json)
- [ ] 5.6 Unit tests for hash verification
- [ ] 5.7 Smoke test: Tamper with binary, verify rejection

**Files to Create/Modify:**
- `src/security/IntegrityChecker.ts` - Calculate and verify hashes
- `tools/win/KeyWin.cs` - Add SHA256 self-check method
- `src/server/mcpServer.ts` - Call IntegrityChecker on startup
- `security/config.json` - Add binaryHashes section
- `scripts/build-win-tools.ps1` - Calculate hashes, update config

**Development Bypass:**
- `SKIP_INTEGRITY_CHECK=true` when dev mode enabled
- Hash mismatch warning only (not fatal) in development
- Auto-update hashes on rebuild when config is unsigned

---

## Phase 6: Session Token Authentication ✓ COMPLETE

**Goal:** Implement HMAC-SHA256 session tokens between MCP and KeyWin.exe

### Tasks:
- [x] 6.1 Implement session secret generation (random 256-bit)
- [x] 6.2 Create session token with HMAC-SHA256 signature
- [x] 6.3 Pass token to KeyWin.exe via environment variable
- [x] 6.4 Add token verification in KeyWin.exe (C#)
- [x] 6.5 Implement nonce tracking (replay protection)
- [x] 6.6 Add 5-second token expiry (60s in dev mode)
- [x] 6.7 Unit tests for token generation/verification
- [x] 6.8 Integration tests: Invalid token, expired token, replay attack, bypass mode

**Files Created:**
- `src/security/SessionTokenManager.ts` ✓ - Generate and verify HMAC-SHA256 tokens
- `src/security/SessionTokenManager.test.ts` ✓ (29/29 tests passing)
- `src/security/SessionToken.integration.test.ts` ✓ (5/5 tests passing)
- `tools/win/KeyWin.cs` ✓ - Added VerifySessionToken() with HMAC verification

**Files Modified:**
- `src/server/mcpServer.ts` ✓ - Initialize SessionTokenManager on startup
- `src/scenario/replayer.ts` ✓ - Pass token via MCP_SESSION_TOKEN environment variable

**Development Bypass:**
- `SKIP_SESSION_AUTH=true` bypasses all token verification
- Extended token expiry (60s) in development mode vs 5s in production
- Session secret can be fixed for deterministic testing

---

## Phase 7: OS Signature Enforcement Check ✓ COMPLETE

**Goal:** Verify binaries are signed and trusted by OS before execution

### Tasks:
- [x] 7.1 Implement OS signature check (Windows API via PowerShell)
- [x] 7.2 Check certificate thumbprint matches expected value
- [x] 7.3 Verify certificate in OS Trusted Publishers store
- [x] 7.4 Add startup check for WDAC/AppLocker status
- [x] 7.5 Warning if OS enforcement disabled (not fatal in dev)
- [x] 7.6 Unit tests for OS enforcement checks
- [x] 7.7 Smoke test: Verify calc.exe (Microsoft signed and trusted)

**Files Created:**
- `src/security/OSEnforcementChecker.ts` ✓ - Check signatures via Get-AuthenticodeSignature
- `src/security/OSEnforcementChecker.test.ts` ✓ (14/14 tests passing)

**Files Modified:**
- `security/config.json` ✓ - Added requireOSEnforcement and expectedCertThumbprint fields
- `src/security/types.ts` ✓ - Updated SecurityPolicy interface

**Development Bypass:**
- `SKIP_OS_ENFORCEMENT_CHECK=true` bypasses all signature checks
- Warning only (not fatal) when developmentMode enabled
- Separate config field: `requireOSEnforcement: false` in dev

---

## Phase 8: Certificate Installation & Signing

**Goal:** Create installer that signs binaries and registers certificate with OS

### Tasks:
- [ ] 8.1 Create Windows installer (MSI or NSIS)
- [ ] 8.2 Sign installer with code signing certificate
- [ ] 8.3 Install certificate to Trusted Publishers store
- [ ] 8.4 Sign KeyWin.exe during installation
- [ ] 8.5 Create uninstaller (remove cert, clean files)
- [ ] 8.6 Add certificate renewal workflow
- [ ] 8.7 Test installation on clean Windows VM

**Files to Create:**
- `installer/setup.iss` - Inno Setup script
- `installer/install-cert.ps1` - Certificate installation
- `scripts/sign-binaries.ps1` - Sign with real certificate
- `docs/INSTALLATION.md` - Installation guide

**Development Bypass:**
- Development builds use self-signed cert (not in trust store)
- Installer only for production distribution
- Manual certificate trust for development testing

---
- `src/security/OSEnforcement.ts` (new)
- `tools/win/KeyWin.cs` - Add Windows API signature verification
- `src/server/mcpServer.ts` - Check OS enforcement on startup

**Development Bypass:**
- Config: `security.skipOSEnforcement: true`
- Only enforced when `NODE_ENV=production`
- Warning logged when disabled

---

## Phase 6: Certificate Generation & Signing

**Goal:** Create self-signed certificates for code signing

### Tasks:
- [ ] 6.1 Create certificate generation script (Node.js/OpenSSL)
- [ ] 6.2 Generate RSA-4096 key pair
- [ ] 6.3 Create self-signed certificate (10 year validity)
- [ ] 6.4 Encrypt private key with AES-256 (password-based)
- [ ] 6.5 Store public key for verification
- [ ] 6.6 Sign KeyWin.exe with certificate (signtool)
- [ ] 6.7 Interactive setup wizard with password prompt
- [ ] 6.8 Smoke test: Generate cert, sign binary, verify signature

**Files to Create:**
- `scripts/setup-security.js` (new)
- `src/security/CertificateManager.ts` (new)
- `security/public.key.enc` (generated)
- `security/certificate.cer` (generated)

**Development Bypass:**
- Script generates temporary dev certificate
- Password: "development" (hardcoded for dev)
- Skipped if `NODE_ENV=development`

---

## Phase 7: Installer & Production Setup

**Goal:** Package everything for production deployment

### Tasks:
- [ ] 7.1 Create Windows installer (NSIS or Electron Builder)
- [ ] 7.2 Register certificate with OS during install
- [ ] 7.3 Create desktop shortcuts
- [ ] 7.4 Add to Windows Start Menu
- [ ] 7.5 Install VS Code extension automatically
- [ ] 7.6 Create uninstaller with certificate cleanup
- [ ] 7.7 Add installer signing
- [ ] 7.8 Smoke test: Install, run MCP server, verify security

**Files to Create:**
- `installer/windows/installer.nsi` (new)
- `scripts/build-installer.ps1` (new)
- `installer/windows/post-install.ps1` (new)

**Development Bypass:**
- Portable mode (no installation required)
- Run from source directory
- No certificate registration needed

---

## Testing Strategy

### Smoke Tests (Automated)
Each phase includes quick validation:
- ✅ Config loads successfully
- ✅ Valid operations succeed
- ✅ Invalid operations are blocked
- ✅ Performance acceptable (<100ms overhead)

### Integration Tests
After each phase:
- Full scenario execution (Calculator test)
- Security feature enabled
- Verify no regressions

### Security Tests
After Phase 7:
- Attempt to run unsigned binary → Blocked
- Tamper with KeyWin.exe → Detected
- Invalid session token → Rejected
- Process not in whitelist → Denied

---

## Progress Tracking

| Phase | Status | Started | Completed | Tests Passing |
|-------|--------|---------|-----------|---------------|
| 1. Filtering Config | ✅ Complete | 2026-02-15 | 2026-02-15 | 17/17 |
| 2. Filter + Signing | ✅ Complete | 2026-02-15 | 2026-02-15 | 11/11 |
| 3. Cert Generation | ✅ Complete | 2026-02-15 | 2026-02-15 | 26/26 |
| 4. Config Signing | ✅ Complete | 2026-02-15 | 2026-02-15 | 17/17 |
| 5. Binary Integrity | ✅ Complete | 2026-02-15 | 2026-02-15 | 17/17 |
| 6. Session Auth | ✅ Complete | 2026-02-18 | 2026-02-18 | 34/34 |
| 7. OS Enforcement | ✅ Complete | 2026-02-18 | 2026-02-18 | 14/14 |
| 8. Installer | ⏳ Pending | - | - | - |

---

## Development Bypasses Summary

**Quick Development Mode:**
1. Set `NODE_ENV=development`
2. Set `SKIP_INTEGRITY_CHECK=1`
3. Set `SKIP_SESSION_AUTH=1`
4. Config: `developmentMode.enabled: true`
5. Uncomment `#define DEVELOPMENT_MODE` in KeyWin.cs

**All security checks disabled** - Use only during development!

**Production Mode:**
1. Set `NODE_ENV=production`
2. Remove all bypass environment variables
3. Config: `developmentMode.enabled: false`
4. Remove `#define DEVELOPMENT_MODE` from KeyWin.cs
5. Run security setup: `node scripts/setup-security.js`

---

**Last Updated:** 2026-02-18  
**Overall Progress:** 7/8 phases complete (87.5%)  
**Total Tests:** 136/136 passing  

**Next Steps:**
1. ~~Implement Session Token Authentication (Phase 6)~~ ✅ COMPLETE
2. ~~Implement OS Enforcement Checker (Phase 7)~~ ✅ COMPLETE
3. Create installer and production setup (Phase 8)

**Recent Additions (2026-02-18):**
- ✅ OSEnforcementChecker with PowerShell signature verification
- ✅ WDAC and AppLocker detection
- ✅ Certificate thumbprint verification
- ✅ Trusted Publishers store checking
- ✅ 14 unit tests (all passing)
- ✅ SessionTokenManager with HMAC-SHA256 authentication
- ✅ Nonce tracking for replay attack prevention
- ✅ Token expiry (5s production, 60s development)
- ✅ Session token verification in KeyWin.exe (C#)
- ✅ Integration with MCP server and ScenarioReplayer
- ✅ 34 unit + integration tests (all passing)

**Previous Additions:**
- ✅ Direct injection mode implemented (--inject-mode parameter)
- ✅ Universal UI Automation approach (ValuePattern + InvokePattern)
- ✅ Language-independent button lookup (AutomationId)
- ✅ ConfigSigner with RSA-SHA256 signatures
- ✅ IntegrityChecker with SHA-256 hash verification
- ✅ Binary hash tracking in config.json
