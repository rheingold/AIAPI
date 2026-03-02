# KeyWin.exe API Documentation

## Overview
KeyWin.exe is a Windows automation binary that facilitates UI interactions using Windows UIAutomation framework. **All output is structured JSON** for language-independent integration.

## Command Line Interface

```
KeyWin.exe [--inject-mode=MODE] <ProcessId> <Keys>
```

### Global Options

#### `--inject-mode=MODE`
**Values**: `direct` (default) | `focus`

Controls how keyboard/mouse input is injected:

**Direct Mode (default)**:
- Input injected without activating target window
- No focus stealing - window stays in background
- Uses UI Automation (ValuePattern for text, InvokePattern for buttons)
- Language-independent (uses AutomationId, not localized names)
- Works with: Notepad, Calculator, most Win32 and UWP apps
- **Best for**: Background automation, multi-window workflows

**Focus Mode**:
- Window activated (SetForegroundWindow) before input
- Steals focus - target window comes to front
- Uses traditional SendKeys API
- Universal compatibility with all apps
- **Best for**: Single-window testing, legacy apps

**Configuration Priority**:
1. Command-line parameter: `--inject-mode=direct`
2. Environment variable: `KEYWIN_INJECT_MODE=focus`
3. Default: `direct`

**Examples**:
```powershell
# Direct mode (no focus stealing)
KeyWin.exe --inject-mode=direct notepad "Background text"

# Focus mode (traditional)
KeyWin.exe --inject-mode=focus notepad "Foreground text"

# Via environment variable
$env:KEYWIN_INJECT_MODE = "focus"
KeyWin.exe notepad "Will use focus mode"
```

### ProcessId Formats

WinKeys.exe supports three identification methods:

1. **Process name**: `notepad` or `notepad.exe`
   - Finds window by process executable name
   - May fail for UWP apps (use PID/HANDLE instead)

2. **Process ID**: `PID:12345`
   - Direct process ID lookup (most reliable)
   - Format: `PID:` + numeric process ID
   - Case-sensitive prefix

3. **Window Handle**: `HANDLE:67890`
   - Direct window handle lookup (fastest)
   - Format: `HANDLE:` + numeric window handle (decimal, not hex)
   - Case-sensitive prefix

**Best Practice**: Use `{LISTWINDOWS}` first to get PID or HANDLE, then use that for reliable identification.

## Commands

All commands output JSON. Check the `success` field before accessing data.

### 1. List Windows - `{LISTWINDOWS}`
**Syntax**: `WinKeys.exe "{LISTWINDOWS}"`

**No ProcessId required** - this is a global command.

**Output**: JSON array of all visible windows
```json
{
  "success": true,
  "windows": [
    {
      "handle": 5247274,
      "title": "Kalkulačka",
      "pid": 3388
    },
    {
      "handle": 4983300,
      "title": "Visual Studio Code",
      "pid": 29052
    }
  ]
}
```

**Usage Pattern**:
```powershell
# Get all windows
$result = WinKeys.exe "{LISTWINDOWS}" 2>$null | ConvertFrom-Json

# Find Calculator
$calc = $result.windows | Where-Object { $_.title -like "*alcul*" } | Select-Object -First 1

# Use HANDLE for reliable access
WinKeys.exe "HANDLE:$($calc.handle)" "{READ}"
```

### 2. Keyboard Input
**Syntax**: Send literal text
```
WinKeys.exe "PID:12345" "123"
WinKeys.exe "HANDLE:67890" "Hello World"
WinKeys.exe "notepad" "test"
```

**Special Keys**:
- `+` is automatically escaped as `{+}` (literal plus sign)
- `=` is converted to `{ENTER}` for calculator operations
- Use `{ESC}`, `{TAB}`, `{ENTER}` for special keys

**Output**: JSON
```json
{"success": true, "action": "keys"}
```

**Error Example**:
```json
{"success": false, "error": "sendkeys_failed", "message": "Window was destroyed"}
```

### 3. Read Display Value - `{READ}`
**Syntax**: `{READ}`

**Output**: JSON with pure value (localized text stripped)
```json
{
  "success": true,
  "value": "42"
}
```

**Note**: Previous versions returned "Zobrazuje se 42" (Czech locale). Current version extracts pure numeric/operator content using regex pattern `[\d\+\-\*/\.,\(\)eE]+$`.

**Example**:
```powershell
WinKeys.exe "PID:12345" "{READ}"
# Output: {"success":true,"value":"42"}
```

**Error Example**:
```json
{"success": false, "error": "read_failed", "value": null}
```

### 4. Query UI Tree - `{QUERYTREE:depth}`
**Syntax**: `{QUERYTREE:depth}`

**Output**: JSON tree structure
```json
{
  "Name": "Kalkulačka",
  "AutomationId": "TitleBar",
  "ControlType": "TitleBar",
  "Position": {"X":409,"Y":116,"Width":420,"Height":676},
  "Properties": {"IsEnabled":true,"IsOffscreen":false},
  "Actions": ["SetFocus"],
  "children": [...]
}
```

**Example**:
```powershell
WinKeys.exe "HANDLE:5247274" "{QUERYTREE:3}"
# Outputs full tree to depth 3
```

### 5. Mouse Click by Coordinates - `{CLICK:x,y}`
**Syntax**: `{CLICK:x,y}`

**Output**: JSON
```json
{"success": true, "action": "click"}
```

**Example**:
```powershell
WinKeys.exe "PID:12345" "{CLICK:250,300}"
```

### 6. Mouse Click by Name - `{CLICKNAME:name}`
**Syntax**: `{CLICKNAME:name}`

**Output**: JSON success or error
```json
{"success": true, "action": "clickname"}
```

**Error if element not found**:
```json
{"success": false, "error": "element_not_found"}
```

**Example**:
```powershell
# Czech Calculator
WinKeys.exe "HANDLE:5247274" "{CLICKNAME:Clear}"
WinKeys.exe "HANDLE:5247274" "{CLICKNAME:Osm}"

# English Calculator  
WinKeys.exe "HANDLE:5247274" "{CLICKNAME:Eight}"
```

**Note**: Button names are locale-dependent. Use `{QUERYTREE}` to discover exact names, or use `{CLICK:x,y}` for language independence.

## Output Format

**All commands output JSON to stdout**. Debug messages go to stderr.

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
  "message": "Optional error details",
  "target": "Optional target identifier"
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Window not found |
| 2 | Invalid usage/arguments |
| 3 | SendKeys failed |
| 4 | Read operation failed |
| 5 | Element not found (CLICKNAME) |
| 128 | Fatal exception |

**See ERROR_CODES.md for complete error reference and remediation.**

## Complete Examples

### Example 1: Find and Automate Calculator

```powershell
# 1. List all windows
$windows = & "C:\path\to\WinKeys.exe" "{LISTWINDOWS}" 2>$null | ConvertFrom-Json

# 2. Find Calculator by title (language-independent partial match)
$calc = $windows.windows | Where-Object { $_.title -like "*alcul*" } | Select-Object -First 1

if (-not $calc) {
    Write-Error "Calculator not found. Please start Calculator first."
    exit 1
}

Write-Host "Found Calculator: PID=$($calc.pid), HANDLE=$($calc.handle)"

# 3. Use HANDLE for all operations (most reliable)
$processId = "HANDLE:$($calc.handle)"

# 4. Clear display
$result = & "C:\path\to\WinKeys.exe" $processId "{ESCAPE}" 2>$null | ConvertFrom-Json
if (-not $result.success) {
    Write-Error "Clear failed: $($result.error)"
    exit 1
}

# 5. Perform calculation: 123 + 456 =
& "C:\path\to\WinKeys.exe" $processId "123+456=" 2>$null | Out-Null
Start-Sleep -Seconds 1

# 6. Read result
$readResult = & "C:\path\to\WinKeys.exe" $processId "{READ}" 2>$null | ConvertFrom-Json
if ($readResult.success) {
    Write-Host "Calculation result: $($readResult.value)"  # Output: 579
} else {
    Write-Error "Read failed: $($readResult.error)"
}
```

### Example 2: Language-Independent Button Clicks

```powershell
$processId = "HANDLE:5247274"

# 1. Query UI structure to find button positions
$tree = & "C:\path\to\WinKeys.exe" $processId "{QUERYTREE:2}" 2>$null | ConvertFrom-Json

# 2. Find "Clear" button (works in any language)
$clearBtn = $tree.children | ForEach-Object { $_.children } | 
    Where-Object { $_.ControlType -eq "Button" -and $_.Name -like "*lear*" } |
    Select-Object -First 1

# 3. Click by coordinates (language-independent)
$x = $clearBtn.Position.X + ($clearBtn.Position.Width / 2)
$y = $clearBtn.Position.Y + ($clearBtn.Position.Height / 2)

& "C:\path\to\WinKeys.exe" $processId "{CLICK:$x,$y}" 2>$null
```

### Example 3: Error Handling

```powershell
function Invoke-WinKeysCommand {
    param(
        [string]$ProcessId,
        [string]$Keys
    )
    
    $output = & "C:\path\to\WinKeys.exe" $ProcessId $Keys 2>$null
    $result = $output | ConvertFrom-Json
    
    if (-not $result.success) {
        switch ($result.error) {
            "window_not_found" {
                throw "Window '$($result.target)' not found. Use {LISTWINDOWS} to enumerate."
            }
            "element_not_found" {
                throw "Element not found. Use {QUERYTREE} to find correct name."
            }
            "read_failed" {
                Write-Warning "Could not read value (element may be empty)"
                return $null
            }
            default {
                throw "WinKeys error: $($result.error) - $($result.message)"
            }
        }
    }
    
    return $result
}

# Usage
try {
    $result = Invoke-WinKeysCommand "PID:12345" "{READ}"
    Write-Host "Value: $($result.value)"
} catch {
    Write-Error $_
}
```

## PowerShell Integration Pattern

```powershell
# Helper function for reliable automation
function Get-WindowHandle {
    param([string]$TitlePattern)
    
    $windows = & "C:\path\to\WinKeys.exe" "{LISTWINDOWS}" 2>$null | ConvertFrom-Json
    $window = $windows.windows | Where-Object { $_.title -like $TitlePattern } | Select-Object -First 1
    
    if ($window) {
        return "HANDLE:$($window.handle)"
    }
    return $null
}

# Usage
$calc = Get-WindowHandle "*alcul*"
if ($calc) {
    & "C:\path\to\WinKeys.exe" $calc "5*8=" 2>$null
}
```

## TypeScript Integration (MCP Server)

```typescript
import { spawn } from 'child_process';

async function executeWinKeys(processId: string, keys: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const proc = spawn('C:\\path\\to\\WinKeys.exe', [processId, keys]);
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });
        
        proc.on('close', (code) => {
            try {
                const result = JSON.parse(stdout);
                
                if (!result.success) {
                    reject(new Error(`WinKeys error: ${result.error} - ${result.message || ''}`));
                } else {
                    resolve(result);
                }
            } catch (err) {
                reject(new Error(`Invalid JSON from WinKeys (exit ${code}): ${stdout}`));
            }
        });
    });
}
```

## Best Practices

1. **Always use PID or HANDLE** for reliable window identification
   - Process names fail for UWP apps
   - Titles change with content
   - PID/HANDLE are stable

2. **Redirect stderr to null** in production
   ```powershell
   WinKeys.exe "..." "..." 2>$null
   ```

3. **Parse JSON and check success field**
   ```powershell
   $result = ... | ConvertFrom-Json
   if (-not $result.success) { ... }
   ```

4. **Use {LISTWINDOWS} first** to discover windows dynamically

5. **Use {QUERYTREE} for element discovery**
   - Don't hardcode button names (locale-dependent)
   - Extract coordinates for language-independence

6. **Prefer UIAutomation over keyboard**
   - {CLICKNAME:...} and {CLICK:x,y} don't require window focus
   - Keyboard input (SendKeys) requires foreground window

7. **Add delays between operations**
   - Modern apps need time to update UI
   - Minimum 500ms after clicks
   - 1-2 seconds after complex operations

## Debugging

### View Debug Output
```powershell
WinKeys.exe "notepad" "test" 2>&1
```

### Common Debug Messages
- `DEBUG: Looking for process: ...` - Shows target identification
- `DEBUG: Found N process(es) named '...'` - Process enumeration result
- `DEBUG: Window found, handle: ...` - Window located successfully
- `DEBUG: SetForegroundWindow returned: ...` - Focus attempt result

### Troubleshooting Checklist
1. Window exists? → Use `{LISTWINDOWS}`
2. Correct ProcessId format? → `PID:12345` or `HANDLE:67890` (uppercase, no spaces)
3. Element name correct? → Use `{QUERYTREE}` to verify
4. JSON parsing failed? → Redirect stderr: `2>$null`
5. Operation had no effect? → Check window has focus or use UIAutomation patterns

**For complete error codes and remediation, see ERROR_CODES.md**

## Architecture Notes

WinKeys.exe implements **one simple function per command**:
- No mixed concerns
- No business logic
- Pure input/output transformation
- Consistent JSON output format
- All operations are atomic

This design ensures:
- Predictable behavior
- Easy debugging
- Language-independent integration
- Reliable automation workflows

**Parameters**:
- `depth`: Integer (1-10) - How many levels deep to traverse

**Example**:
```powershell
WinKeys.exe "Calculator" "{QUERYTREE:3}"
```

### 4. List All Windows - `{LISTWINDOWS}`
**Syntax**: `{LISTWINDOWS}`

**Output**: JSON array of windows
```json
{
  "success": true,
  "windows": [
    {
      "handle": 1234567,
      "title": "Calculator",
      "pid": 8888
    },
    {
      "handle": 7654321,
      "title": "Notepad",
      "pid": 9999
    }
  ]
}
```

**Example**:
```powershell
WinKeys.exe "dummy" "{LISTWINDOWS}"
```

### 5. Mouse Click by Coordinates - `{CLICK:x,y}`
**Syntax**: `{CLICK:x,y}`

**Parameters**:
- `x`: Absolute screen X coordinate
- `y`: Absolute screen Y coordinate

**Output**: `OK`

**Example**:
```powershell
WinKeys.exe "Calculator" "{CLICK:500,300}"
```

### 6. Click by Element Name - `{CLICKNAME:name}`
**Syntax**: `{CLICKNAME:elementName}`

**Note**: Searches UI tree for element with matching AutomationId or Name.

**Example**:
```powershell
WinKeys.exe "Calculator" "{CLICKNAME:num3Button}"
```

## Window Finding Logic

WinKeys.exe searches for windows in this order:
1. Process name match (e.g., "CalculatorApp")
2. Window title match (e.g., "Kalkulačka")
3. Falls back to any window with partial title match

## Exit Codes

- `0` - Success
- `1` - Success with debug output (warnings)
- `2` - Window not found
- `3` - SendKeys failed
- `4` - Read operation failed

## Usage in PowerShell

```powershell
# Basic keyboard input
& "WinKeys.exe" "Calculator" "5+3="

# Read result (parse JSON)
$output = & "WinKeys.exe" "Calculator" "{READ}" 2>&1 | Where-Object { $_ -match '^\{' }
$result = $output | ConvertFrom-Json
Write-Host "Calculator shows: $($result.value)"

# Query UI structure
$tree = & "WinKeys.exe" "Calculator" "{QUERYTREE:2}" 2>&1 | Where-Object { $_ -match '^\{' } | ConvertFrom-Json
Write-Host "Window has $($tree.children.Count) children"

# List all windows
$windows = & "WinKeys.exe" "dummy" "{LISTWINDOWS}" 2>&1 | Where-Object { $_ -match '^\{' } | ConvertFrom-Json
$windows.windows | Where-Object { $_.title -like "*Calc*" }
```

## Debug Output

Debug messages are sent to `stderr` and prefixed with `DEBUG:`. Production code should filter these out:

```powershell
# Filter to get only JSON output
$json = & "WinKeys.exe" "Calculator" "{READ}" 2>&1 | Where-Object { $_ -match '^\{' }
```

## Source Code

Located at: `tools/win/WinKeys.cs`

Compilation:
```powershell
csc.exe /target:winexe /out:dist/win/WinKeys.exe `
  /r:"System.Windows.Forms.dll" `
  /r:"WPF/UIAutomationClient.dll" `
  /r:"WPF/UIAutomationTypes.dll" `
  /r:"WPF/WindowsBase.dll" `
  tools/win/WinKeys.cs
```
