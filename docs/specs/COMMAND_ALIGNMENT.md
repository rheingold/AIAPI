# Command Alignment - MCP ↔ KeyWin.exe ↔ Security Filters

## Overview

This document ensures **complete alignment** between:
1. **MCP Server API** - What clients can call
2. **KeyWin.exe Commands** - What the helper executable does
3. **Security Filters** - What can be allowed/denied

---

## Complete Command Matrix

| MCP Method | KeyWin.exe Command | Filter Command | Description | Security Risk |
|------------|-------------------|----------------|-------------|---------------|
| `queryTree` | `{QUERYTREE:N}` | `{QUERYTREE}` | Query UI element tree | 🟡 Low - Read only |
| `clickElement` (by ID) | `{CLICKID:xxx}` | `{CLICKID}` | Click element by AutomationId | 🔴 High - Can trigger actions |
| `clickElement` (by Name) | `{CLICKNAME:xxx}` | `{CLICKNAME}` | Click element by Name | 🔴 High - Can trigger actions |
| `clickElement` (coordinates) | `{CLICK:x,y}` | `{CLICK}` | Click at screen coordinates | 🔴 High - Can click anywhere |
| `clickElement` (keystroke) | `plaintext` | `{SENDKEYS}` | Send keyboard input | 🔴 High - Can type anything |
| `readProperty` | `{READ}` | `{READ}` | Read display text/property | 🟡 Low - Read only |
| `setProperty` | `{SET:prop:value}` | `{SET}` | Set element property/text | 🔴 High - Can modify data |
| `listWindows` | `{LISTWINDOWS}` | `{LISTWINDOWS}` | List all visible windows | 🟢 Very Low - Enumeration |
| `launchProcess` | N/A (MCP only) | `{LAUNCH}` | Launch new process | 🔴 Critical - Process execution |
| `terminateProcess` | `{KILL}` | `{KILL}` | Terminate process | 🔴 Critical - Process termination |
| `getProviders` | N/A (MCP only) | `{GETPROVIDERS}` | List available providers | 🟢 Very Low - Enumeration |

---

## Security Filter Rules Format

### Rule Structure
```
ACTION PROCESS → HELPER::COMMAND/PATTERN
```

**Components:**
- `ACTION`: `ALLOW` or `DENY`
- `PROCESS`: Target process (wildcards supported)
  - `*` = all processes
  - `calc*` = any calculator
  - `notepad.exe` = specific process name
  - `C:\Windows\System32\calc.exe` = full path
  - `SHA256:a3b2c1d4e5f6...` = by file hash (most secure)
  - `MD5:5d41402abc4b...` = by MD5 hash
- `HELPER`: Which helper executable
  - `KeyWin.exe`
  - `BrowserWin.exe` (future)
  - `OfficeWin.exe` (future)
- `COMMAND`: Specific command
  - `{QUERYTREE}` = query UI tree
  - `{CLICKID}` = click by ID
  - `{CLICKNAME}` = click by name
  - `{SENDKEYS}` = keyboard input
  - etc.
- `PATTERN`: Optional parameter pattern
  - For `{CLICKID}`: button ID like `num*Button`
  - For `{CLICKNAME}`: element name like `Submit*`
  - For `{SENDKEYS}`: keystroke pattern
  - `*` = any parameter

---

## Process Identification Methods

### 1. By Process Name (Simple)
```
ALLOW calc.exe → KeyWin.exe::{QUERYTREE}/*
```
**Pros:** Simple, readable
**Cons:** Can be spoofed (any exe renamed to calc.exe)

### 2. By Full Path (Better)
```
ALLOW C:\Windows\System32\calc.exe → KeyWin.exe::{QUERYTREE}/*
```
**Pros:** More specific, includes location
**Cons:** Breaks if app moves, can still be overwritten

### 3. By File Hash (Most Secure) ⭐
```
ALLOW SHA256:5a8d5f7e9c2b1a3d4e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d → KeyWin.exe::{QUERYTREE}/*
```
**Pros:** 
- ✅ Cryptographically secure
- ✅ Impossible to spoof without exact binary
- ✅ Version-specific (different versions = different hash)
- ✅ Tamper-proof (modified binary = different hash)

**Cons:**
- ⚠️ Requires hash computation
- ⚠️ Rules must be updated when app updates

### 4. Hybrid Approach (Recommended)
```
ALLOW calc.exe[SHA256:5a8d...] → KeyWin.exe::{QUERYTREE}/*
```
Readable name with hash verification in brackets.

---

## Examples

### 1. Allow Calculator Queries Only
```
ALLOW calc* → KeyWin.exe::{QUERYTREE}/*
DENY calc* → KeyWin.exe::{CLICKID}/*
DENY calc* → KeyWin.exe::{CLICKNAME}/*
DENY calc* → KeyWin.exe::{SENDKEYS}/*
```
Result: Can inspect calculator UI but cannot interact with it.

---

### 2. Allow Clicking Number Buttons Only
```
ALLOW CalculatorApp → KeyWin.exe::{CLICKID}/num*Button
DENY CalculatorApp → KeyWin.exe::{CLICKID}/*
```
Result: Can only click number buttons (num0Button through num9Button).

---

### 3. Restrict All Process Termination
```
DENY * → KeyWin.exe::{KILL}/*
```
Result: Cannot terminate any process.

---

### 4. Allow Only Read Operations
```
ALLOW * → KeyWin.exe::{QUERYTREE}/*
ALLOW * → KeyWin.exe::{READ}/*
ALLOW * → KeyWin.exe::{LISTWINDOWS}/*
DENY * → KeyWin.exe::*/*
```
Result: Can only read/query, no modifications or actions.

---

### 5. Block Launching Specific Applications
```
DENY * → KeyWin.exe::{LAUNCH}/cmd.exe
DENY * → KeyWin.exe::{LAUNCH}/powershell.exe
DENY * → KeyWin.exe::{LAUNCH}/*regedit*
```
Result: Cannot launch command prompt, PowerShell, or registry editor.

---

### 6. Allow Only Verified Calculator Binary
```
ALLOW SHA256:a3b2c1d4e5f6789... → KeyWin.exe::*/*
DENY calc* → KeyWin.exe::*/*
```
Result: Only allows the specific verified Calculator binary (by hash), blocks any renamed or modified versions.

---

### 7. Block Known Malware by Hash
```
DENY SHA256:bad1c0de5a8d... → KeyWin.exe::{LAUNCH}/*
DENY MD5:d3adb33f1234... → KeyWin.exe::{LAUNCH}/*
```
Result: Blocks launching specific binaries identified by their hash, regardless of name.

---

### 8. Version-Specific Rules
```
# Allow old stable version
ALLOW notepad.exe[SHA256:old_version_hash] → KeyWin.exe::*/*

# Deny new untested version
DENY notepad.exe[SHA256:new_version_hash] → KeyWin.exe::*/*
```
Result: Can control which specific version of an application is allowed.

---

## Command Categories by Risk Level

### 🟢 Read-Only (Low Risk)
- `{QUERYTREE}` - Query UI structure
- `{READ}` - Read text/properties
- `{LISTWINDOWS}` - List windows
- `{GETPROVIDERS}` - List providers

**Default Policy:** Usually ALLOW

---

### 🟡 Modification (Medium Risk)
- `{SET}` - Set properties (text in fields)

**Default Policy:** Depends on context

---

### 🔴 Action/Execution (High Risk)
- `{CLICKID}` - Click controls
- `{CLICKNAME}` - Click controls
- `{CLICK}` - Mouse clicks
- `{SENDKEYS}` - Keyboard input

**Default Policy:** Usually DENY, selectively ALLOW

---

### 🔴 Process Control (Critical Risk)
- `{LAUNCH}` - Launch processes
- `{KILL}` - Terminate processes

**Default Policy:** Strict DENY, very selective ALLOW

---

## Implementation Requirements

### 1. KeyWin.exe Command Recognition
All commands must be recognized and reported for filtering:

```csharp
// In KeyWin.cs - before executing any command:
string commandType = DetermineCommandType(keys);
// Returns: "QUERYTREE", "CLICKID", "CLICKNAME", "SENDKEYS", etc.

// Pass to security check:
if (!IsCommandAllowed(processName, commandType, parameter)) {
    return Error("Command blocked by security policy");
}
```

---

### 2. MCP Server Filter Validation
Before calling KeyWin.exe, validate against filters:

```typescript
// In httpServerWithDashboard.ts or automationEngine.ts
async function validateSecurityFilter(
    processName: string,
    helperName: string,
    command: string,
    pattern: string
): Promise<boolean> {
    // Check all loaded filters
    // Return true if ALLOW, false if DENY
}
```

---

### 3. Security Filter UI
The filter editor must include ALL commands in dropdown:

```html
<select id="filter-command">
  <optgroup label="Read Operations (Low Risk)">
    <option value="{QUERYTREE}">{QUERYTREE} - Query UI tree</option>
    <option value="{READ}">{READ} - Read text/properties</option>
    <option value="{LISTWINDOWS}">{LISTWINDOWS} - List windows</option>
    <option value="{GETPROVIDERS}">{GETPROVIDERS} - List providers</option>
  </optgroup>
  
  <optgroup label="UI Interaction (High Risk)">
    <option value="{CLICKID}">{CLICKID} - Click by AutomationId</option>
    <option value="{CLICKNAME}">{CLICKNAME} - Click by Name</option>
    <option value="{CLICK}">{CLICK} - Click at coordinates</option>
    <option value="{SENDKEYS}">{SENDKEYS} - Send keystrokes</option>
    <option value="{SET}">{SET} - Set property value</option>
  </optgroup>
  
  <optgroup label="Process Control (Critical Risk)">
    <option value="{LAUNCH}">{LAUNCH} - Launch process</option>
    <option value="{KILL}">{KILL} - Terminate process</option>
  </optgroup>
</select>
```

---

## Command Detection Logic

### KeyWin.exe Command Parsing

```csharp
static string DetermineCommandType(string keys) {
    if (keys.StartsWith("{QUERYTREE", StringComparison.OrdinalIgnoreCase))
        return "QUERYTREE";
    if (keys.StartsWith("{CLICKID:", StringComparison.OrdinalIgnoreCase))
        return "CLICKID";
    if (keys.StartsWith("{CLICKNAME:", StringComparison.OrdinalIgnoreCase))
        return "CLICKNAME";
    if (keys.StartsWith("{CLICK:", StringComparison.OrdinalIgnoreCase))
        return "CLICK";
    if (keys.Equals("{READ}", StringComparison.OrdinalIgnoreCase))
        return "READ";
    if (keys.StartsWith("{SET:", StringComparison.OrdinalIgnoreCase))
        return "SET";
    if (keys.Equals("{LISTWINDOWS}", StringComparison.OrdinalIgnoreCase))
        return "LISTWINDOWS";
    if (keys.Equals("{KILL}", StringComparison.OrdinalIgnoreCase))
        return "KILL";
    
    // Default: treat as keystroke input
    return "SENDKEYS";
}

static string ExtractParameter(string keys, string commandType) {
    switch (commandType) {
        case "CLICKID":
            // Extract "buttonId" from "{CLICKID:buttonId}"
            var match = Regex.Match(keys, @"\{CLICKID:(.+?)\}", RegexOptions.IgnoreCase);
            return match.Success ? match.Groups[1].Value : "";
        
        case "CLICKNAME":
            // Extract "Button Name" from "{CLICKNAME:Button Name}"
            var match2 = Regex.Match(keys, @"\{CLICKNAME:(.+?)\}", RegexOptions.IgnoreCase);
            return match2.Success ? match2.Groups[1].Value : "";
        
        case "SENDKEYS":
            // Return the actual keystrokes
            return keys;
        
        default:
            return "*";
    }
}
```

---

## Filter Evaluation Order

1. **Most Specific First**: Check filters with exact process names before wildcards
2. **DENY Wins**: If any DENY matches, block the operation
3. **Explicit ALLOW Required**: If no ALLOW matches after checking all filters, default to DENY
4. **Pattern Matching**: Use wildcards for flexible filtering

```typescript
function evaluateFilters(
    processName: string,
    command: string,
    parameter: string
): 'ALLOW' | 'DENY' {
    // 1. Check for explicit DENY with exact match
    // 2. Check for explicit DENY with wildcard
    // 3. Check for explicit ALLOW with exact match
    // 4. Check for explicit ALLOW with wildcard
    // 5. Default: DENY (secure by default)
}
```

---

## Testing Matrix

Each command must be tested with security filters:

| Test Case | Process | Command | Pattern | Expected Result |
|-----------|---------|---------|---------|-----------------|
| 1 | calc.exe | {QUERYTREE} | * | ALLOW (read-only) |
| 2 | calc.exe | {CLICKID} | num4Button | ALLOW (specific button) |
| 3 | calc.exe | {CLICKID} | clearButton | DENY (not allowed) |
| 4 | * | {KILL} | * | DENY (process termination) |
| 5 | notepad.exe | {SENDKEYS} | hello | ALLOW (typing in notepad) |
| 6 | cmd.exe | {SENDKEYS} | * | DENY (prevent shell injection) |
| 7 | * | {LAUNCH} | calc.exe | ALLOW (safe app) |
| 8 | * | {LAUNCH} | powershell.exe | DENY (security risk) |

---

## Summary

✅ **All MCP methods** have corresponding KeyWin.exe commands
✅ **All KeyWin.exe commands** are filterable in security settings
✅ **All operations** are categorized by risk level
✅ **Pattern matching** allows fine-grained control
✅ **Default DENY** policy for maximum security

**Next Steps:**
1. Update filter UI dropdown with ALL commands
2. Implement command detection in KeyWin.exe
3. Add filter validation in MCP server
4. Create test scenarios for each command
5. Document default security policies
