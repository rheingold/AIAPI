param([string]$MCP = "http://127.0.0.1:3457", [int]$Handle = 67702, [int]$Y = 85)

function KW($id, $args_ht) {
    $b = @{jsonrpc="2.0";id=$id;method="tools/call";params=@{name="KeyWin";arguments=$args_ht}} | ConvertTo-Json -Depth 8 -Compress
    (Invoke-WebRequest -Uri $MCP -Method POST -ContentType "application/json" -UseBasicParsing -Body $b).Content | ConvertFrom-Json
}

# Get window rect first
$tree = (KW 1 @{action="QUERYTREE";proc="HANDLE:$Handle";path="";value=1}).result
Write-Host "Window: name='$($tree.name)' x=$($tree.position.x) y=$($tree.position.y) w=$($tree.position.width) h=$($tree.position.height)"
Write-Host ""
Write-Host "Scanning bookmarks bar at y=$Y across x=40..900 in 40px steps..."
Write-Host "==================================================================="

$knownHandles = (KW 2 @{action="LISTWINDOWS";proc="brave.exe"}).result.windows | Where-Object {$_.pid -eq 18696} | Select-Object -ExpandProperty handle

foreach ($x in (40..900 | Where-Object { $_ % 40 -eq 0 })) {
    # Click
    $r = KW ($x+1000) @{action="SENDKEYS";proc="HANDLE:$Handle";parameter="{CLICK:$x,$Y}"}
    Start-Sleep -Milliseconds 400

    # Check for new popup windows (menus/tooltips)
    $allWins = (KW ($x+2000) @{action="LISTWINDOWS";proc="brave.exe"}).result.windows
    $newWins = $allWins | Where-Object { $_.pid -eq 18696 -and $_.handle -notin $knownHandles }

    if ($newWins) {
        Write-Host "  [x=$x] *** POPUP DETECTED: $(($newWins | ForEach-Object { 'H:'+$_.handle+'='+$_.title }) -join ', ') ***" -ForegroundColor Green

        # Scan UIA tree of the popup
        foreach ($pw in $newWins) {
            $pt = (KW ($x+3000) @{action="QUERYTREE";proc="HANDLE:$($pw.handle)";path="";value=5}).result
            Write-Host "    Popup UIA tree depth-5:" -ForegroundColor Yellow
            $pt | ConvertTo-Json -Depth 4 | Write-Host
        }

        # ESC to close
        KW ($x+4000) @{action="SENDKEYS";proc="HANDLE:$Handle";parameter="{ESC}"} | Out-Null
        Start-Sleep -Milliseconds 300
    } else {
        $title = $allWins | Where-Object {$_.handle -eq $Handle} | Select-Object -ExpandProperty title
        Write-Host "  [x=$x] no popup | active tab: '$title'"
    }
}

Write-Host ""
Write-Host "=== Scan complete ==="
