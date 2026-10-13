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
 let h=harness({fidOnly:true});await h.ctx.submitMagnet('cookie',magnet,'42');assert.equal(h.config().submitHistory[0].status,'success');
 h=harness({noOutput:true});await h.ctx.submitMagnet('cookie',magnet,'42');assert.equal(h.config().submitHistory[0].status,'pending');assert(h.logs.some(item=>String(item).includes('输出文件ID')));assert.equal(h.config().offlinePlacementPending.length,1);
 h=harness();let msg=await h.ctx.submitMagnet('cookie',magnet,'42');assert(msg.includes('已确认'));assert.equal(h.calls.filter(c=>c.url.includes('files/move')).length,1);assert.equal(h.config().submitHistory[0].status,'success');assert.equal(h.config().offlinePlacementPending.length,0);
 h=harness({fileSchema:true});await h.ctx.submitMagnet('cookie',magnet,'42');assert.equal(h.config().submitHistory[0].status,'success');
 h=harness({running:true});msg=await h.ctx.submitMagnet('cookie',magnet,'42');assert(msg.includes('等待核对'));assert.equal(h.config().submitHistory[0].status,'pending');assert(!h.calls.some(c=>c.url.includes('files/move')));
 h=harness({existing:true});msg=await h.ctx.submitMagnet('cookie',magnet,'42');assert(msg.includes('曾经添加过'));assert.equal(h.config().submitHistory[0].status,'duplicate');assert(!h.calls.some(c=>c.url.includes('add_task_url')||c.url.includes('files/move')));
 h=harness({invalidFolder:true});await assert.rejects(h.ctx.submitMagnet('cookie',magnet,'42'));assert(!h.calls.some(c=>c.url.includes('add_task_url')));
 h=harness({rejected:true});await assert.rejects(h.ctx.submitMagnet('cookie',magnet,'42'),/提交失败/);assert.equal(h.config().submitHistory[0].status,'failed');assert(!h.config().offlinePlacementPending);
 h=harness({moveFailure:true});msg=await h.ctx.submitMagnet('cookie',magnet,'42');assert(msg.includes('等待核对'));assert.equal(h.config().submitHistory[0].status,'pending');assert.equal(h.config().offlinePlacementPending.length,1);
 h=harness({uncertain:true});await assert.rejects(h.ctx.submitMagnet('cookie',magnet,'42'),/提交结果未确认/);assert.equal(h.calls.filter(c=>c.url.includes('add_task_url')).length,1);assert.equal(h.config().submitHistory[0].status,'uncertain');
 h=harness({switchBeforeMove:true});msg=await h.ctx.submitMagnet('cookie',magnet,'42');assert(!h.calls.some(c=>c.url.includes('files/move')));assert.equal(h.config().submitHistory[0].status,'pending');
 h=harness({failedTask:true});await assert.rejects(h.ctx.submitMagnet('cookie',magnet,'42'),/离线下载失败/);assert.equal(h.config().submitHistory.length,1);assert.equal(h.config().submitHistory[0].status,'failed');assert.equal(h.config().offlinePlacementPending.length,0);
 h=harness({parent:'99'});msg=await h.ctx.submitMagnet('cookie',magnet,'42');assert(msg.includes('其他目录'));assert.equal(h.config().submitHistory[0].status,'placement_failed');assert(!h.calls.some(c=>c.url.includes('files/move')));
 h=harness();await assert.rejects(h.ctx.submitMagnet('cookie',magnet,undefined));assert(!h.calls.some(c=>c.url.includes('add_task_url')));
 h=harness({running:true});await h.ctx.submitMagnet('cookie',magnet,'42');const resumed=harness({existing:true,initialConfig:h.config()});await resumed.ctx.checkPendingOfflinePlacements();assert.equal(resumed.config().submitHistory[0].status,'success');assert.equal(resumed.config().offlinePlacementPending.length,0); h=harness();h.ctx.apiRequest=async()=>({state:true,data:[{is_dir:1,cid:'0',fid:'101',n:'统一字段目录'},{is_dir:1,cid:'202',fid:'0',n:'网页字段目录'},{fid:'303',cid:'0',n:'文件'}]});const folders=await h.ctx.getFolders('cookie','0');assert.equal(folders.length,2);assert.equal(folders[0].cid,'101');assert.equal(folders[1].cid,'202'); console.log('指定目录校验、根目录纠正、文件/目录字段、重复不移动、下载中待核对、失败响应、账户切换、移动失败与提交超时验证通过');
})().catch(e=>{console.error(e);process.exit(1)});
