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


const {GuanyingProvider,catalogPath}=require(require('path').resolve(__dirname,'../guanying-provider'));
const {normalizeOptions,legacyFilters}=require(require('path').resolve(__dirname,'../guanying-monitor'));
(async()=>{
const url=new URL(catalogPath('mv',1,{year:['2026','2025'],genre:['剧情','喜剧']}),'https://www.xn--wcv59z.com');assert.equal(url.searchParams.get('year'),'2026_2025');assert.equal(url.searchParams.get('genres'),'1');assert.deepEqual(legacyFilters(normalizeOptions({year:['2026','2025']})).years,['2026','2025']);
const provider=new GuanyingProvider({});let unblock;const order=[];const first=provider.enqueue(()=>new Promise(resolve=>{unblock=()=>{order.push('current');resolve();};}),0);const bg=provider.enqueue(async()=>order.push('background'),0),ui=provider.enqueue(async()=>order.push('library'),10);unblock();await Promise.all([first,bg,ui]);assert.deepEqual(order,['current','library','background']);let searchPath;provider.read=async path=>{searchPath=path;return {items:[]};};await provider.catalog('mv',2,{search:'大唐妖探'});assert.equal(new URL(searchPath,'https://www.xn--wcv59z.com').searchParams.get('q'),'大唐妖探');assert.equal(new URL(searchPath,'https://www.xn--wcv59z.com').searchParams.get('page'),'2');provider.close();await assert.rejects(provider.enqueue(async()=>{},0));
console.log('PASS native multi-year/type, foreground priority, real search URL, shutdown queue');
const h=harness();h.run("bindMonitorAccount('123')");const magnet='magnet:?xt=urn:btih:'+ 'a'.repeat(40);h.ctx.entry={uid:'123',url:magnet,movieId:'1',title:'Show S01E01-E02',size:'10GB'};h.run("mergeDatabaseResource(resourceDatabase(),entry,'pending');writeResourceDatabase(resourceDatabase())");let calls=0;h.ctx.apiRequest=async()=>{calls++;throw Error('must not request accepted seed');};h.ctx.detail={title:'Show',all_seeds:[{id:10,zname:'Show S01E01-E02',zlink:magnet,zsize:'10GB'}]};await h.run("inspectTelevisionFiles({id:'1',title:'Show'},detail,monitorConfig().filters)");assert.equal(calls,0);console.log('PASS accepted local magnet skipped before remote torrent file inspection');
let ticks=0;h.ctx.setInterval=(callback)=>{ticks++;h.ctx.tick=callback;return ticks;};h.run('scheduleMonitor()');await h.handlers['set-monitor'](null,{enabled:true,intervalMinutes:15,deferRun:true,filters:{years:['2026']}});assert.equal(ticks,1);await h.handlers['set-monitor'](null,{enabled:true,intervalMinutes:7,deferRun:true});assert.equal(ticks,2);assert(h.handlers['get-monitor-state']().nextCheckAt);console.log('PASS filter saves preserve timer, interval changes reschedule, next trigger exposed');
const stopped=harness();stopped.ctx.getAccount=async()=>{await stopped.handlers['stop-monitor']();return {uid:'123'};};const stoppedResult=await stopped.run('runMonitor(true)');assert(stoppedResult.lastMessage.includes('已停止扫描'));assert.equal(stoppedResult.error,false);assert.equal(stopped.run('monitorRunning'),false);console.log('PASS stopping active scan exits cleanly without submission');
const dated=harness();dated.ctx.apiRequest=async()=>({success:true,code:200,data:{list:[{doub_id:1,title:'Wrong year',niandai:'2025'}],total:1,limit:20}});let detailCalls=0;dated.ctx.fetchCloudDetail=async()=>{detailCalls++;throw Error('must not fetch wrong year detail');};await assert.rejects(dated.run("fetchCloudCatalog('movie',1,{years:'2026',withinDays:1,strictCatalog:true})"),e=>e.filterRejected);assert.equal(detailCalls,0);console.log('PASS native year validation before date/detail scan, no full-library fallback');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
