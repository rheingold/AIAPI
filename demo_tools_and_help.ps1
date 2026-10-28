Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Tools List + getActionDetail Demo" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Show tools/list
Write-Host ">>> tools/list <<<" -ForegroundColor Yellow
$body1 = @{ jsonrpc="2.0"; id=1; method="tools/list" } | ConvertTo-Json
$r1 = Invoke-WebRequest -Uri "http://localhost:4457" -Method POST -ContentType "application/json" -Body $body1 -UseBasicParsing
$t1 = $r1.Content | ConvertFrom-Json
foreach ($t in $t1.result.tools) {
    Write-Host "  [$($t.name)]" -ForegroundColor Green
    $desc = $t.description
    if ($desc -and $desc.Length -gt 130) { $desc = $desc.Substring(0,130)+"..." }
    Write-Host "    $desc" -ForegroundColor Gray
}
Write-Host ""

# 2. getActionDetail index
Write-Host ">>> getActionDetail (index) <<<" -ForegroundColor Yellow
$body2 = @{ jsonrpc="2.0"; id=2; method="tools/call"; params=@{ name="getActionDetail"; arguments=@{} } } | ConvertTo-Json -Depth 5
$r2 = Invoke-WebRequest -Uri "http://localhost:4457" -Method POST -ContentType "application/json" -Body $body2 -UseBasicParsing
$d2 = ($r2.Content | ConvertFrom-Json).result.content.text | ConvertFrom-Json
Write-Host ($d2 | ConvertTo-Json -Depth 5)
Write-Host ""

# 3. getActionDetail for KeyWin/SENDKEYS
Write-Host ">>> getActionDetail KeyWin/SENDKEYS <<<" -ForegroundColor Yellow
$body3 = @{ jsonrpc="2.0"; id=3; method="tools/call"; params=@{ name="getActionDetail"; arguments=@{ helper="KeyWin"; action="SENDKEYS" } } } | ConvertTo-Json -Depth 5
$r3 = Invoke-WebRequest -Uri "http://localhost:4457" -Method POST -ContentType "application/json" -Body $body3 -UseBasicParsing
$d3 = ($r3.Content | ConvertFrom-Json).result.content.text | ConvertFrom-Json
Write-Host ($d3 | ConvertTo-Json -Depth 6)
Write-Host ""

# 4. getActionDetail for NativeWin/EXEC_CMD
Write-Host ">>> getActionDetail NativeWin/EXEC_CMD <<<" -ForegroundColor Yellow
$body4 = @{ jsonrpc="2.0"; id=4; method="tools/call"; params=@{ name="getActionDetail"; arguments=@{ helper="NativeWin"; action="EXEC_CMD" } } } | ConvertTo-Json -Depth 5
$r4 = Invoke-WebRequest -Uri "http://localhost:4457" -Method POST -ContentType "application/json" -Body $body4 -UseBasicParsing
$d4 = ($r4.Content | ConvertFrom-Json).result.content.text | ConvertFrom-Json
Write-Host ($d4 | ConvertTo-Json -Depth 6)
