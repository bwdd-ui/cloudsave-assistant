const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('main.js','utf8');
const block=src.slice(src.indexOf('function getFolders('),src.indexOf('let monitorTimer'));
const dbBlock=src.slice(src.indexOf('const RESOURCE_DATABASE_FILE'),src.indexOf('function readConfig()'));
const history=src.slice(src.indexOf('function submitHistory()'),src.indexOf('function normalizeMovie('));
const magnet='magnet:?xt=urn:btih:'+'a'.repeat(40);
function harness(options={}) {
 let config={folder:{cid:'42',name:'待归档',uid:'123'},submitHistory:[]},submitted=false,parent=options.parent??'0',cookie='cookie';const calls=[],logs=[];
 let dbFiles={}; const mockFs={mkdirSync(){},existsSync:p=>p in dbFiles,readFileSync:p=>dbFiles[p],writeFileSync:(p,s)=>dbFiles[p]=s,renameSync(a,b){dbFiles[b]=dbFiles[a];delete dbFiles[a];}};
 const ctx={require:require('module').createRequire(process.cwd()+'/main.js'),scanExportTools:()=>require(process.cwd()+'/scan-export.js'),normalizeMovie:x=>x,mergeExportRecord:(a,b)=>({...b,...a,media:{...b.media,...a.media}}),queueMetadataCapture(){},crypto:require('crypto'),fs:mockFs,path:require('path'),app:{getPath:()=> 'C:/Temp/mock-folder'},mainWindow:null,sizeInGb:v=> Number(String(v||'').match(/([\d.]+)/)?.[1])||0,Date,Math,URLSearchParams,String,Number,Boolean,Object,Array,Promise,readConfig:()=>structuredClone(config),writeConfig:v=>config=structuredClone(v),loadCookie:()=>cookie,getAccount:async()=>({uid:'123'}),appendMonitorLog:(...v)=>logs.push(v),waitResource:async()=>{},check115:r=>{if(r.state!==true)throw Error(r.message||r.error||'115失败')},apiRequest:async(url,opt={})=>{
  calls.push({url,method:opt.method||'GET',body:opt.body});
  if(url.includes('files?'))return {state:true,path:[{cid:'0',name:'根目录'},{cid:options.invalidFolder?'0':'42',name:'待归档'}]};
  if(url.includes('get_user_task'))return submitted||options.existing?{state:true,data:{info_hash:'a'.repeat(40),url:magnet,status:options.failedTask?-1:options.running?1:2,...(options.fidOnly?{fid:'888'}:options.noOutput?{}:{file_id:'888'})}}:{state:false};
  if(url.includes('task_lists'))return {state:true,tasks:options.existing?[{info_hash:'a'.repeat(40),url:magnet,status:2,file_id:'888'}]:[],page_count:1};
  if(url.includes('add_task_url')) {submitted=true;if(options.uncertain)throw Error('timeout');if(options.rejected)return {state:false,message:'提交失败'};return {state:true};}
  if(url.includes('files/get_info')) {if(options.switchBeforeMove)cookie='changed';return {state:true,data:[options.fileSchema?{fid:'888',cid:parent}:{cid:'888',pid:parent}]};}
  if(url.includes('files/move')) {assert.equal(opt.body.get('fid'),'888');assert.equal(opt.body.get('fid[0]'),'888');assert.equal(opt.body.get('pid'),'42');assert.equal(JSON.parse(opt.body.get('conflict_policy'))['888'].action,'keep_both');if(options.moveFailure)return {state:false,error:'移动失败'};parent='42';return {state:true};}
  throw Error('unexpected '+url);
 }};
 if(options.initialConfig)config=structuredClone(options.initialConfig); vm.createContext(ctx);vm.runInContext('const jsonStore=null;const shuttingDown=false;'+dbBlock+history+block,ctx);ctx.__submissionSyncEvents=[];vm.runInContext('cloudSubmitSync.trigger=(uid,key)=>__submissionSyncEvents.push({uid,key})',ctx);return {ctx,calls,logs,config:()=>config,setCookie:v=>cookie=v};
}
module.exports={harness,magnet};
if(require.main===module)(async()=>{
let h=harness();let msg=await h.ctx.submitMagnet('cookie',magnet,'42');assert(msg.includes('已接受提交'));assert.equal(h.config().submitHistory[0].status,'pending');assert.equal(h.calls.find(c=>c.url.includes('add_task_url')).body.get('wp_path_id'),'42');assert.equal(h.config().offlinePlacementPending.length,1);assert.equal(h.config().offlinePlacementPending[0].cid,'42');assert.equal(h.ctx.__submissionSyncEvents.length,1);assert.equal(h.ctx.__submissionSyncEvents[0].uid,'123');assert(!h.calls.some(c=>/task_lists|get_user_task|files\/get_info|files\/move/.test(c.url)));
await h.ctx.submitMagnet('cookie',magnet.toUpperCase().replace('MAGNET','magnet'),'42');assert.equal(h.calls.filter(c=>c.url.includes('add_task_url')).length,1);assert.equal(h.config().submitHistory.at(-1).status,'duplicate');assert.equal(h.ctx.__submissionSyncEvents.length,1);
h=harness({invalidFolder:true});await assert.rejects(h.ctx.submitMagnet('cookie',magnet,'42'));assert(!h.calls.some(c=>c.url.includes('add_task_url')));
h=harness({rejected:true});await assert.rejects(h.ctx.submitMagnet('cookie',magnet,'42'),/提交失败/);assert.equal(h.config().submitHistory[0].status,'failed');
h=harness({uncertain:true});await assert.rejects(h.ctx.submitMagnet('cookie',magnet,'42'),/提交结果未确认/);assert.equal(h.config().submitHistory[0].status,'uncertain');assert.equal(h.calls.filter(c=>c.url.includes('add_task_url')).length,1);
h=harness();h.setCookie('changed');await assert.rejects(h.ctx.submitMagnet('cookie',magnet,'42'),/账户已更换/);assert.equal(h.calls.length,0);
assert(!src.includes("ipcMain.handle('sync-offline-status'"));assert(!src.includes("ipcMain.handle('recheck-submission-folder'"));assert(!/set(?:Interval|Timeout)\(checkPendingOfflinePlacements/.test(src));
console.log('本地去重、指定目录直接提交、持久化核对队列、提交时不查询/移动、账户保护、失败和不确定结果验证通过');
})().catch(e=>{console.error(e);process.exit(1)});