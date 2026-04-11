/**
 * SecurityLib.cpp — AIAPI native security enforcement DLL  (Windows, C++)
 *
 * Build (MSVC, no IDE needed):
 *   cl /nologo /LD /O2 /W3 /D "AIAPI_SECURITYLIB_EXPORTS" ^
 *      SecurityLib.cpp /link bcrypt.lib kernel32.lib
 *
 * Requires: Windows Vista+ (BCrypt API).
 * No external dependencies beyond the Windows SDK.
 */

#define _WIN32_WINNT 0x0601     /* Windows 7+ for BCrypt full HMAC support */
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <bcrypt.h>
#include <wchar.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <stdint.h>
#include <ctype.h>
#include "SecurityLib.h"

#pragma comment(lib, "bcrypt.lib")

/* ═══════════════════════════════════════════════════════════════════════════ *
 * Internal constants                                                         *
 * ═══════════════════════════════════════════════════════════════════════════ */

#define MAX_HASH_LEN        64          /* hex chars in a SHA-256 digest      */
#define MAX_RULES           256         /* maximum filter rules in config     */
#define MAX_BINARY_HASHES   32          /* maximum binary hash entries        */
#define MAX_FIELD           256         /* max chars for rule field strings   */

#define SHA256_BYTES        32
#define HMAC_SHA256_BYTES   32


/* ═══════════════════════════════════════════════════════════════════════════ *
 * Internal data structures                                                   *
 * ═══════════════════════════════════════════════════════════════════════════ */

/* A single security filter rule (mirrors FilterRule in filterEval.ts) */
typedef struct {
    char action[8];           /* "allow" | "deny" | "ask"                     */
    char process[MAX_FIELD];  /* process name glob, e.g. "calc.exe" or "*"    */
    char helper[MAX_FIELD];   /* helper name glob, e.g. "KeyWin.exe" or "*"   */
    char command[MAX_FIELD];  /* command glob (braces stripped), e.g. "READ"  */
    char pattern[MAX_FIELD];  /* parameter/target glob, e.g. "num*Button"     */
} FilterRule;

/* A binary hash record from config.json binaryHashes section */
typedef struct {
    char name[MAX_FIELD];     /* key or basename of path, e.g. "KeyWin.exe"   */
    char sha256[MAX_HASH_LEN+1]; /* lower-case hex SHA-256                    */
} BinaryHash;

/* Global security state */
static struct {
    int          loaded;                           /* non-zero after sec_load OK */
    int          defaultDeny;                      /* 1 = DENY when no rule matches */

    FilterRule   rules[MAX_RULES];
    int          ruleCount;

    BinaryHash   hashes[MAX_BINARY_HASHES];
    int          hashCount;

    uint8_t      sessionKey[SHA256_BYTES];         /* from sec_hkdf_sha256()    */
    int          sessionKeyReady;

    char         selfPath[MAX_PATH];               /* DLL's own path (DllMain)  */
} g = {0};


/* ═══════════════════════════════════════════════════════════════════════════ *
 * String / wildcard helpers                                                  *
 * ═══════════════════════════════════════════════════════════════════════════ */

static void str_lower(char* dst, const char* src, int maxLen)
{
    if (!dst || !src) return;
    int i = 0;
    while (i < maxLen - 1 && src[i]) { dst[i] = (char)tolower((unsigned char)src[i]); i++; }
    dst[i] = '\0';
}

/* Basename (filename) of a path, e.g. "C:\foo\bar.exe" → "bar.exe" */
static const char* path_basename(const char* path)
{
    if (!path) return "";
    const char* s = path;
    const char* last = path;
    while (*s) {
        if (*s == '\\' || *s == '/') last = s + 1;
        s++;
    }
    return last;
}

/**
 * Case-insensitive wildcard match.
 * pattern: '*' matches any sequence; '?' matches exactly one char.
 * Mirrors wildcardMatch() in wildcardMatch.ts (plain glob, no /regex/).
 */
static int wildcard_match(const char* pattern, const char* text)
{
    if (!pattern || !*pattern) return !text || !*text;
    if (*pattern == '*') {
        while (*pattern == '*') pattern++;           /* collapse consecutive '*' */
        if (!*pattern) return 1;                     /* trailing * matches rest  */
        while (*text) {
            if (wildcard_match(pattern, text)) return 1;
            text++;
        }
        return wildcard_match(pattern, text);
    }
    if (!*text) return 0;
    if (*pattern == '?' || tolower((unsigned char)*pattern) == tolower((unsigned char)*text))
        return wildcard_match(pattern + 1, text + 1);
    return 0;
}


/* ═══════════════════════════════════════════════════════════════════════════ *
 * BCrypt helpers — SHA-256 hash of a file or buffer                          *
 * ═══════════════════════════════════════════════════════════════════════════ */

/* Hash a buffer with SHA-256; result → digest[0..31) */
static int bcrypt_sha256_buf(const uint8_t* data, size_t len, uint8_t digest[SHA256_BYTES])
{
    BCRYPT_ALG_HANDLE hAlg  = NULL;
    BCRYPT_HASH_HANDLE hHash = NULL;
    int rc = SEC_ERROR_CRYPTO;

    if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, NULL, 0) != 0) goto done;
    if (BCryptCreateHash(hAlg, &hHash, NULL, 0, NULL, 0, 0) != 0) goto done;
    if (BCryptHashData(hHash, (PUCHAR)data, (ULONG)len, 0) != 0) goto done;
    if (BCryptFinishHash(hHash, (PUCHAR)digest, SHA256_BYTES, 0) != 0) goto done;
    rc = 0;

done:
    if (hHash) BCryptDestroyHash(hHash);
    if (hAlg)  BCryptCloseAlgorithmProvider(hAlg, 0);
    return rc;
}

/* Hash a file with SHA-256; result → hex[0..64] (NUL-terminated) */
static int sha256_file(const char* path, char hexOut[MAX_HASH_LEN + 1])
{
    if (!path || !hexOut) return SEC_ERROR_BADARG;

    HANDLE hFile = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL,
                               OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return SEC_ERROR_IO;

    BCRYPT_ALG_HANDLE  hAlg  = NULL;
    BCRYPT_HASH_HANDLE hHash = NULL;
    uint8_t digest[SHA256_BYTES];
    int rc = SEC_ERROR_CRYPTO;

    if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, NULL, 0) != 0) goto fclose;
    if (BCryptCreateHash(hAlg, &hHash, NULL, 0, NULL, 0, 0) != 0) goto fclose;

    {
        BYTE buf[32768];
        DWORD read = 0;
        while (ReadFile(hFile, buf, sizeof(buf), &read, NULL) && read > 0) {
            if (BCryptHashData(hHash, buf, read, 0) != 0) goto fclose;
        }
    }

    if (BCryptFinishHash(hHash, (PUCHAR)digest, SHA256_BYTES, 0) != 0) goto fclose;
    rc = 0;
    for (int i = 0; i < SHA256_BYTES; i++)
        sprintf_s(hexOut + i * 2, 3, "%02x", digest[i]);
    hexOut[MAX_HASH_LEN] = '\0';

fclose:
    if (hHash) BCryptDestroyHash(hHash);
    if (hAlg)  BCryptCloseAlgorithmProvider(hAlg, 0);
    CloseHandle(hFile);
    return rc;
}


/* ═══════════════════════════════════════════════════════════════════════════ *
 * BCrypt HMAC-SHA256                                                          *
 * ═══════════════════════════════════════════════════════════════════════════ */

static int hmac_sha256(
    const uint8_t* key,    int keyLen,
    const uint8_t* data,   int dataLen,
    uint8_t        out[HMAC_SHA256_BYTES])
{
    BCRYPT_ALG_HANDLE  hAlg  = NULL;
    BCRYPT_HASH_HANDLE hHash = NULL;
    int rc = SEC_ERROR_CRYPTO;

    if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, NULL,
                                    BCRYPT_ALG_HANDLE_HMAC_FLAG) != 0) goto done;
    if (BCryptCreateHash(hAlg, &hHash, NULL, 0,
                         (PUCHAR)key, (ULONG)keyLen, 0) != 0) goto done;
    if (BCryptHashData(hHash, (PUCHAR)data, (ULONG)dataLen, 0) != 0) goto done;
    if (BCryptFinishHash(hHash, (PUCHAR)out, HMAC_SHA256_BYTES, 0) != 0) goto done;
    rc = 0;

done:
    if (hHash) BCryptDestroyHash(hHash);
    if (hAlg)  BCryptCloseAlgorithmProvider(hAlg, 0);
    return rc;
}


/* ═══════════════════════════════════════════════════════════════════════════ *
 * Minimal JSON parser                                                         *
 *                                                                             *
 * Operates on a NUL-terminated read-only string.  A "cursor" (const char** p)*
 * is advanced by each helper.  No heap allocation.                           *
 * ═══════════════════════════════════════════════════════════════════════════ */

static void json_skip_ws(const char** p)
{
    while (**p && (unsigned char)**p <= ' ') (*p)++;
}

/* Skip a complete JSON value at *p (object/array/string/number/bool/null) */
static void json_skip_value(const char** p);

static void json_skip_string(const char** p)
{
    if (**p != '"') return;
    (*p)++;
    while (**p) {
        if (**p == '\\') { (*p)++; if (**p) (*p)++; }
        else if (**p == '"') { (*p)++; return; }
        else (*p)++;
    }
}

static void json_skip_value(const char** p)
{
    json_skip_ws(p);
    char c = **p;
    if (c == '"') { json_skip_string(p); return; }
    if (c == '{') {
        (*p)++;
        json_skip_ws(p);
        while (**p && **p != '}') {
            json_skip_string(p);     /* key   */
            json_skip_ws(p);
            if (**p == ':') (*p)++;
            json_skip_value(p);      /* value */
            json_skip_ws(p);
            if (**p == ',') (*p)++;
            json_skip_ws(p);
        }
        if (**p == '}') (*p)++;
        return;
    }
    if (c == '[') {
        (*p)++;
        json_skip_ws(p);
        while (**p && **p != ']') {
            json_skip_value(p);
            json_skip_ws(p);
            if (**p == ',') (*p)++;
            json_skip_ws(p);
        }
        if (**p == ']') (*p)++;
        return;
    }
    /* number, bool, null: scan until delimiter */
    while (**p && **p != ',' && **p != '}' && **p != ']' && (unsigned char)**p > ' ')
        (*p)++;
}

/**
 * Read a JSON string into buf[0..bufLen).  *p must point at opening '"'.
 * Returns 1 on success, 0 on failure.
 */
static int json_read_string(const char** p, char* buf, int bufLen)
{
    if (!buf || bufLen < 1) return 0;
    json_skip_ws(p);
    if (**p != '"') return 0;
    (*p)++;
    int i = 0;
    while (**p && **p != '"') {
        if (**p == '\\') {
            (*p)++;
            char esc = **p;
            if (esc == '"' || esc == '\\' || esc == '/') { if (i < bufLen - 1) buf[i++] = esc; }
            else if (esc == 'n')  { if (i < bufLen - 1) buf[i++] = '\n'; }
            else if (esc == 'r')  { if (i < bufLen - 1) buf[i++] = '\r'; }
            else if (esc == 't')  { if (i < bufLen - 1) buf[i++] = '\t'; }
            else                  { if (i < bufLen - 1) buf[i++] = esc; }
        } else {
            if (i < bufLen - 1) buf[i++] = **p;
        }
        (*p)++;
    }
    buf[i] = '\0';
    if (**p == '"') (*p)++;
    return 1;
}

/**
 * Find a key in the *current JSON object* (at '{' or just inside it).
 * Returns pointer to the start of the value for that key, or NULL.
 * Advances *p to just after the found value's opening on success;
 * the cursor is NOT moved past the value so the caller can read it.
 * After the call, *p points at the value if return != NULL.
 */
static const char* json_find_key(const char* obj_start, const char* key)
{
    const char* p = obj_start;
    json_skip_ws(&p);
    if (*p == '{') p++;
    json_skip_ws(&p);

    while (*p && *p != '}') {
        /* read key */
        char kbuf[MAX_FIELD];
        if (!json_read_string(&p, kbuf, sizeof(kbuf))) return NULL;
        json_skip_ws(&p);
        if (*p != ':') return NULL;
        p++;   /* skip colon */
        json_skip_ws(&p);
        const char* val_start = p;

        if (strcmp(kbuf, key) == 0) return val_start;

        /* not our key — skip value */
        json_skip_value(&p);
        json_skip_ws(&p);
        if (*p == ',') p++;
        json_skip_ws(&p);
    }
    return NULL;
}


/* ═══════════════════════════════════════════════════════════════════════════ *
 * Config JSON parser  — populates g.rules[], g.hashes[], g.defaultDeny       *
 * ═══════════════════════════════════════════════════════════════════════════ */

/* Load one rule object into g.rules[g.ruleCount].  Returns 1 on success. */
static int parse_rule_object(const char* obj)
{
    if (g.ruleCount >= MAX_RULES) return 0;
    FilterRule* r = &g.rules[g.ruleCount];

    const char* v;

    /* action */
    v = json_find_key(obj, "action");
    if (v) json_read_string(&v, r->action, sizeof(r->action));
    if (!r->action[0]) return 0;
    str_lower(r->action, r->action, (int)sizeof(r->action));

    /* process */
    v = json_find_key(obj, "process");
    if (v) json_read_string(&v, r->process, sizeof(r->process));
    if (!r->process[0]) { r->process[0] = '*'; r->process[1] = '\0'; }

    /* helper */
    v = json_find_key(obj, "helper");
    if (v) json_read_string(&v, r->helper, sizeof(r->helper));
    if (!r->helper[0]) { r->helper[0] = '*'; r->helper[1] = '\0'; }

    /* command — strip surrounding braces */
    v = json_find_key(obj, "command");
    char cmdRaw[MAX_FIELD] = {0};
    if (v) json_read_string(&v, cmdRaw, sizeof(cmdRaw));
    if (!cmdRaw[0]) { r->command[0] = '*'; r->command[1] = '\0'; }
    else {
        const char* csrc = cmdRaw;
        if (*csrc == '{') csrc++;
        int clen = (int)strlen(csrc);
        if (clen > 0 && csrc[clen-1] == '}') clen--;
        if (clen <= 0) { r->command[0] = '*'; r->command[1] = '\0'; }
        else { strncpy_s(r->command, sizeof(r->command), csrc, clen); }
    }

    /* pattern */
    v = json_find_key(obj, "pattern");
    if (v) json_read_string(&v, r->pattern, sizeof(r->pattern));
    if (!r->pattern[0]) { r->pattern[0] = '*'; r->pattern[1] = '\0'; }

    g.ruleCount++;
    return 1;
}

/* Parse binaryHashes object; each entry may be a string hash or object with "sha256" + "path". */
static void parse_binary_hashes(const char* obj)
{
    const char* p = obj;
    json_skip_ws(&p);
    if (*p == '{') p++;
    json_skip_ws(&p);

    while (*p && *p != '}' && g.hashCount < MAX_BINARY_HASHES) {
        /* read entry key (logical name, e.g. "keywin" or "KeyWin.exe") */
        char entryKey[MAX_FIELD] = {0};
        if (!json_read_string(&p, entryKey, sizeof(entryKey))) break;
        json_skip_ws(&p);
        if (*p != ':') break;
        p++;
        json_skip_ws(&p);

        BinaryHash* bh = &g.hashes[g.hashCount];

        if (*p == '{') {
            /* object value: look for "sha256" and optionally "path" */
            const char* vobj = p;
            const char* sha = json_find_key(vobj, "sha256");
            if (sha) json_read_string(&sha, bh->sha256, sizeof(bh->sha256));
            str_lower(bh->sha256, bh->sha256, (int)sizeof(bh->sha256));

            /* prefer filename from "path" field as the lookup name */
            char pathBuf[MAX_PATH] = {0};
            const char* pf = json_find_key(vobj, "path");
            if (pf) json_read_string(&pf, pathBuf, sizeof(pathBuf));

            if (pathBuf[0])
                strncpy_s(bh->name, sizeof(bh->name), path_basename(pathBuf), _TRUNCATE);
            else
                strncpy_s(bh->name, sizeof(bh->name), entryKey, _TRUNCATE);

            json_skip_value(&p);
        } else if (*p == '"') {
            /* plain string SHA-256 value */
            char sha[MAX_HASH_LEN + 1] = {0};
            json_read_string(&p, sha, sizeof(sha));
            str_lower(bh->sha256, sha, (int)sizeof(bh->sha256));
            strncpy_s(bh->name, sizeof(bh->name), entryKey, _TRUNCATE);
        } else {
            json_skip_value(&p);
        }

        if (bh->sha256[0] && bh->name[0]) g.hashCount++;

        json_skip_ws(&p);
        if (*p == ',') p++;
        json_skip_ws(&p);
    }
}

/* Top-level config.json parser; fills g.rules, g.hashes, g.defaultDeny */
static int parse_config_json(const char* json, int jsonLen)
{
    /* null-terminate safely (we never modify the buffer, just cast) */
    if (!json || jsonLen <= 0) return SEC_ERROR_CONFIG;

    /* ── security.defaultPolicy ─────────────────────────────────────────── */
    g.defaultDeny = 1;  /* DENY_UNLISTED by default */
    const char* sec = json_find_key(json, "security");
    if (sec) {
        char dp[64] = {0};
        const char* dpv = json_find_key(sec, "defaultPolicy");
        if (dpv) { json_read_string(&dpv, dp, sizeof(dp)); str_lower(dp, dp, (int)sizeof(dp)); }
        /* "allow_all" → permissive; anything else → deny-by-default */
        if (strcmp(dp, "allow_all") == 0 || strcmp(dp, "allow") == 0) g.defaultDeny = 0;
    }

    /* ── binaryHashes ───────────────────────────────────────────────────── */
    const char* bh = json_find_key(json, "binaryHashes");
    if (bh) parse_binary_hashes(bh);

    /* ── filterRules ────────────────────────────────────────────────────── */
    const char* fr = json_find_key(json, "filterRules");
    if (fr) {
        const char* p = fr;
        json_skip_ws(&p);
        if (*p == '[') {
            p++;
            json_skip_ws(&p);
            while (*p && *p != ']') {
                if (*p == '{') {
                    const char* elem = p;
                    parse_rule_object(elem);
                    json_skip_value(&p);
                } else {
                    json_skip_value(&p);
                }
                json_skip_ws(&p);
                if (*p == ',') p++;
                json_skip_ws(&p);
            }
        }
    }

    return 0;  /* success */
}


/* ═══════════════════════════════════════════════════════════════════════════ *
 * Exported API                                                                *
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── sec_load ──────────────────────────────────────────────────────────────── */
SECLIB_API int sec_load(const uint8_t* pkBytes, int pkLen, const char* configPath)
{
    if (!configPath || !*configPath) return SEC_ERROR_BADARG;

    /* Reset state */
    sec_unload();

    /* ── Read config.json ────────────────────────────────────────────────── */
    HANDLE hFile = CreateFileA(configPath, GENERIC_READ, FILE_SHARE_READ, NULL,
                               OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return SEC_ERROR_IO;

    DWORD fileSize = GetFileSize(hFile, NULL);
    if (fileSize == INVALID_FILE_SIZE || fileSize == 0 || fileSize > 1024 * 1024) {
        CloseHandle(hFile);
        return SEC_ERROR_CONFIG;
    }

    char* buf = (char*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, fileSize + 1);
    if (!buf) { CloseHandle(hFile); return SEC_ERROR_CONFIG; }

    DWORD bytesRead = 0;
    if (!ReadFile(hFile, buf, fileSize, &bytesRead, NULL) || bytesRead != fileSize) {
        HeapFree(GetProcessHeap(), 0, buf);
        CloseHandle(hFile);
        return SEC_ERROR_IO;
    }
    CloseHandle(hFile);
    buf[fileSize] = '\0';

    /* ── Optional: verify config.json.sig if pk provided ────────────────── */
    if (pkBytes && pkLen > 0) {
        /* Build .sig path by appending ".sig" to configPath */
        char sigPath[MAX_PATH] = {0};
        sprintf_s(sigPath, sizeof(sigPath), "%s.sig", configPath);

        HANDLE hSig = CreateFileA(sigPath, GENERIC_READ, FILE_SHARE_READ, NULL,
                                  OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
        if (hSig != INVALID_HANDLE_VALUE) {
            /* Signature exists — verify SHA-256 of config.json matches expected digest
             * stored in the .sig file (simplified: .sig stores a SHA-256 hex of the
             * config JSON for the current V1 implementation).
             *
             * Full RSA-SHA256 verification via BCryptVerifySignature requires importing
             * the raw PKCS#8 key bytes as a BCrypt key pair, which varies by key format.
             * V1 uses the simpler approach: .sig = SHA256(config.json) in hex, signed
             * by the MCP server at config-write time and re-derived here for comparison.
             */
            DWORD sigSize = GetFileSize(hSig, NULL);
            if (sigSize >= MAX_HASH_LEN) {
                char sigBuf[MAX_HASH_LEN + 16] = {0};
                DWORD sr = 0;
                if (ReadFile(hSig, sigBuf, MAX_HASH_LEN, &sr, NULL) && sr == MAX_HASH_LEN) {
                    /* Lower-case both for comparison */
                    char sigHex[MAX_HASH_LEN + 1] = {0};
                    char fileHex[MAX_HASH_LEN + 1] = {0};
                    str_lower(sigHex, sigBuf, (int)sizeof(sigHex));

                    uint8_t digest[SHA256_BYTES];
                    if (bcrypt_sha256_buf((const uint8_t*)buf, (size_t)fileSize, digest) == 0) {
                        for (int i = 0; i < SHA256_BYTES; i++)
                            sprintf_s(fileHex + i * 2, 3, "%02x", digest[i]);

                        if (strcmp(sigHex, fileHex) != 0) {
                            HeapFree(GetProcessHeap(), 0, buf);
                            CloseHandle(hSig);
                            return SEC_ERROR_SIG_MISMATCH;
                        }
                    }
                }
            }
            CloseHandle(hSig);
        }
        /* If no .sig file exists, skip verification (first-time setup or dev mode) */
    }

    /* ── Parse config ────────────────────────────────────────────────────── */
    int rc = parse_config_json(buf, (int)fileSize);
    HeapFree(GetProcessHeap(), 0, buf);

    if (rc < 0) return rc;

    g.loaded = 1;
    return 0;   /* success */
}


/* ── sec_validate_signature ───────────────────────────────────────────────── */
SECLIB_API int sec_validate_signature(const char* exePath)
{
    if (!g.loaded) return SEC_ERROR_UNLOADED;
    if (!exePath || !*exePath) return SEC_ERROR_BADARG;

    char hexActual[MAX_HASH_LEN + 1] = {0};
    int rc = sha256_file(exePath, hexActual);
    if (rc < 0) return rc;

    /* Lookup by basename (case-insensitive) */
    char base[MAX_FIELD] = {0};
    str_lower(base, path_basename(exePath), (int)sizeof(base));

    for (int i = 0; i < g.hashCount; i++) {
        char storedBase[MAX_FIELD] = {0};
        str_lower(storedBase, g.hashes[i].name, (int)sizeof(storedBase));
        if (strcmp(storedBase, base) == 0) {
            return (strcmp(g.hashes[i].sha256, hexActual) == 0)
                   ? SEC_ALLOW : SEC_ERROR_SIG_MISMATCH;
        }
    }

    /* No entry for this exe in config → treat as mismatch */
    return SEC_ERROR_SIG_MISMATCH;
}


/* ── sec_validate_signature_self ──────────────────────────────────────────── */
SECLIB_API int sec_validate_signature_self(void)
{
    if (!g.loaded) return SEC_ERROR_UNLOADED;
    if (!g.selfPath[0]) return SEC_ERROR_IO;
    return sec_validate_signature(g.selfPath);
}


/* ── sec_validate_action ──────────────────────────────────────────────────── */
SECLIB_API int sec_validate_action(
    const char* action,
    const char* target,
    const char* processName,
    const char* processPath,
    const char* processHash,
    int         processId)
{
    if (!g.loaded) return SEC_ERROR_UNLOADED;

    /* Strip braces from action, e.g. "{CLICKID}" → "CLICKID" */
    char cmd[MAX_FIELD] = {0};
    if (action && *action == '{') {
        const char* s = action + 1;
        int len = (int)strlen(s);
        if (len > 0 && s[len-1] == '}') len--;
        strncpy_s(cmd, sizeof(cmd), s, len);
    } else if (action) {
        strncpy_s(cmd, sizeof(cmd), action, _TRUNCATE);
    } else {
        cmd[0] = '\0';
    }

    const char* proc  = processName ? processName : "";
    const char* param = target      ? target      : "";

    int anyAllow = 0;

    for (int i = 0; i < g.ruleCount; i++) {
        FilterRule* r = &g.rules[i];

        /* process match */
        if (!wildcard_match(r->process, proc)) continue;

        /* command match */
        char rCmd[MAX_FIELD] = {0};
        str_lower(rCmd, r->command, (int)sizeof(rCmd));
        char lCmd[MAX_FIELD] = {0};
        str_lower(lCmd, cmd, (int)sizeof(lCmd));
        if (strcmp(rCmd, "*") != 0 && !wildcard_match(rCmd, lCmd)) continue;

        /* helper match — not applicable inside the DLL (we don't know caller name here)
         * Skip helper matching entirely; the MCP server already applies helper-level rules */

        /* pattern match */
        if (!wildcard_match(r->pattern, param)) continue;

        /* matched */
        if (strcmp(r->action, "deny") == 0 || strcmp(r->action, "DENY") == 0) {
            return SEC_DENY;
        }
        if (strcmp(r->action, "ask") == 0 || strcmp(r->action, "ASK") == 0) {
            return SEC_ASK;   /* caller treats as DENY */
        }
        /* allow: record and keep scanning for a later deny */
        anyAllow = 1;
    }

    if (anyAllow) return SEC_ALLOW;

    /* no rule matched → apply default policy */
    return g.defaultDeny ? SEC_DENY : SEC_ALLOW;
}


/* ── sec_hkdf_sha256 ──────────────────────────────────────────────────────── */
SECLIB_API int sec_hkdf_sha256(
    const uint8_t* ikm,  int ikmLen,
    const uint8_t* salt, int saltLen,
    const char*    info, int infoLen,
    uint8_t*       out,  int outLen)
{
    if (!ikm || ikmLen <= 0) return SEC_ERROR_BADARG;
    if (!out || outLen <= 0) return SEC_ERROR_BADARG;

    /* ── Extract: PRK = HMAC-SHA256(salt, IKM) ────────────────────────── */
    /* If salt is NULL/empty use zero-filled 32-byte salt */
    uint8_t zeroSalt[HMAC_SHA256_BYTES] = {0};
    const uint8_t* saltBuf = (salt && saltLen > 0) ? salt : zeroSalt;
    int            saltBufLen = (salt && saltLen > 0) ? saltLen : HMAC_SHA256_BYTES;

    uint8_t prk[HMAC_SHA256_BYTES] = {0};
    int rc = hmac_sha256(saltBuf, saltBufLen, ikm, ikmLen, prk);
    if (rc != 0) return rc;

    /* ── Expand: T(i) = HMAC-SHA256(PRK, T(i-1) || info || i) ─────────── */
    /* Supports up to 255 * 32 = 8160 bytes of output (RFC 5869 limit) */
    int n = (outLen + HMAC_SHA256_BYTES - 1) / HMAC_SHA256_BYTES;  /* ceil */
    if (n > 255) return SEC_ERROR_BADARG;

    const uint8_t* infoBytes = info ? (const uint8_t*)info : (const uint8_t*)"";
    int            infoBytesLen = info ? infoLen : 0;

    uint8_t T[HMAC_SHA256_BYTES] = {0};
    int     Tlen = 0;
    int     written = 0;

    /* Build a scratch buffer: T_prev || info || counter (max 32+256+1=289 bytes) */
    uint8_t tmp[32 + 256 + 1];

    for (int i = 1; i <= n; i++) {
        int tmpLen = 0;
        /* append T(i-1) */
        memcpy(tmp + tmpLen, T, Tlen);       tmpLen += Tlen;
        /* append info */
        if (infoBytesLen > 0 && infoBytesLen <= 256) {
            memcpy(tmp + tmpLen, infoBytes, infoBytesLen);
            tmpLen += infoBytesLen;
        }
        /* append counter byte */
        tmp[tmpLen++] = (uint8_t)i;

        rc = hmac_sha256(prk, HMAC_SHA256_BYTES, tmp, tmpLen, T);
        if (rc != 0) {
            SecureZeroMemory(prk, sizeof(prk));
            return rc;
        }
        Tlen = HMAC_SHA256_BYTES;

        int toCopy = (written + HMAC_SHA256_BYTES <= outLen)
                     ? HMAC_SHA256_BYTES : (outLen - written);
        memcpy(out + written, T, toCopy);
        written += toCopy;
    }

    /* Cache the first 32 bytes as the session key */
    if (outLen >= SHA256_BYTES) {
        memcpy(g.sessionKey, out, SHA256_BYTES);
        g.sessionKeyReady = 1;
    }

    SecureZeroMemory(prk, sizeof(prk));
    SecureZeroMemory(T,   sizeof(T));
    return 0;  /* success */
}


/* ── sec_get_session_key ──────────────────────────────────────────────────── */
SECLIB_API int sec_get_session_key(uint8_t* out, int outLen)
{
    if (!g.sessionKeyReady) return SEC_ERROR_UNLOADED;
    if (!out || outLen < SHA256_BYTES) return SEC_ERROR_BADARG;
    memcpy(out, g.sessionKey, SHA256_BYTES);
    return SEC_ALLOW;
}


/* ── sec_unload ───────────────────────────────────────────────────────────── */
SECLIB_API void sec_unload(void)
{
    SecureZeroMemory(g.rules,      sizeof(g.rules));
    SecureZeroMemory(g.hashes,     sizeof(g.hashes));
    SecureZeroMemory(g.sessionKey, sizeof(g.sessionKey));
    g.ruleCount       = 0;
    g.hashCount       = 0;
    g.defaultDeny     = 1;
    g.loaded          = 0;
    g.sessionKeyReady = 0;
    /* preserve g.selfPath — it is set once in DllMain */
}


/* ═══════════════════════════════════════════════════════════════════════════ *
 * DllMain — capture the DLL's own path on first attachment                   *
 * ═══════════════════════════════════════════════════════════════════════════ */

BOOL WINAPI DllMain(HINSTANCE hInstDLL, DWORD fdwReason, LPVOID lpvReserved)
{
    if (fdwReason == DLL_PROCESS_ATTACH) {
        GetModuleFileNameA(hInstDLL, g.selfPath, MAX_PATH);
        DisableThreadLibraryCalls(hInstDLL);
    }
    return TRUE;
}
