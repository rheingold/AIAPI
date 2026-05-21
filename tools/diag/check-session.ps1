<#
.SYNOPSIS
    Diagnoses Windows session context for AIAPI service vs. interactive use.
    Run this on the machine where AIAPI is installed to check for Session 0 issues.
#>

Write-Host "`n=== AIAPI Session 0 Diagnostic ===" -ForegroundColor Cyan

# Current session
$mySessionId = (Get-Process -Id $PID).SessionId
Write-Host "This PowerShell process session ID: $mySessionId" -ForegroundColor $(if ($mySessionId -eq 0) { 'Red' } else { 'Green' })

if ($mySessionId -eq 0) {
    Write-Host "WARNING: Running in Session 0 (service context)." -ForegroundColor Red
    Write-Host "LISTWINDOWS and SENDKEYS will NOT reach the user desktop." -ForegroundColor Red
} else {
    Write-Host "OK: Running in interactive session $mySessionId." -ForegroundColor Green
}

# Active console session
try {
    $sig = @'
[DllImport("kernel32.dll")]
public static extern uint WTSGetActiveConsoleSessionId();
'@
    $type = Add-Type -MemberDefinition $sig -Name 'WTS' -Namespace 'WinAPI' -PassThru
    $consoleSession = $type::WTSGetActiveConsoleSessionId()
    Write-Host "Active console session (user desktop): $consoleSession" -ForegroundColor Cyan
} catch {
    Write-Host "Could not query WTSGetActiveConsoleSessionId: $_" -ForegroundColor Yellow
}

# Check if AIAPI service exists and its session
$svc = Get-Service -Name 'AIAPI' -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "`nAIAPI service found: Status=$($svc.Status)" -ForegroundColor Cyan
    $svcProcess = Get-WmiObject Win32_Service -Filter "Name='AIAPI'" | Select-Object ProcessId
    if ($svcProcess -and $svcProcess.ProcessId -gt 0) {
        $svcProc = Get-Process -Id $svcProcess.ProcessId -ErrorAction SilentlyContinue
        if ($svcProc) {
            Write-Host "AIAPI service process session ID: $($svcProc.SessionId)" -ForegroundColor $(if ($svcProc.SessionId -eq 0) { 'Red' } else { 'Green' })
            if ($svcProc.SessionId -eq 0) {
                Write-Host "ACTION REQUIRED: AIAPI service runs in Session 0." -ForegroundColor Red
                Write-Host "See docs/specs/SESSION0_ISOLATION.md for the fix." -ForegroundColor Yellow
            }
        }
    }
} else {
    Write-Host "`nAIAPI Windows Service not found (running in dev mode — OK)." -ForegroundColor Gray
}

# Check helper processes
$helpers = @('KeyWin', 'BrowserWin', 'MSOfficeWin', 'LibreOfficeWin')
Write-Host "`n--- Helper process sessions ---"
foreach ($helper in $helpers) {
    $procs = Get-Process -Name $helper -ErrorAction SilentlyContinue
    if ($procs) {
        foreach ($p in $procs) {
            $color = if ($p.SessionId -eq 0) { 'Red' } else { 'Green' }
            Write-Host "  $($helper).exe PID=$($p.Id) Session=$($p.SessionId)" -ForegroundColor $color
        }
    } else {
        Write-Host "  $($helper).exe: not running" -ForegroundColor Gray
    }
}

Write-Host "`nDiagnostic complete." -ForegroundColor Cyan
