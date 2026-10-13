const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('main.js','utf8');
const block=src.slice(src.indexOf('function getFolders('),src.indexOf('let monitorTimer'));
const dbBlock=src.slice(src.indexOf('const RESOURCE_DATABASE_FILE'),src.indexOf('function readConfig()'));
const history=src.slice(src.indexOf('function submitHistory()'),src.indexOf('function normalizeMovie('));
const magnet='magnet:?xt=urn:btih:'+'a'.repeat(40);
function harness(options={}) {
 let config={folder:{cid:'42',name:'待归档',uid:'123'},submitHistory:[]},submitted=false,parent=options.parent??'0',cookie='cookie';const calls=[],logs=[];
 let dbFiles={}; const mockFs={mkdirSync(){},existsSync:p=>p in dbFiles,readFileSync:p=>dbFiles[p],writeFileSync:(p,s)=>dbFiles[p]=s,renameSync(a,b){dbFiles[b]=dbFiles[a];delete dbFiles[a];}};
 const ctx={scanExportTools:()=>require(process.cwd()+'/scan-export.js'),normalizeMovie:x=>x,mergeExportRecord:(a,b)=>({...b,...a,media:{...b.media,...a.media}}),queueMetadataCapture(){},crypto:require('crypto'),fs:mockFs,path:require('path'),app:{getPath:()=> 'C:/Temp/mock-folder'},mainWindow:null,sizeInGb:v=> Number(String(v||'').match(/([\d.]+)/)?.[1])||0,Date,Math,URLSearchParams,String,Number,Boolean,Object,Array,Promise,readConfig:()=>structuredClone(config),writeConfig:v=>config=structuredClone(v),loadCookie:()=>cookie,getAccount:async()=>({uid:'123'}),appendMonitorLog:(...v)=>logs.push(v),waitResource:async()=>{},check115:r=>{if(r.state!==true)throw Error(r.message||r.error||'115失败')},apiRequest:async(url,opt={})=>{
  calls.push({url,method:opt.method||'GET',body:opt.body});
  if(url.includes('files?'))return {state:true,path:[{cid:'0',name:'根目录'},{cid:options.invalidFolder?'0':'42',name:'待归档'}]};
  if(url.includes('get_user_task'))return submitted||options.existing?{state:true,data:{info_hash:'a'.repeat(40),url:magnet,status:options.failedTask?-1:options.running?1:2,...(options.fidOnly?{fid:'888'}:options.noOutput?{}:{file_id:'888'})}}:{state:false};
  if(url.includes('task_lists'))return {state:true,tasks:options.existing?[{info_hash:'a'.repeat(40),url:magnet,status:2,file_id:'888'}]:[],page_count:1};
  if(url.includes('add_task_url')) {submitted=true;if(options.uncertain)throw Error('timeout');if(options.rejected)return {state:false,message:'提交失败'};return {state:true};}
  if(url.includes('files/get_info')) {if(options.switchBeforeMove)cookie='changed';return {state:true,data:[options.fileSchema?{fid:'888',cid:parent}:{cid:'888',pid:parent}]};}
  if(url.includes('files/move')) {assert.equal(opt.body.get('fid'),'888');assert.equal(opt.body.get('fid[0]'),'888');assert.equal(opt.body.get('pid'),'42');assert.equal(JSON.parse(opt.body.get('conflict_policy'))['888'].action,'keep_both');if(options.moveFailure)return {state:false,error:'移动失败'};parent='42';return {state:true};}
  throw Error('unexpected '+url);
 }};
 if(options.initialConfig)config=structuredClone(options.initialConfig); vm.createContext(ctx);vm.runInContext('const jsonStore=null;const shuttingDown=false;'+dbBlock+history+block,ctx);return {ctx,calls,logs,config:()=>config,setCookie:v=>cookie=v};
}

(async()=>{
 const h=harness({parent:'42'}); const expected={saved:0,failed:0,pending:0}; const tasks=[];
 for(let i=0;i<1900;i++) tasks.push({info_hash:(10000+i).toString(16).padStart(40,'0'),status:1});
 for(let i=0;i<672;i++) {
  const hash=(i+1).toString(16).padStart(40,'0'),url='magnet:?xt=urn:btih:'+hash;
  const row=h.ctx.recordSubmitHistory(url,'pending','115已接受任务','42',{uid:'123',folderName:'待归档',title:'资源'+i,source:'auto'});
  h.ctx.savePendingOffline({id:'queue'+i,uid:'123',url,cid:'42',name:'待归档',historyId:row.id});
  const status=i%20===0?-1:i%10===0?2:1;expected[status===2?'saved':status===-1?'failed':'pending']++;
  tasks.push({info_hash:hash,status,file_id:'888',percentDone:25,status_text:status===-1?'资源下载失败':'下载中'});
 }
 const original=h.ctx.apiRequest;let pages=[];h.ctx.apiRequest=async(url,opt={})=>{
  assert(!url.includes('get_user_task')&&!url.includes('add_task_url')&&!url.includes('files/move'),'Bulk sync must not submit, individually query or move files already in target');
  if(url.includes('task_lists')){const page=Number(new URL(url).searchParams.get('page'));pages.push(page);return {state:true,tasks:tasks.slice((page-1)*100,page*100),page_count:Math.ceil(tasks.length/100)};}
  return original(url,opt);
 };
 let databaseWrites=0; const diskWrite=h.ctx.fs.writeFileSync; h.ctx.fs.writeFileSync=(p,s)=>{if(p.endsWith('offline-resources.json.tmp'))databaseWrites++;return diskWrite(p,s);};
 const result=await h.ctx.checkPendingOfflinePlacements(true); assert(databaseWrites<=8,'Sync writes database by page instead of per terminal task: '+databaseWrites); console.log('Database writes for 672 mixed tasks: '+databaseWrites);assert.equal(result.checked,672);assert.equal(result.saved,expected.saved);assert.equal(result.failed,expected.failed);assert.equal(result.pending,expected.pending);assert.equal(pages.length,26);assert.equal(h.config().offlinePlacementPending.length,expected.pending);assert(h.config().submitHistory.filter(r=>r.status==='pending').every(r=>r.message.includes('25%')));
 const repeat=await h.ctx.checkPendingOfflinePlacements(true);assert.equal(repeat.saved,0);assert.equal(repeat.failed,0);assert.equal(repeat.pending,expected.pending);
 const f=harness();let calls=[];f.ctx.apiRequest=async url=>{calls.push(url);if(url.includes('clouddownload'))throw Error('timeout');return {state:true,tasks:[],page_count:1};};await f.ctx.readOfflineTaskPage('cookie',1);await f.ctx.readOfflineTaskPage('cookie',2);assert.equal(calls.length,3);assert(calls[2].includes('115.com/web/lixian'));
 const m=harness({initialConfig:{submitHistory:[],offlinePlacementPending:[{id:'m',uid:'123',url:magnet,cid:'42',name:'待归档'}]}});const missing=await m.ctx.checkPendingOfflinePlacements();assert.equal(missing.missing,1);assert.equal(m.config().offlinePlacementPending.length,1);assert(m.config().offlinePlacementPending[0].lastCheckMessage.includes('未找到'));
 console.log('PASS 672 records, 26 pages, exact hash matching, completed/failed/live progress, repeat sync without resubmit, remembered official host fallback, missing tasks preserved');
})().catch(e=>{console.error(e);process.exit(1)});
