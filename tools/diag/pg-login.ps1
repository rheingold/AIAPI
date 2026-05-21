# pgAdmin login + full-verify via MCP/BrowserWin
$mcp     = "http://127.0.0.1:3467"
$browser = "brave.exe"

function Mcp([int]$id, [string]$action, [hashtable]$extras = @{}) {
    $a    = @{ action=$action; proc=$browser } + $extras
    $body = @{ jsonrpc="2.0"; id=$id; method="tools/call";
               params=@{ name="BrowserWin"; arguments=$a } } |
            ConvertTo-Json -Depth 8 -Compress
    $j = (Invoke-WebRequest -Uri $mcp -Method POST -ContentType "application/json" `
              -UseBasicParsing -Body $body).Content | ConvertFrom-Json
    if ($j.error) { throw "[$action] FAILED: $($j.error.message)" }
    return $j.result
}
function McpKey([int]$id, [string]$handle, [string]$keys) {
    $body = @{ jsonrpc="2.0"; id=$id; method="tools/call";
               params=@{ name="KeyWin"; arguments=@{ action="SENDKEYS"; proc=$handle; value=$keys } } } |
            ConvertTo-Json -Depth 8 -Compress
    return ((Invoke-WebRequest -Uri $mcp -Method POST -ContentType "application/json" `
                 -UseBasicParsing -Body $body).Content | ConvertFrom-Json).result
}

Write-Host "`n[1] LISTWINDOWS (pre-flight)"
$lw = Mcp 1 "LISTWINDOWS"
$lw.windows | Where-Object { $_.title -match "pgAdmin|Brave|heslo" } |
    Format-Table handle, pid, title -AutoSize

Write-Host "[2] Current URL + CSRF"
$jsState = 'JSON.stringify({url:location.href,csrf:typeof pgAdmin!="undefined"?pgAdmin.csrf_token:null})'
$state   = Mcp 2 "EXEC" @{ value=$jsState }
Write-Host "  $($state.result)"
$stateObj = $state.result | ConvertFrom-Json

if ($stateObj.url -notmatch "/browser/") {
    Write-Host "`n[3] Filling email..."
    $jsEmail = 'var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(document.querySelector("[name=email]"),"ddladmin@localhost.locale");document.querySelector("[name=email]").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("[name=email]").value'
    Write-Host "  email: $((Mcp 3 'EXEC' @{ value=$jsEmail }).result)"

    Write-Host "[4] Filling password..."
    $jsPass = 'var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(document.querySelector("[name=password]"),"1/ddladmin.2");document.querySelector("[name=password]").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("[name=password]").value'
    Write-Host "  pw: $((Mcp 4 'EXEC' @{ value=$jsPass }).result)"

    Write-Host "[5] Click Login..."
    Mcp 5 "CLICKNAME" @{ path="Login" } | Out-Null
    Start-Sleep -Seconds 4

    Write-Host "[5b] LISTWINDOWS after login..."
    (Mcp 6 "LISTWINDOWS").windows | Where-Object { $_.title -match "heslo|pgAdmin" } |
        Format-Table handle, pid, title -AutoSize

    $url = (Mcp 7 "EXEC" @{ value="location.href" }).result
    Write-Host "  URL: $url"
    if ($url -match "login") { throw "Login redirect failed" }
}

$sgid = 2
Write-Host "`n[6] CSRF: $((Mcp 8 'EXEC' @{ value='pgAdmin.csrf_token' }).result)"

Write-Host "`n[7] Register server (sgid=$sgid)..."
$jsReg = "(function(){var c=pgAdmin.csrf_token;var p={name:'aiapi-pg',host:'192.168.254.16',port:5432,db:'aiapi_test',username:'ddladmin',password:'1/ddladmin.2',role:'',comment:'AIAPI',connect_now:true,gid:$sgid};var x=new XMLHttpRequest();x.open('POST','/browser/server/obj/$sgid/',false);x.setRequestHeader('Content-Type','application/json');x.setRequestHeader('X-pgA-CSRFToken',c);x.send(JSON.stringify(p));return x.responseText;})()"
$regR = Mcp 9 "EXEC" @{ value=$jsReg }
Write-Host "  raw: $($regR.result)"
$reg = $regR.result | ConvertFrom-Json
$sid = $reg.node._id
Write-Host "  sid=$sid  connected=$($reg.node.connected)"

Write-Host "`n[8] LISTWINDOWS after register (dialog check)..."
$dlg = (Mcp 10 "LISTWINDOWS").windows | Where-Object { $_.title -match "heslo|lo.*heslo" }
if ($dlg) {
    Write-Host "  Dialog h=$($dlg[0].handle) - ESC..."
    McpKey 11 "HANDLE:$($dlg[0].handle)" "{ESC}" | Out-Null
    Start-Sleep -Seconds 1
    $dlg2 = (Mcp 20 "LISTWINDOWS").windows | Where-Object { $_.title -match "heslo" }
    if ($dlg2) { McpKey 21 "HANDLE:$($dlg2[0].handle)" "{ESC}" | Out-Null }
} else { Write-Host "  No dialog." }

Write-Host "`n[9] List databases..."
$jsDb = "(function(){var c=pgAdmin.csrf_token;var x=new XMLHttpRequest();x.open('GET','/browser/database/nodes/$sgid/$sid/',false);x.setRequestHeader('X-pgA-CSRFToken',c);x.setRequestHeader('Accept','application/json');x.send();var d=JSON.parse(x.responseText);return JSON.stringify((d.data||d).map(function(t){return{id:t._id,label:t.label}}));})()"
$dbR = Mcp 12 "EXEC" @{ value=$jsDb }
Write-Host "  $($dbR.result)"
$dbs  = $dbR.result | ConvertFrom-Json
$dbid = ($dbs | Where-Object { $_.label -eq "aiapi_test" }).id
Write-Host "  aiapi_test dbid=$dbid"

Write-Host "`n[10] List schemas..."
$jsSch = "(function(){var c=pgAdmin.csrf_token;var x=new XMLHttpRequest();x.open('GET','/browser/schema/nodes/$sgid/$sid/$dbid/',false);x.setRequestHeader('X-pgA-CSRFToken',c);x.setRequestHeader('Accept','application/json');x.send();var d=JSON.parse(x.responseText);return JSON.stringify((d.data||d).map(function(s){return{id:s._id,label:s.label}}));})()"
$schR  = Mcp 13 "EXEC" @{ value=$jsSch }
Write-Host "  $($schR.result)"
$schid = ($schR.result | ConvertFrom-Json | Where-Object { $_.label -eq "public" }).id
Write-Host "  public schid=$schid"

Write-Host "`n[11] Verify tables..."
$jsTbl = "(function(){var c=pgAdmin.csrf_token;var x=new XMLHttpRequest();x.open('GET','/browser/table/nodes/$sgid/$sid/$dbid/$schid/',false);x.setRequestHeader('X-pgA-CSRFToken',c);x.setRequestHeader('Accept','application/json');x.send();var d=JSON.parse(x.responseText);var tbls=(d.data||d).map(function(t){return t.label});var want=['aiapi_users','aiapi_roles','aiapi_user_roles','aiapi_apikeys','aiapi_settings'];var missing=want.filter(function(n){return tbls.indexOf(n)<0});return JSON.stringify({tables:tbls,missing:missing,ok:missing.length===0});})()"
$tblR = Mcp 14 "EXEC" @{ value=$jsTbl }
Write-Host "  $($tblR.result)"
$tbl = $tblR.result | ConvertFrom-Json
if ($tbl.ok) {
    Write-Host "`nALL TABLES OK: $($tbl.tables -join ', ')" -ForegroundColor Green
} else {
    Write-Host "`nMISSING: $($tbl.missing -join ', ')" -ForegroundColor Red; exit 1
}
