param()

$ErrorActionPreference = 'Stop'

function Get-CscPath {
  $paths = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  )
  foreach ($p in $paths) { if (Test-Path $p) { return $p } }

  # Fallback: VS Build Tools / Roslyn
  $roslyn = Get-ChildItem -Path "$env:ProgramFiles*\Microsoft Visual Studio\*\*\MSBuild\Current\Bin\Roslyn\csc.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
  if ($roslyn) { return $roslyn }

  # Fallback: any csc on PATH
  $cmd = Get-Command csc.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  return $null
}

$csc = Get-CscPath
if (-not $csc) {
  Write-Error "csc.exe not found. Please install .NET Framework Developer Pack or Visual Studio Build Tools."
}

$src = Join-Path $PSScriptRoot '..\tools\win\KeyWin.cs'
$destDir = Join-Path $PSScriptRoot '..\dist\win'
$destExe = Join-Path $destDir 'KeyWin.exe'

$uiac = Get-ChildItem -Path "$env:WINDIR\Microsoft.NET" -Recurse -Filter UIAutomationClient.dll -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$uiat = Get-ChildItem -Path "$env:WINDIR\Microsoft.NET" -Recurse -Filter UIAutomationTypes.dll -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$wbase = Get-ChildItem -Path "$env:WINDIR\Microsoft.NET" -Recurse -Filter WindowsBase.dll -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName

$refAssemblies = @($uiac, $uiat, $wbase) | Where-Object { $_ -ne $null }

foreach ($ref in $refAssemblies) {
  if (-not (Test-Path $ref)) {
    Write-Warning "Reference not found: $ref"
  }
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

 $args = @('/nologo','/target:winexe',"/out:$destExe")
 foreach ($ref in $refAssemblies) { $args += "/r:$ref" }
 $args += $src

 & $csc @args

Write-Host "Built: $destExe"
