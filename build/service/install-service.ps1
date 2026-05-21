# ???????????????????????????????????????????????????????????????????????????????
# AIAPI Service Installation Script (WinSW-based)
# ???????????????????????????????????????????????????????????????????????????????
#
# This script installs the AI UI Automation API as a Windows Service using WinSW.
#
# Usage:
#   .\install-service.ps1 [-ServicePath <path>] [-UseLocalExe]
#
# Parameters:
#   -ServicePath: Where to install the service (default: C:\Program Files\AIAPI)
#   -UseLocalExe: Use existing aiapi-server.exe from dist/release (for dev testing)
#
# Requirements:
#   - Administrator privileges
#   - aiapi-server.exe (standalone executable created by pkg)
#   - WinSW.exe (downloaded automatically if not present)
#
# ???????????????????????????????????????????????????????????????????????????????

[CmdletBinding()]
param(
    [string]$ServicePath = "C:\Program Files\AIAPI",
    [switch]$UseLocalExe
)

$ErrorActionPreference = "Stop"

# ??????????????????????????????????????????????????????????????????????????????
# Helper Functions
# ??????????????????????????????????????????????????????????????????????????????

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "???????????????????????????????????????????????????????????" -ForegroundColor Cyan
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host "???????????????????????????????????????????????????????????" -ForegroundColor Cyan
}

function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-WinSW {
    param([string]$DestPath)
    
    if (Test-Path $DestPath) {
        Write-Host "? WinSW already present" -ForegroundColor Green
        return
    }
    
    Write-Host "Downloading WinSW..." -ForegroundColor Cyan
    
    $winswUrl = "https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe"
    
    try {
        Invoke-WebRequest -Uri $winswUrl -OutFile $DestPath -UseBasicParsing
        Write-Host "? WinSW downloaded" -ForegroundColor Green
    }
    catch {
        Write-Host "? Failed to download WinSW: $_" -ForegroundColor Red
        throw
    }
}

# ??????????????????????????????????????????????????????????????????????????????
# Main Installation Logic
# ??????????????????????????????????????????????????????????????????????????????

Write-Section "AIAPI Service Installation (pkg + WinSW)"

# Check administrator privileges
if (-not (Test-Administrator)) {
    Write-Host "? ERROR: Administrator privileges required" -ForegroundColor Red
    Write-Host "  Right-click PowerShell and 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

Write-Host "? Running as Administrator" -ForegroundColor Green

# Determine project root
$scriptDir = Split-Path -Parent $PSCommandPath
$projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)

Write-Host "? Project root: $projectRoot" -ForegroundColor Green

# Check if service already exists
$serviceName = "AIAPIService"
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if ($existingService) {
    Write-Host "? Service '$serviceName' already exists (status: $($existingService.Status))" -ForegroundColor Yellow
    $response = Read-Host "Uninstall and reinstall? (y/N)"
    
    if ($response -ne 'y' -and $response -ne 'Y') {
        Write-Host "Installation cancelled" -ForegroundColor Yellow
        exit 0
    }
    
    Write-Host "Removing existing service..." -ForegroundColor Cyan
    
    # Stop if running
    if ($existingService.Status -eq 'Running') {
        Stop-Service -Name $serviceName -Force
        Start-Sleep -Seconds 2
    }
    
    # Try to find and use WinSW to uninstall
    $existingWinSW = Join-Path $ServicePath "aiapi-service.exe"
    if (Test-Path $existingWinSW) {
        & $existingWinSW uninstall
        Start-Sleep -Seconds 2
    } else {
        # Fallback to sc.exe
        sc.exe delete $serviceName | Out-Null
        Start-Sleep -Seconds 2
    }
    
    Write-Host "? Existing service removed" -ForegroundColor Green
}

Write-Section "Preparing Service Files"

# Create service directory
if (-not (Test-Path $ServicePath)) {
    New-Item -ItemType Directory -Path $ServicePath -Force | Out-Null
    Write-Host "? Created directory: $ServicePath" -ForegroundColor Green
} else {
    Write-Host "? Using existing directory: $ServicePath" -ForegroundColor Green
}

# Find or build the standalone executable
$localExePath = Join-Path $projectRoot "dist\release\aiapi-server.exe"

if ($UseLocalExe) {
    if (-not (Test-Path $localExePath)) {
        Write-Host "? ERROR: aiapi-server.exe not found at $localExePath" -ForegroundColor Red
        Write-Host "  Run 'npm run package:exe' first to build it" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host "? Using existing executable: $localExePath" -ForegroundColor Green
} else {
    Write-Host "Building standalone executable with pkg..." -ForegroundColor Cyan
    
    Push-Location $projectRoot
    
    try {
        # Ensure TypeScript is compiled
        & npm run compile
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "? TypeScript compilation failed" -ForegroundColor Red
            exit 1
        }
        
        # Build with pkg
        & npm run package:exe
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "? pkg build failed" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "? Standalone executable built" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}

# Copy executable to service directory
$serviceExePath = Join-Path $ServicePath "aiapi-server.exe"
Copy-Item -Path $localExePath -Destination $serviceExePath -Force
Write-Host "? Copied aiapi-server.exe to service directory" -ForegroundColor Green

# Copy helper binaries and resources
Write-Host "Copying helper binaries and resources..." -ForegroundColor Cyan

$resourcesToCopy = @(
    @{ Src = "components\helpers\windows\dist\KeyWin.exe"; Dest = "dist\win" },
    @{ Src = "components\helpers\windows\dist\BrowserWin.exe"; Dest = "dist\win" },
    @{ Src = "components\helpers\windows\dist\WinCommon.dll"; Dest = "dist\win" },
    @{ Src = "components\helpers\windows\dist\SecurityLib.dll"; Dest = "dist\win" },
    @{ Src = "components\helpers\shared\dist-resources\apptemplates"; Dest = "components\helpers\shared\dist-resources\apptemplates" },
    @{ Src = "components\helpers\windows\dist-resources\apptemplates"; Dest = "components\helpers\windows\dist-resources\apptemplates" },
    @{ Src = "components\server\dist-resources\dashboard"; Dest = "components\server\dist-resources\dashboard" },
    @{ Src = "config"; Dest = "config" },
    @{ Src = "security"; Dest = "security" }
)

foreach ($item in $resourcesToCopy) {
    $srcPath = Join-Path $projectRoot $item.Src
    $destPath = Join-Path $ServicePath $item.Dest
    
    if (Test-Path $srcPath) {
        $destParent = Split-Path -Parent $destPath
        if (-not (Test-Path $destParent)) {
            New-Item -ItemType Directory -Path $destParent -Force | Out-Null
        }
        
        Copy-Item -Path $srcPath -Destination $destPath -Recurse -Force
        Write-Host "  ? $($item.Src)" -ForegroundColor Gray
    } else {
        Write-Host "  ? Skipped $($item.Src) (not found)" -ForegroundColor Yellow
    }
}

Write-Host "? Resources copied" -ForegroundColor Green

# Download WinSW
Write-Section "Setting up WinSW"

$winswExePath = Join-Path $ServicePath "aiapi-service.exe"
Get-WinSW -DestPath $winswExePath

# Copy service configuration XML
$configSourcePath = Join-Path $scriptDir "aiapi-service.xml"
$configDestPath = Join-Path $ServicePath "aiapi-service.xml"

if (-not (Test-Path $configSourcePath)) {
    Write-Host "? ERROR: Service configuration XML not found at $configSourcePath" -ForegroundColor Red
    exit 1
}

Copy-Item -Path $configSourcePath -Destination $configDestPath -Force
Write-Host "? Service configuration copied" -ForegroundColor Green

# Create logs directory
$logsDir = Join-Path $ServicePath "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

Write-Section "Installing Windows Service"

# Install service using WinSW
Push-Location $ServicePath

try {
    Write-Host "Registering service with Windows Service Manager..." -ForegroundColor Cyan
    
    & .\aiapi-service.exe install
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "? Service installation failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "? Service registered" -ForegroundColor Green
    
    Write-Section "Starting Service"
    
    Write-Host "Starting service..." -ForegroundColor Cyan
    Start-Service -Name $serviceName
    
    Start-Sleep -Seconds 5
    
    $service = Get-Service -Name $serviceName
    
    if ($service.Status -eq 'Running') {
        Write-Host "? Service started successfully!" -ForegroundColor Green
    } else {
        Write-Host "? Service status: $($service.Status)" -ForegroundColor Yellow
        Write-Host "  Check logs: $logsDir" -ForegroundColor Yellow
    }
}
finally {
    Pop-Location
}

Write-Section "Installation Complete"

Write-Host ""
Write-Host "Service Information:" -ForegroundColor Cyan
Write-Host "  Name:        AIAPIService" -ForegroundColor White
Write-Host "  Display:     AI UI Automation API" -ForegroundColor White
Write-Host "  Status:      $((Get-Service -Name $serviceName).Status)" -ForegroundColor White
Write-Host "  Location:    $ServicePath" -ForegroundColor White
Write-Host ""
Write-Host "Endpoints:" -ForegroundColor Cyan
Write-Host "  MCP Server:  http://127.0.0.1:4457" -ForegroundColor White
Write-Host "  Dashboard:   http://127.0.0.1:4458" -ForegroundColor White
Write-Host ""
Write-Host "Logs:" -ForegroundColor Cyan
Write-Host "  Directory:   $logsDir" -ForegroundColor White
Write-Host ""
Write-Host "Service Management:" -ForegroundColor Cyan
Write-Host "  Start:       Start-Service AIAPIService" -ForegroundColor Gray
Write-Host "  Stop:        Stop-Service AIAPIService" -ForegroundColor Gray
Write-Host "  Restart:     Restart-Service AIAPIService" -ForegroundColor Gray
Write-Host "  Status:      Get-Service AIAPIService" -ForegroundColor Gray
Write-Host "  Uninstall:   .\uninstall-service.ps1" -ForegroundColor Gray
Write-Host "  Update:      .\update-service.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "? AIAPI Service is now running!" -ForegroundColor Green
Write-Host ""

# Test the endpoint
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:4457/ping" -UseBasicParsing -TimeoutSec 5
    Write-Host "? Health check successful - service is responding" -ForegroundColor Green
}
catch {
    Write-Host "? Health check failed - service may still be starting" -ForegroundColor Yellow
    Write-Host "  Wait a few seconds and try: http://127.0.0.1:4457/ping" -ForegroundColor Yellow
}

Write-Host ""
