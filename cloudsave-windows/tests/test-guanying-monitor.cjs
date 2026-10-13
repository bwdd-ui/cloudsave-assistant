const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const SOURCE = require('path').resolve(__dirname,'../main.js');
const text = fs.readFileSync(SOURCE, 'utf8');
const failures = [];
function harness(initial = {}) {
  let config = JSON.parse(JSON.stringify({ cookie: 'UID=123;CID=a;SEID=b', folder: { cid: '88', name: '待归档', uid: '123' }, monitor: { enabled: true, intervalMinutes: 15, seen: [], filters: { maxItems: 2 } }, ...initial }));
  const handlers = {}, events = [];
  const electron = { app: { getPath: () => 'C:/Temp/mock-monitor', whenReady: () => ({ then() {} }), on() {} }, ipcMain: { handle: (key, fn) => handlers[key] = fn }, safeStorage: { isEncryptionAvailable: () => false }, session: {}, clipboard: {}, shell: {} };
  const files = {}; const mockFs = { readFileSync: p => String(p).endsWith('config.json') ? JSON.stringify(config) : files[p], writeFileSync: (p, content) => {if(String(p).endsWith('config.json'))config=JSON.parse(content);else files[p]=content;}, renameSync(a,b){files[b]=files[a];delete files[a];}, mkdirSync() {}, existsSync: p => p in files };
  const ctx = vm.createContext({ require: key => key.endsWith('scan-export.js') ? require(require('path').resolve(__dirname,'../scan-export.js')) : key === 'electron' ? electron : key === 'fs' ? mockFs : require('module').createRequire(SOURCE)(key), process: { platform: 'win32' }, Buffer, URL, URLSearchParams, Date, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, console, __dirname: 'C:/Temp/mock-monitor', fetch: () => { throw Error('NETWORK DISALLOWED'); } });
  vm.runInContext(text, ctx, { filename: SOURCE });
  ctx.__events = events;
  vm.runInContext(`mainWindow = { isDestroyed: () => false, webContents: { send: (...args) => __events.push(args) } };`, ctx);
  return { ctx, handlers, events, run: code => vm.runInContext(code, ctx), get: () => config, set: value => config = JSON.parse(JSON.stringify(value)), patch: patch => config = { ...config, ...patch } };
}

const {GuanyingMonitor,legacyFilters}=require(require('path').resolve(__dirname,'../guanying-monitor'));
const {catalogPath,idFromPath,pathFromId,publishDay}=require(require('path').resolve(__dirname,'../guanying-provider'));
(async()=>{
 assert.equal(catalogPath('mv',2,{year:'2026',genre:'喜剧',sort:'uptime',withinDays:7,res:'磁力'}),'/mv?genre=%E5%96%9C%E5%89%A7&year=2026&sort=uptime&res=%E7%A3%81%E5%8A%9B&trange=7&timetype=uptime&page=2');
 assert.equal(idFromPath('/tv/ABC12'),'gy:tv:ABC12');assert.equal(pathFromId('gy:tv:ABC12'),'/tv/ABC12');assert.throws(()=>idFromPath('https://evil.example/mv/ABC12'));
 assert.equal(publishDay('昨天',new Date(2026,9,6,12)),'2026-10-05');
 console.log('PASS actual native query, origin restrictions, film namespace, relative calendar dates');
 const h=harness();h.run("bindMonitorAccount('123')");h.ctx.candidate={uid:'123',url:'magnet:?xt=urn:btih:'+ 'a'.repeat(40),movieId:'gy:mv:bLWyx',title:'Movie',size:'10GB'};
 h.run("mergeDatabaseResource(resourceDatabase(),candidate,'scanned');writeResourceDatabase(resourceDatabase())");
 h.ctx.getAccount=async()=>({uid:'123'});h.ctx.validateSaveFolder=async()=>({cid:'88',name:'待归档'});let posts=0;h.ctx.apiRequest=async()=>{posts++;return {state:true};};
 await h.run("submitMagnet(loadCookie(),candidate.url,'88','待归档',candidate)");assert.equal(posts,1);await h.run("submitMagnet(loadCookie(),candidate.url,'88','待归档',candidate)");assert.equal(posts,1);assert.equal(h.run('submitHistory().at(-1).status'),'duplicate');
 console.log('PASS cached-only item is submitted; accepted local item skips remote POST');
 let config={monitorAccountUid:'123',guanyingMonitor:{enabled:true,intervalMinutes:15,options:{categories:['mv','tv','ac'],year:'2026',maxItems:1250}}},snapshot={signature:'',rows:[],complete:false},seen=new Set(),calls=[],saved=0;
 const deps={readConfig:()=>config,writeConfig:value=>config=value,uid:()=>config.monitorAccountUid,sessionStamp:()=>'',cookie:()=> 'UID=123;',account:async()=>({uid:'123'}),bindAccount:()=>{},validateFolder:async()=>{},folder:()=>({cid:'88',name:'待归档'}),shuttingDown:()=>false,readSnapshot:()=>snapshot,writeSnapshot:value=>snapshot=value,log:()=>{},publish:()=>{},inspectFiles:async()=>{},capture:(movie,detail,filters,snap)=>{snap.rows.push({url:movie.id});},select:(mode,movie)=>({candidates:[{key:movie.id,url:movie.id,title:movie.id}]}),seen:()=>seen,submit:async(_cookie,url,cid)=>{calls.push(['submit',url,cid]);saved++;return '115已接受提交';},remember:item=>seen.add(item.key),provider:()=>({catalog:async(category,page,filters)=>{calls.push(['catalog',category,page,filters]);return {items:[{id:'gy:'+category+':abc',title:'Film',year:'2026'}],hasNext:false};},detail:async id=>{calls.push(['detail',id]);return {website:'guanying'};}})};
 const monitor=new GuanyingMonitor(deps);assert.equal(monitor.state().options.maxItems,1250);await monitor.run(true);assert.equal(saved,3);assert.equal(snapshot.complete,true);assert(calls.findIndex(x=>x[0]==='submit')<calls.findIndex(x=>x[0]==='catalog'&&x[1]==='tv'));assert.equal(config.guanyingScan,undefined);assert(calls.filter(x=>x[0]==='catalog').every(x=>x[3].year==='2026'&&x[3].res==='磁力'));
 console.log('PASS native filters before details, movie/tv/anime all scanned, streamed submission, specified folder, 1250 quota');
 await monitor.run(true);assert.equal(saved,3);console.log('PASS completed scan can revisit updates without repeating local submissions');
 config.guanyingMonitor.options.maxItems=1;seen.clear();calls=[];saved=0;await monitor.run(true);assert.equal(saved,1);assert(config.guanyingScan);await monitor.run(true);assert.equal(saved,2);console.log('PASS quota interruption preserves unsubmitted title and resumes');
 deps.provider=()=>({catalog:async()=>({items:[{id:'gy:mv:abc',year:'2020'}]}),detail:async()=>{throw Error('must not fetch');}});config.guanyingMonitor.options.year='2023';await monitor.run(true);assert(config.guanyingMonitor.blockedSignature);const before=config.guanyingMonitor.lastRun;await monitor.run(false);assert.equal(config.guanyingMonitor.lastRun,before);console.log('PASS ignored native year pauses automatically before detail fetch');
 monitor.close();
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
