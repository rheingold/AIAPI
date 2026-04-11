/**
 * SecurityLib.h — Public C API for the AIAPI native security enforcement DLL.
 *
 * This DLL is loaded by every helper (.exe) via P/Invoke before any command is
 * executed.  It provides:
 *   - Binary hash verification  (sec_validate_signature, sec_validate_signature_self)
 *   - Security filter evaluation (sec_validate_action)
 *   - HKDF-SHA256 session key derivation (sec_hkdf_sha256)
 *   - Config loading + optional RSA-SHA256 config.json.sig verification (sec_load)
 *
 * Build: cl /nologo /LD /O2 SecurityLib.cpp /link bcrypt.lib
 *
 * Caller model:
 *   1. helper main() calls sec_validate_signature_self() FIRST — exit(77) on tamper.
 *   2. After _auth handshake completes, call sec_load(pkBytes, pkLen, configPath).
 *   3. Derive session key: sec_hkdf_sha256(...) / sec_get_session_key().
 *   4. Before every command: sec_validate_action() — return DENY if not SEC_ALLOW.
 *   5. At shutdown: sec_unload().
 *
 * All string parameters are UTF-8 encoded, NUL-terminated.
 * Thread safety: sec_load/sec_unload are NOT thread-safe; call from one thread only.
 *                sec_validate_* / sec_hkdf_sha256 are read-only and thread-safe after
 *                sec_load() returns successfully.
 */

#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── DLL export / import macro ───────────────────────────────────────────── */
#if defined(_WIN32) || defined(_WIN64)
#  ifdef AIAPI_SECURITYLIB_EXPORTS
#    define SECLIB_API __declspec(dllexport)
#  else
#    define SECLIB_API __declspec(dllimport)
#  endif
#else
#  define SECLIB_API __attribute__((visibility("default")))
#endif

/* ── Return codes ─────────────────────────────────────────────────────────── */

/** Action allowed — command may proceed. */
#define SEC_ALLOW              1

/** Action denied — helper MUST NOT execute the command. */
#define SEC_DENY               0

/** User confirmation required (future).  Currently treated as DENY. */
#define SEC_ASK                2

/** sec_load() has not been called or returned an error. */
#define SEC_ERROR_UNLOADED    (-1)

/** Config file missing, unreadable, or JSON parse failure. */
#define SEC_ERROR_CONFIG      (-2)

/** File I/O failure (hash computation, file open, etc.). */
#define SEC_ERROR_IO          (-3)

/** Cryptographic operation failure (BCrypt error, HKDF failure). */
#define SEC_ERROR_CRYPTO      (-4)

/** Hash / signature mismatch — binary tampered with. */
#define SEC_ERROR_SIG_MISMATCH (-5)

/** Null or invalid argument provided to a function. */
#define SEC_ERROR_BADARG      (-6)

/**
 * Return code from sec_validate_signature_self() when the DLL's own SHA-256
 * does not match the hash stored in config.json.
 * Callers should call exit(SECURITY_TAMPER) immediately upon receiving this.
 */
#define SECURITY_TAMPER        77


/* ── Public API ───────────────────────────────────────────────────────────── */

/**
 * Load security configuration and optionally verify config.json.sig.
 *
 * pkBytes    – Raw PKCS#8 private-key bytes received from the MCP server via
 *              the _auth message (already decrypted from private.key.enc).
 *              May be NULL (or pkLen == 0) during development / SKIP_SESSION_AUTH mode;
 *              in that case config.json.sig verification is skipped.
 * pkLen      – Byte length of pkBytes.
 * configPath – NUL-terminated UTF-8 absolute path to security/config.json.
 *
 * Returns 0 (SEC_DENY) on success (neutral "loaded OK"), or a negative error code.
 * Note: SEC_DENY == 0 == "no errors" — callers check (retval < 0) for load error.
 */
SECLIB_API int sec_load(const uint8_t* pkBytes, int pkLen, const char* configPath);

/**
 * Verify the SHA-256 of exePath against the hash recorded in config.json.
 *
 * Requires sec_load() to have succeeded.  The hash lookup uses the basename of
 * exePath (e.g. "KeyWin.exe") as the key into binaryHashes.
 *
 * Returns SEC_ALLOW on match, SEC_ERROR_SIG_MISMATCH on mismatch, or other
 * negative code on error.
 */
SECLIB_API int sec_validate_signature(const char* exePath);

/**
 * Verify the SHA-256 of THIS DLL against the hash in config.json["binaryHashes"]["SecurityLib.dll"].
 *
 * Must be called before sec_load() (uses a cached self-path set at DLL attachment).
 * If config is not yet loaded, returns SEC_ERROR_UNLOADED (not a tamper indicator).
 * Returns SEC_ALLOW on match, SECURITY_TAMPER on mismatch, SEC_ERROR_UNLOADED if
 * no hash for the DLL is in the config.
 *
 * Recommended exit sequence:
 *   int r = sec_validate_signature_self();
 *   if (r == SECURITY_TAMPER) { exit(SECURITY_TAMPER); }
 */
SECLIB_API int sec_validate_signature_self(void);

/**
 * Evaluate the loaded security filter rules against a command invocation.
 *
 * Evaluation semantics (mirrors filterEval.ts):
 *   - Scan rules in order.
 *   - On the FIRST matching DENY rule: return SEC_DENY immediately.
 *   - On a matching ALLOW rule: record it but keep scanning.
 *   - After all rules: if any ALLOW recorded → SEC_ALLOW.
 *   - No rule matched → SEC_DENY (default-deny policy).
 *
 * action      – Command type, e.g. "QUERYTREE" or "{CLICKID}" (braces stripped).
 * target      – Parameter / target string, e.g. "num1Button".
 * processName – Target process executable name, e.g. "calc.exe".
 * processPath – Full path of target process (may be NULL or "").
 * processHash – SHA-256 hex of target process exe (may be NULL or "").
 * processId   – PID of target process (0 if unknown).
 *
 * Returns SEC_ALLOW, SEC_DENY, SEC_ASK, or negative error code.
 */
SECLIB_API int sec_validate_action(
    const char* action,
    const char* target,
    const char* processName,
    const char* processPath,
    const char* processHash,
    int         processId);

/**
 * Derive a session key using HKDF-SHA256.
 *
 * Both the helper and the MCP server call this independently with the same
 * inputs to derive an identical session key that is never transmitted.
 *
 *   HKDF-SHA256(IKM=ikm, salt=salt, info=info) → outLen bytes
 *
 * ikm     – Input key material (raw private-key bytes).
 * ikmLen  – Byte length of ikm.
 * salt    – 32-byte value = SHA256(serverNonce || helperNonce).
 * saltLen – Expected to be 32.
 * info    – Context string, e.g. "AIAPI-v1-session".
 * infoLen – strlen(info).
 * out     – Caller-allocated output buffer.
 * outLen  – Desired output byte count (typically 32).
 *
 * Returns 0 on success, negative error code on failure.
 * Also stores the derived key internally for retrieval via sec_get_session_key().
 */
SECLIB_API int sec_hkdf_sha256(
    const uint8_t* ikm,  int ikmLen,
    const uint8_t* salt, int saltLen,
    const char*    info, int infoLen,
    uint8_t*       out,  int outLen);

/**
 * Copy the session key derived by the most recent sec_hkdf_sha256() call.
 *
 * out    – Caller-allocated buffer, must be at least outLen bytes.
 * outLen – Number of bytes to copy (typically 32).
 *
 * Returns SEC_ALLOW on success, SEC_ERROR_UNLOADED if sec_hkdf_sha256() has
 * not yet been called successfully.
 */
SECLIB_API int sec_get_session_key(uint8_t* out, int outLen);

/**
 * Zero all in-memory security state (filter rules, hashes, session key, PK bytes)
 * and release any CNG handles.
 *
 * After this call, all sec_* functions return SEC_ERROR_UNLOADED until
 * sec_load() is called again.
 */
SECLIB_API void sec_unload(void);


#ifdef __cplusplus
}   /* extern "C" */
#endif
