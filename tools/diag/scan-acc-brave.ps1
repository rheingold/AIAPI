param([string]$MCP = "http://127.0.0.1:3457", [int]$Handle = 4131832)

function KW($id, $args_ht) {
    $b = @{jsonrpc="2.0";id=$id;method="tools/call";params=@{name="KeyWin";arguments=$args_ht}} | ConvertTo-Json -Depth 8 -Compress
    (Invoke-WebRequest -Uri $MCP -Method POST -ContentType "application/json" -UseBasicParsing -Body $b).Content | ConvertFrom-Json
}

Write-Host "=== Step 1: navigate to google.com to trigger full browser UI ===" -ForegroundColor Cyan
(KW 1 @{action="SENDKEYS";proc="HANDLE:$Handle";parameter="{CTRL}l"}).result.success
Start-Sleep -Milliseconds 400
(KW 2 @{action="SENDKEYS";proc="HANDLE:$Handle";parameter="https://www.google.com{ENTER}"}).result.success
Write-Host "Waiting for page load..."
Start-Sleep -Seconds 4

Write-Host "`n=== Step 2: QUERYTREE depth-5 on accessibility Brave ===" -ForegroundColor Cyan
$r = (KW 3 @{action="QUERYTREE";proc="HANDLE:$Handle";path="";value=5}).result
$json = $r | ConvertTo-Json -Depth 10
Write-Host "Total JSON chars: $($json.Length)"
$json | Out-File "brave-acc-tree.json" -Encoding utf8

Write-Host "`n--- Top-level children ---"
$r.children | ForEach-Object {
    Write-Host "  [$($_.type)] '$($_.name)' sub=$($_.children.Count)"
    $_.children | ForEach-Object {
        Write-Host "    [$($_.type)] '$($_.name)' sub=$($_.children.Count)"
        $_.children | ForEach-Object {
            Write-Host "      [$($_.type)] '$($_.name)' id='$($_.id)' sub=$($_.children.Count)"
        }
    }
}

Write-Host "`n=== Step 3: scan for bookmarks bar nodes (name contains KB or bookmark) ===" -ForegroundColor Cyan
function Find-Nodes($node, $depth=0) {
    $pad = "  " * $depth
    if ($node.name -match "KB|bookmark|záložk|Zalozk" -or $node.id -match "bookmark") {
        Write-Host "${pad}MATCH [$($node.type)] id='$($node.id)' name='$($node.name)'" -ForegroundColor Green
    }
    foreach ($c in $node.children) { Find-Nodes $c ($depth+1) }
}
Find-Nodes $r
