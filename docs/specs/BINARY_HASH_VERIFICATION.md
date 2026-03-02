# Binary Hash Verification for Process Identification

## Overview

This feature allows security filters to identify processes using cryptographic hashes (SHA256 or MD5) of their executable files. This provides the most secure method of process identification, as file hashes are cryptographically unique and cannot be spoofed by renaming or relocating files.

## Why Use Binary Hashes?

### Traditional Methods (Weak)
- **Process Name** (`calc.exe`): Easily spoofed by renaming
- **Process Path** (`C:\Windows\System32\calc.exe`): Can be overwritten by malware
- **PID/HANDLE**: Transient, changes on every restart

### Hash-Based Identification (Strong) ⭐
- **Cryptographically Secure**: SHA256/MD5 uniquely identifies the exact binary
- **Tamper-Proof**: Any modification to the file changes the hash
- **Version-Specific**: Different versions have different hashes
- **Malware Detection**: Known malicious binaries can be blocked by hash
- **Integrity Verification**: Ensures the binary hasn't been modified

## Supported Hash Formats

### 1. SHA256 (Recommended)
```
SHA256:5a8d5f7e9c2b1a3d4e6f7890abcdef1234567890abcdef1234567890abcdef12
```
- Most secure (256-bit)
- Industry standard
- Collision-resistant
- Use for all new rules

### 2. MD5 (Legacy Support)
```
MD5:a3b2c1d4e5f6789abcdef1234567890
```
- Legacy support only
- 128-bit, less secure than SHA256
- Use only for compatibility with existing systems

### 3. Hybrid Format (Best UX)
```
calc.exe[SHA256:5a8d5f7e9c2b1a3d...]
```
- Human-readable process name
- Cryptographically verified hash
- Best of both worlds
- Recommended for complex filter configurations

## Usage in Security Filters

### Example 1: Allow Verified Binary
```
ALLOW calc.exe → KEYWIN::QUERYTREE/*
```
**Problem:** Any file named `calc.exe` is allowed (spoofing risk)

```
ALLOW SHA256:5a8d5f7e9c2b1a3d... → KEYWIN::QUERYTREE/*
```
**Solution:** Only the exact verified Windows Calculator binary is allowed

### Example 2: Block Known Malware
```
DENY SHA256:deadbeef1234567890... → KEYWIN::*/*
```
Blocks a specific malicious binary by its hash, regardless of name or location

### Example 3: Version-Specific Access
```
ALLOW notepad.exe[SHA256:abc123...] → KEYWIN::SENDKEYS/*
```
```
DENY notepad.exe[SHA256:xyz789...] → KEYWIN::SENDKEYS/*
```
Allow automation for Notepad v11.0, but block v10.0 (known vulnerability)

## Dashboard UI

### Process Identification Criteria
The security filter modal now includes:

✅ **Process Name** - Simple but spoofable
✅ **Window Title** - With wildcard support
✅ **Process Path** - Better but still overwritable
⭐ **Binary Hash (SHA256/MD5)** - Most Secure

### Hash Computation Tools
Two convenient methods to get hashes:

#### 1. Compute from File 📂
- Click "📂 Compute from File"
- Select .exe or .dll file
- Hash computed in browser (client-side)
- No file upload required

#### 2. Get from Running Process 🔍
- Select a window from the Windows list
- Click "🔍 Get from Running Process"
- Server computes hash of the running binary
- Hash automatically filled in

### Algorithm Selection
- **SHA256** (Recommended) - Default option
- **MD5** (Legacy) - For compatibility

## Implementation Details

### Frontend (✅ Complete)
- [x] Checkbox for "Binary Hash" in filter modal
- [x] Algorithm selector (SHA256/MD5)
- [x] Hash input field (monospace, pattern validation)
- [x] "Compute from File" button with client-side crypto
- [x] "Get from Running Process" button (API call)
- [x] Helpful tooltips and examples

### Backend (⏳ Pending)
- [ ] `/api/process-hash` endpoint
  - Accept `processId` or `processName`
  - Read binary from disk
  - Compute SHA256/MD5
  - Cache results
- [ ] Update `listWindows` to include `binaryHash` field
- [ ] Filter validation with hash matching
  - Parse `SHA256:`, `MD5:`, hybrid formats
  - Compare against running process
  - Cache computed hashes for performance

### Security Considerations
1. **Cache Hashes**: Computing hashes is expensive; cache results per binary path
2. **Privilege Escalation**: Reading binary files may require elevated permissions
3. **Performance**: Compute hashes lazily (on-demand) to avoid startup delays
4. **Hash Storage**: Store in filter configuration as plaintext (hashes are public)
5. **Validation**: Verify hash format before execution (64 hex chars for SHA256, 32 for MD5)

## Testing Scenarios

### Test Case 1: Verify Legitimate Binary
1. Compute SHA256 of `C:\Windows\System32\calc.exe`
2. Create filter: `ALLOW SHA256:xxx → KEYWIN::QUERYTREE/*`
3. Verify calculator automation works
4. Rename `malware.exe` to `calc.exe`, verify it's blocked

### Test Case 2: Block Malware
1. Get hash of known malicious binary
2. Create filter: `DENY SHA256:deadbeef... → KEYWIN::*/*`
3. Verify all automation is blocked for that binary

### Test Case 3: Version Control
1. Get hashes of two versions of Notepad
2. Allow version 11.0: `ALLOW notepad.exe[SHA256:abc] → KEYWIN::SENDKEYS/*`
3. Deny version 10.0: `DENY notepad.exe[SHA256:xyz] → KEYWIN::SENDKEYS/*`
4. Verify correct version-specific behavior

## Best Practices

### When to Use Hashes
✅ **Use hashes for:**
- Security-critical applications
- Production environments
- Malware detection/prevention
- Version-specific rules
- Verified software whitelisting

❌ **Don't use hashes for:**
- Development/testing (binaries change frequently)
- Generic wildcards (use process name instead)
- Frequently updated applications (hash changes on update)

### Hybrid Format Recommendation
For complex configurations, use hybrid format:
```
calc.exe[SHA256:5a8d...]
notepad.exe[SHA256:abc123...]
```

Benefits:
- Human-readable in audit logs
- Cryptographically verified
- Self-documenting configurations
- Easy to review and maintain

## Documentation Links

- [COMMAND_ALIGNMENT.md](COMMAND_ALIGNMENT.md#process-identification-methods) - Process identification methods
- [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) - Overall security design
- [DASHBOARD_SECURITY.md](DASHBOARD_SECURITY.md) - Dashboard security features

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| UI - Checkbox | ✅ Complete | Added to filter modal |
| UI - Hash Input | ✅ Complete | Monospace, pattern validation |
| UI - Compute from File | ✅ Complete | Client-side crypto.subtle |
| UI - Get from Running | ✅ Complete | API call to backend |
| UI - Algorithm Selector | ✅ Complete | SHA256/MD5 dropdown |
| Backend - /api/process-hash | ⏳ Pending | Endpoint to compute hash |
| Backend - listWindows hash | ⏳ Pending | Include binaryHash field |
| Backend - Filter validation | ⏳ Pending | Parse and match hashes |
| Backend - Hash caching | ⏳ Pending | Performance optimization |
| Testing - Hash scenarios | ⏳ Pending | Test cases 1-3 |
| Documentation | ✅ Complete | This document + COMMAND_ALIGNMENT |

## Example Filter Rules

```json
{
  "filters": [
    {
      "action": "ALLOW",
      "process": "SHA256:5a8d5f7e9c2b1a3d4e6f7890abcdef1234567890abcdef1234567890abcdef12",
      "helper": "KEYWIN",
      "command": "QUERYTREE",
      "pattern": "*",
      "comment": "Allow Windows Calculator - Verified Binary"
    },
    {
      "action": "DENY",
      "process": "SHA256:deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
      "helper": "KEYWIN",
      "command": "*",
      "pattern": "*",
      "comment": "Block Known Malware"
    },
    {
      "action": "ALLOW",
      "process": "notepad.exe[SHA256:abc1234567890def...]",
      "helper": "KEYWIN",
      "command": "SENDKEYS",
      "pattern": "*",
      "comment": "Allow Notepad v11.0 - Hybrid Format"
    }
  ]
}
```

---

**Last Updated:** 2026-02-15
**Status:** 🟡 UI Complete, Backend Pending
