# ═══════════════════════════════════════════════════════════════════════════════
# AIAPI Service Update Script (WinSW-based)
# ═══════════════════════════════════════════════════════════════════════════════
#
# This script updates the running AIAPI service after git commit/push.
# Run this after committing changes to deploy the update to the production service.
#
# Usage:
#   .\update-service.ps1 [-NoBuild] [-NoRestart] [-BuildTarget <All|TS|CS|Exe|None>]
#
# Parameters:
#   -NoBuild:      Skip building, use existing binaries
#   -NoRestart:    Update files but don't restart service
#   -BuildTarget:  'All' (default), 'TS', 'CS', 'Exe', or 'None' (same as -NoBuild)
#
# ═══════════════════════════════════════════════════════════════════════════════

[CmdletBinding()]
param(
    [switch]$NoBuild,
    [switch]$NoRestart,
    [ValidateSet('All','TS','CS','Exe','None')]
    [string]$BuildTarget = 'All'
)

$ErrorActionPreference = "Stop"

# ──────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ──────────────────────────────────────────────────────────────────────────────

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
}

function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ──────────────────────────────────────────────────────────────────────────────
# Main Logic
# ──────────────────────────────────────────────────────────────────────────────

Write-Section "AIAPI Service Update"

# Check administrator privileges
if (-not (Test-Administrator)) {
    Write-Host "✗ ERROR: Administrator privileges required" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Running as Administrator" -ForegroundColor Green

# Determine project root
$scriptDir = Split-Path -Parent $PSCommandPath
$projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$servicePath = "C:\Program Files\AIAPI"
$serviceName = "AIAPIService"

Write-Host "✓ Project root: $projectRoot" -ForegroundColor Green

# Check if service exists
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if (-not $service) {
    Write-Host "✗ ERROR: Service '$serviceName' not installed" -ForegroundColor Red
    Write-Host "  Run install-service.ps1 first" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Service found (status: $($service.Status))" -ForegroundColor Green

# Build if requested
if ($NoBuild -or $BuildTarget -eq 'None') {
    Write-Host "⚠ Skipping build (using existing binaries)" -ForegroundColor Yellow
} else {
    Write-Section "Building Project"
    Push-Location $projectRoot
    try {
        # TypeScript compile (tsc only - produces dist/*.js)
        if ($BuildTarget -eq 'All' -or $BuildTarget -eq 'TS') {
            Write-Host "Compiling TypeScript..." -ForegroundColor Cyan
            & npm run compile
            if ($LASTEXITCODE -ne 0) {
                Write-Host "✗ TypeScript compilation failed" -ForegroundColor Red
                exit 1
            }
            Write-Host "✓ TypeScript compiled" -ForegroundColor Green
        }

        # C# helpers
        if ($BuildTarget -eq 'All' -or $BuildTarget -eq 'CS') {
            Write-Host "Building C# helpers..." -ForegroundColor Cyan
            & PowerShell -ExecutionPolicy Bypass -File "build-all.ps1" -CsOnly
            if ($LASTEXITCODE -ne 0) {
                Write-Host "✗ C# helper build failed" -ForegroundColor Red
                exit 1
            }
            Write-Host "✓ C# helpers built" -ForegroundColor Green
        }

        # pkg standalone exe - MUST run after TS compile because the service runs
        # aiapi-server.exe (a pkg bundle of dist/). 'TS' includes this step so that
        # TypeScript changes actually reach the deployed exe. 'Exe' alone re-packages
        # whatever is currently in dist/ without recompiling.
        if ($BuildTarget -eq 'All' -or $BuildTarget -eq 'TS' -or $BuildTarget -eq 'Exe') {
            Write-Host "Building standalone executable (pkg)..." -ForegroundColor Cyan
            & npm run package:exe
            if ($LASTEXITCODE -ne 0) {
                Write-Host "✗ pkg build failed" -ForegroundColor Red
                exit 1
            }
            Write-Host "✓ Standalone executable built" -ForegroundColor Green
        }
    }
    finally {
        Pop-Location
    }
}

# Stop service
Write-Section "Stopping Service"

if ($service.Status -eq 'Running') {
    Write-Host "Stopping service..." -ForegroundColor Cyan
    Stop-Service -Name $serviceName -Force
    
    $timeout = 30
    $elapsed = 0
    
    while ((Get-Service -Name $serviceName).Status -ne 'Stopped' -and $elapsed -lt $timeout) {
        Start-Sleep -Seconds 1
        $elapsed++
        if ($elapsed % 5 -eq 0) {
            Write-Host "  Waiting... ($elapsed/$timeout)" -ForegroundColor Gray
        }
    }
    
    $finalStatus = (Get-Service -Name $serviceName).Status
    
    if ($finalStatus -eq 'Stopped') {
        Write-Host "✓ Service stopped" -ForegroundColor Green
    } else {
        Write-Host "⚠ Service status: $finalStatus (timeout)" -ForegroundColor Yellow
    }
    
    # Kill any lingering helper processes
    Get-Process | Where-Object { $_.Path -like "$servicePath*" } | ForEach-Object {
        Write-Host "  Terminating lingering process: $($_.Name)" -ForegroundColor Gray
        $_ | Stop-Process -Force
    }
    
    Start-Sleep -Seconds 2
} else {
    Write-Host "✓ Service already stopped" -ForegroundColor Green
}

# Copy updated files
Write-Section "Copying Updated Files"

$filesToCopy = @(
    @{ Src = "dist\release\aiapi-server.exe"; Dest = "aiapi-server.exe"; Desc = "Main executable" },
    @{ Src = "dist\helpers\KeyWin.exe"; Dest = "dist\win\KeyWin.exe"; Desc = "KeyWin helper" },
    @{ Src = "dist\helpers\BrowserWin.exe"; Dest = "dist\win\BrowserWin.exe"; Desc = "BrowserWin helper" },
    @{ Src = "dist\helpers\SecurityLib.dll"; Dest = "dist\win\SecurityLib.dll"; Desc = "Security library" }
)

$dirsToCopy = @(
    @{ Src = "components\helpers\shared\dist-resources\apptemplates"; Dest = "components\helpers\shared\dist-resources\apptemplates"; Desc = "Shared app templates" },
    @{ Src = "components\helpers\windows\dist-resources\apptemplates"; Dest = "components\helpers\windows\dist-resources\apptemplates"; Desc = "Windows app templates" },
    @{ Src = "components\server\dist-resources\dashboard"; Dest = "components\server\dist-resources\dashboard"; Desc = "Dashboard UI" }
)

foreach ($item in $filesToCopy) {
    $srcPath = Join-Path $projectRoot $item.Src
    $destPath = Join-Path $servicePath $item.Dest
    
    if (Test-Path $srcPath) {
        $destParent = Split-Path -Parent $destPath
        if (-not (Test-Path $destParent)) {
            New-Item -ItemType Directory -Path $destParent -Force | Out-Null
        }
        
        Copy-Item -Path $srcPath -Destination $destPath -Force
        Write-Host "  ✓ $($item.Desc)" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠ Skipped $($item.Desc) (not found)" -ForegroundColor Yellow
    }
}

foreach ($item in $dirsToCopy) {
    $srcPath = Join-Path $projectRoot $item.Src
    $destPath = Join-Path $servicePath $item.Dest
    
    if (Test-Path $srcPath) {
        if (Test-Path $destPath) {
            Remove-Item -Path $destPath -Recurse -Force
        }
        
        $destParent = Split-Path -Parent $destPath
        if (-not (Test-Path $destParent)) {
            New-Item -ItemType Directory -Path $destParent -Force | Out-Null
        }
        
        Copy-Item -Path $srcPath -Destination $destPath -Recurse -Force
        Write-Host "  ✓ $($item.Desc)" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠ Skipped $($item.Desc) (not found)" -ForegroundColor Yellow
    }
}

Write-Host "✓ Files updated" -ForegroundColor Green

# Restart service
if (-not $NoRestart) {
    Write-Section "Starting Service"
    
    Write-Host "Starting service..." -ForegroundColor Cyan
    Start-Service -Name $serviceName
    
    Start-Sleep -Seconds 5
    
    $service = Get-Service -Name $serviceName
    
    if ($service.Status -eq 'Running') {
        Write-Host "✓ Service started successfully" -ForegroundColor Green
    } else {
        Write-Host "⚠ Service status: $($service.Status)" -ForegroundColor Yellow
        Write-Host "  Check logs at: $servicePath\logs" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ Service not restarted (use Start-Service $serviceName to start)" -ForegroundColor Yellow
}

# ── Post-deploy smoke test ────────────────────────────────────────────────
if (-not $NoRestart) {
    Write-Host "Running post-deploy smoke test..." -ForegroundColor Cyan
    Start-Sleep -Seconds 3
    $smokeScript = Join-Path $PSScriptRoot "..\..\test\smoke\service-mode.ps1"
    if (Test-Path $smokeScript) {
        & powershell -NonInteractive -ExecutionPolicy Bypass -File $smokeScript
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Smoke test FAILED (exit $LASTEXITCODE) — service is running but may be degraded."
        } else {
            Write-Host "Smoke test PASSED." -ForegroundColor Green
        }
    } else {
        Write-Warning "Smoke test script not found at $smokeScript — skipping."
    }
}

Write-Section "Update Complete"

# Get git info
$gitCommit = ""
$gitBranch = ""
try {
    Push-Location $projectRoot
    $gitCommit = & git rev-parse --short HEAD 2>$null
    $gitBranch = & git branch --show-current 2>$null
    Pop-Location
} catch { }

Write-Host ""
Write-Host "Service Information:" -ForegroundColor Cyan
Write-Host "  Name:        AIAPIService" -ForegroundColor White
Write-Host "  Status:      $((Get-Service -Name $serviceName).Status)" -ForegroundColor White
Write-Host "  Location:    $servicePath" -ForegroundColor White
if ($gitCommit) {
    Write-Host "  Git:         $gitBranch @ $gitCommit" -ForegroundColor White
}
Write-Host ""
Write-Host "Endpoints:" -ForegroundColor Cyan
Write-Host "  MCP Server:  http://127.0.0.1:4457" -ForegroundColor White
Write-Host "  Dashboard:   http://127.0.0.1:4458" -ForegroundColor White
Write-Host ""
Write-Host "Logs:" -ForegroundColor Cyan
Write-Host "  Directory:   $servicePath\logs" -ForegroundColor White
Write-Host ""
Write-Host "✓ Service updated successfully!" -ForegroundColor Green
Write-Host ""

# Show recent logs if service is running
if (-not $NoRestart -and (Get-Service -Name $serviceName).Status -eq 'Running') {
    $logFiles = Get-ChildItem -Path "$servicePath\logs" -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    
    if ($logFiles) {
        Write-Host "Recent log output (last 10 lines):" -ForegroundColor Cyan
        Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor Gray
        Get-Content $logFiles[0].FullName -Tail 10 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
        Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor Gray
        Write-Host ""
    }
    
    # Test health endpoint
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:4457/ping" -UseBasicParsing -TimeoutSec 5
        Write-Host "✓ Health check successful - service is responding" -ForegroundColor Green
    }
    catch {
        Write-Host "⚠ Health check failed - service may still be starting" -ForegroundColor Yellow
    }
}

Write-Host ""
