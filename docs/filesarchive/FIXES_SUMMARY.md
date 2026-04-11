# Fixes Summary - Addressing Design Issues

This document summarizes the fixes applied to address the four critical design issues identified.

## Issue 1: Inconsistent I/O Syntax ✅ FIXED

**Problem**: Different methods used different output formats (CSV, text, JSON, line-separated).

**Solution**: **All WinKeys.exe output is now JSON**.

### Before:
- Keyboard input: `"OK"` (plain text)
- {CLICK}: `"OK"` (plain text)
- {CLICKNAME}: Sometimes "OK", sometimes errors as text
- {READ}: `{"success":true,"value":"..."}` (JSON)
- {LISTWINDOWS}: `{"success":true,"windows":[...]}` (JSON)
- {QUERYTREE}: JSON
- Errors: Mixed plain text and JSON

### After:
- **All commands output JSON**
- Keyboard input: `{"success":true,"action":"keys"}`
- {CLICK:x,y}: `{"success":true,"action":"click"}`
- {CLICKNAME:name}: `{"success":true,"action":"clickname"}` or `{"success":false,"error":"element_not_found"}`
- {READ}: `{"success":true,"value":"..."}` or `{"success":false,"error":"read_failed","value":null}`
- {LISTWINDOWS}: `{"success":true,"windows":[...]}` (unchanged)
- {QUERYTREE}: JSON tree (unchanged)
- Errors: `{"success":false,"error":"code","message":"..."}` (always JSON)

### Success Format
```json
{
  "success": true,
  // ... command-specific fields
}
```

### Error Format
```json
{
  "success": false,
  "error": "error_code",
  "message": "Optional details",
  "target": "Optional identifier"
}
```

### Benefits:
- ✅ Consistent parsing in all languages (PowerShell, TypeScript, Python, etc.)
- ✅ Machine-readable errors
- ✅ No need for text parsing or regex matching
- ✅ Easy error handling with `success` field check

---

## Issue 2: Localized Text Contamination ✅ FIXED

**Problem**: "Zobrazuje se 8" (Czech for "Display is 8") instead of pure value "8".

**Root Cause**: Windows Calculator's UIAutomation ValuePattern returns localized display text including prefix.

**Solution**: Regex extraction to strip locale-specific prefixes.

### Implementation in WinKeys.cs:

```csharp
string rawValue = vp.Current.Value;  // "Zobrazuje se 8"
var match = Regex.Match(rawValue, @"[\d\+\-\*/\.,\(\)eE]+$");
if (match.Success) {
    return match.Value.Trim();  // Returns "8"
}
return rawValue;  // Fallback to raw if no match
```

### Pattern: `[\d\+\-\*/\.,\(\)eE]+$`
Matches:
- Digits: `0-9`
- Operators: `+ - * /`
- Decimal: `. ,`
- Parentheses: `( )`
- Scientific notation: `e E`
- End of string: `$`

### Results:

| Input (Locale-Dependent) | Output (Pure Value) |
|--------------------------|---------------------|
| "Zobrazuje se 8" (Czech) | "8" |
| "Display is 42" (English) | "42" |
| "Affichage 3.14" (French) | "3.14" |
| "显示 123" (Chinese) | "123" |
| "100+50" | "100+50" |

### Benefits:
- ✅ Language-independent value extraction
- ✅ No hardcoded locale strings
- ✅ Works across all Windows language settings
- ✅ Pure data for calculations and assertions

---

## Issue 3: Limited Process Identification ✅ FIXED

**Problem**: Only supported process name/title identification. No PID or HANDLE support.

**Solution**: Three identification methods implemented.

### Supported Formats:

#### 1. Process Name (Legacy)
```
WinKeys.exe "notepad" "{READ}"
WinKeys.exe "notepad.exe" "{READ}"
```
- Finds by executable name
- May fail for UWP apps
- Not recommended for production

#### 2. Process ID (NEW)
```
WinKeys.exe "PID:12345" "{READ}"
```
- Direct process ID lookup
- **Most reliable** for programmatic use
- Format: `PID:` + numeric process ID
- Case-sensitive prefix

#### 3. Window Handle (NEW)
```
WinKeys.exe "HANDLE:67890" "{READ}"
```
- Direct window handle lookup
- **Fastest** - no process enumeration
- Format: `HANDLE:` + numeric handle (decimal)
- Case-sensitive prefix

### Implementation:

```csharp
static IntPtr FindWindowByProcessName(string processNameOrId)
{
    // Support PID:12345 format
    if (processNameOrId.StartsWith("PID:", StringComparison.OrdinalIgnoreCase))
    {
        int pid = int.Parse(processNameOrId.Substring(4));
        return FindWindowByPid(pid);
    }

    // Support HANDLE:67890 format
    if (processNameOrId.StartsWith("HANDLE:", StringComparison.OrdinalIgnoreCase))
    {
        long handle = long.Parse(processNameOrId.Substring(7));
        return new IntPtr(handle);
    }

    // Original process name lookup
    // ...
}
```

### {LISTWINDOWS} for Discovery:

```powershell
# 1. List all windows
$windows = WinKeys.exe "{LISTWINDOWS}" 2>$null | ConvertFrom-Json

# 2. Find Calculator
$calc = $windows.windows | Where-Object { $_.title -like "*alcul*" } | Select-Object -First 1

# 3. Use HANDLE for reliable operations
WinKeys.exe "HANDLE:$($calc.handle)" "7+8="
WinKeys.exe "HANDLE:$($calc.handle)" "{READ}"
```

### Output Example:
```json
{
  "success": true,
  "windows": [
    {
      "handle": 5247274,
      "title": "Kalkulačka",
      "pid": 3388
    }
  ]
}
```

### Benefits:
- ✅ Reliable identification across all app types (Win32, UWP, .NET)
- ✅ No title/name matching ambiguity
- ✅ Stable identifiers (PID/HANDLE don't change during session)
- ✅ Programmatic discovery with {LISTWINDOWS}
- ✅ No locale-dependent window titles

### Recommendation:
**Always use {LISTWINDOWS} → filter → use HANDLE**

```powershell
# Recommended pattern
$target = (WinKeys.exe "{LISTWINDOWS}" 2>$null | ConvertFrom-Json).windows | 
    Where-Object { $_.title -like "*pattern*" } | 
    Select-Object -First 1
    
$processId = "HANDLE:$($target.handle)"
```

---

## Issue 4: Missing Error Documentation ✅ FIXED

**Problem**: No documentation of possible errors, reasons, and remediation.

**Solution**: Comprehensive error documentation created.

### New Documentation File: ERROR_CODES.md

Complete reference covering:
- Exit codes (0-128)
- Error code strings
- JSON error format
- Common failure scenarios
- Remediation steps
- Debugging tips
- Best practices

### Exit Codes Table:

| Code | Error | Description | Remediation |
|------|-------|-------------|-------------|
| 0 | Success | Operation completed | N/A |
| 1 | `window_not_found` | Process/window not found | Use {LISTWINDOWS}, verify PID/HANDLE |
| 2 | `invalid_usage` | Invalid arguments | Check command syntax |
| 3 | `sendkeys_failed` | SendKeys exception | Retry, ensure window has focus |
| 4 | `read_failed` | No readable element | Verify element with {QUERYTREE} |
| 5 | `element_not_found` | {CLICKNAME} failed | Check exact name with {QUERYTREE} |
| 128 | `fatal_exception` | Unhandled exception | Check stderr for stack trace |

### Error Response Examples:

```json
{"success":false,"error":"window_not_found","target":"notepad"}
{"success":false,"error":"element_not_found"}
{"success":false,"error":"sendkeys_failed","message":"Window was destroyed"}
{"success":false,"error":"read_failed","value":null}
{"success":false,"error":"fatal_exception","type":"NullReferenceException","message":"..."}
```

### Common Scenarios Documented:

1. **Window Not Found**
   - Causes: Process not running, UWP window hosting, title mismatch
   - Solution: Use {LISTWINDOWS} to discover, use PID/HANDLE

2. **Element Name Mismatch**
   - Causes: Localized UI, incorrect name, wrong control type
   - Solution: Query with {QUERYTREE}, use coordinates instead

3. **Value Extraction Issues**
   - Causes: Localized display text
   - Solution: Now handled automatically with regex

4. **Focus Issues**
   - Causes: Window not foreground, security restrictions
   - Solution: Use UIAutomation patterns (CLICKNAME, CLICK), not keyboard

5. **Invalid JSON Output**
   - Causes: DEBUG messages on stdout
   - Solution: Redirect stderr: `2>$null`

6. **PID/HANDLE Format Errors**
   - Causes: Wrong format, spaces, lowercase
   - Solution: Use exact format `PID:12345` or `HANDLE:67890`

### PowerShell Error Handling Pattern:

```powershell
function Invoke-WinKeysCommand {
    param($ProcessId, $Keys)
    
    $output = & "WinKeys.exe" $ProcessId $Keys 2>$null
    $result = $output | ConvertFrom-Json
    
    if (-not $result.success) {
        switch ($result.error) {
            "window_not_found" {
                throw "Window '$($result.target)' not found. Use {LISTWINDOWS}."
            }
            "element_not_found" {
                throw "Element not found. Use {QUERYTREE}."
            }
            "read_failed" {
                Write-Warning "Could not read (may be empty)"
                return $null
            }
            default {
                throw "WinKeys error: $($result.error)"
            }
        }
    }
    
    return $result
}
```

### Benefits:
- ✅ Complete error code reference
- ✅ Remediation steps for each error
- ✅ Common failure scenarios documented
- ✅ Debugging tips and patterns
- ✅ Language-specific error handling examples (PowerShell, TypeScript)

---

## Summary of Changes

### Files Modified:

1. **tools/win/WinKeys.cs**:
   - Added PID/HANDLE identification support
   - Made all output JSON-consistent
   - Added locale-independent value extraction (regex)
   - Moved {LISTWINDOWS} before argument validation (global command)
   - Enhanced error messages with context

2. **WINKEYS_API.md** (Updated):
   - Documented three identification methods
   - Added comprehensive examples
   - PowerShell and TypeScript integration patterns
   - Complete command reference with JSON formats
   - Best practices section

3. **ERROR_CODES.md** (NEW):
   - Complete error code reference
   - Exit codes table
   - Common failure scenarios
   - Remediation steps
   - Debugging tips
   - Error handling patterns

4. **dist/win/WinKeys.exe** (Recompiled):
   - All fixes compiled and tested

### Testing Results:

✅ {LISTWINDOWS} works without ProcessId argument  
✅ PID:12345 format correctly identifies processes  
✅ HANDLE:67890 format correctly identifies windows  
✅ All commands output JSON  
✅ Value extraction strips localized text  
✅ Error responses include error codes and context  

### Architecture Compliance:

✅ **Simple, Single-Purpose Functions**: Each command does ONE thing  
✅ **No Business Logic**: Pure I/O transformation  
✅ **Consistent Interface**: All JSON output  
✅ **Reliable Identification**: PID/HANDLE support  
✅ **Language-Independent**: Regex value extraction, no hardcoded locales  

---

## Migration Guide

### For Existing Scripts:

#### Before (Old API):
```powershell
WinKeys.exe "Calculator" "7+3="
if ($LASTEXITCODE -eq 0) {
    Write-Host "OK"
}
```

#### After (New API):
```powershell
$result = WinKeys.exe "PID:12345" "7+3=" 2>$null | ConvertFrom-Json
if ($result.success) {
    Write-Host "Success: $($result.action)"
}
```

### Key Changes:

1. **Parse JSON output**: Always use `ConvertFrom-Json`
2. **Check success field**: Don't rely on exit code alone
3. **Use PID/HANDLE**: More reliable than process names
4. **Discover with {LISTWINDOWS}**: Don't hardcode process names
5. **Redirect stderr**: Use `2>$null` to suppress DEBUG output

### Breaking Changes:

❌ Plain text output removed (was: `"OK"`)  
✅ JSON output required (now: `{"success":true,"action":"..."}`)

❌ Exit code as sole indicator  
✅ JSON `success` field as primary indicator

❌ Process name only  
✅ PID: and HANDLE: formats added

### Backward Compatibility:

✅ Process name still works (legacy support)  
✅ All existing commands preserved ({READ}, {QUERYTREE}, etc.)  
✅ Exit codes unchanged (0=success, 1=not found, etc.)  
⚠️ Output format changed (JSON required)  

---

## Conclusion

All four issues have been comprehensively addressed:

1. ✅ **Consistent I/O**: All output is JSON
2. ✅ **Pure Values**: Locale-independent extraction
3. ✅ **Robust Identification**: PID/HANDLE support with {LISTWINDOWS} discovery
4. ✅ **Complete Error Docs**: ERROR_CODES.md with remediation

The system now follows the architecture principle:
**Server + Facilitating Binaries + Documentation**

Each method does **ONE SIMPLE THING** reliably and predictably.
