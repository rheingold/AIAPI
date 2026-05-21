param([string]$MCP = "http://127.0.0.1:3457")
function KW($id, $a) { $b=@{jsonrpc="2.0";id=$id;method="tools/call";params=@{name="KeyWin";arguments=$a}}|ConvertTo-Json -Depth 8 -Compress; (Invoke-WebRequest -Uri $MCP -Method POST -ContentType "application/json" -UseBasicParsing -Body $b).Content|ConvertFrom-Json }
function BW($id, $a) { $b=@{jsonrpc="2.0";id=$id;method="tools/call";params=@{name="BrowserWin";arguments=$a}}|ConvertTo-Json -Depth 8 -Compress; (Invoke-WebRequest -Uri $MCP -Method POST -ContentType "application/json" -UseBasicParsing -Body $b).Content|ConvertFrom-Json }

# ── 1. Find the accessibility Brave window (pid != 18696, != 35528) ──
$wins = (KW 1 @{action="LISTWINDOWS";proc="brave.exe"}).result.windows
$accWin = $wins | Where-Object { $_.pid -ne 18696 -and $_.pid -ne 35528 -and $_.title -match "Brave" } | Sort-Object handle | Select-Object -First 1
Write-Host "Acc Brave: handle=$($accWin.handle) pid=$($accWin.pid) title='$($accWin.title)'"

# ── 2. Dismiss Restore dialog if present ──
$restoreWin = $wins | Where-Object { $_.pid -eq $accWin.pid -and $_.title -match "Obnovit|Restore" }
if ($restoreWin) {
    Write-Host "Dismissing Restore dialog HANDLE:$($restoreWin.handle)..."
    # Find button in dialog
    $dlg = (KW 2 @{action="QUERYTREE";proc="HANDLE:$($restoreWin.handle)";path="";value=5}).result
    Write-Host ($dlg | ConvertTo-Json -Depth 4)
    # Try clicking "Don't restore" via ESC on the main window
    KW 3 @{action="SENDKEYS";proc="HANDLE:$($accWin.handle)";parameter="{ESC}"} | Out-Null
    Start-Sleep -Milliseconds 500
}

# ── 3. Navigate to google.com via CDP (no focus needed) ──
Write-Host "`nNavigating to google.com via CDP port 9223..."
$nav = (BW 4 @{action="NAVIGATE";proc="brave:9223";value="https://www.google.com"}).result
Write-Host "Navigate: success=$($nav.success) url=$($nav.url)"
Start-Sleep -Seconds 4

# ── 4. Full depth-8 UIA tree ──
Write-Host "`n=== QUERYTREE depth-8 ===" -ForegroundColor Cyan
$tree = (KW 5 @{action="QUERYTREE";proc="HANDLE:$($accWin.handle)";path="";value=8}).result
$json = $tree | ConvertTo-Json -Depth 12
Write-Host "Tree JSON: $($json.Length) chars"
$json | Out-File "brave-acc-d8.json" -Encoding utf8

# ── 5. Walk all nodes recursively, print everything ──
Write-Host ""
$nodeCount = 0
function Walk($n, $depth=0) {
    $script:nodeCount++
    $pad = "  " * $depth
    $extra = if ($n.id) { " id='$($n.id)'" } else { "" }
    $pos = if ($n.position -and $n.position.width) { " @($($n.position.x),$($n.position.y) $($n.position.width)x$($n.position.height))" } else { "" }
    $actions = if ($n.actions -and $n.actions.Count) { " ["+($n.actions-join",")+"]" } else { "" }
    $color = if ($n.name -match "\S") { "Yellow" } else { "Gray" }
    Write-Host "${pad}[$($n.type)]$extra$pos '$($n.name)'$actions" -ForegroundColor $color
    if ($n.children) { foreach ($c in $n.children) { Walk $c ($depth+1) } }
}
Walk $tree
Write-Host "`nTotal UIA nodes: $nodeCount" -ForegroundColor Cyan
