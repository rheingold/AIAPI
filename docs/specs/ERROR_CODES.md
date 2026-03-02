# Error Codes and Remediation

Complete reference for all error codes returned by WinKeys.exe and the MCP Server.

## WinKeys.exe Exit Codes

| Code | Error | Description | Remediation |
|------|-------|-------------|-------------|
| 0 | Success | Operation completed successfully | N/A |
| 1 | `window_not_found` | Process/window not found by name, PID, or HANDLE | Verify process is running. Use `{LISTWINDOWS}` to enumerate available windows. |
| 2 | `invalid_usage` | Missing or invalid command-line arguments | Check usage: `WinKeys <ProcessId> <Keys>`. See WINKEYS_API.md for valid formats. |
| 3 | `sendkeys_failed` | SendKeys.SendWait() threw an exception | Window may have lost focus or been closed. Retry after ensuring window is foreground. |
| 4 | `read_failed` | {READ} command found no readable text element | UI element may not support ValuePattern or have no Name property. Check with `{QUERYTREE}`. |
| 5 | `element_not_found` | {CLICKNAME:name} found no matching button | Button name incorrect or element not a button. Use `{QUERYTREE}` to find exact names. |
| 128 | `fatal_exception` | Unhandled C# exception occurred | Check stderr for stack trace. May indicate system-level failure. |

## WinKeys.exe JSON Error Format

All errors output JSON to stdout:

```json
{
  "success": false,
  "error": "error_code",
  "message": "Optional detailed message",
  "target": "Optional target identifier"
}
```

### Error Fields

- **success**: Always `false` for errors
- **error**: Machine-readable error code (lowercase_with_underscores)
- **message**: (Optional) Human-readable error description with context
- **target**: (Optional) The ProcessId/HANDLE/name that was being accessed
- **type**: (Only for `fatal_exception`) Exception type name
- **value**: (Only for `read_failed`) Will be `null`

### Examples

```json
{"success":false,"error":"window_not_found","target":"notepad"}
{"success":false,"error":"invalid_usage"}
{"success":false,"error":"sendkeys_failed","message":"Window was destroyed"}
{"success":false,"error":"read_failed","value":null}
{"success":false,"error":"element_not_found"}
{"success":false,"error":"fatal_exception","type":"NullReferenceException","message":"..."}
```

## MCP Server Error Codes

The MCP Server follows JSON-RPC 2.0 error conventions.

### Standard JSON-RPC Errors

| Code | Error | Description |
|------|-------|-------------|
| -32700 | Parse error | Invalid JSON in request |
| -32600 | Invalid Request | JSON-RPC structure invalid |
| -32601 | Method not found | Unknown method name |
| -32602 | Invalid params | Invalid method parameters |
| -32603 | Internal error | Server internal error |

### Application Errors (Custom)

| Code | Error | Description | Remediation |
|------|-------|-------------|-------------|
| 1 | Provider not found | No provider registered for requested platform | Check `getProviders` tool. Ensure correct provider loaded. |
| 2 | Process launch failed | launchProcess failed to spawn process | Check executable path. Verify permissions. |
| 3 | Window enumeration failed | listWindows failed | Provider error. Check stderr logs. |
| 4 | Tree query failed | queryTree failed to read UI structure | Window/process may be invalid. Verify with `listWindows`. |
| 5 | Property read failed | readProperty could not read value | Element may not support reading. Try `queryTree` to verify. |
| 6 | Property write failed | setProperty could not write value | Element may be read-only or not support the pattern. |
| 7 | Click failed | clickElement failed to perform click | Element may not support InvokePattern. Verify with `queryTree`. |
| 8 | WinKeys execution failed | WinKeys.exe returned non-zero exit code | See WinKeys.exe exit codes above. Check parsed JSON error. |

### MCP Error Response Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": {
      "details": "Additional context about the error"
    }
  }
}
```

## Common Failure Scenarios

### 1. Window Not Found

**Symptoms**:
- `window_not_found` error
- Exit code 1

**Causes**:
- Process not running
- Process has no visible window
- Title/name mismatch (especially with UWP apps like Calculator hosted by ApplicationFrameHost)

**Remediation**:
1. Use `{LISTWINDOWS}` to enumerate all available windows
2. Note the PID or HANDLE from the list
3. Use `PID:12345` or `HANDLE:67890` format instead of process name
4. For modern Windows apps, use ApplicationFrameHost PID, not the app's own PID

**Example**:
```powershell
# Find Calculator window
$windows = C:\path\to\WinKeys.exe "{LISTWINDOWS}" 2>$null | ConvertFrom-Json
$calc = $windows.windows | Where-Object { $_.title -like "*alcul*" } | Select-Object -First 1

# Use HANDLE for reliable identification
C:\path\to\WinKeys.exe "HANDLE:$($calc.handle)" "{READ}"
```

### 2. Element Name Mismatch

**Symptoms**:
- `element_not_found` error (exit code 5)
- {CLICKNAME:...} fails

**Causes**:
- Localized UI (button names vary by language)
- Incorrect element name
- Element is not a Button control type

**Remediation**:
1. Query UI tree to find exact element names: `{QUERYTREE:3}`
2. Look for `"ControlType":"Button"` and note exact `"Name":"..."`
3. Elements may have language-specific names (e.g., Czech "Osm" vs English "Eight")
4. Use {CLICK:x,y} with coordinates instead of names for language independence

**Example**:
```powershell
# Query to find button names
$tree = C:\path\to\WinKeys.exe "HANDLE:12345" "{QUERYTREE:2}" 2>$null | ConvertFrom-Json

# Find all buttons
$tree.children | ForEach-Object { $_.children } | Where-Object { $_.ControlType -eq "Button" } | Select-Object Name

# Use exact name or coordinates
C:\path\to\WinKeys.exe "HANDLE:12345" "{CLICKNAME:Clear}"
# OR
C:\path\to\WinKeys.exe "HANDLE:12345" "{CLICK:250,300}"
```

### 3. Value Extraction Issues

**Symptoms**:
- {READ} returns localized text like "Zobrazuje se 8" instead of "8"
- Unexpected prefixes in values

**Causes**:
- Display element includes locale-specific descriptive text
- UIAutomation ValuePattern returns full display string

**Solution**:
The current implementation uses regex to extract pure numeric/operator content:
- Pattern: `[\d\+\-\*/\.,\(\)eE]+$`
- Strips any non-numeric prefix
- Returns only the value portion

**Note**: If regex fails to match, raw value is returned.

### 4. Focus Issues

**Symptoms**:
- Keyboard input doesn't work
- Keys sent but no effect
- DEBUG shows `SetForegroundWindow returned: False`

**Causes**:
- Window not in foreground
- Another window has focus
- Windows security restrictions prevent focus change

**Remediation**:
1. Use UIAutomation patterns ({CLICKNAME:...}, {CLICK:x,y}) - these don't require focus
2. Manually bring window to front before automation
3. Use InvokePattern (button clicks) instead of keyboard simulation
4. Increase delay after focus attempt (500ms default may be insufficient)

### 5. Invalid JSON Output

**Symptoms**:
- JSON parsing fails
- Unexpected characters in output
- PowerShell ConvertFrom-Json errors

**Causes**:
- DEBUG messages mixed with JSON output on stdout
- Special characters not properly escaped

**Remediation**:
1. Redirect stderr to null: `2>$null`
2. All WinKeys.exe output is now JSON - no plain "OK" or error text
3. Parse JSON and check `success` field before accessing data

**Example**:
```powershell
$output = C:\path\to\WinKeys.exe "PID:12345" "{READ}" 2>$null
$result = $output | ConvertFrom-Json

if ($result.success) {
    Write-Host "Value: $($result.value)"
} else {
    Write-Host "Error: $($result.error) - $($result.message)"
}
```

### 6. PID/HANDLE Format Errors

**Symptoms**:
- Process found but wrong window accessed
- Numeric IDs not recognized

**Causes**:
- Wrong format (spaces, missing prefix, etc.)

**Solution**:
Use exact formats:
- Process name: `notepad` or `notepad.exe`
- Process ID: `PID:12345` (no spaces, uppercase PID)
- Window handle: `HANDLE:67890` (no spaces, uppercase HANDLE)

**Invalid examples**:
- `PID: 12345` (space after colon)
- `pid:12345` (lowercase)
- `12345` (no prefix)
- `HANDLE:0x10A3C` (hex not supported, use decimal)

## Best Practices for Error Handling

### In PowerShell Scripts

```powershell
function Invoke-WinKeys {
    param($ProcessId, $Keys)
    
    $output = & "C:\path\to\WinKeys.exe" $ProcessId $Keys 2>$null
    $result = $output | ConvertFrom-Json
    
    if (-not $result.success) {
        switch ($result.error) {
            "window_not_found" {
                Write-Error "Window not found: $($result.target). Use {LISTWINDOWS} to find it."
                return $null
            }
            "read_failed" {
                Write-Warning "Could not read value. Element may be empty."
                return $null
            }
            "element_not_found" {
                Write-Error "Element not found. Use {QUERYTREE} to find correct name."
                return $null
            }
            default {
                Write-Error "WinKeys error: $($result.error) - $($result.message)"
                return $null
            }
        }
    }
    
    return $result
}
```

### In TypeScript (MCP Server)

```typescript
async function executeWinKeys(processId: string, keys: string): Promise<any> {
    const { stdout, stderr, exitCode } = await execWinKeys(processId, keys);
    
    try {
        const result = JSON.parse(stdout);
        
        if (!result.success) {
            throw new Error(`WinKeys error: ${result.error} - ${result.message || ''}`);
        }
        
        return result;
    } catch (err) {
        if (err instanceof SyntaxError) {
            throw new Error(`Invalid JSON from WinKeys: ${stdout}`);
        }
        throw err;
    }
}
```

## Debugging Tips

### Enable Debug Output

All debug output goes to stderr. Capture it separately:

```powershell
C:\path\to\WinKeys.exe "notepad" "test" 2>&1 | Tee-Object -Variable output
```

Look for:
- `DEBUG: Looking for process: ...`
- `DEBUG: Found N process(es) named '...'`
- `DEBUG: Window found, handle: ...`
- `DEBUG: SetForegroundWindow returned: ...`
- `DEBUG: Sending keys via SendKeys.SendWait: ...`

### Test Incrementally

1. **Verify window exists**: `WinKeys.exe "{LISTWINDOWS}"`
2. **Get window HANDLE**: Parse output, find by title
3. **Query UI structure**: `WinKeys.exe "HANDLE:..." "{QUERYTREE:2}"`
4. **Test simple read**: `WinKeys.exe "HANDLE:..." "{READ}"`
5. **Test interaction**: `WinKeys.exe "HANDLE:..." "{CLICKNAME:...}"`

### Common DEBUG Messages

| Message | Meaning | Action |
|---------|---------|--------|
| `Found 0 process(es) named '...'` | Process not running or wrong name | Check process name, try PID/HANDLE |
| `SetForegroundWindow returned: False` | Window could not gain focus | Use UIAutomation patterns, not keyboard |
| `Display read returned null` | No readable element found | Query tree, verify element exists |
| `SendKeys error: ...` | Keyboard simulation failed | Check window still exists and has focus |

