# pg-ui-explore.ps1  v4  (fixed: iframe CodeMirror, translate dialog, dialog dismiss)
$mcp     = "http://127.0.0.1:3467"
$browser = "brave.exe"
$sgid    = 2

# Win32 PostMessage API for native dialogs BrowserWin/KeyWin cannot reach
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class WinMsg {
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@ -ErrorAction SilentlyContinue

function Exec([int]$id, [string]$js) {
    $body = @{jsonrpc="2.0";id=$id;method="tools/call";params=@{name="BrowserWin";arguments=@{action="EXEC";proc=$browser;value=$js}}} | ConvertTo-Json -Depth 8 -Compress
    $j = (Invoke-WebRequest -Uri $mcp -Method POST -ContentType "application/json" -UseBasicParsing -Body $body).Content | ConvertFrom-Json
    if ($j.error) { return $null }
    return $j.result.result
}
function LW([int]$id) {
    $body = @{jsonrpc="2.0";id=$id;method="tools/call";params=@{name="BrowserWin";arguments=@{action="LISTWINDOWS";proc=$browser}}} | ConvertTo-Json -Depth 8 -Compress
    return ((Invoke-WebRequest -Uri $mcp -Method POST -ContentType "application/json" -UseBasicParsing -Body $body).Content | ConvertFrom-Json).result.windows
}
function Dismiss($id) {
    $wins = LW $id
    $dismissed = 0
    # Brave "Uložit heslo?" (save password) — try KeyWin SENDKEYS
    $dlgs = $wins | Where-Object { $_.title -match "heslo|Ulo" }
    foreach ($d in $dlgs) {
        Write-Host "   [heslo-dialog h=$($d.handle)] ESC via KeyWin"
        $body = @{jsonrpc="2.0";id=($id+1);method="tools/call";params=@{name="KeyWin";arguments=@{action="SENDKEYS";proc="HANDLE:$($d.handle)";value="{ESC}"}}} | ConvertTo-Json -Depth 8 -Compress
        Invoke-WebRequest -Uri $mcp -Method POST -ContentType "application/json" -UseBasicParsing -Body $body | Out-Null
        Start-Sleep -Milliseconds 600
        $dismissed++
    }
    # Brave "Přeložit tuto stránku?" (translate page) — intentionally NOT dismissed here.
    # The translate infobar does not block CDP EXEC. Sending ESC to it can affect pgAdmin DOM
    # (same HWND in some configurations) and cancel in-progress tree expansions.
    # Log only so we can diagnose if needed.
    $trans = $wins | Where-Object { $_.title -match "P.elo|Translate|tuto str" -and $_.title -notmatch "pgAdmin" }
    foreach ($d in $trans) {
        Write-Host "   [translate-dialog h=$($d.handle)] (ignored — not dismissing)"
    }
    return $dismissed
}
function WaitNode([string]$lbl, [int]$maxMs = 6000) {
    $js = "(function(){var e=document.querySelectorAll('.file-entry');for(var i=0;i<e.length;i++){var l=e[i].querySelector('.file-label');if(l&&l.textContent.trim().indexOf('$lbl')===0){return 'found';}}return 'not-found';})()"
    $t = 0
    while ($t -lt $maxMs) {
        $r = Exec 0 $js
        if ($r -eq "found") { return $true }
        Dismiss 0 | Out-Null   # dismiss any blocking dialog mid-wait
        Start-Sleep -Milliseconds 700; $t += 700
    }
    return $false
}
function ClickLast([int]$id, [string]$lbl) {
    # Click directory-toggle of the LAST .file-entry matching $lbl (most recent server)
    $js = "(function(){var e=document.querySelectorAll('.file-entry');var last=null;for(var i=0;i<e.length;i++){var l=e[i].querySelector('.file-label');if(l&&l.textContent.trim().indexOf('$lbl')===0){last=e[i];}}if(!last){return 'not-found:$lbl';}var t=last.querySelector('I.directory-toggle');if(t){t.click();return 'clicked:$lbl';}return 'no-toggle:$lbl';})()"
    return Exec $id $js
}
function ClickFirst([int]$id, [string]$lbl) {
    $js = "(function(){var e=document.querySelectorAll('.file-entry');for(var i=0;i<e.length;i++){var l=e[i].querySelector('.file-label');if(l&&l.textContent.trim().indexOf('$lbl')===0){var t=e[i].querySelector('I.directory-toggle');if(t){t.click();return 'clicked:$lbl';}return 'no-toggle:$lbl';}}return 'not-found:$lbl';})()"
    return Exec $id $js
}

# ── PRE-FLIGHT: cleanup + register ───────────────────────────────────────────
Write-Host "`n=== PRE-FLIGHT ==="
if ((Exec 1 "location.href") -notmatch "/browser/") { throw "Not on /browser/" }

# Correct endpoint: GET /browser/server/nodes/{sgid}/ (not /obj/)
# DELETE: /browser/server/obj/{sgid}/{_id}  (NO trailing slash — 404 with trailing slash)
$jsListSrv = "(function(){var c=pgAdmin.csrf_token;var x=new XMLHttpRequest();x.open('GET','/browser/server/nodes/$sgid/',false);x.setRequestHeader('X-pgA-CSRFToken',c);x.send();try{var d=JSON.parse(x.responseText);return JSON.stringify((d.result||[]).map(function(s){return{id:s._id,label:s.label||s.name}}));}catch(e){return '[]';}})()"
$srvList = (Exec 2 $jsListSrv) | ConvertFrom-Json
Write-Host "  Existing servers: $($srvList.Count)"
foreach ($srv in $srvList) {
    $jsDel = "(function(){var c=pgAdmin.csrf_token;var x=new XMLHttpRequest();x.open('DELETE','/browser/server/obj/$sgid/$($srv.id)',false);x.setRequestHeader('X-pgA-CSRFToken',c);x.setRequestHeader('Content-Type','application/json');x.send('{}');return x.status;})()"
    $st = Exec 3 $jsDel
    Write-Host "    DELETE sid=$($srv.id) -> $st"
}

$jsReg = "(function(){var c=pgAdmin.csrf_token;var p={name:'aiapi-pg',host:'192.168.254.16',port:5432,db:'aiapi_test',username:'ddladmin',password:'1/ddladmin.2',role:'',comment:'AIAPI',connect_now:true,gid:$sgid};var x=new XMLHttpRequest();x.open('POST','/browser/server/obj/$sgid/',false);x.setRequestHeader('Content-Type','application/json');x.setRequestHeader('X-pgA-CSRFToken',c);x.send(JSON.stringify(p));return x.responseText;})()"
$reg = (Exec 4 $jsReg) | ConvertFrom-Json
$sid = $reg.node._id
Write-Host "  Registered: sid=$sid connected=$($reg.node.connected)"

# Dismiss any dialog immediately after registration
Start-Sleep -Milliseconds 1000
Dismiss 5 | Out-Null

# Reload page so tree shows exactly 1 server
Write-Host "  Reloading tree..."
Exec 6 "location.reload()" | Out-Null
Start-Sleep -Seconds 4
Dismiss 7 | Out-Null

# Pre-warm DB connection: expand Servers → aiapi-pg, wait for children to load
# Using pgAdmin.Browser.tree.open() + .children() — NOT rootNode.children (that's always empty)
Write-Host "  Expanding Servers group via pgAdmin tree API..."
$jsExpandSrv = "(function(){var t=pgAdmin.Browser.tree;var sg=t.first(null);t.open(sg);return 'opened:'+((t.itemData(sg)||{}).label)+' hasKids:'+t.children(sg).length;})()"
Write-Host "      $(Exec 8 $jsExpandSrv)"
Start-Sleep -Seconds 4
$srvKids = Exec 9 "(function(){var t=pgAdmin.Browser.tree;var sg=t.first(null);var k=t.children(sg);return k.length+':'+(k.map(function(c){return (t.itemData(c)||{}).label||'?'})).join(',');})()"
Write-Host "  Servers kids: $srvKids"

Write-Host "  Pre-warming DB connection (opening aiapi-pg, waiting 25s)..."
$jsWarm = "(function(){var t=pgAdmin.Browser.tree;var sg=t.first(null);var k=t.children(sg);var pg=k[k.length-1];if(!pg)return 'no-pg:kids='+k.length;t.open(pg);return 'warming:'+(t.itemData(pg)||{}).label;})()"
Write-Host "  Warmup: $(Exec 10 $jsWarm)"
Start-Sleep -Seconds 25
$warmNodes = Exec 11 "document.querySelectorAll('.file-entry').length+' entries after warmup'"
Write-Host "  $warmNodes"


Write-Host "`n=== PHASE A: TREE EXPANSION ==="
# Uses pgAdmin.Browser.tree.open() + .children() API — element.click() does NOT fire React handlers

function TreeOpen([int]$id, [string]$js) {
    $r = Exec $id $js
    Write-Host "  $r"
    Start-Sleep -Seconds 4
    return $r
}

# [1] Open Servers → aiapi-pg → Databases
Write-Host "  [1] Opening Servers → aiapi-pg → Databases..."
$js1 = "(function(){var t=pgAdmin.Browser.tree;var sg=t.first(null);t.open(sg);var pg=(t.children(sg)||[])[0];if(!pg)return 'no-pg';t.open(pg);var dbItem=(t.children(pg)||[]).filter(function(c){return(t.itemData(c)||{}).label==='Databases';})[0];if(!dbItem)return 'no-Databases:pg.kids='+t.children(pg).length;t.open(dbItem);return 'ok:Servers>'+((t.itemData(pg)||{}).label)+'>Databases';})()";
TreeOpen 100 $js1 | Out-Null

# [2] Open aiapi_test
Write-Host "  [2] Opening aiapi_test..."
$js2 = "(function(){var t=pgAdmin.Browser.tree;var sg=t.first(null);var pg=(t.children(sg)||[])[0];var dbItem=(t.children(pg)||[]).filter(function(c){return(t.itemData(c)||{}).label==='Databases';})[0];if(!dbItem)return 'no-Databases';var atItem=(t.children(dbItem)||[]).filter(function(c){return(t.itemData(c)||{}).label==='aiapi_test';})[0];if(!atItem)return 'no-aiapi_test:db.kids='+t.children(dbItem).length;t.open(atItem);return 'ok:aiapi_test';})()";
TreeOpen 110 $js2 | Out-Null

# [3] Open Schemas
Write-Host "  [3] Opening Schemas..."
$js3 = "(function(){var t=pgAdmin.Browser.tree;var sg=t.first(null);var pg=(t.children(sg)||[])[0];var dbItem=(t.children(pg)||[]).filter(function(c){return(t.itemData(c)||{}).label==='Databases';})[0];var atItem=(t.children(dbItem)||[]).filter(function(c){return(t.itemData(c)||{}).label==='aiapi_test';})[0];if(!atItem)return 'no-aiapi_test';var schItem=(t.children(atItem)||[]).filter(function(c){return(t.itemData(c)||{}).label==='Schemas';})[0];if(!schItem)return 'no-Schemas:at.kids='+t.children(atItem).length;t.open(schItem);return 'ok:Schemas';})()";
TreeOpen 120 $js3 | Out-Null

# [4] Open public
Write-Host "  [4] Opening public..."
$js4 = "(function(){var t=pgAdmin.Browser.tree;var sg=t.first(null);var pg=(t.children(sg)||[])[0];var dbItem=(t.children(pg)||[]).filter(function(c){return(t.itemData(c)||{}).label==='Databases';})[0];var atItem=(t.children(dbItem)||[]).filter(function(c){return(t.itemData(c)||{}).label==='aiapi_test';})[0];var schItem=(t.children(atItem)||[]).filter(function(c){return(t.itemData(c)||{}).label==='Schemas';})[0];if(!schItem)return 'no-Schemas';var pubItem=(t.children(schItem)||[]).filter(function(c){return(t.itemData(c)||{}).label==='public';})[0];if(!pubItem)return 'no-public:sch.kids='+t.children(schItem).length;t.open(pubItem);return 'ok:public';})()";
TreeOpen 130 $js4 | Out-Null

# [5] Open Tables — select it so Query Tool menu enables
Write-Host "  [5] Opening Tables and selecting for QT..."
$js5 = "(function(){var t=pgAdmin.Browser.tree;var sg=t.first(null);var pg=(t.children(sg)||[])[0];var dbItem=(t.children(pg)||[]).filter(function(c){return(t.itemData(c)||{}).label==='Databases';})[0];var atItem=(t.children(dbItem)||[]).filter(function(c){return(t.itemData(c)||{}).label==='aiapi_test';})[0];var schItem=(t.children(atItem)||[]).filter(function(c){return(t.itemData(c)||{}).label==='Schemas';})[0];var pubItem=(t.children(schItem)||[]).filter(function(c){return(t.itemData(c)||{}).label==='public';})[0];if(!pubItem)return 'no-public';var tblItem=(t.children(pubItem)||[]).filter(function(c){return(t.itemData(c)||{}).label==='Tables';})[0];if(!tblItem)return 'no-Tables:pub.kids='+t.children(pubItem).length;t.open(tblItem);t.select(atItem);return 'ok:Tables selected:aiapi_test';})()";
TreeOpen 140 $js5 | Out-Null

# Wait for table items to load
Start-Sleep -Seconds 2

$jsTree = "JSON.stringify(Array.from(document.querySelectorAll('.file-entry')).map(function(n){var l=n.querySelector('.file-label');return{d:n.className.match(/depth-\d/)?n.className.match(/depth-\d/)[0]:'?',txt:l?l.textContent.trim().substring(0,40):''}}))"
Write-Host "`n  Tree snapshot:"
$snap = (Exec 200 $jsTree) | ConvertFrom-Json
$snap | Where-Object { $_.txt -ne "" } | Format-Table d,txt -AutoSize

# ── PHASE B: QUERY TOOL ───────────────────────────────────────────────────────
Write-Host "`n=== PHASE B: QUERY TOOL ==="

# Select aiapi_test to enable Query Tool menu
Write-Host "  [1] Select aiapi_test node..."
$jsSelect = "(function(){var e=document.querySelectorAll('.file-entry');for(var i=0;i<e.length;i++){var l=e[i].querySelector('.file-label');if(l&&l.textContent.trim().indexOf('aiapi_test')===0){l.click();return 'clicked';}};return 'not-found';})()"
Write-Host "      $(Exec 301 $jsSelect)"; Start-Sleep -Milliseconds 1200

# Open Query Tool via Tools > Query Tool menu
Write-Host "  [2] Tools > Query Tool..."
$jsT = "(function(){var all=document.querySelectorAll('button,a,.nav-link');for(var i=0;i<all.length;i++){if(all[i].textContent.trim()==='Tools'){all[i].click();return 'ok';}}return 'not-found';})()"
Exec 302 $jsT | Out-Null; Start-Sleep -Milliseconds 700
$jsQT = "(function(){var all=document.querySelectorAll('[role=menuitem],li,a,.dropdown-item');for(var i=0;i<all.length;i++){var t=all[i].textContent.trim();if(t.indexOf('Query Tool')===0){all[i].click();return t;}}return 'not-found';})()"
Write-Host "      $(Exec 303 $jsQT)"; Start-Sleep -Seconds 4

# Activate the QT dock tab to make iframe visible so React mounts
Write-Host "  [3a] Activating QT dock tab..."
$jsActivate = "(function(){var tabs=document.querySelectorAll('[role=tab],.dock-tab-btn,.nav-link');for(var i=0;i<tabs.length;i++){var t=tabs[i].textContent.trim();if((t.indexOf('aiapi_test')>=0||t.indexOf('ddladmin')>=0)&&t.length<80){tabs[i].click();return 'activated:'+t;}}return 'no-qt-tab';})()"
Write-Host "      $(Exec 3031 $jsActivate)"; Start-Sleep -Seconds 4

# Find the iframe for current session: use the one with the highest sid value
Write-Host "  [3] Finding QT iframe (max sid)..."
$jsFindFrame = "(function(){var fs=document.querySelectorAll('iframe');var best=null;var bestSid=0;for(var i=0;i<fs.length;i++){try{var u=fs[i].contentWindow.location.href;var m=u.match(/sid=(\d+)/);if(m&&parseInt(m[1])>bestSid){bestSid=parseInt(m[1]);best=fs[i];}}catch(e){}}if(!best)return 'not-found';window.__qtFrame=best;var d=best.contentDocument;return 'found:sid='+bestSid+' cm6='+d.querySelectorAll('.cm-content').length+' ready='+d.readyState;})()"
Write-Host "      $(Exec 304 $jsFindFrame)"; Start-Sleep -Seconds 2

# Cancel any accumulated confirmation dialogs from other pending executes
Write-Host "  [4] Clearing pending dialogs..."
$jsCancel = "(function(){var f=window.__qtFrame;if(!f)return 'no frame';var d=f.contentDocument;var btns=Array.from(d.querySelectorAll('button')).filter(function(b){return b.textContent.trim()==='Cancel';});btns.forEach(function(b){b.click();});return 'cancelled:'+btns.length;})()"
Write-Host "      $(Exec 305 $jsCancel)"; Start-Sleep -Milliseconds 500

# Fill SQL using CM6 execCommand API
$sql = "SELECT * FROM aiapi_users LIMIT 5;"
Write-Host "  [5] Filling SQL: $sql"
$jsFill = "(function(){var f=window.__qtFrame;if(!f)return 'no frame';var d=f.contentDocument;var cw=f.contentWindow;var cm=d.querySelector('.cm-content');if(!cm)return 'no cm6-editor';cm.focus();cw.document.execCommand('selectAll');cw.document.execCommand('insertText',false,'$sql');return 'filled:'+cm.textContent.substring(0,80);})()"
Write-Host "      $(Exec 306 $jsFill)"

# Click Execute query (aria-label)
Write-Host "  [6] Execute query..."
$jsRun = '(function(){var f=window.__qtFrame;var d=f.contentDocument;var btns=d.querySelectorAll("button");for(var i=0;i<btns.length;i++){var al=btns[i].getAttribute("aria-label")||"";if(al==="Execute query"){btns[i].click();return "clicked";}}return "no exec btn";})()'
Write-Host "      $(Exec 307 $jsRun)"; Start-Sleep -Seconds 2

# Dismiss confirmation dialog: find last Continue button (indexOf for robustness)
Write-Host "  [6a] Confirm dialog..."
$jsCfm = '(function(){var f=window.__qtFrame;var d=f.contentDocument;var cont=Array.from(d.querySelectorAll("button")).filter(function(b){return b.textContent.indexOf("Continue")>=0;});if(!cont.length)return "no dialog";var dan=Array.from(d.querySelectorAll("button")).find(function(b){return b.textContent.indexOf("ask again")>=0;});if(dan)dan.click();cont[cont.length-1].click();return "confirmed:"+cont.length;})()'
Write-Host "      $(Exec 308 $jsCfm)"; Start-Sleep -Seconds 8

# Read react-data-grid result rows  (.rdg-row / .rdg-cell)
Write-Host "  [7] Reading result grid..."
$jsGrid = "(function(){var f=window.__qtFrame;if(!f)return 'no frame';var d=f.contentDocument;var rows=d.querySelectorAll('.rdg-row');var out=[];rows.forEach(function(r){var cells=r.querySelectorAll('.rdg-cell');var row=Array.from(cells).map(function(c){return c.textContent.trim()});if(row.some(function(c){return c.length>0}))out.push(row.join(' | '));});return JSON.stringify(out.slice(0,15));})()"
$grid = (Exec 309 $jsGrid) | ConvertFrom-Json
if ($grid -and $grid.Count -gt 0) {
    $grid | ForEach-Object { Write-Host "    $_" }
} else {
    # Fallback: show message area
    $jsMsg = "(function(){var f=window.__qtFrame;var d=f.contentDocument;var all=d.body.innerText;var mIdx=all.indexOf('Messages');return mIdx>=0?all.substring(mIdx,Math.min(mIdx+400,all.length)):'no messages';})()"
    Write-Host "    (no grid rows)"
    Write-Host "      $(Exec 310 $jsMsg)"
}

Write-Host "`n=== DONE ==="
