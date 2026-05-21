
Set-Content -Encoding utf8 -Path .\tmp_lw.txt -Value '{"action":"LISTWINDOWS","proc":"SYSTEM"}'
$p = Start-Process -FilePath ".\dist\helpers\KeyWin.exe" -ArgumentList "--listen-stdin" -RedirectStandardInput ".\tmp_lw.txt" -RedirectStandardOutput ".\tmp_lw_out.txt" -NoNewWindow -PassThru
$p.WaitForExit(5000)
$lw = Get-Content .\tmp_lw_out.txt -Raw | ConvertFrom-Json
$win = $lw.windows | Where-Object { $_.title -match "Kalk" } | Select-Object -First 1
if (-not $win) { Write-Host "No calculator window found!"; exit 1 }
Write-Host "Found: handle=$($win.handle) title=$($win.title)"

Set-Content -Encoding utf8 -Path .\tmp_qt.txt -Value ('{"action":"QUERYTREE","proc":"HANDLE:' + $win.handle + '","path":"5"}')
$p2 = Start-Process -FilePath ".\dist\helpers\KeyWin.exe" -ArgumentList "--listen-stdin" -RedirectStandardInput ".\tmp_qt.txt" -RedirectStandardOutput ".\tmp_qt_out.txt" -NoNewWindow -PassThru
$p2.WaitForExit(10000)
$raw = Get-Content .\tmp_qt_out.txt -Raw
Write-Host "Output length: $($raw.Length)"
[regex]::Matches($raw, '"id":"([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
Remove-Item .\tmp_lw.txt,.\tmp_lw_out.txt,.\tmp_qt.txt,.\tmp_qt_out.txt -ErrorAction SilentlyContinue
