$mcp = "http://127.0.0.1:3467"
function Exec([int]$id, [string]$js) {
    $body = @{jsonrpc="2.0";id=$id;method="tools/call";params=@{name="BrowserWin";arguments=@{action="EXEC";proc="brave.exe";value=$js}}} | ConvertTo-Json -Depth 8 -Compress
    $j = (Invoke-WebRequest -Uri $mcp -Method POST -ContentType "application/json" -UseBasicParsing -Body $body).Content | ConvertFrom-Json
    if ($j.error) { return "ERR:" + $j.error.message }
    return $j.result.result
}
Write-Host "=== Find frame by max sid ==="
Write-Host (Exec 1 "(function(){var fs=document.querySelectorAll('iframe');if(!fs.length)return 'no iframes';var best=null;var bestSid=0;for(var i=0;i<fs.length;i++){try{var u=fs[i].contentWindow.location.href;var m=u.match(/sid=(\d+)/);if(m&&parseInt(m[1])>bestSid){bestSid=parseInt(m[1]);best=fs[i];}}catch(e){}}if(!best)return 'none';window.__qtFrame=best;var d=best.contentDocument;return JSON.stringify({sid:bestSid,cm:d.querySelectorAll('.cm-content').length,ready:d.readyState});})()") 
Write-Host "=== Cancel all pending dialogs ==="
Write-Host (Exec 2 "(function(){var f=window.__qtFrame;var d=f.contentDocument;var btns=Array.from(d.querySelectorAll('button')).filter(function(b){return b.textContent.trim()==='Cancel';});btns.forEach(function(b){b.click();});return 'cancelled:'+btns.length;})()"); Start-Sleep -Seconds 1
Write-Host "=== Fill SQL ==="
$ddlSql = "SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns WHERE table_schema = \'public\' AND table_name LIKE \'aiapi_%\' ORDER BY table_name, ordinal_position;"
Write-Host (Exec 3 "(function(){var f=window.__qtFrame;if(!f)return 'no frame';var d=f.contentDocument;var cw=f.contentWindow;var cm=d.querySelector('.cm-content');if(!cm)return 'no cm';cm.focus();cw.document.execCommand('selectAll');cw.document.execCommand('insertText',false,'$ddlSql');return 'filled:'+cm.textContent.substring(0,120);})()")  
Write-Host "=== Click Execute query ==="
Write-Host (Exec 4 "(function(){var f=window.__qtFrame;var d=f.contentDocument;var btns=d.querySelectorAll('button');for(var i=0;i<btns.length;i++){var al=btns[i].getAttribute('aria-label')||'';if(al==='Execute query'){btns[i].click();return 'clicked';}}return 'not found';})()"); Start-Sleep -Seconds 2
Write-Host "=== Confirm dialog (if shown) ==="
Write-Host (Exec 5 "(function(){var f=window.__qtFrame;var d=f.contentDocument;var btns=Array.from(d.querySelectorAll('button'));var dan=btns.find(function(b){return b.textContent.trim()==='Don\'t ask again';});var cont=btns.filter(function(b){return b.textContent.trim()==='Continue';});if(!cont.length)return 'no dialog';if(dan)dan.click();cont[cont.length-1].click();return 'confirmed, count:'+cont.length;})()"); Start-Sleep -Seconds 8
Write-Host "=== Read grid rows ==="
$raw = (Exec 6 "(function(){var f=window.__qtFrame;if(!f)return 'no frame';var d=f.contentDocument;var rows=d.querySelectorAll('.rdg-row,[role=row]');var out=[];rows.forEach(function(r){var cells=r.querySelectorAll('.rdg-cell,[role=gridcell],[role=columnheader]');var row=Array.from(cells).map(function(c){return c.textContent.trim()});if(row.some(function(c){return c.length>0}))out.push(row.join(' | '));});return JSON.stringify(out.slice(0,60));})()") 
try { ($raw | ConvertFrom-Json) | ForEach-Object { Write-Host "  $_" } } catch { Write-Host $raw }
Write-Host "=== Messages tab ==="
Write-Host (Exec 7 "(function(){var f=window.__qtFrame;var d=f.contentDocument;var msg=d.querySelector('[class*=Messages],[class*=messages]');if(msg)return msg.innerText.substring(0,400);var all=d.body.innerText;var mIdx=all.indexOf('Messages');return mIdx>=0?all.substring(mIdx,mIdx+300):'no messages tab';})()") 

Write-Host "=== Scan grid classes ==="
Write-Host (Exec 8 "(function(){var f=window.__qtFrame;var d=f.contentDocument;var clss=new Set();d.querySelectorAll('[class]').forEach(function(el){var c=el.className;if(typeof c==='string')c.split(' ').forEach(function(cls){if(cls.indexOf('rdg')>=0||cls.indexOf('grid')>=0||cls.indexOf('row')>=0||cls.indexOf('output')>=0||cls.indexOf('data')>=0)clss.add(cls);})});return JSON.stringify([...clss].slice(0,30));})()") 
