// Run with the project's Electron executable. Uses an isolated temporary Data
// directory, synthetic covers and no real cloud credentials or transfers.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudsave-ui-smoke-'));
process.env.CLOUDSAVE_STORAGE_ROOT = root;
global.fetch = async () => { throw Error('Smoke test: network disabled'); };
const output = process.env.CLOUDSAVE_TEST_OUTPUT || root;
app.on('browser-window-created', (_event, win) => win.hide());
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (_event, ...args) => console.log('Renderer:', ...args)));
require('../main.js');
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
  const deadline = Date.now() + 30000; let win;
  while (Date.now() < deadline) {
    win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
    if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript("document.readyState === 'complete' && document.querySelectorAll('script[src]').length > 0")) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(win, 'Application window');
  const dom = await win.webContents.executeJavaScript(`({api:typeof window.cloudsave,ui:typeof window.cloudsaveUI,nav:document.body.innerText.includes('不太灵'),errors:document.querySelectorAll('script[src]').length})`);
  console.log('DOM:', JSON.stringify(dom)); assert.equal(dom.api, 'object'); assert.equal(dom.ui, 'object'); assert(dom.nav);
  const expectedVersion=require('../package.json').version;
  for(let attempt=0;attempt<30;attempt++){if(await win.webContents.executeJavaScript("document.querySelector('.workspace-version')?.textContent") === 'v'+expectedVersion)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('.workspace-version')?.textContent"),'v'+expectedVersion);
  const fixture = new BrowserWindow({ show: false, width: 900, height: 600, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } });
  await fixture.loadURL('data:text/html,<div id="grid"></div>');
  fixture.setPosition(-20000, 0); fixture.showInactive();
  const helper = fs.readFileSync(path.join(__dirname, '../ui-runtime.js'), 'utf8');
  await fixture.webContents.executeJavaScript(`window.calls=0;window.clicked=0;window.cloudsave={posterData:async()=>{calls++;return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="teal"/></svg>');}};document.getElementById('grid').innerHTML=Array.from({length:20},(_,i)=>'<article class="cloud-poster-card" style="height:300px"><img data-poster-url="https://smoke.invalid/'+i+'.png" alt="测试"><div class="cloud-poster-title">测试 '+i+'</div></article>').join('');document.querySelector('.cloud-poster-card').onclick=()=>clicked++;void 0;`);
  await fixture.webContents.executeJavaScript(helper);
  await fixture.webContents.executeJavaScript(`cloudsaveUI.posters(document.getElementById('grid'));document.querySelector('.cloud-poster-card').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  await new Promise(resolve => setTimeout(resolve, 500));
  const lazy = await fixture.webContents.executeJavaScript(`({calls,clicked,role:document.querySelector('.cloud-poster-card').getAttribute('role')})`);
  console.log('Covers:', JSON.stringify(lazy)); assert(lazy.calls > 0 && lazy.calls < 20, 'Off-screen covers must not load'); assert.equal(lazy.clicked, 1); assert.equal(lazy.role, 'button');
  await fixture.webContents.executeJavaScript('window.scrollTo(0,4000)'); await new Promise(resolve => setTimeout(resolve, 500));
  assert(await fixture.webContents.executeJavaScript('calls') > lazy.calls, 'Scrolling starts new covers'); fixture.destroy();
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'desktop-ui.png'), (await win.webContents.capturePage()).toPNG());
  // Exercise the task overview at different desktop window widths.
  await win.webContents.executeJavaScript("document.getElementById('showOfflineTasks').click();void 0;");
  assert(await win.webContents.executeJavaScript("!document.querySelector('.offline-episode-disclosure').open && document.querySelector('.offline-episode-disclosure').contains(document.getElementById('offlineEpisodeSave'))"));
  for (const width of [1500, 1040, 800]) {
    win.setSize(width, 900); await new Promise(resolve => setTimeout(resolve, 120));
    const overview = await win.webContents.executeJavaScript(`(() => {
      const page=document.getElementById('offlineTasksPage'),card=document.querySelector('.offline-sync-card');
      return {cloud:card.contains(document.getElementById('cloudDownloadCounts')),controls:card.contains(document.getElementById('cloudSyncSave')),history:document.querySelector('.offline-history-tools').contains(document.getElementById('submitHistorySource')),unique:document.querySelectorAll('#cloudSyncSave').length===1,overflow:page.scrollWidth-page.clientWidth,columns:getComputedStyle(document.querySelector('.offline-overview')).gridTemplateColumns.split(' ').length};
    })()`);
    assert(overview.cloud && overview.controls && overview.history && overview.unique);
    assert(overview.overflow <= 1, 'Offline task page must not overflow at '+width+'px');
    assert.equal(overview.columns, width > 1250 ? 2 : 1);
  }
  fs.writeFileSync(path.join(output,'offline-layout.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(1440,900);
  // Validate actual rendering/paging with an isolated, mixed-year catalogue.
  const {ipcMain}=require('electron'),{FilteredLibraryPages}=require('../filtered-library-pages'),filtered=new FilteredLibraryPages();
  // Exercise manual-sync feedback through actual renderer/IPC with synthetic responses.
  let rejectSync;let fixtureSyncState={enabled:true,running:false,syncedAt:Date.now()-1000,intervalMinutes:60};
  ipcMain.removeHandler('cloud-download-state');ipcMain.handle('cloud-download-state',()=>fixtureSyncState);
  ipcMain.removeHandler('sync-cloud-downloads');ipcMain.handle('sync-cloud-downloads',()=>new Promise((_resolve,reject)=>{rejectSync=reject;}));
  await win.webContents.executeJavaScript("globalThis.syncFeedbackPromise=runCloudDownloadSync('full');renderCloudSyncStatus();void 0;");
  for(let n=0;n<30&&!rejectSync;n++)await new Promise(r=>setTimeout(r,20));assert(rejectSync);
  assert((await win.webContents.executeJavaScript("document.getElementById('cloudDownloadSyncStatus').textContent")).includes('正在全部同步'));
  rejectSync(Error('合成同步失败，请稍后重试'));await win.webContents.executeJavaScript('syncFeedbackPromise');await new Promise(r=>setTimeout(r,1200));
  assert((await win.webContents.executeJavaScript("document.getElementById('cloudDownloadSyncStatus').textContent")).includes('合成同步失败，请稍后重试'));
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('cloudSyncNow').disabled"),false);
  fs.writeFileSync(path.join(output,'sync-feedback.png'),(await win.webContents.capturePage()).toPNG());
  ipcMain.removeHandler('sync-cloud-downloads');ipcMain.handle('sync-cloud-downloads',()=>fixtureSyncState={...fixtureSyncState,syncedAt:Date.now(),progress:{phase:'complete'}});
  await win.webContents.executeJavaScript("runCloudDownloadSync('incremental')");
  assert(!(await win.webContents.executeJavaScript("document.getElementById('cloudDownloadSyncStatus').textContent")).includes('合成同步失败'));
  // Local history search filters all loaded records before UI pagination.
  await win.webContents.executeJavaScript("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{globalThis.syntheticCopiedLinks=text;}}});void 0;");
  await win.webContents.executeJavaScript(`submissionRows=Array.from({length:75},(_,i)=>({id:'search-'+i,title:i===65?'征途 ABC 第65集':'普通影片'+i,folderName:i===65?'电视剧归档':'普通目录',source:'manual',status:i===65?'uncertain':i===66?'placement_failed':i===67?'failed':'success',url:'magnet:?xt=urn:btih:'+String(i===74?0:i).padStart(40,'0')}));cloudHistoryFilter='all';document.getElementById('submitHistorySource').value='all';document.getElementById('submitHistoryStatusFilter').value='all';renderSubmissionRows();document.getElementById('historyNextPage').click();document.getElementById('submitHistorySearch').value='征途 归档';document.getElementById('submitHistorySearch').dispatchEvent(new Event('input'));void 0;`);
  await new Promise(r=>setTimeout(r,250));
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#submitHistoryList .offline-history-row').length"),1);
  assert((await win.webContents.executeJavaScript("document.getElementById('historyPageInfo').textContent")).startsWith('1 / 1'));
  assert((await win.webContents.executeJavaScript("document.getElementById('submitHistoryList').textContent")).includes('第65集'));
  await win.webContents.executeJavaScript("document.getElementById('copyFilteredHistoryLinks').click();void 0;");await new Promise(r=>setTimeout(r,50));
  assert.equal(await win.webContents.executeJavaScript("syntheticCopiedLinks"),'magnet:?xt=urn:btih:'+String(65).padStart(40,'0'));
  fs.writeFileSync(path.join(output,'history-search.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('submitHistorySource').value='auto';document.getElementById('submitHistorySource').dispatchEvent(new Event('change'));void 0;");
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#submitHistoryList .offline-history-row').length"),0);
  await win.webContents.executeJavaScript("document.getElementById('submitHistorySource').value='all';document.getElementById('submitHistorySearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));void 0;");
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#submitHistoryList .offline-history-row').length"),50);
  await win.webContents.executeJavaScript("document.getElementById('copyFilteredHistoryLinks').click();void 0;");await new Promise(r=>setTimeout(r,50));
  assert.equal(await win.webContents.executeJavaScript("syntheticCopiedLinks.split('\\n').length"),74,'Copy includes all 75 matching records and deduplicates one repeated link');
  assert((await win.webContents.executeJavaScript("syntheticCopiedLinks")).includes(String(73).padStart(40,'0')));
  fs.writeFileSync(path.join(output,'history-filtered-copy.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('#submitHistoryCounts [data-history-status=attention]').click();void 0;");
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#submitHistoryList .offline-history-row').length"),3);
  assert((await win.webContents.executeJavaScript("document.getElementById('submitHistoryList').textContent")).includes('提交待确认'));
  await new Promise(r=>setTimeout(r,150));
  fs.writeFileSync(path.join(output,'history-attention.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('copyFilteredHistoryLinks').click();void 0;");await new Promise(r=>setTimeout(r,50));
  assert.equal(await win.webContents.executeJavaScript("syntheticCopiedLinks.split('\\n').length"),3);
  await win.webContents.executeJavaScript("document.getElementById('submitHistoryStatusFilter').value='placement_failed';document.getElementById('submitHistoryStatusFilter').dispatchEvent(new Event('change'));void 0;");
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#submitHistoryList .offline-history-row').length"),1);
  assert((await win.webContents.executeJavaScript("document.getElementById('submitHistoryList').textContent")).includes('普通影片66'));
  await win.webContents.executeJavaScript("document.getElementById('submitHistoryStatusFilter').value='all';void 0;");
  await win.webContents.executeJavaScript(`cloudSyncState={...cloudSyncState,uid:'synthetic',tasks:[{key:'cloud:1',title:'云端特别片',folderName:'115目录',state:'completed',url:'magnet:synthetic'}],counts:{completed:1}};cloudHistoryFilter='completed';document.getElementById('submitHistorySearch').value='云端 115';renderSubmissionRows();void 0;`);
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#submitHistoryList .offline-history-row').length"),1);
  assert((await win.webContents.executeJavaScript("document.getElementById('submitHistoryList').textContent")).includes('云端特别片'));
  await win.webContents.executeJavaScript("document.getElementById('submitHistorySearch').value='';document.querySelector('#submitHistoryCounts [data-history-status=attention]').click();void 0;");
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#submitHistoryList .offline-history-row').length"),3,'Local attention shortcut leaves cloud-only view');
  await win.webContents.executeJavaScript("cloudHistoryFilter='completed';renderSubmissionRows();document.getElementById('submitHistoryStatusFilter').value='placement_failed';document.getElementById('submitHistoryStatusFilter').dispatchEvent(new Event('change'));void 0;");
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#submitHistoryList .offline-history-row').length"),1,'Local status dropdown leaves cloud-only view');
  await win.webContents.executeJavaScript("submissionRows=[];cloudHistoryFilter='all';document.getElementById('clearSubmitHistorySearch').click();void 0;");
  const films=Array.from({length:75},(_,i)=>({id:String(i),title:'筛选测试'+i,year:i<25?(i<11?'2026':'2025'):i<50?'2026':'2025'}));
  ipcMain.removeHandler('cloud-catalog');ipcMain.handle('cloud-catalog',(_e,mode,page)=>filtered.get('fixture',page,async n=>({items:films.slice((n-1)*25,n*25),limit:25,total:75}),x=>x.year==='2026'));
  await win.webContents.executeJavaScript("document.getElementById('showCloudHome').click();cloudFilterState={years:'2026'};cloudPage=1;loadCloudLibrary();void 0;");
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#cloudLibraryGrid .cloud-poster-card').length"),25);
  assert((await win.webContents.executeJavaScript("document.getElementById('cloudLibraryStatus').textContent")).includes('跨页补齐'));
  await win.webContents.executeJavaScript("cloudPage=2;loadCloudLibrary();void 0;");await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#cloudLibraryGrid .cloud-poster-card').length"),11);
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('cloudNext').disabled"),true);
  fs.writeFileSync(path.join(output,'filtered-library.png'),(await win.webContents.capturePage()).toPNG());
  ipcMain.removeHandler('share115-state');
  ipcMain.handle('share115-state',()=>({tasks:[],logs:[],running:false,records:[{id:'legacy',site:'qmp4',title:'历史接口接受记录',status:'accepted',verified:false,message:'接口已接受',count:1,folderName:'测试目录',at:Date.now()}]}));
  await win.webContents.executeJavaScript("document.getElementById('showShare115Logs').click();void 0;");await new Promise(resolve=>setTimeout(resolve,150));
  assert((await win.webContents.executeJavaScript("document.getElementById('share115Records').textContent")).includes('目录未核验'));
  assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#share115Records [data-action=retry]').length"),1);
  // Verify the reorganized navigation using the actual existing handlers.
  const hasLayout = await win.webContents.executeJavaScript("Boolean(document.querySelector('.workspace-bar'))");
  if (hasLayout) {
    await win.webContents.executeJavaScript("document.getElementById('showMonitorFilter').click();void 0;");
    await new Promise(resolve => setTimeout(resolve, 250));
    const monitor = await win.webContents.executeJavaScript("({title:document.querySelector('.workspace-title').textContent,jumps:!document.querySelector('.workspace-monitor-jumps').hidden,inline:document.getElementById('filterPage').contains(document.getElementById('share115Page')),groups:[...document.querySelectorAll('.nav-group-body')].filter(x=>!x.hidden).length,disclosure:!!document.querySelector('#filterPage .monitor-native-disclosure')})");
    assert(monitor.title.includes('不太灵')); assert(monitor.jumps && monitor.inline && monitor.disclosure); assert.equal(monitor.groups, 1);
    fs.writeFileSync(path.join(output, 'monitor-layout.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.getElementById('showSettings').click();void 0;"); await new Promise(resolve => setTimeout(resolve, 80));
    await win.webContents.executeJavaScript("document.getElementById('closeSettings').click();void 0;"); await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('.side-nav .nav-btn.active').id"), 'showMonitorFilter', 'Settings returns to the previous workspace');
  }
  fs.writeFileSync(path.join(output, 'desktop-smoke.json'), JSON.stringify({ ok: true, applicationVersion: require('../package.json').version, electronVersion: process.versions.electron, arch: process.arch, isolatedData: true, realCloudTransfers: false, navigation: true, lazyCovers: true, keyboardCards: true, workspaceLayout: hasLayout, taskOverviewWidths: [1500,1040,800], filteredLibraryPages: true, legacyTransferUnverified: true, syncFeedback: true, historySearch: true, filteredLinksCopy: true, historyAttention: true, systemClipboardChanged: false }));
  await win.webContents.executeJavaScript('window.cloudsave.backgroundSettings({closeToTray:false})');
  app.quit();
}).catch(error => { console.error(error); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'desktop-smoke.json'), JSON.stringify({ ok: false, error: error.stack })); app.exit(1); });
setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 45000).unref();
