# FS_Escaping Test Runner — PowerShell
# 
# Tests FS_WRITE/FS_READ escaping through the MCP server by:
# 1. Writing test content via FS_WRITE
# 2. Reading back via FS_READ  
# 3. Comparing content integrity
#
# Prerequisites: MCP server running on port 3457
# Run: powershell -ExecutionPolicy Bypass -File test-fs-escaping.ps1

param(
    [string]$ServerUrl = "http://127.0.0.1:3457",
    [string]$OutputDir = "$PSScriptRoot\fs-escaping\output"
)

$ErrorActionPreference = 'Stop'
$passed = 0
$failed = 0

# ─── Helpers ──────────────────────────────────────────────────────────────

function Invoke-MCPCall {
    param(
        [hashtable]$Arguments
    )
    
    $body = @{
        jsonrpc = '2.0'
        id = (Get-Date).Ticks
        method = 'tools/call'
        params = @{
            name = 'AutomateUI'
            arguments = $Arguments
        }
    } | ConvertTo-Json -Depth 10 -Compress
    
    try {
        $response = Invoke-RestMethod -Uri $ServerUrl -Method Post -Body $body -ContentType 'application/json'
        if ($response.error) {
            throw "RPC error: $($response.error.message)"
        }
        return $response.result
    } catch {
        throw $_
    }
}

function Test-FSWrite {
    param([string]$Path, [string]$Value, [switch]$Append)
    
    $args = @{
        helper = '_System'
        action = 'FS_WRITE'
        path = $Path
        value = $Value
    }
    if ($Append) { $args.append = $true }
    return Invoke-MCPCall @args
}

function Test-FSRead {
    param([string]$Path)
    return Invoke-MCPCall @{ helper = '_System'; action = 'FS_READ'; path = $Path }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    
    if ($Condition) {
        $script:passed++
        Write-Host "  ✅ $Message" -ForegroundColor Green
    } else {
        $script:failed++
        Write-Host "  ❌ $Message" -ForegroundColor Red
    }
}

# ─── Setup ────────────────────────────────────────────────────────────────

Write-Host "═══════════════════════════════════════════════════"
Write-Host "  FS Escaping Tests — PowerShell Runner"
Write-Host "═══════════════════════════════════════════════════"

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# Verify server is reachable
try {
    Invoke-MCPCall @{ helper = '_System'; action = 'FS_LIST'; path = $OutputDir } | Out-Null
    Write-Host "✅ MCP server reachable" -ForegroundColor Green
} catch {
    Write-Host "❌ Cannot reach MCP server at $ServerUrl" -ForegroundColor Red
    exit 1
}

# ─── Test: PowerShell Script Round-Trip ───────────────────────────────────

Write-Host "`n📄 PowerShell script round-trip"

$psContent = @'
$greeting = "Hello, World!"
$number = 42
$path = "C:\Users\test\Documents"
$url = "https://example.com/api?key=value&foo=bar"
Write-Host "$greeting $number"
Get-Process | Where-Object { $_.CPU -gt 100 }
function Test-Func { param([string]$input) Write-Output $input }
$hereString = @"
Line with $dollar and `backtick
"@
'@

$psPath = Join-Path $OutputDir 'test.ps1'
$wr = Test-FSWrite -Path $psPath -Value $psContent
Assert-True $wr.success "FS_WRITE PowerShell script"

$rd = Test-FSRead -Path $psPath
Assert-True $rd.success "FS_READ PowerShell script"

$fileContent = Get-Content $psPath -Raw
Assert-True ($fileContent -eq $psContent) "PowerShell content identical"
Assert-True ($fileContent -contains '$greeting') "Dollar sign preserved"
Assert-True (-not ($fileContent -contains '`$greeting')) "Dollar NOT backtick-escaped"

# ─── Test: Batch Script ──────────────────────────────────────────────────

Write-Host "`n📄 Batch script round-trip"

$batContent = @'
@echo off
echo %PATH%
echo 100%% complete
set "VAR=value"
cmd1 & cmd2 | cmd3
echo test > file.txt
'@

$batPath = Join-Path $OutputDir 'test.bat'
$wr = Test-FSWrite -Path $batPath -Value $batContent
Assert-True $wr.success "FS_WRITE batch script"

$rd = Test-FSRead -Path $batPath
$fileContent = Get-Content $batPath -Raw
Assert-True ($fileContent -eq $batContent) "Batch content identical"
Assert-True ($fileContent -contains '%PATH%') "Percent signs preserved"

# ─── Test: JSON Content ──────────────────────────────────────────────────

Write-Host "`n📄 JSON content round-trip"

$jsonObj = @{
    path = "C:\Users\test"
    url = "https://example.com?a=1&b=2"
    nested = @{ key = "value" }
    regex = "\b[A-Z]{2,}\b"
} | ConvertTo-Json -Depth 5

$jsonPath = Join-Path $OutputDir 'test.json'
$wr = Test-FSWrite -Path $jsonPath -Value $jsonObj
Assert-True $wr.success "FS_WRITE JSON"

$rd = Test-FSRead -Path $jsonPath
try {
    $parsed = $rd.value | ConvertFrom-Json
    Assert-True ($parsed.path -eq "C:\Users\test") "JSON path preserved"
} catch {
    Assert-True $false "JSON parseable: $_"
}

# ─── Test: Whitespace Preservation ───────────────────────────────────────

Write-Host "`n🔧 Whitespace preservation"

$wsPath = Join-Path $OutputDir 'whitespace.txt'
$wsContent = "line1`r`nline2`r`n"
Test-FSWrite -Path $wsPath -Value $wsContent
$actual = Get-Content $wsPath -Raw
Assert-True ($actual -eq $wsContent) "CRLF preserved"

$tabContent = "col1`tcol2`n    indented`n`t`ttab-indented"
Test-FSWrite -Path $wsPath -Value $tabContent
$actual = Get-Content $wsPath -Raw
Assert-True ($actual -eq $tabContent) "Tabs preserved"

# ─── Test: Append Mode ───────────────────────────────────────────────────

Write-Host "`n🔧 Append mode"

$appendPath = Join-Path $OutputDir 'append.txt'
Test-FSWrite -Path $appendPath -Value "line1`n"
Test-FSWrite -Path $appendPath -Value "line2`n" -Append
Test-FSWrite -Path $appendPath -Value "line3`n" -Append
$actual = Get-Content $appendPath -Raw
Assert-True ($actual -eq "line1`nline2`nline3`n") "Append mode correct"

# ─── Test: Unicode ───────────────────────────────────────────────────────

Write-Host "`n🔧 Unicode and emoji"

$unicodePath = Join-Path $OutputDir 'unicode.txt'
$unicodeContent = "Hello 世界 🌍 😀"
Test-FSWrite -Path $unicodePath -Value $unicodeContent
$actual = Get-Content $unicodePath -Raw -Encoding UTF8
Assert-True ($actual -eq $unicodeContent) "Unicode preserved"

# ─── Test: EXEC_CMD ──────────────────────────────────────────────────────

Write-Host "`n🔧 EXEC_CMD tests"

try {
    $cmdResult = Invoke-MCPCall @{
        helper = '_System'
        action = 'EXEC_CMD'
        proc = 'cmd.exe'
        value = '/c echo hello_from_cmd'
    }
    Assert-True $cmdResult.success "EXEC_CMD cmd.exe"
    Assert-True ($cmdResult.stdout -contains 'hello_from_cmd') "EXEC_CMD stdout correct"
} catch {
    Assert-True $false "EXEC_CMD: $_"
}

try {
    $psResult = Invoke-MCPCall @{
        helper = '_System'
        action = 'EXEC_CMD'
        proc = 'powershell.exe'
        value = '-ExecutionPolicy Bypass -Command "Write-Output hello_from_ps"'
    }
    Assert-True $psResult.success "EXEC_CMD PowerShell"
} catch {
    Assert-True $false "EXEC_CMD PS: $_"
}

# ─── Summary ──────────────────────────────────────────────────────────────

Write-Host "`n═══════════════════════════════════════════════════"
Write-Host "  Summary"
Write-Host "═══════════════════════════════════════════════════"
Write-Host "  ✅ Passed:  $passed"
Write-Host "  ❌ Failed: $failed"
Write-Host "═══════════════════════════════════════════════════"

# Cleanup
try {
    Remove-Item $OutputDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "🧹 Cleanup complete"
} catch {}

if ($failed -gt 0) { exit 1 }
