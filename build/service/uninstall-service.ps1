# ═══════════════════════════════════════════════════════════════════════════════
# AIAPI Service Uninstallation Script (WinSW-based)
# ═════════════════════════════════════════════════════════════════════════════ ══
#
# This script uninstalls the AIAPI Windows Service.
#
# Usage:
#   .\uninstall-service.ps1 [-KeepFiles]
#
# Parameters:
#   -KeepFiles: Keep service files, only remove the service registration
#
# ═══════════════════════════════════════════════════════════════════════════════

[CmdletBinding()]
param(
    [switch]$KeepFiles
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

Write-Section "AIAPI Service Uninstallation"

# Check administrator privileges
if (-not (Test-Administrator)) {
    Write-Host "✗ ERROR: Administrator privileges required" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Running as Administrator" -ForegroundColor Green

$serviceName = "AIAPIService"
$servicePath = "C:\Program Files\AIAPI"

# Check if service exists
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if (-not $service) {
    Write-Host "⚠ Service '$serviceName' not found" -ForegroundColor Yellow
    
    if (-not $KeepFiles -and (Test-Path $servicePath)) {
        $response = Read-Host "Remove service files from $servicePath anyway? (y/N)"
        if ($response -ne 'y' -and $response -ne 'Y') {
            exit 0
        }
        $removeFiles = $true
    } else {
        Write-Host "Nothing to uninstall" -ForegroundColor Yellow
        exit 0
    }
}

if ($service) {
    Write-Section "Stopping Service"
    
    if ($service.Status -eq 'Running') {
        Write-Host "Stopping service..." -ForegroundColor Cyan
        Stop-Service -Name $serviceName -Force
        
        $timeout = 15
        $elapsed = 0
        while ((Get-Service -Name $serviceName).Status -ne 'Stopped' -and $elapsed -lt $timeout) {
            Start-Sleep -Seconds 1
            $elapsed++
        }
        
        if ((Get-Service -Name $serviceName).Status -eq 'Stopped') {
            Write-Host "✓ Service stopped" -ForegroundColor Green
        } else {
            Write-Host "⚠ Service did not stop cleanly" -ForegroundColor Yellow
        }
    } else {
        Write-Host "✓ Service already stopped" -ForegroundColor Green
    }
    
    # Give helper processes time to terminate
    Start-Sleep -Seconds 2
    
    Write-Section "Uninstalling Service"
    
    $winswExePath = Join-Path $servicePath "aiapi-service.exe"
    
    if (Test-Path $winswExePath) {
        Write-Host "Using WinSW to uninstall..." -ForegroundColor Cyan
        
        Push-Location $servicePath
        try {
            & .\aiapi-service.exe uninstall
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✓ Service uninstalled" -ForegroundColor Green
            } else {
                Write-Host "⚠ WinSW returned exit code $LASTEXITCODE" -ForegroundColor Yellow
            }
        }
        finally {
            Pop-Location
        }
    } else {
        Write-Host "Using sc.exe to uninstall..." -ForegroundColor Cyan
        sc.exe delete $serviceName
        Write-Host "✓ Service uninstalled" -ForegroundColor Green
    }
    
    Start-Sleep -Seconds 2
}

# Remove files
if (-not $KeepFiles -or $removeFiles) {
    Write-Section "Removing Files"
    
    if (Test-Path $servicePath) {
        $response = Read-Host "Delete all files in $servicePath? (y/N)"
        
        if ($response -eq 'y' -or $response -eq 'Y') {
            Write-Host "Removing service files..." -ForegroundColor Cyan
            
            try {
                # Kill any lingering helper processes
                Get-Process | Where-Object { $_.Path -like "$servicePath*" } | ForEach-Object {
                    Write-Host "  Terminating lingering process: $($_.Name)" -ForegroundColor Gray
                    $_ | Stop-Process -Force
                }
                
                Start-Sleep -Seconds 1
                
                Remove-Item -Path $servicePath -Recurse -Force
                Write-Host "✓ Files removed" -ForegroundColor Green
            }
            catch {
                Write-Host "⚠ Could not remove some files: $_" -ForegroundColor Yellow
                Write-Host "  You may need to remove them manually" -ForegroundColor Yellow
            }
        } else {
            Write-Host "✓ Files kept at $servicePath" -ForegroundColor Green
        }
    }
}

Write-Section "Uninstallation Complete"
Write-Host ""
Write-Host "✓ Service uninstalled successfully" -ForegroundColor Green
Write-Host ""
