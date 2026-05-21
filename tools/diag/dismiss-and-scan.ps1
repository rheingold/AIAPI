param([string]$MCP = "http://127.0.0.1:3457", [int]$AccPid = 27972, [int]$AccHandle = 1771068)
function KW($id, $a) { $b=@{jsonrpc="2.0";id=$id;method="tools/call";params=@{name="KeyWin";arguments=$a}}|ConvertTo-Json -Depth 8 -Compress; (Invoke-WebRequest -Uri $MCP -Method POST -ContentType "application/json" -UseBasicParsing -Body $b).Content|ConvertFrom-Json }
function BW($id, $a) { $b=@{jsonrpc="2.0";id=$id;method="tools/call";params=@{name="BrowserWin";arguments=$a}}|ConvertTo-Json -Depth 8 -Compress; (Invoke-WebRequest -Uri $MCP -Method POST -ContentType "application/json" -UseBasicParsing -Body $b).Content|ConvertFrom-Json }

# ─ 1. Dismiss restore dialog with coordinate clicks ─
Write-Host "=== Step 1: dismiss Restore dialog ===" -ForegroundColor Cyan
foreach ($coord in @("960,220","880,220","960,210","830,220","1040,210","760,220")) {
    KW 10 @{action="SENDKEYS";proc="HANDLE:$AccHandle";parameter="{CLICK:$coord}"} | Out-Null
    Start-Sleep -Milliseconds 400
    $dlg=(KW 11 @{action="LISTWINDOWS";proc="brave.exe"}).result.windows | Where-Object {$_.pid -eq $AccPid -and $_.handle -ne $AccHandle}
    if (!$dlg) { Write-Host "  Dialog dismissed after click $coord" -ForegroundColor Green ; break }
    else { Write-Host "  click $coord - dialog still present (handles: $($dlg.handle -join ','))" }
}

# ─ 2. Also try CDP JS to dismiss if still present ─
$js = 'document.querySelector("button") ? document.querySelector("button").innerText : "no-btn"'
$btnText = (BW 12 @{action="EXEC";proc="brave:9223";value=$js}).result.result
Write-Host "First button in page: '$btnText'"

# ─ 3. Ensure page is navigated ─
Write-Host "`n=== Step 2: navigate to google.com via CDP ===" -ForegroundColor Cyan
(BW 20 @{action="NAVIGATE";proc="brave:9223";value="https://www.google.com"}).result | Select-Object success,url | Format-Table
Start-Sleep -Seconds 4

# ─ 4. Full depth-8 UIA scan ─
Write-Host "=== Step 3: QUERYTREE depth-8 ===" -ForegroundColor Cyan
$tree = (KW 30 @{action="QUERYTREE";proc="HANDLE:$AccHandle";path="";value=8}).result
$json = $tree | ConvertTo-Json -Depth 12
Write-Host "Tree JSON length: $($json.Length) chars"
$json | Out-File "brave-acc-d8.json" -Encoding utf8

$n = 0
function Walk($node, $d=0) {
    $script:n++
    $pad="  "*$d
    $pos = if ($node.position -and $node.position.width -gt 0) { " @($($node.position.x),$($node.position.y))" } else { "" }
    $col = if ($node.name -match "\S") { "Yellow" } else { "DarkGray" }
    Write-Host "${pad}[$($node.type)]$pos '$($node.name)' acts=$($node.actions.Count) sub=$($node.children.Count)" -ForegroundColor $col
    if ($node.children) { foreach ($c in $node.children) { Walk $c ($d+1) } }
}
Walk $tree
Write-Host "`nTotal nodes: $n" -ForegroundColor Cyan

# ─ 5. Try CLICKNAME on bookmarks bar ─
Write-Host "`n=== Step 4: try CLICKNAME 'KB:general' ===" -ForegroundColor Cyan
$click = (KW 40 @{action="SENDKEYS";proc="HANDLE:$AccHandle";parameter="{CLICKNAME:KB:general}"}).result
Write-Host "CLICKNAME result: $($click | ConvertTo-Json -Compress)"
