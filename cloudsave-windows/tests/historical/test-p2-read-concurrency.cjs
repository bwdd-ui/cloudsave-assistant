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
 const h=harness({parent:'42'}); const tasks=[];
 for(let i=1;i<=30;i++){const hash=i.toString(16).padStart(40,'0'),url='magnet:?xt=urn:btih:'+hash;const row=h.ctx.recordSubmitHistory(url,'pending','accepted','42',{uid:'123'});h.ctx.savePendingOffline({id:'q'+i,historyId:row.id,uid:'123',url,cid:'42',name:'待归档'});tasks.push({info_hash:hash,status:2,file_id:'888'});}
 const original=h.ctx.apiRequest;let active=0,max=0,reads=0;h.ctx.apiRequest=async(url,opt)=>{if(url.includes('task_lists'))return{state:true,tasks,page_count:1};if(url.includes('get_info')){reads++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,25));active--;return original(url,opt);}return original(url,opt);};
 const start=Date.now();const result=await h.ctx.checkPendingOfflinePlacements(true);const elapsed=Date.now()-start;assert.equal(max,2);assert.equal(result.saved,30);assert.equal(reads,30);assert(elapsed<2000);assert.equal(h.config().offlinePlacementPending.length,0);
 const missing=harness({parent:'42'});const row=missing.ctx.recordSubmitHistory(magnet,'pending','accepted','42',{uid:'123'});missing.ctx.savePendingOffline({id:'missing',historyId:row.id,uid:'123',url:magnet,cid:'42',name:'待归档'});let missingReads=0;missing.ctx.apiRequest=async url=>url.includes('task_lists')?{state:true,tasks:[{info_hash:'a'.repeat(40),status:2,file_id:'888'}],page_count:1}:url.includes('get_info')?(missingReads++,{state:false,msg:'文件（夹）不存在或已经删除。'}):{state:true};await missing.ctx.checkPendingOfflinePlacements(true);assert.equal(missing.config().submitHistory[0].status,'placement_failed');assert.equal(missing.config().offlinePlacementPending.length,0);await missing.ctx.checkPendingOfflinePlacements(true);assert.equal(missingReads,1);
 console.log('PASS 30 completed tasks, max 2 concurrent reads, '+elapsed+'ms with 25ms mock latency, file moves remain serialized, missing-output records stop repeat queries');
})().catch(e=>{console.error(e);process.exit(1)});
