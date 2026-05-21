const {mcpCall}=require('../../test/e2e/_shared');
const B='brave.exe';
async function run(){
  const sid=4,sgid=2,dbid=127376;
  const csrf=await mcpCall('BrowserWin',{proc:B,action:'EXEC',path:'',value:'pgAdmin.csrf_token'});
  const c=csrf.result.replace(/^"|"$/g,'');
  function xhr(path){return `(function(){var x=new XMLHttpRequest();x.open('GET','${path}',false);x.setRequestHeader('X-pgA-CSRFToken','${c}');x.setRequestHeader('Accept','application/json');x.send();return JSON.parse(x.responseText)})()`;}
  // Schemas
  const sch=await mcpCall('BrowserWin',{proc:B,action:'EXEC',path:'',value:`(function(){var c='${c}';var x=new XMLHttpRequest();x.open('GET','/browser/schema/nodes/${sgid}/${sid}/${dbid}/',false);x.setRequestHeader('X-pgA-CSRFToken',c);x.setRequestHeader('Accept','application/json');x.send();var d=JSON.parse(x.responseText);return JSON.stringify((d.data||d).map(function(s){return{id:s._id,label:s.label}}))})()`});
  console.log('Schemas:',sch.result);
  const schList=JSON.parse(sch.result);
  const pub=schList.find(s=>s.label==='public');
  const schid=pub.id;
  console.log('public schid:',schid);
  // Tables
  const tbl=await mcpCall('BrowserWin',{proc:B,action:'EXEC',path:'',value:`(function(){var c='${c}';var x=new XMLHttpRequest();x.open('GET','/browser/table/nodes/${sgid}/${sid}/${dbid}/${schid}/',false);x.setRequestHeader('X-pgA-CSRFToken',c);x.setRequestHeader('Accept','application/json');x.send();var d=JSON.parse(x.responseText);var tbls=(d.data||d).map(function(t){return t.label});var want=['aiapi_users','aiapi_roles','aiapi_user_roles','aiapi_apikeys','aiapi_settings'];var missing=want.filter(function(n){return tbls.indexOf(n)<0});return JSON.stringify({tables:tbls.sort(),missing:missing,ok:missing.length===0})})()`});
  console.log('Tables verify:',tbl.result);
  // LISTWINDOWS
  const lw=await mcpCall('BrowserWin',{proc:B,action:'LISTWINDOWS',path:'',value:''});
  console.log('Windows:',JSON.stringify(lw.windows.filter(w=>w.pid===9072).map(w=>({h:w.handle,t:w.title}))));
  // Tree DOM
  const dom=await mcpCall('BrowserWin',{proc:B,action:'EXEC',path:'',value:'(function(){return JSON.stringify(Array.from(document.querySelectorAll(".file-entry")).map(function(e){return{cls:e.className.replace("file-entry ",""),txt:e.textContent.trim().slice(0,50)}}))})()'});
  console.log('Tree DOM:',dom.result);
}
run().catch(e=>console.error(e.message));
