const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const SOURCE = 'E:/Deliverables/cloudsave-auto-save-1.20.11-final-20260921/cloudsave-windows/main.js';
const text = fs.readFileSync(SOURCE, 'utf8');
const failures = [];
function harness(initial = {}) {
  let config = JSON.parse(JSON.stringify({ cookie: 'UID=123;CID=a;SEID=b', folder: { cid: '88', name: '待归档', uid: '123' }, monitor: { enabled: true, intervalMinutes: 15, seen: [], filters: { maxItems: 2 } }, ...initial }));
  const handlers = {}, events = [];
  const electron = { app: { getPath: () => 'C:/Temp/mock-monitor', whenReady: () => ({ then() {} }), on() {} }, ipcMain: { handle: (key, fn) => handlers[key] = fn }, safeStorage: { isEncryptionAvailable: () => false }, session: {}, clipboard: {}, shell: {} };
  const files = {}; const mockFs = { readFileSync: p => String(p).endsWith('config.json') ? JSON.stringify(config) : files[p], writeFileSync: (p, content) => {if(String(p).endsWith('config.json'))config=JSON.parse(content);else files[p]=content;}, renameSync(a,b){files[b]=files[a];delete files[a];}, mkdirSync() {}, existsSync: p => p in files };
  const ctx = vm.createContext({ require: key => key.endsWith('scan-export.js') ? require('E:/Deliverables/cloudsave-auto-save-1.20.11-final-20260921/cloudsave-windows/scan-export.js') : key === 'electron' ? electron : key === 'fs' ? mockFs : require(key), process: { platform: 'win32' }, Buffer, URL, URLSearchParams, Date, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, console, __dirname: 'C:/Temp/mock-monitor', fetch: () => { throw Error('NETWORK DISALLOWED'); } });
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
(async () => {
const h=harness({monitor:{enabled:true,seen:[],filters:{years:['2019','2020'],genres:['剧情','动作'],maxItems:2}}});
const requests=[],detailIds=[];
h.ctx.fetchCloudCatalog=async(mode,page,query)=>{requests.push({mode,page,query});return {total:1,limit:25,items:mode==='movie'?[{id:query.years,title:'Film',year:query.years}]:[]};};
h.ctx.fetchMovieDetail=async id=>{detailIds.push(id);return {title:'Film',niandai:id,class:'剧情',all_seeds:[]};};
await h.run('scanMonitorCatalog(monitorConfig())');assert.equal(requests.length,8);assert(requests.every(x=>['2019','2020'].includes(x.query.years)&&['剧情','动作'].includes(x.query.genres)));assert.equal(detailIds.length,2);assert.equal(h.get().monitorScan.version,4);
const decade=h.run("monitorCatalogQueries({years:['90年代']})");assert.equal(decade.length,10);assert.equal(decade[0].years,'1990');assert.equal(decade[9].years,'1999');
assert.equal(h.run("originalMovieUrl('', '123')"),'https://www.0bt0.com/mv/123');assert.equal(h.run("originalMovieUrl('/mv/456', '123')"),'https://www.0bt0.com/mv/456');assert.equal(h.run("originalMovieUrl('https://www.1bt0.com/mv/123?x=1', '123')"),'https://www.0bt0.com/mv/123?x=1');assert.equal(h.run("originalMovieUrl('https://www.0bt0.com/', '123')"),'https://www.0bt0.com/mv/123');assert.equal(h.run("originalMovieUrl('https://example.org/', '123')"),'https://www.0bt0.com/mv/123');
const qh=harness();let requestURL='';qh.ctx.apiRequest=async url=>{requestURL=url;return {success:true,code:200,data:{list:[],total:0,limit:25}}};await qh.run("fetchCloudCatalog('movie',1,{strictCatalog:true,years:'2019',genres:'剧情',countries:'美国',qualities:'WEB-4K',tags:'热门'})");const args=new URL(requestURL).searchParams;assert.equal(args.get('se'),'2019');assert.equal(args.get('sc'),'剧情');assert.equal(args.get('sd'),'美国');assert.equal(args.get('sf'),'WEB-4K');assert.equal(args.get('sh'),'热门');
const ignored=harness({monitor:{enabled:true,seen:[],filters:{years:['2019']}}});ignored.ctx.fetchCloudCatalog=async()=>({total:70000,limit:25,items:[{id:'123',year:'2026'}]});ignored.ctx.fetchMovieDetail=async()=>{throw Error('must not scan unrelated detail')};await assert.rejects(ignored.run('scanMonitorCatalog(monitorConfig())'),/未按年份/);
console.log('PASS multi-select filtered requests, deduplication, decade expansion, API query mapping, ignored-year stop, current movie original URL and relative/mirror URLs');
})().catch(error=>{console.error(error);process.exit(1)});
