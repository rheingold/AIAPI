# test/smoke/exec-cmd-bridge.ps1
# Verifies that exec_cmd routes through WinSvcBridge --exec when running as a Windows
# Service (Session 0) so commands execute as the logged-in user, not SYSTEM.
# Requires: AIAPI service running on port 4457

param(
    [string]$BaseUrl = 'http://localhost:4457/'
)

$pass = 0; $fail = 0

function Invoke-ExecCmd {
    param([string]$Exe, [string]$Args = '')
    $payload = @{
        jsonrpc = '2.0'; id = 1; method = 'tools/call'
        params  = @{ name = 'exec_cmd'; arguments = @{ executable = $Exe; args = $Args } }
    } | ConvertTo-Json -Depth 5
    $r = Invoke-WebRequest -Uri $BaseUrl -Method POST -ContentType 'application/json' -Body $payload -UseBasicParsing -TimeoutSec 15
    return $r.Content | ConvertFrom-Json
}

function Check {
    param([string]$Label, [string]$Exe, [string]$Args, [string]$Expect, [string]$ExpectNot = '')
    try {
        $r      = Invoke-ExecCmd -Exe $Exe -Args $Args
        $val    = $r.result.value
        $bridge = $r.result._bridge
        $ok     = $val -match [regex]::Escape($Expect)
        if ($ok -and $ExpectNot -and $val -match [regex]::Escape($ExpectNot)) { $ok = $false }
        if ($ok) {
            Write-Host "  PASS [$Label]: '$val' bridge=$bridge"
            $script:pass++
        } else {
            Write-Host "  FAIL [$Label]: expected='$Expect' notExpected='$ExpectNot' got='$val' bridge=$bridge"
            $script:fail++
        }
    } catch {
        Write-Host "  ERROR [$Label]: $_"
        $script:fail++
    }
}

Write-Host ""
Write-Host "=== exec_cmd bridge test (service @ $BaseUrl) ==="
Write-Host ""

# Check 1: whoami returns the logged-in user, NOT nt authority\system
Check "whoami=user"   "whoami"      ""                        "plachy"         "nt authority"

# Check 2: hostname returns machine name
Check "hostname"      "hostname"    ""                        "DESKTOP-NKO75N9"

# Check 3: cmd.exe /c echo works via bridge (args split by server-side splitArgs)
Check "cmd echo"      "cmd.exe"     "/c echo hello_bridge"    "hello_bridge"

# Check 4: powershell UserName env var — use -Command with single quoted string to avoid PS interactive
Check "ps username"   "powershell"  "-NoProfile -NonInteractive -Command Write-Output $env:USERNAME"  "plachy"

# Check 5: _bridge field is 'exec' confirming bridge path was taken
try {
    $r = Invoke-ExecCmd -Exe "whoami" -Args ""
    if ($r.result._bridge -eq 'exec') {
        Write-Host "  PASS [_bridge=exec]: confirmed bridge route"
        $pass++
    } else {
        Write-Host "  FAIL [_bridge=exec]: _bridge='$($r.result._bridge)' (bridge not used)"
        $fail++
    }
} catch {
    Write-Host "  ERROR [_bridge=exec]: $_"; $fail++
}

# Check 6: success=true for a passing command
try {
    $r = Invoke-ExecCmd -Exe "whoami" -Args ""
    if ($r.result.success -eq $true) {
        Write-Host "  PASS [success=true]"
        $pass++
    } else {
        Write-Host "  FAIL [success=true]: success=$($r.result.success)"
        $fail++
    }
} catch {
    Write-Host "  ERROR [success]: $_"; $fail++
}

$total = $pass + $fail
Write-Host ""
if ($fail -eq 0) {
    Write-Host "=== $pass/$total PASS ===" -ForegroundColor Green
    exit 0
} else {
    Write-Host "=== $pass/$total PASS  $fail FAIL ===" -ForegroundColor Red
    exit 1
}
