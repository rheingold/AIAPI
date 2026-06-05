$ErrorActionPreference = 'Stop'
# Build WinSvcBridge.exe using the .NET 4 C# compiler (csc.exe).
# No UI-Automation or Windows Forms references needed -- just kernel32/advapi32/wtsapi32
# which are linked via P/Invoke at runtime.
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
    Write-Error "csc.exe not found -- .NET Framework 4 required"
    exit 1
}

$src = "components\helpers\bridge\src\WinSvcBridge.cs"
$out = "dist\helpers\WinSvcBridge.exe"

if (-not (Test-Path "dist\helpers")) {
    New-Item -ItemType Directory -Path "dist\helpers" -Force | Out-Null
}

Write-Host "Building WinSvcBridge.exe..." -ForegroundColor Cyan
& $csc /nologo /target:exe "/out:$out" $src
if ($LASTEXITCODE -ne 0) {
    Write-Error "WinSvcBridge build FAILED (exit $LASTEXITCODE)"
    exit $LASTEXITCODE
}
Write-Host "WinSvcBridge build OK -> $out" -ForegroundColor Green
