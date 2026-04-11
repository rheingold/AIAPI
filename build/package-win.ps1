# package-win.ps1 — Build + package AIAPI as a standalone Windows .exe
# Output: dist/release/aiapi-server-win-x64.exe
#
# Prerequisites:
#   npm install -g pkg        (or: npx pkg is used below as fallback)
#   Node 18+ on PATH
#   build-all.ps1 must have been run first (helpers compiled to dist/helpers/)
#
# Usage:
#   PowerShell -ExecutionPolicy Bypass -File scripts\package-win.ps1
#   npm run package:win

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot

Write-Host "`n=== AIAPI Windows Packaging ===" -ForegroundColor Cyan

# ── 1. TypeScript compile ─────────────────────────────────────────────────────
Write-Host "`n[1/4] Compiling TypeScript..." -ForegroundColor Yellow
Push-Location $Root
try {
    npx tsc -p tsconfig.json
    if ($LASTEXITCODE -ne 0) { throw "TypeScript compile failed" }
} finally { Pop-Location }
Write-Host "  TS compile OK" -ForegroundColor Green

# ── 2. Build helpers ──────────────────────────────────────────────────────────
Write-Host "`n[2/4] Building helper .exes (build-all.ps1)..." -ForegroundColor Yellow
Push-Location $Root
try {
    PowerShell -ExecutionPolicy Bypass -File build-all.ps1
    if ($LASTEXITCODE -ne 0) { throw "build-all.ps1 failed" }
} finally { Pop-Location }
Write-Host "  Helper build OK" -ForegroundColor Green

# ── 3. pkg bundle ─────────────────────────────────────────────────────────────
Write-Host "`n[3/4] Bundling with pkg -> dist/release/aiapi-server-win-x64.exe..." -ForegroundColor Yellow

$releaseDir = Join-Path $Root "dist\release"
if (-not (Test-Path $releaseDir)) { New-Item -ItemType Directory -Path $releaseDir | Out-Null }

Push-Location $Root
try {
    # Install pkg globally if not already present
    $pkgPath = (Get-Command pkg -ErrorAction SilentlyContinue)?.Source
    if (-not $pkgPath) {
        Write-Host "  pkg not found globally; using npx pkg" -ForegroundColor DarkYellow
        npx pkg dist/start-mcp-server.js `
            --target node18-win-x64 `
            --output dist/release/aiapi-server-win-x64.exe `
            --compress GZip
    } else {
        pkg dist/start-mcp-server.js `
            --target node18-win-x64 `
            --output dist/release/aiapi-server-win-x64.exe `
            --compress GZip
    }
    if ($LASTEXITCODE -ne 0) { throw "pkg bundle failed" }
} finally { Pop-Location }
Write-Host "  pkg bundle OK" -ForegroundColor Green

# ── 4. Copy companion files ───────────────────────────────────────────────────
Write-Host "`n[4/4] Copying companion assets to dist/release/..." -ForegroundColor Yellow

$companions = @(
    @{ src = "dist\helpers";    dst = "dist\release\helpers" }
    @{ src = "static";          dst = "dist\release\static" }
    @{ src = "apptemplates";    dst = "dist\release\apptemplates" }
    @{ src = "config";          dst = "dist\release\config" }
)
foreach ($item in $companions) {
    $srcPath = Join-Path $Root $item.src
    $dstPath = Join-Path $Root $item.dst
    if (Test-Path $srcPath) {
        Copy-Item -Recurse -Force $srcPath $dstPath
        Write-Host "  Copied $($item.src) -> $($item.dst)" -ForegroundColor DarkGray
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────
$exePath = Join-Path $Root "dist\release\aiapi-server-win-x64.exe"
if (Test-Path $exePath) {
    $sizeMb = [Math]::Round((Get-Item $exePath).Length / 1MB, 1)
    Write-Host "`n✅ Package ready: dist\release\aiapi-server-win-x64.exe ($sizeMb MB)" -ForegroundColor Green
    Write-Host "   Run: .\dist\release\aiapi-server-win-x64.exe --port 3457" -ForegroundColor DarkGray
} else {
    Write-Host "`n❌ Output .exe not found — packaging may have failed." -ForegroundColor Red
    exit 1
}
