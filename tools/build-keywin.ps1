$ErrorActionPreference = 'Stop'
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$uiac   = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter UIAutomationClient.dll  -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$uiat   = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter UIAutomationTypes.dll   -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$wbase  = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter WindowsBase.dll         -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$wforms = (Get-ChildItem "$env:WINDIR\Microsoft.NET" -Recurse -Filter System.Windows.Forms.dll -EA SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
$mcsharp = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\Microsoft.CSharp.dll"
Write-Host "uiac:   $uiac"
Write-Host "uiat:   $uiat"
Write-Host "wbase:  $wbase"
Stop-Process -Name "KeyWin" -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
& $csc /nologo /target:winexe "/out:dist\helpers\KeyWin.exe" "/r:$uiac" "/r:$uiat" "/r:$wbase" "/r:$wforms" "/r:$mcsharp" components\helpers\shared\src\HelperCommon.cs components\helpers\shared\src\WinCommon.cs components\helpers\windows\src\KeyWin.cs
Write-Host "KeyWin build exit: $LASTEXITCODE"
