# ═══════════════════════════════════════════════════════════════════════════════
# AIAPI Service-Mode Smoke Test
# ═══════════════════════════════════════════════════════════════════════════════
#
# Mandatory post-deploy smoke test gate for the Windows service deployment.
# Validates the live service on port 4457 (service-mode port — NOT dev port 3457).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File test\smoke\service-mode.ps1
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
#
# Checks:
#   1. GET /health  → status == "ok"
#   2. MCP tools/list  → array with >= 1 items
#   3. MCP listHelpers → NativeWin present with virtual: true
#   4. MCP exec_cmd  → output contains "hello"
#   5. MCP fs_list   → returns a list (not an error)
#   6. GET /api/settings → HTTP 200
#   7. Session 0 detection → NativeWin present in listHelpers response
#   8. Service port assertion → port 4457 (not dev port 3457)
# ═══════════════════════════════════════════════════════════════════════════════

$BaseUrl  = "http://127.0.0.1:4457"
$Passed   = 0
$Failed   = 0
$Total    = 8

function Write-Pass([string]$msg) {
    Write-Host "[PASS] $msg" -ForegroundColor Green
    $script:Passed++
}

function Write-Fail([string]$msg) {
    Write-Host "[FAIL] $msg" -ForegroundColor Red
    $script:Failed++
}

function Invoke-McpTool {
    param(
        [string]$ToolName,
        [hashtable]$Arguments = @{},
        [int]$Id = 1
    )
    $body = @{
        jsonrpc = "2.0"
        id      = $Id
        method  = "tools/call"
        params  = @{
            name      = $ToolName
            arguments = $Arguments
        }
    } | ConvertTo-Json -Depth 10 -Compress

    Invoke-RestMethod -Uri $BaseUrl -Method POST -Body $body `
        -ContentType "application/json" -ErrorAction Stop
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " AIAPI Service-Mode Smoke Test  --  port $BaseUrl" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# ── Check 1: GET /health → status == "ok" ─────────────────────────────────────
Write-Host "Check 1: GET /health"
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method GET -ErrorAction Stop
    if ($health.status -eq "ok") {
        Write-Pass "GET /health returned status='ok'"
    } else {
        Write-Fail "GET /health returned status='$($health.status)' (expected 'ok')"
    }
} catch {
    Write-Fail "GET /health failed: $_"
}

# ── Check 2: MCP tools/list → array with >= 1 items ──────────────────────────
Write-Host "Check 2: MCP tools/list"
try {
    $listBody = '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
    $toolsList = Invoke-RestMethod -Uri $BaseUrl -Method POST -Body $listBody `
        -ContentType "application/json" -ErrorAction Stop
    $tools = $toolsList.result.tools
    if ($tools -and $tools.Count -ge 1) {
        Write-Pass "tools/list returned $($tools.Count) tools"
    } else {
        Write-Fail "tools/list returned empty or missing tools array (count=$($tools.Count))"
    }
} catch {
    Write-Fail "tools/list failed: $_"
}

# ── Check 3: MCP listHelpers → NativeWin present with virtual: true ───────────
Write-Host "Check 3: MCP listHelpers (NativeWin virtual:true)"
$listHelpersResponse = $null
try {
    $listHelpersResponse = Invoke-McpTool -ToolName "listHelpers" -Id 3
    $contentText = $listHelpersResponse.result.content[0].text
    $helpersData = $contentText | ConvertFrom-Json
    $helpers = $helpersData.helpers
    $nativeWin = $helpers | Where-Object { $_.name -eq "NativeWin" }
    if ($nativeWin -and $nativeWin.virtual -eq $true) {
        Write-Pass "listHelpers returned NativeWin with virtual=true"
    } elseif ($nativeWin) {
        Write-Fail "listHelpers returned NativeWin but virtual=$($nativeWin.virtual) (expected true)"
    } else {
        Write-Fail "listHelpers did not return NativeWin helper (helpers: $($helpers | ForEach-Object { $_.name } | Join-String -Separator ', '))"
    }
} catch {
    Write-Fail "listHelpers failed: $_"
}

# ── Check 4: MCP exec_cmd → output contains "hello" ──────────────────────────
Write-Host "Check 4: MCP exec_cmd echo"
try {
    $execResp = Invoke-McpTool -ToolName "exec_cmd" -Arguments @{ command = "echo hello" } -Id 4
    $execText = $execResp.result.content[0].text
    if ($execText -match "hello") {
        Write-Pass "exec_cmd 'echo hello' output contains 'hello'"
    } else {
        Write-Fail "exec_cmd output did not contain 'hello'. Got: $execText"
    }
} catch {
    Write-Fail "exec_cmd failed: $_"
}

# ── Check 5: MCP fs_list → returns a list (not an error) ─────────────────────
Write-Host "Check 5: MCP fs_list"
try {
    $fsResp = Invoke-McpTool -ToolName "fs_list" -Arguments @{ path = "." } -Id 5
    $fsText = $fsResp.result.content[0].text
    $fsData = $fsText | ConvertFrom-Json
    # Success if we get an array (even empty) and no error field
    if ($fsResp.result.isError -eq $true) {
        Write-Fail "fs_list returned an error: $fsText"
    } elseif ($null -ne $fsData) {
        Write-Pass "fs_list returned a list from path '.'"
    } else {
        Write-Fail "fs_list returned unexpected null/empty response"
    }
} catch {
    Write-Fail "fs_list failed: $_"
}

# ── Check 6: GET /api/settings → HTTP 200 ────────────────────────────────────
Write-Host "Check 6: GET /api/settings"
try {
    $settingsResp = Invoke-WebRequest -Uri "$BaseUrl/api/settings" -UseBasicParsing -ErrorAction Stop
    if ($settingsResp.StatusCode -eq 200) {
        Write-Pass "GET /api/settings returned HTTP 200"
    } else {
        Write-Fail "GET /api/settings returned HTTP $($settingsResp.StatusCode) (expected 200)"
    }
} catch {
    Write-Fail "GET /api/settings failed: $_"
}

# ── Check 7: Session 0 detection — NativeWin must exist in listHelpers ────────
Write-Host "Check 7: Session 0 detection (NativeWin presence)"
try {
    if ($null -eq $listHelpersResponse) {
        $listHelpersResponse = Invoke-McpTool -ToolName "listHelpers" -Id 7
    }
    $contentText = $listHelpersResponse.result.content[0].text
    $helpersData = $contentText | ConvertFrom-Json
    $nativeWin = $helpersData.helpers | Where-Object { $_.name -eq "NativeWin" }
    if ($nativeWin) {
        Write-Pass "Session 0 detection: NativeWin helper is present (Session-0-safe tools available)"
    } else {
        Write-Fail "Session 0 detection: NativeWin not found in listHelpers — NativeWin-group tools unavailable"
    }
} catch {
    Write-Fail "Session 0 detection check failed: $_"
}

# ── Check 8: Service is NOT in dev mode (port must be 4457, not 3457) ─────────
Write-Host "Check 8: Service port assertion (must be 4457)"
try {
    # Verify we actually connected on 4457 (if the server responded on 4457, we are in service mode)
    $tcpTest = Test-NetConnection -ComputerName "127.0.0.1" -Port 4457 -InformationLevel Quiet -ErrorAction SilentlyContinue
    $devPortOpen = Test-NetConnection -ComputerName "127.0.0.1" -Port 3457 -InformationLevel Quiet -ErrorAction SilentlyContinue

    if ($tcpTest -eq $true) {
        if ($devPortOpen -eq $true) {
            # Both ports open — warn but don't fail; service-port is correct
            Write-Pass "Port 4457 is listening (service-mode port). NOTE: dev port 3457 is also open — ensure you are testing the service instance."
        } else {
            Write-Pass "Port 4457 is listening and dev port 3457 is NOT open — confirmed service-mode deployment"
        }
    } else {
        Write-Fail "Port 4457 is NOT listening — service may not be running or is on wrong port"
    }
} catch {
    Write-Fail "Port check failed: $_"
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
$summaryColor = if ($Failed -eq 0) { "Green" } else { "Red" }
Write-Host " $Passed/$Total checks passed" -ForegroundColor $summaryColor
if ($Failed -gt 0) {
    Write-Host " $Failed check(s) FAILED" -ForegroundColor Red
}
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

if ($Failed -gt 0) {
    Write-Host "SMOKE TEST FAILED — service is not fully functional" -ForegroundColor Red
    Write-Host "See docs/specs/QA_PROCESS.md for remediation steps." -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "SMOKE TEST PASSED — service is operational" -ForegroundColor Green
    exit 0
}
