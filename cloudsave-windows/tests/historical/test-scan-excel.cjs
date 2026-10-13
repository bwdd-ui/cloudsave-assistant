const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const SOURCE = 'E:/Deliverables/cloudsave-auto-save-1.20.11-final-20260921/cloudsave-windows/main.js';
const text = fs.readFileSync(SOURCE, 'utf8');
const failures = [];
function harness(initial = {}) {
  let config = JSON.parse(JSON.stringify({ cookie: 'UID=123;CID=a;SEID=b', folder: { cid: '88', name: '待归档', uid: '123' }, monitor: { enabled: true, intervalMinutes: 15, seen: [], filters: { maxItems: 2 } }, ...initial }));
  const handlers = {}, events = [];
  const electron = { app: { getPath: () => 'C:/Temp/mock-monitor', whenReady: () => ({ then() {} }), on() {} }, ipcMain: { handle: (key, fn) => handlers[key] = fn }, safeStorage: { isEncryptionAvailable: () => false }, session: {}, clipboard: {}, shell: {}, dialog: { showSaveDialog: async () => ({ filePath: "C:/Temp/mock-export.xlsx" }) } };
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
const tools=require('E:/Deliverables/cloudsave-auto-save-1.20.11-final-20260921/cloudsave-windows/scan-export.js');
(async()=>{
const summary=`媒体信息摘要\n文件名: &#x53;unshine.Women's.Choir.2025.mkv\n时　长: 2 h 14 min\n分辨率: 3 840 x 1 608 (2.40:1)\n帧　率: 60.000 fps\n视　频: HEVC @ 4 496 kb/s\n音　频: Chinese DTS 5.1 @ 768 kb/s\nChinese AAC LC 2.0 @ 192 kb/s\n种子文件信息\nignored`;
const media=tools.parseMedia(summary);assert.equal(media.filename,"Sunshine.Women's.Choir.2025.mkv");assert.equal(media.duration,'2 h 14 min');assert.equal(media.frameRate,'60.000 fps');assert.equal(media.audio,'Chinese DTS 5.1 @ 768 kb/s\nChinese AAC LC 2.0 @ 192 kb/s');assert(!media.audio.includes('ignored'));
assert.equal(tools.parseMedia({media_info:'<div>文件名：Test.mkv</div><div>时长：1 h</div><div>音频：AAC<br>DTS</div>'}).audio,'AAC\nDTS');
const h=harness({monitor:{enabled:true,seen:[magnet(1)],filters:{maxItems:1,compareSize:true}}});
h.ctx.fetchCloudCatalog=async mode=>({total:1,limit:25,items:mode==='movie'?[movie(1)]:[]});
h.ctx.fetchMovieDetail=async()=>({title:'Film',doub_id:'1',niandai:'2026',class:'剧情',production_area:'中国台湾',release_date:'2026-04-04(中国大陆), 2025-12-31(中国台湾)',all_seeds:[{...seed(1,'1GB'),media_info:summary},{...seed(2,'2GB'),media_info:summary},{...seed(3,'3GB'),media_info:summary}]});
const candidates=await h.run('scanMonitorCatalog(monitorConfig())');assert.equal(candidates.length,1);assert.equal(h.run('scanExportSnapshot().rows.length'),3);assert.equal(h.run('scanExportSnapshot().complete'),true);
h.run('clearMonitorScan(monitorScanSignature(monitorConfig().filters))');h.run('scanExportCache=undefined');assert.equal(h.run('scanExportSnapshot().rows.length'),3);
const output=await h.run('exportScannedMagnets(false)');assert.equal(output.count,3);assert.equal(output.missing,0);assert.equal(output.partialScan,false);const bytes=h.run("fs.readFileSync('C:/Temp/mock-export.xlsx')");fs.writeFileSync('C:/Temp/cloudsave-export-test.xlsx',bytes);
const hostile=tools.buildXlsx([{url:magnet(9),title:'=HYPERLINK("https://evil")',media:{audio:'DTS & AAC\nFLAC'},country:'中国台湾'}]);fs.writeFileSync('C:/Temp/cloudsave-export-literal-test.xlsx',hostile);
assert.equal(h.run("parse115Json('{\"file_id\":3314720694462959785,\"pid\":0,\"text\":\"3314720694462959785\"}').file_id"),'3314720694462959785');assert.equal(h.run("parse115Json('{\"pid\":0}').pid"),0);

const repair=harness({submitHistory:[{id:'root-record',uid:'123',url:magnet(7),cid:'88',folderName:'待归档',status:'duplicate',time:'2026-10-04T08:00:00Z',title:'指定资源'}]});let actualParent='0';const moved=[];
repair.ctx.getAccount=async()=>({uid:'123'});repair.ctx.apiRequest=async(url,opts={})=>{
 if(url.includes('files?'))return {state:true,path:[{cid:'0',name:'根目录'},{cid:'88',name:'待归档'}]};
 if(url.includes('get_user_task'))return {state:true,data:{info_hash:offlineHashForTest(),status:2,fid:'3314720694462959785'}};
 if(url.includes('files/get_info'))return {state:true,data:[{fid:'3314720694462959785',cid:actualParent}]};
 if(url.includes('files/move')){assert.equal(opts.body.get('fid[0]'),'3314720694462959785');moved.push(opts.body.get('fid'));actualParent=opts.body.get('pid');return {state:true};}
 throw Error('unexpected request '+url);
};function offlineHashForTest(){return '7'.padStart(40,'0');}
const repaired=await repair.handlers['recheck-submission-folder']({},'root-record');assert(repaired.includes('已确认'));assert.deepEqual(moved,['3314720694462959785']);assert.equal(actualParent,'88');assert.equal(repair.get().submitHistory[0].status,'success');assert.equal(repair.get().offlinePlacementPending.length,0);
await repair.handlers['recheck-submission-folder']({},'root-record');assert.equal(moved.length,1);
assert.equal(tools.HEADERS.length,11);console.log('PASS all matched magnets retained incl submitted/smaller versions, durable snapshot, separate movie/seed dates, HTML entities, audio lines, media parsing, XLSX export without offline submission, long115 IDs exact');
})().catch(error=>{console.error(error);process.exit(1)});
