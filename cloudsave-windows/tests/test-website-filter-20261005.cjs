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
await test('mixed-year page rejected before requesting details',async()=>{const h=harness({monitor:{enabled:true,filters:{years:['2023']}}});let details=0;h.ctx.fetchCloudCatalog=async()=>({total:2,limit:2,items:[{id:'1',year:'2023'},{id:'2',year:'2026'}]});h.ctx.fetchMovieDetail=async()=>{details++;return {};};await assert.rejects(()=>h.run('scanMonitorCatalog(monitorConfig())'),error=>error.filterRejected===true);assert.equal(details,0);});
await test('permanent year mismatch does not loop on automatic timer, manual can retry',async()=>{const h=harness({monitor:{enabled:true,filters:{years:['2023']}}});let scans=0;h.ctx.getAccount=async()=>({uid:'123'});h.ctx.validateSaveFolder=async()=>({cid:'88',name:'待归档'});h.ctx.scanMonitorCatalog=async()=>{scans++;throw Object.assign(Error('year mismatch'),{filterRejected:true});};await h.run('runMonitor(false)');assert.equal(scans,1);assert.ok(h.get().monitor.filterBlockedSignature);assert.equal(h.get().monitor.nextRetryAt,'');await h.run('runMonitor(false)');assert.equal(scans,1);await h.run('runMonitor(true)');assert.equal(scans,2);});
await test('ad files excluded but ordinary unknown video still reviewed',async()=>{const h=harness();h.ctx.raw={files:[{name:'Show.S01E01.mkv (1GB)'},{name:'我的电影网站我的电影网站.mkv (1.9MB)'},{name:'unknown-video.mkv (1.9MB)'}]};const x=h.run("episodeFileInformation(raw,'Show.S01E01',{})");assert.deepEqual(Array.from(x.keys),['S1E1']);assert.equal(x.unresolved.length,1);assert.match(x.unresolved[0].name,/unknown-video/);});
await test('website log provenance explicit and old logs remain compatible',async()=>{const h=harness();h.run("appendMonitorLog('gy check','info','','guanying')");assert.equal(h.get().monitor.logs.at(-1).website,'guanying');h.run("appendMonitorLog('bt check')");assert.equal(h.get().monitor.logs.at(-1).website,'butailing');});
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
})();