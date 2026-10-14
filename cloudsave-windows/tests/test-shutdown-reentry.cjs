const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const block = source.slice(source.indexOf('let quittingAfterFlush ='), source.indexOf("app.on('window-all-closed'"));
const turn = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  let handler, finish, saves = 0, quits = 0, errors = 0, closes = 0;
  let failure = false;
  const module = { close() { closes++; if (failure) throw Error('cleanup failed'); } };
  const context = {
    app: { on(name, callback) { assert.equal(name, 'before-quit'); handler = callback; }, quit() { quits++; const e = event(); handler(e); assert.equal(e.prevented, 0); } },
    jsonStore: { close() { saves++; return new Promise(resolve => { finish = resolve; }); } },
    dialog: { showErrorBox(title, message) { errors++; assert.match(title, /尚未退出/); assert.match(message, /cleanup failed|disk failed/); } },
    shuttingDown: false, customShareParser: null, multiCloudModule: module,
    guangyaModule: null, pan123Monitor: null, share115Monitor: null,
    cloudSyncSchedule: module, cloudSubmitSync: module, browseCache: module,
    scanExportCancelled: false, guanyingMonitor: module, btbtlaMonitor: module,
    btbtlaProvider: null, jyingMonitor: module, jyingProvider: null,
    qmp4Monitor: module, qmp4Provider: null, haisouView: null, guanyingProvider: null,
    monitorTimer: null, filterProbeTimer: null, lifecycleTimers: [], monitorPushTimer: null,
    offlineOperationQueue: null, metadataQueue: null, cloudDownloadCache: {}, guanyingSessionManager: null,
    monitorRunning: false, btbtlaExportRunning: false, jyingExportRunning: false,
    qmp4ExportRunning: false, guanyingExportRunning: false, placementCheckRunning: false,
    batchSubmitRunning: false, scanExportRunning: false, waitResource: turn,
    clearInterval, clearTimeout
  };
  function event() { return { prevented: 0, preventDefault() { this.prevented++; } }; }
  vm.runInNewContext(block, { ...context });
  const first = event(); handler(first); await turn();
  assert.equal(saves, 1); assert.equal(first.prevented, 1);
  const before = closes;
  for (let i = 0; i < 20; i++) { const e = event(); handler(e); assert.equal(e.prevented, 1); }
  await turn(); assert.equal(saves, 1); assert.equal(closes, before);
  finish(); await turn(); assert.equal(quits, 1); assert.equal(errors, 0);

  // A synchronous cleanup failure must be caught, then allow an explicit retry.
  failure = true; saves = 0; quits = 0; vm.runInNewContext(block, { ...context });
  assert.doesNotThrow(() => handler(event())); await turn();
  assert.equal(errors, 1); assert.equal(saves, 0); assert.equal(quits, 0);
  failure = false;
  context.jsonStore.close = async () => { saves++; throw Error('disk failed'); };
  handler(event()); handler(event()); await turn();
  assert.equal(errors, 2); assert.equal(saves, 1); assert.equal(quits, 0);
  context.jsonStore.close = async () => { saves++; };
  handler(event()); await turn(); assert.equal(saves, 2); assert.equal(quits, 1);
  console.log('PASS actual shutdown handler coalesces repeated quits and permits retry after cleanup/write failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
