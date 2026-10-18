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
(async () => {
  await test('monitor status exposes current-account pending download and placement checks only', async () => {
    const h = harness({ offlinePlacementPending: [
      { id: 'a', uid: '123', url: magnet(1) },
      { id: 'duplicate-a', uid: '123', url: magnet(1) },
      { id: 'resolved', uid: '123', url: magnet(2) },
      { id: 'other-account', uid: '456', url: magnet(3) }
    ], offlinePlacementResolved: { ['123|magnet:' + '2'.padStart(40, '0')]: { resolution: 'confirmed' } } });
    const current = await h.handlers['get-monitor-state']();
    assert.equal(current.pendingPlacementCount, 1, 'duplicate and resolved entries are excluded and other accounts stay private');
    h.run('pushMonitorStatus(monitorConfig())');
    assert.equal(h.events.at(-1)[1].pendingPlacementCount, 1, 'live monitor updates carry the same count');
    h.patch({ cookie: 'UID=456;CID=a;SEID=b' });
    assert.equal((await h.handlers['get-monitor-state']()).pendingPlacementCount, 1, 'the count follows the active account');
  });
  await test('fatal page detail failure preserves4/resumes currentmovie without redoing pages', async () => {
    const h = harness(); let fail = true; const lists = [], details = [];
    h.ctx.fetchCloudCatalog = async (mode, page) => { lists.push(mode + ':' + page); return mode === 'movie' ? { total: 6, limit: 2, items: [movie(page * 2 - 1), movie(page * 2)] } : { total: 0, limit: 2, items: [] }; };
    h.ctx.fetchMovieDetail = async id => { details.push(id); if (id === '5' && fail) throw Object.assign(Error('site unavailable'), { mirrorsExhausted: true }); return detail(Number(id) <= 4 ? [seed(Number(id))] : []); };
    await assert.rejects(() => h.run('scanMonitorCatalog(monitorConfig())'), /site unavailable/);
    assert.equal(h.get().monitorScan.page, 3); assert.equal(h.get().monitorScan.offset, 0); assert.equal(h.get().monitorScan.candidates.length, 4);
    fail = false;
    const candidates = await h.run('scanMonitorCatalog(monitorConfig())');
    assert.equal(candidates.length, 4); assert.equal(candidates.scanned, 6);
    assert.deepEqual(lists, ['movie:1', 'movie:2', 'movie:3', 'tv:1']);
    assert.deepEqual(details, ['1', '2', '3', '4', '5', '5', '6']);
    assert.equal(h.get().monitorScan.phase, 'complete');
  });
  await test('resume midpage keeps earliermovie result and avoids refetch/reprocessing', async () => {
    const h = harness(); let fail = true; const ids = [], lists = [];
    h.ctx.fetchCloudCatalog = async (mode, page) => { lists.push(mode + ':' + page); return mode === 'movie' ? { total: 3, limit: 3, items: [movie(1), movie(2), movie(3)] } : { total: 0, limit: 3, items: [] }; };
    h.ctx.fetchMovieDetail = async id => { ids.push(id); if (id === '2' && fail) throw Object.assign(Error('429'), { noMirrorRetry: true }); return detail([seed(Number(id))]); };
    await assert.rejects(() => h.run('scanMonitorCatalog(monitorConfig())'), /429/);
    assert.equal(h.get().monitorScan.offset, 1); assert.equal(h.get().monitorScan.candidates.length, 1);
    fail = false; const found = await h.run('scanMonitorCatalog(monitorConfig())');
    assert.equal(found.length, 3); assert.deepEqual(ids, ['1','2','2','3']); assert.deepEqual(lists,['movie:1','tv:1']);
  });
  await test('film andseason/episode maximum, equal/smaller skips, strictlylarger upgrades', async () => {
    const h = harness(); h.run("bindMonitorAccount('123')");
    h.ctx.raw = detail([seed(1,'1GB'),seed(2,'3GB')]);
    let result = h.run("selectMonitorCandidates('movie',{id:'1',title:'Film'},raw,monitorConfig().filters)");
    assert.equal(result.candidates.length,1); assert.equal(result.candidates[0].url,magnet(2));
    h.ctx.item = result.candidates[0]; h.run('saveMonitorMovieBest(item)');
    assert.equal(h.run("selectMonitorCandidates('movie',{id:'1'},raw,monitorConfig().filters)").candidates.length,0);
    h.ctx.raw = detail([seed(3,'4GB')]); assert.equal(h.run("selectMonitorCandidates('movie',{id:'1'},raw,monitorConfig().filters)").candidates.length,1);
    h.ctx.raw = detail([seed(10,'1GB','Drama.S01E01'),seed(11,'3GB','Drama.S01E01'),seed(12,'2GB','Drama.S01E02'),seed(13,'5GB','Drama.S02E01'),seed(14,'50GB','Drama.S01全集')]);
    result=h.run("selectMonitorCandidates('tv',{id:'2'},raw,monitorConfig().filters)");
    assert.equal(result.candidates.length,3); assert.equal(result.unrecognized,1); assert.deepEqual(Array.from(result.candidates,c=>c.selectionKey).sort(),['tv:2:S1E1','tv:2:S1E2','tv:2:S2E1']);
    assert.equal(result.candidates.find(c=>c.selectionKey==='tv:2:S1E1').url,magnet(11));
  });
  await test('onlyCloud acceptsproviderobject withoutwp_num', async () => {
    const h=harness(); h.ctx.raw = { ...detail([seed(1)]), movies_online_seed:{'115':[{link:'https://115.com/s/test'}]} };
    assert.equal(h.run("matchesMonitorFilters({size:'2GB',date:'2026-10-04'},raw,{...monitorConfig().filters,onlyCloud:true})"),true);
    h.ctx.raw=detail([seed(1)]); assert.equal(h.run("matchesMonitorFilters({size:'2GB'},raw,{...monitorConfig().filters,onlyCloud:true})"),false);
  });
  await test('account switch isolatesseen/best andrestoresprevious account', async()=>{
    const h=harness(); h.run("bindMonitorAccount('123')"); h.ctx.item={movieId:'1',size:'3GB',url:magnet(1)}; h.run('saveMonitorMovieBest(item);saveMonitor({seen:[magnetKey(item.url)]})');
    h.run("bindMonitorAccount('456')"); assert.equal(h.get().monitor.seen.length,0); assert.equal(Object.keys(h.get().monitorMovieBest).length,0);
    h.run("bindMonitorAccount('123')"); assert.equal(h.get().monitor.seen.length,1); assert.equal(h.get().monitorMovieBest['1'].sizeGB,3);
  });
  await test('quota countsnewacceptances, duplicate/error do not usequota, summaryfailures',async()=>{
    const h=harness(); h.ctx.getAccount=async()=>({uid:'123'}); h.ctx.validateSaveFolder=async(_,folder)=>folder; const submitted=[];
    h.ctx.fetchCloudCatalog=async mode=>({total: mode==='movie'?4:0,limit:4,items:mode==='movie'?[1,2,3,4].map(movie):[]});
    h.ctx.fetchMovieDetail=async id=>detail([seed(Number(id),'2GB','Version'+id,'2026-10-0'+(5-Number(id))+'T10:00:00+08:00')]);
    h.ctx.submitMagnet=async(c,url,cid,name,context)=>{submitted.push([url,context.source]); if(url===magnet(1))return '该磁力曾经添加过';if(url===magnet(2))throw Error('ordinary error');return '115已接受任务';};
    const result=await h.run('runMonitor(true)'); assert.equal(result.saved,2); assert.equal(result.submissionFailures,1); assert.equal(result.duplicates,1); assert.equal(result.error,true);assert.equal(submitted.length,4);assert.equal(submitted.every(s=>s[1]==='auto'),true);assert.match(result.lastMessage,/提交失败或待确认 1 条/);assert.match(result.lastMessage,/提交成功不代表已下载到目标目录/);assert.match(result.lastMessage,/核对下载状态和实际保存目录/);assert.match(h.get().monitor.lastMessage,/提交成功不代表已下载到目标目录/);
    assert.equal(h.get().monitorScan.phase,'complete');
  });
  await test('turnoff duringdetail preventsauto submissionandpreservescheckpoint',async()=>{
    const h=harness();h.ctx.getAccount=async()=>({uid:'123'});h.ctx.validateSaveFolder=async(_,f)=>f;let submissions=0;
    h.ctx.fetchCloudCatalog=async()=>({total:1,limit:1,items:[movie(1)]});h.ctx.fetchMovieDetail=async()=>{h.run('saveMonitor({enabled:false})');return detail([seed(1)]);};h.ctx.submitMagnet=async()=>{submissions++;};
    const result=await h.run('runMonitor(false)');assert.equal(submissions,0);assert.equal(result.error,false);assert.match(result.lastMessage,/监控已关闭/);assert.equal(h.get().monitorScan.offset,0);
  });
  await test('filterchangeduringdetail stops submission',async()=>{
    const h=harness();h.ctx.getAccount=async()=>({uid:'123'});h.ctx.validateSaveFolder=async(_,f)=>f;let submissions=0;
    h.ctx.fetchCloudCatalog=async()=>({total:1,limit:1,items:[movie(1)]});h.ctx.fetchMovieDetail=async()=>{h.run("saveMonitor({filters:{...monitorConfig().filters,years:['2020']}})");return detail([seed(1)]);};h.ctx.submitMagnet=async()=>{submissions++;};
    const result=await h.run('runMonitor(true)');assert.equal(submissions,0);assert.match(result.lastMessage,/筛选条件/);
  });
  await test('backgroundfailed larger restoresoldersuccessfulsizebaseline',async()=>{
    const h=harness();h.run("bindMonitorAccount('123')");h.ctx.item={movieId:'1',size:'3GB',url:magnet(1)};h.run('saveMonitorMovieBest(item)');h.ctx.item={movieId:'1',size:'5GB',url:magnet(2)};h.run('saveMonitorMovieBest(item);saveMonitor({seen:[magnetKey(item.url)]})');
    h.ctx.entry={uid:'123',url:magnet(2),cid:'88',id:'entry',historyTime:'t'};h.ctx.findOfflineTask=async()=>({status:-1});
    await assert.rejects(()=>h.run('reconcileOfflinePlacement(loadCookie(),entry)'),/离线下载失败/);
    assert.equal(h.get().monitorMovieBest['1'].sizeGB,3);assert.equal(h.get().monitorSavedVersions['1'].length,1);assert.equal(h.get().monitor.seen.length,0);
  });
  await test('laterfailure cancelsduplicatehistorydedup forsamehash',async()=>{
    const h=harness();h.run("bindMonitorAccount('123')");h.ctx.url=magnet(1);h.run("recordSubmitHistory(url,'pending','accepted','88',{uid:'123'});recordSubmitHistory(url,'duplicate','clicked again','88',{uid:'123'})");const initial=h.get();initial.submitHistory[1].time=new Date(Date.parse(initial.submitHistory[0].time)+1000).toISOString();h.set(initial);
    h.ctx.entry={uid:'123',url:magnet(1),cid:'88',id:'entry',historyTime:h.get().submitHistory[0].time};h.ctx.findOfflineTask=async()=>({status:-1});
    await assert.rejects(()=>h.run('reconcileOfflinePlacement(loadCookie(),entry)'),/离线下载失败/);
    assert.equal(h.run('monitorSeenKeys().has(magnetKey(url))'),false);
  });
  console.log('\n'+(10-failures.length)+'/10 passed');if(failures.length){console.log(failures.join('\n'));process.exitCode=1;}
})();
