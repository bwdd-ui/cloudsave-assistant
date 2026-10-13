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
const magnet = n => 'magnet:?xt=urn:btih:' + n.toString(16).padStart(40, '0');
const movie = id => ({ id: String(id), title: 'Film' + id, year: '2026' });
const seed = (n, size = '2GB', title = 'Version' + n, date = '2026-10-04T10:00:00+08:00') => ({ zname: title, zlink: magnet(n), zsize: size, ezt: date });
const detail = seeds => ({ title: 'Film', niandai: '2026', all_seeds: seeds });
async function test(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failures.push(name + ': ' + e.message); console.error('FAIL ' + name + ': ' + e.stack); } }
(async()=>{
 await test('compareSize switch persists and changes candidate policy',async()=>{
  const h=harness();h.run("bindMonitorAccount('123')");
  h.ctx.raw=detail([seed(1,'8GB'),seed(2,'12GB'),seed(3,'10GB')]);
  h.run("recordSubmitHistory('"+magnet(3)+"','success','confirmed','88',{uid:'123',source:'manual',movieId:'1',selectionKey:'1',size:'10GB'})");
  let r=h.run("selectMonitorCandidates('movie',{id:'1'},raw,monitorConfig().filters)");assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].url,magnet(2));
  await h.handlers['set-monitor']({}, {enabled:true,deferRun:true,filters:{...h.run('monitorConfig().filters'),compareSize:false}});
  r=h.run("selectMonitorCandidates('movie',{id:'1'},raw,monitorConfig().filters)");assert.equal(r.candidates.length,2);assert.equal(new Set(r.candidates.map(v=>v.candidateKey)).size,2);
  h.run('resourceDatabaseCache=undefined');assert.equal(h.run('monitorConfig().filters.compareSize'),false);
  h.ctx.fetchCloudCatalog=async(mode)=>({total:mode==='movie'?1:0,limit:1,items:mode==='movie'?[movie(1)]:[]});h.ctx.fetchMovieDetail=async()=>h.ctx.raw;
  const all=await h.run('scanMonitorCatalog(monitorConfig())');assert.equal(all.length,2);
 });
 await test('larger stored version still prevents smallerwhen missingfromwebsite',async()=>{
  const h=harness();h.run("bindMonitorAccount('123')");h.ctx.record={uid:'123',source:'auto',selectionKey:'1',size:'15GB'};
  h.run("recordSubmitHistory('"+magnet(100)+"','success','ok','88',record)");h.ctx.raw=detail([seed(1,'10GB')]);
  assert.equal(h.run("selectMonitorCandidates('movie',{id:'1'},raw,monitorConfig().filters)").candidates.length,0);
  h.ctx.raw=detail([seed(2,'16GB')]);assert.equal(h.run("selectMonitorCandidates('movie',{id:'1'},raw,monitorConfig().filters)").candidates.length,1);
 });
 await test('television database compares byseasonandepisode',async()=>{
  const h=harness();h.run("bindMonitorAccount('123')");h.ctx.record={uid:'123',source:'manual',selectionKey:'tv:2:S1E1',size:'10GB'};
  h.run("recordSubmitHistory('"+magnet(100)+"','success','ok','88',record)");
  h.ctx.raw=detail([seed(1,'8GB','Show.S01E01'),seed(2,'4GB','Show.S01E02'),seed(3,'9GB','Show.S02E01')]);
  const r=h.run("selectMonitorCandidates('tv',{id:'2'},raw,monitorConfig().filters)");assert.deepEqual(Array.from(r.candidates,v=>v.selectionKey).sort(),['tv:2:S1E2','tv:2:S2E1']);
 });
 await test('all history survives500 rowUIconfig limit and restart',async()=>{
  const h=harness();h.run("bindMonitorAccount('123')");
  for(let n=1;n<=520;n++) {h.ctx.row={uid:'123',source:n%2?'auto':'batch',selectionKey:'1',size:n+'GB'};h.ctx.url=magnet(n);h.run("recordSubmitHistory(url,'pending','accepted','88',row)");}
  assert.equal(h.get().submitHistory.length,500);assert.equal(h.run('submitHistory().length'),520);assert.equal(h.run("resourceDatabaseBestSize('1','123')"),520);
  h.run('resourceDatabaseCache=undefined;resourceDatabaseSizeIndex=undefined');assert.equal(h.run('submitHistory().length'),520);assert.equal(h.run("resourceDatabaseBestSize('1','123')"),520);
 });
 await test('confirmed resource state remainsconfirmed after bestversion saving',async()=>{
  const h=harness();h.run("bindMonitorAccount('123')");h.ctx.url=magnet(1);h.ctx.item={url:h.ctx.url,size:'5GB',selectionKey:'1',movieId:'1'};
  h.run("recordSubmitHistory(url,'success','ok','88',{uid:'123',source:'auto',selectionKey:'1',size:'5GB'});saveMonitorMovieBest(item)");
  assert.equal(h.run("Object.values(resourceDatabase().resources)[0].status"),'success');
 });
 await test('corrupt local database is retained instead of overwritten',async()=>{
  const h=harness();h.run("fs.writeFileSync(RESOURCE_DATABASE_FILE(),'broken','utf8');resourceDatabaseCache=undefined");
  assert.throws(()=>h.run('resourceDatabase()'),/无法读取/);assert.equal(h.run("fs.readFileSync(RESOURCE_DATABASE_FILE(),'utf8')"),'broken');
 });
 console.log('\n'+(6-failures.length)+'/6 database tests passed');if(failures.length)process.exitCode=1;
})();