param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# TypeScript compile
Write-Host "=== Compiling TypeScript ==="
Set-Location $root
& npm run compile
Write-Host "TypeScript exit: $LASTEXITCODE"

# C# compiler
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
Write-Host "Using csc: $csc"

$helperCommonSrc = "$root\tools\common\HelperCommon.cs"
$winCommonSrc    = "$root\tools\common\WinCommon.cs"
$keySrc          = "$root\tools\win\KeyWin.cs"
$browserSrc      = "$root\tools\browser\BrowserWin.cs"
$keyDestDir      = "$root\dist\win"
$browserDestDir  = "$root\dist\browser"

New-Item -ItemType Directory -Force -Path $keyDestDir    | Out-Null
New-Item -ItemType Directory -Force -Path $browserDestDir | Out-Null

# Find UIAutomation + WinForms DLLs (needed by both KeyWin and BrowserWin)
$uiac   = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter UIAutomationClient.dll  -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$uiat   = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter UIAutomationTypes.dll   -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$wbase  = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter WindowsBase.dll         -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$wforms = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter System.Windows.Forms.dll -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName

Write-Host "uiac:   $uiac"
Write-Host "uiat:   $uiat"
Write-Host "wbase:  $wbase"
Write-Host "wforms: $wforms"

# Build KeyWin.exe  (WinCommon.cs not yet merged in — KeyWin still carries its own copy)
Write-Host "=== Building KeyWin.exe ==="
& $csc /nologo /target:winexe "/out:$keyDestDir\KeyWin.exe" "/r:$uiac" "/r:$uiat" "/r:$wbase" $helperCommonSrc $keySrc
Write-Host "KeyWin exit: $LASTEXITCODE"

# Build BrowserWin.exe  (WinCommon.cs adds UIA fallback; needs same DLL set as KeyWin)
Write-Host "=== Building BrowserWin.exe ==="
& $csc /nologo /target:exe "/out:$browserDestDir\BrowserWin.exe" `
    "/r:$uiac" "/r:$uiat" "/r:$wbase" "/r:$wforms" `
    $helperCommonSrc $winCommonSrc $browserSrc
Write-Host "BrowserWin exit: $LASTEXITCODE"

Write-Host "=== Build complete ==="
