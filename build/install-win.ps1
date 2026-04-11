# install-win.ps1 — Install AIAPI as a Windows Service (no MSI needed for 1.0)
#
# Requires:
#   - Run as Administrator
#   - NSSM (Non-Sucking Service Manager) on PATH, or in .\tools\nssm.exe
#     Download: https://nssm.cc/release/nssm-2.24.zip
#   - dist\release\aiapi-server-win-x64.exe built via scripts\package-win.ps1
#
# Usage (run elevated PowerShell):
#   PowerShell -ExecutionPolicy Bypass -File scripts\install-win.ps1
#   PowerShell -ExecutionPolicy Bypass -File scripts\install-win.ps1 -Uninstall

param(
    [switch]$Uninstall,
    [string]$InstallDir   = "C:\Program Files\AIAPI",
    [int]   $McpPort      = 3457,
    [int]   $DashPort     = 3458,
    [string]$ServiceName  = "AIAPI"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Admin guard ───────────────────────────────────────────────────────────────
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
          ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must run as Administrator."
    exit 1
}

$Root    = Split-Path -Parent $PSScriptRoot
$ExeSrc  = Join-Path $Root "dist\release\aiapi-server-win-x64.exe"
$ExeDst  = Join-Path $InstallDir "aiapi-server.exe"

# ── NSSM discovery ───────────────────────────────────────────────────────────
$nssm = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source
if (-not $nssm) { $nssm = Join-Path $Root "tools\nssm.exe" }
if (-not (Test-Path $nssm)) {
    Write-Error "NSSM not found. Download from https://nssm.cc and place in PATH or tools\nssm.exe"
    exit 1
}

# ═══════════════════════════════════════════════════════════════════════════════
#  UNINSTALL
# ═══════════════════════════════════════════════════════════════════════════════
if ($Uninstall) {
    Write-Host "`n=== Uninstalling AIAPI Service ===" -ForegroundColor Cyan

    & $nssm stop  $ServiceName 2>$null
    & $nssm remove $ServiceName confirm
    Write-Host "  Service removed" -ForegroundColor Green

    # Remove firewall rules
    Remove-NetFirewallRule -DisplayName "AIAPI MCP Server"  -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName "AIAPI Dashboard"   -ErrorAction SilentlyContinue
    Write-Host "  Firewall rules removed" -ForegroundColor Green

    # Optionally remove files (prompt)
    $rem = Read-Host "Remove installed files from '$InstallDir'? [y/N]"
    if ($rem -eq 'y' -or $rem -eq 'Y') {
        Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
        Write-Host "  Files removed" -ForegroundColor Green
    }
    Write-Host "`n✅ Uninstall complete." -ForegroundColor Green
    exit 0
}

# ═══════════════════════════════════════════════════════════════════════════════
#  INSTALL
# ═══════════════════════════════════════════════════════════════════════════════
Write-Host "`n=== Installing AIAPI ($ServiceName) to '$InstallDir' ===" -ForegroundColor Cyan

# ── 1. Verify source exe ──────────────────────────────────────────────────────
if (-not (Test-Path $ExeSrc)) {
    Write-Error "Packaged .exe not found at '$ExeSrc'. Run scripts\package-win.ps1 first."
    exit 1
}

# ── 2. Copy files ─────────────────────────────────────────────────────────────
Write-Host "`n[1/4] Copying files to '$InstallDir'..." -ForegroundColor Yellow
if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }

$copies = @(
    @{ src = $ExeSrc;                 dst = $ExeDst }
    @{ src = "$Root\dist\helpers";    dst = "$InstallDir\helpers" }
    @{ src = "$Root\static";          dst = "$InstallDir\static" }
    @{ src = "$Root\apptemplates";    dst = "$InstallDir\apptemplates" }
    @{ src = "$Root\config";          dst = "$InstallDir\config" }
)
foreach ($item in $copies) {
    if (Test-Path $item.src) {
        Copy-Item -Recurse -Force $item.src $item.dst
        Write-Host "  + $($item.src | Split-Path -Leaf)" -ForegroundColor DarkGray
    }
}
Write-Host "  Files copied" -ForegroundColor Green

# ── 3. Windows Service via NSSM ───────────────────────────────────────────────
Write-Host "`n[2/4] Installing Windows Service '$ServiceName'..." -ForegroundColor Yellow

$existingSvc = Get-Service $ServiceName -ErrorAction SilentlyContinue
if ($existingSvc) {
    Write-Host "  Service already exists — updating" -ForegroundColor DarkYellow
    & $nssm stop $ServiceName 2>$null
}

& $nssm install $ServiceName $ExeDst
& $nssm set     $ServiceName AppParameters "--port $McpPort"
& $nssm set     $ServiceName AppDirectory  $InstallDir
& $nssm set     $ServiceName DisplayName   "AIAPI MCP Automation Server"
& $nssm set     $ServiceName Description   "AIAPI MCP server + dashboard. Exposes AI-accessible UI automation tools."
& $nssm set     $ServiceName Start         SERVICE_AUTO_START
& $nssm set     $ServiceName AppStdout     "$InstallDir\logs\service-out.log"
& $nssm set     $ServiceName AppStderr     "$InstallDir\logs\service-err.log"
& $nssm set     $ServiceName AppRotateFiles 1

New-Item -ItemType Directory -Force "$InstallDir\logs" | Out-Null
Write-Host "  Service installed (auto-start)" -ForegroundColor Green

# ── 4. Firewall rules ─────────────────────────────────────────────────────────
Write-Host "`n[3/4] Adding Windows Firewall rules..." -ForegroundColor Yellow
New-NetFirewallRule -DisplayName "AIAPI MCP Server" `
    -Direction Inbound -Protocol TCP -LocalPort $McpPort `
    -Action Allow -Profile Domain,Private -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName "AIAPI Dashboard" `
    -Direction Inbound -Protocol TCP -LocalPort $DashPort `
    -Action Allow -Profile Domain,Private -ErrorAction SilentlyContinue | Out-Null
Write-Host "  Firewall rules added (ports $McpPort, $DashPort)" -ForegroundColor Green

# ── 5. Start service ──────────────────────────────────────────────────────────
Write-Host "`n[4/4] Starting service..." -ForegroundColor Yellow
& $nssm start $ServiceName
Start-Sleep 2
$svcStatus = (Get-Service $ServiceName -ErrorAction SilentlyContinue)?.Status
Write-Host "  Service status: $svcStatus" -ForegroundColor $(if ($svcStatus -eq 'Running') { 'Green' } else { 'Yellow' })

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host @"

✅ AIAPI installed successfully.
   MCP server : http://127.0.0.1:$McpPort
   Dashboard  : http://127.0.0.1:$DashPort
   Service    : $ServiceName (auto-start)
   Install dir: $InstallDir

To uninstall:
   PowerShell -ExecutionPolicy Bypass -File scripts\install-win.ps1 -Uninstall
"@ -ForegroundColor Green
