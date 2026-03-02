# WinKeys.exe Quick Reference

## Identification Methods

```powershell
# 1. Discover windows
$windows = WinKeys.exe "{LISTWINDOWS}" 2>$null | ConvertFrom-Json

# 2. Find target (example: Calculator)
$target = $windows.windows | Where-Object { $_.title -like "*alcul*" } | Select-Object -First 1

# 3. Use HANDLE (recommended)
$processId = "HANDLE:$($target.handle)"

# Alternative: Use PID
$processId = "PID:$($target.pid)"

# Legacy: Use process name (not recommended)
$processId = "notepad"
```

## Commands

| Command | Syntax | Output |
|---------|--------|--------|
| List Windows | `"{LISTWINDOWS}"` | `{"success":true,"windows":[{handle,title,pid}...]}` |
| Read Value | `"HANDLE:123" "{READ}"` | `{"success":true,"value":"42"}` |
| Query Tree | `"HANDLE:123" "{QUERYTREE:3}"` | JSON tree structure |
| Send Keys | `"HANDLE:123" "7+3="` | `{"success":true,"action":"keys"}` |
| Click Coords | `"HANDLE:123" "{CLICK:250,300}"` | `{"success":true,"action":"click"}` |
| Click Name | `"HANDLE:123" "{CLICKNAME:Clear}"` | `{"success":true,"action":"clickname"}` |

## Success/Error Format

```json
// Success
{"success": true, ...}

// Error
{"success": false, "error": "error_code", "message": "..."}
```

## Exit Codes

| Code | Error |
|------|-------|
| 0 | Success |
| 1 | `window_not_found` |
| 2 | `invalid_usage` |
| 3 | `sendkeys_failed` |
| 4 | `read_failed` |
| 5 | `element_not_found` |
| 128 | `fatal_exception` |

## Standard Pattern

```powershell
# 1. Find window
$windows = WinKeys.exe "{LISTWINDOWS}" 2>$null | ConvertFrom-Json
$target = $windows.windows | Where-Object { $_.title -like "*pattern*" } | Select-Object -First 1

# 2. Use HANDLE
$handle = "HANDLE:$($target.handle)"

# 3. Execute command
$result = WinKeys.exe $handle "{READ}" 2>$null | ConvertFrom-Json

# 4. Check success
if ($result.success) {
    Write-Host "Value: $($result.value)"
} else {
    Write-Error "Error: $($result.error)"
}
```

## Error Handling

```powershell
function Invoke-WinKeys {
    param($ProcessId, $Keys)
    
    $result = WinKeys.exe $ProcessId $Keys 2>$null | ConvertFrom-Json
    
    if (-not $result.success) {
        throw "WinKeys error: $($result.error) - $($result.message)"
    }
    
    return $result
}
```

## Tips

- ✓ Always redirect stderr: `2>$null`
- ✓ Always parse JSON: `| ConvertFrom-Json`
- ✓ Always check `success` field
- ✓ Use HANDLE for reliability
- ✓ Use {LISTWINDOWS} for discovery
- ✓ Use {QUERYTREE} for element names
- ✗ Don't hardcode process names
- ✗ Don't hardcode button names (locale-dependent)
- ✗ Don't rely on exit code alone

## See Also

- **ERROR_CODES.md** - Complete error reference
- **WINKEYS_API.md** - Full API documentation
- **FIXES_SUMMARY.md** - Design improvements
