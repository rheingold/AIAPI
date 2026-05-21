# ═══════════════════════════════════════════════════════════════════════════════
# AIAPI Installer Package Builder
# ═══════════════════════════════════════════════════════════════════════════════
#
# This script creates a redistributable installer package containing:
#   - aiapi-server.exe (standalone executable)
#   - WinSW.exe (service wrapper)
#   - Service configuration XML
#   - Helper binaries (KeyWin, BrowserWin, etc.)
#   - App templates and dashboard UI
#   - Installation scripts
#
# Output: dist/release/AIAPI-Setup-{version}.zip
#
# ═══════════════════════════════════════════════════════════════════════════════

[CmdletBinding()]
param(
    [string]$Version = "0.2.0"
)

$ErrorActionPreference = "Stop"

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
}

Write-Section "AIAPI Installer Package Builder"

# Determine project root
$scriptDir = Split-Path -Parent $PSCommandPath
$projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$releaseDir = Join-Path $projectRoot "dist\release"
$packageName = "AIAPI-Setup-$Version"
$packageDir = Join-Path $releaseDir $packageName

Write-Host "✓ Project root: $projectRoot" -ForegroundColor Green
Write-Host "✓ Package will be: $packageName.zip" -ForegroundColor Green

# Clean/create package directory
if (Test-Path $packageDir) {
    Remove-Item -Path $packageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null

Write-Section "Building Components"

# Build everything
Push-Location $projectRoot

try {
    Write-Host "Compiling TypeScript..." -ForegroundColor Cyan
    & npm run compile
    if ($LASTEXITCODE -ne 0) { throw "TypeScript compilation failed" }
    
    Write-Host "✓ TypeScript compiled" -ForegroundColor Green
    
    Write-Host "Building Windows binaries..." -ForegroundColor Cyan
    & PowerShell -ExecutionPolicy Bypass -File "build\windows\build.ps1"
    if ($LASTEXITCODE -ne 0) { throw "Windows build failed" }
    
    Write-Host "✓ Windows binaries built" -ForegroundColor Green
    
    Write-Host "Building standalone executable..." -ForegroundColor Cyan
    & npm run package:exe
    if ($LASTEXITCODE -ne 0) { throw "pkg build failed" }
    
    Write-Host "✓ Standalone executable built" -ForegroundColor Green
}
finally {
    Pop-Location
}

Write-Section "Packaging Files"

# Create directory structure
$dirs = @(
    "dist\win",
    "dist\helpers",
    "components\helpers\shared\dist-resources\apptemplates",
    "components\helpers\windows\dist-resources\apptemplates",
    "components\server\dist-resources\dashboard",
    "config",
    "security",
    "docs"
)

foreach ($dir in $dirs) {
    $destDir = Join-Path $packageDir $dir
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

# Copy main executable
Write-Host "Copying aiapi-server.exe..." -ForegroundColor Cyan
Copy-Item (Join-Path $releaseDir "aiapi-server.exe") (Join-Path $packageDir "aiapi-server.exe") -Force

# Copy helper binaries
Write-Host "Copying helper binaries..." -ForegroundColor Cyan
Copy-Item (Join-Path $projectRoot "dist\win\*") (Join-Path $packageDir "dist\win\") -Recurse -Force
if (Test-Path (Join-Path $projectRoot "dist\helpers")) {
    Copy-Item (Join-Path $projectRoot "dist\helpers\*") (Join-Path $packageDir "dist\helpers\") -Recurse -Force
}

# Copy resources
Write-Host "Copying resources..." -ForegroundColor Cyan

$resourceMappings = @(
    @{ Src = "components\helpers\shared\dist-resources\apptemplates"; Dest = "components\helpers\shared\dist-resources\apptemplates" },
    @{ Src = "components\helpers\windows\dist-resources\apptemplates"; Dest = "components\helpers\windows\dist-resources\apptemplates" },
    @{ Src = "components\server\dist-resources\dashboard"; Dest = "components\server\dist-resources\dashboard" },
    @{ Src = "config"; Dest = "config" },
    @{ Src = "security"; Dest = "security" }
)

foreach ($mapping in $resourceMappings) {
    $src = Join-Path $projectRoot $mapping.Src
    $dest = Join-Path $packageDir $mapping.Dest
    
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dest -Recurse -Force
        Write-Host "  ✓ $($mapping.Src)" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠ Skipped $($mapping.Src)" -ForegroundColor Yellow
    }
}

# Copy service configuration
Write-Host "Copying service files..." -ForegroundColor Cyan
Copy-Item (Join-Path $scriptDir "aiapi-service.xml") (Join-Path $packageDir "aiapi-service.xml") -Force
Copy-Item (Join-Path $scriptDir "service-config.json") (Join-Path $packageDir "service-config.json") -Force

# Copy installation scripts
Copy-Item (Join-Path $scriptDir "install-service.ps1") (Join-Path $packageDir "install.ps1") -Force
Copy-Item (Join-Path $scriptDir "uninstall-service.ps1") (Join-Path $packageDir "uninstall.ps1") -Force
Copy-Item (Join-Path $scriptDir "update-service.ps1") (Join-Path $packageDir "update.ps1") -Force

# Download WinSW
Write-Host "Downloading WinSW..." -ForegroundColor Cyan
$winswUrl = "https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe"
$winswPath = Join-Path $packageDir "aiapi-service.exe"

try {
    Invoke-WebRequest -Uri $winswUrl -OutFile $winswPath -UseBasicParsing
    Write-Host "✓ WinSW downloaded" -ForegroundColor Green
}
catch {
    Write-Host "⚠ Failed to download WinSW: $_" -ForegroundColor Yellow
    Write-Host "  WinSW will be downloaded during installation" -ForegroundColor Yellow
}

# Copy documentation
Write-Host "Copying documentation..." -ForegroundColor Cyan
$docs = @("README.md", "LICENSE", "CHANGELOG.md")
foreach ($doc in $docs) {
    $docPath = Join-Path $projectRoot $doc
    if (Test-Path $docPath) {
        Copy-Item $docPath (Join-Path $packageDir $doc) -Force
    }
}

# Create installation guide
$installGuide = @"
# AI UI Automation API - Installation Guide

## System Requirements

- Windows 10/11 or Windows Server 2016+
- .NET Framework 4.0+ (included with Windows)
- Administrator rights for service installation
- NO Node.js required (standalone executable)

## Quick Installation

### As Windows Service (Recommended)

1. Extract this ZIP file to a temporary folder
2. Right-click PowerShell and select "Run as Administrator"
3. Navigate to the extracted folder
4. Run: ``.\install.ps1``

The service will be installed to:
- **Location:** C:\Program Files\AIAPI
- **Service Name:** AIAPIService
- **Endpoints:**
  - MCP Server: http://127.0.0.1:4457
  - Dashboard: http://127.0.0.1:4458

### Standalone Mode (No Service)

Simply run ``aiapi-server.exe`` directly. It will start the server on ports 4457/4458.

## Service Management

```powershell
# Start service
Start-Service AIAPIService

# Stop service
Stop-Service AIAPIService

# Restart service
Restart-Service AIAPIService

# Check status
Get-Service AIAPIService

# Uninstall service
.\uninstall.ps1

# Update service (after new release)
.\update.ps1
```

## Configuration

Edit ``aiapi-service.xml`` to change:
- Ports (MCP_PORT environment variable)
- Log level
- Security settings
- Startup behavior

After editing, restart the service:
```powershell
Restart-Service AIAPIService
```

## Troubleshooting

**Service won't start:**
```powershell
# Check Windows Event Log
Get-EventLog -LogName Application -Source "AI UI Automation API" -Newest 10

# Check service logs
Get-Content "C:\Program Files\AIAPI\logs\*.log"
```

**Port conflicts:**
- Edit ``aiapi-service.xml``
- Change ``<env name="MCP_PORT" value="4457"/>`` to desired port
- Restart service

## Documentation

- Full API docs: http://127.0.0.1:4457/docs
- Health check: http://127.0.0.1:4457/ping
- Dashboard: http://127.0.0.1:4458

## Support

- GitHub: https://github.com/rheingold/AIAPI
- Issues: https://github.com/rheingold/AIAPI/issues

## Version

$Version - Built on $(Get-Date -Format 'yyyy-MM-dd')
"@

Set-Content -Path (Join-Path $packageDir "INSTALL.md") -Value $installGuide -Encoding UTF8
Write-Host "✓ Installation guide created" -ForegroundColor Green

Write-Section "Creating ZIP Archive"

# Create ZIP file
$zipPath = Join-Path $releaseDir "$packageName.zip"

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Write-Host "Compressing files..." -ForegroundColor Cyan

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($packageDir, $zipPath, 'Optimal', $false)

# Get zip size
$zipSize = (Get-Item $zipPath).Length / 1MB
Write-Host "✓ ZIP archive created ($([math]::Round($zipSize, 2)) MB)" -ForegroundColor Green

# Clean up package directory
Remove-Item -Path $packageDir -Recurse -Force

Write-Section "Package Complete"

Write-Host ""
Write-Host "Package created:" -ForegroundColor Cyan
Write-Host "  File:     $zipPath" -ForegroundColor White
Write-Host "  Size:     $([math]::Round($zipSize, 2)) MB" -ForegroundColor White
Write-Host "  Version:  $Version" -ForegroundColor White
Write-Host ""
Write-Host "Distribution:" -ForegroundColor Cyan
Write-Host "  1. Upload to GitHub Releases" -ForegroundColor Gray
Write-Host "  2. Share on company network" -ForegroundColor Gray
Write-Host "  3. Include in software deployment" -ForegroundColor Gray
Write-Host ""
Write-Host "✓ Ready for distribution!" -ForegroundColor Green
Write-Host ""
