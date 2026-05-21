param()
$ErrorActionPreference = 'Stop'
# $PSScriptRoot = dir of this script (build/windows); root is two levels up
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# TypeScript compile
Write-Host "=== Compiling TypeScript ==="
Set-Location $root
& npm run compile
Write-Host "TypeScript exit: $LASTEXITCODE"

# C# compiler
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
Write-Host "Using csc: $csc"

$helperCommonSrc = "$root\components\helpers\shared\src\HelperCommon.cs"
$winCommonSrc    = "$root\components\helpers\shared\src\WinCommon.cs"
$keySrc          = "$root\components\helpers\windows\src\KeyWin.cs"
$browserSrc      = "$root\components\helpers\windows\src\BrowserWin.cs"
$officeSrc       = "$root\components\helpers\windows\src\MSOfficeWin.cs"
$helpersDestDir  = "$root\dist\helpers"

New-Item -ItemType Directory -Force -Path $helpersDestDir | Out-Null

# Find UIAutomation + WinForms DLLs (needed by both KeyWin and BrowserWin)
$uiac   = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter UIAutomationClient.dll  -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$uiat   = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter UIAutomationTypes.dll   -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$wbase  = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter WindowsBase.dll         -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$wforms = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter System.Windows.Forms.dll -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$sdrawing = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter System.Drawing.dll -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$mcsharp = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\Microsoft.CSharp.dll"
if (-not (Test-Path $mcsharp)) { $mcsharp = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\Microsoft.CSharp.dll" }

Write-Host "uiac:   $uiac"
Write-Host "uiat:   $uiat"
Write-Host "wbase:  $wbase"
Write-Host "wforms: $wforms"

# Kill any running helper daemons so the output EXEs are not file-locked during compile
Write-Host "=== Stopping helper daemons ==="
Stop-Process -Name "KeyWin","BrowserWin","MSOfficeWin","LibreOfficeWin" -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

# Build KeyWin.exe  (WinCommon.cs merged in — shared UIA helpers, FILL/READELEM support)
Write-Host "=== Building KeyWin.exe ==="
& $csc /nologo /target:winexe "/out:$helpersDestDir\KeyWin.exe" "/r:$uiac" "/r:$uiat" "/r:$wbase" "/r:$wforms" "/r:$sdrawing" "/r:$mcsharp" $helperCommonSrc $winCommonSrc $keySrc
Write-Host "KeyWin exit: $LASTEXITCODE"

# Build BrowserWin.exe  (WinCommon.cs adds UIA fallback; needs same DLL set as KeyWin)
Write-Host "=== Building BrowserWin.exe ==="
& $csc /nologo /target:exe "/out:$helpersDestDir\BrowserWin.exe" `
    "/r:$uiac" "/r:$uiat" "/r:$wbase" "/r:$wforms" "/r:$mcsharp" `
    $helperCommonSrc $winCommonSrc $browserSrc
Write-Host "BrowserWin exit: $LASTEXITCODE"

# Build MSOfficeWin.exe  (COM late-binding via dynamic; no Office PIAs needed at compile time)
Write-Host "=== Building MSOfficeWin.exe ==="
& $csc /nologo /target:exe "/out:$helpersDestDir\MSOfficeWin.exe" "/r:$mcsharp" `
    $helperCommonSrc $officeSrc
Write-Host "MSOfficeWin exit: $LASTEXITCODE"

# Build LibreOfficeWin.exe  (LibreOffice/OpenOffice via UNO COM bridge; no UNO type libs needed)
$lofficeSrc = "$root\components\helpers\windows\src\LibreOfficeWin.cs"
Write-Host "=== Building LibreOfficeWin.exe ==="
& $csc /nologo /target:exe "/out:$helpersDestDir\LibreOfficeWin.exe" "/r:$mcsharp" `
    $helperCommonSrc $lofficeSrc
Write-Host "LibreOfficeWin exit: $LASTEXITCODE"

# Copy Python UNO bridge script alongside LibreOfficeWin.exe (LO 24+ fallback)
$loHelperSrc = "$root\components\helpers\windows\src\lo_helper.py"
if (Test-Path $loHelperSrc) {
    Copy-Item $loHelperSrc "$helpersDestDir\lo_helper.py" -Force
    Write-Host "Copied lo_helper.py -> $helpersDestDir"
}

# ── SecurityLib.dll  (native C++ — requires MSVC cl.exe) ─────────────────────
Write-Host "=== Building SecurityLib.dll ==="

$secLibSrc  = "$root\components\helpers\shared\src\security\SecurityLib.cpp"
$secLibDest = "$helpersDestDir\SecurityLib.dll"

# Locate cl.exe from any installed VS / Build Tools
$clExe = $null
$vsDirs = @(
    "$env:ProgramFiles\Microsoft Visual Studio",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio"
)
foreach ($vsDir in $vsDirs) {
    if (Test-Path $vsDir) {
        $found = Get-ChildItem -Path $vsDir -Recurse -Filter 'cl.exe' -ErrorAction SilentlyContinue |
                 Where-Object { $_.FullName -notmatch '\\arm' -and $_.FullName -match 'Hostx64\\x64|HostX86\\x86' } |
                 Select-Object -First 1 -ExpandProperty FullName
        if ($found) { $clExe = $found; break }
    }
}

if (-not $clExe) {
    $clCmd = Get-Command cl.exe -ErrorAction SilentlyContinue
    if ($clCmd) { $clExe = $clCmd.Source }
}

if (-not $clExe) {
    # MSVC not found — try MinGW g++ (MSYS2) as a fallback.
    # MinGW produces a self-contained DLL (bcrypt.dll + kernel32.dll + msvcrt.dll only).
    $gppCandidates = @(
        'C:\msys64\mingw64\bin\g++.exe',
        'C:\msys2\mingw64\bin\g++.exe',
        $(if ($c = Get-Command g++.exe -EA SilentlyContinue) { $c.Source } else { $null })
    ) | Where-Object { $_ -and (Test-Path $_ -EA SilentlyContinue) } | Select-Object -First 1

    if ($gppCandidates) {
        $gppExe = $gppCandidates
        # MinGW needs itself on PATH to resolve its own DLL search paths at compile time.
        $mingwBin = Split-Path $gppExe -Parent
        if ($env:PATH -notlike "*$mingwBin*") { $env:PATH = "$mingwBin;$env:PATH" }
        Write-Host "cl.exe not found — using MinGW g++ fallback: $gppExe"
        & $gppExe -shared -O2 -static-libgcc -static-libstdc++ `
            -o $secLibDest $secLibSrc `
            -lbcrypt -DAIAPI_SECURITYLIB_EXPORTS -D_WIN32_WINNT=0x0601
        Write-Host "SecurityLib (MinGW) exit: $LASTEXITCODE"
        if (Test-Path $secLibDest) {
            Write-Host "Built: $secLibDest"
        } else {
            Write-Warning "SecurityLib.dll was not produced by MinGW g++ — check compiler output."
        }
    } else {
        Write-Warning "Neither cl.exe nor MinGW g++ found — skipping SecurityLib.dll build."
        Write-Warning "Install Visual Studio Build Tools (C++ workload) or MSYS2 MinGW64 to enable native security."
    }
} else {
    Write-Host "Using cl.exe: $clExe"

    # Find the Windows SDK include path for bcrypt.h
    $sdkInclude = $null
    $sdkRoot = 'C:\Program Files (x86)\Windows Kits\10\Include'
    if (Test-Path $sdkRoot) {
        $latestSdk = Get-ChildItem $sdkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
        if ($latestSdk) { $sdkInclude = Join-Path $latestSdk.FullName 'um' }
    }

    # Also find MSVC include path (parent of cl.exe, going up to include/)
    $clDir       = Split-Path $clExe -Parent         # ...HostX64\x64
    $msvcToolsDir = Split-Path (Split-Path $clDir)    # ...MSVC\14.x.x\
    $msvcInclude  = Join-Path $msvcToolsDir 'include'

    $clArgs = @(
        '/nologo', '/LD', '/O2', '/W3',
        '/D', 'AIAPI_SECURITYLIB_EXPORTS',
        '/D', '_WIN32_WINNT=0x0601',
        "/Fo$helpersDestDir\SecurityLib.obj",
        "/Fe$secLibDest",
        $secLibSrc,
        '/link', 'bcrypt.lib', 'kernel32.lib'
    )
    if ($msvcInclude -and (Test-Path $msvcInclude)) { $clArgs = @("/I$msvcInclude") + $clArgs }
    if ($sdkInclude  -and (Test-Path $sdkInclude))  { $clArgs = @("/I$sdkInclude")  + $clArgs }

    & $clExe @clArgs
    Write-Host "SecurityLib exit: $LASTEXITCODE"
    if (Test-Path $secLibDest) {
        Write-Host "Built: $secLibDest"
    } else {
        Write-Warning "SecurityLib.dll was not produced - check compiler output."
    }
}


# ── Update binaryHashes in config/security/config.json ───────────────────────
# Keeps the on-disk hash manifest in sync with freshly-built binaries so
# sec_validate_signature_self() (SecurityLib) and the dashboard integrity check
# always compare against the correct expected values.
Write-Host "=== Updating binaryHashes in config/security/config.json ==="
$configPath = "$root\config\security\config.json"
if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw | ConvertFrom-Json

        # Map: config key → relative path from root
        $binMap = @{
            keyWin       = "dist\helpers\KeyWin.exe"
            browserWin   = "dist\helpers\BrowserWin.exe"
            msOfficeWin  = "dist\helpers\MSOfficeWin.exe"
            libreOfficeWin = "dist\helpers\LibreOfficeWin.exe"
            securityLib  = "dist\helpers\SecurityLib.dll"
        }

        foreach ($key in $binMap.Keys) {
            $relPath = $binMap[$key]
            $fullPath = Join-Path $root $relPath
            if (Test-Path $fullPath) {
                $hash     = (Get-FileHash $fullPath -Algorithm SHA256).Hash.ToLower()
                $size     = (Get-Item $fullPath).Length
                $modified = (Get-Item $fullPath).LastWriteTimeUtc.ToString("o")

                if (-not $cfg.binaryHashes) {
                    $cfg | Add-Member -MemberType NoteProperty -Name binaryHashes -Value ([PSCustomObject]@{})
                }
                if (-not ($cfg.binaryHashes | Get-Member -Name $key -ErrorAction SilentlyContinue)) {
                    $cfg.binaryHashes | Add-Member -MemberType NoteProperty -Name $key -Value ([PSCustomObject]@{})
                }
                $cfg.binaryHashes.$key = [PSCustomObject]@{
                    path         = $relPath
                    sha256       = $hash
                    size         = $size
                    lastModified = $modified
                }
                Write-Host "  $key : $hash ($size bytes)"
            } else {
                Write-Host "  $key : not found at $fullPath — skipped"
            }
        }

        $cfg | ConvertTo-Json -Depth 20 | Set-Content $configPath -Encoding UTF8
        Write-Host "config.json updated."
    } catch {
        Write-Warning "Failed to update binaryHashes: $_"
    }
} else {
    Write-Warning "config.json not found at $configPath — skipping hash update."
}

Write-Host "=== Build complete ==="
