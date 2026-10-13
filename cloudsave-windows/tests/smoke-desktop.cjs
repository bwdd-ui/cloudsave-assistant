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
  fs.writeFileSync(path.join(output, 'desktop-smoke.json'), JSON.stringify({ ok: true, version: app.getVersion(), arch: process.arch, isolatedData: true, realCloudTransfers: false, navigation: true, lazyCovers: true, keyboardCards: true }));
  await win.webContents.executeJavaScript('window.cloudsave.backgroundSettings({closeToTray:false})');
  app.quit();
}).catch(error => { console.error(error); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'desktop-smoke.json'), JSON.stringify({ ok: false, error: error.stack })); app.exit(1); });
setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 45000).unref();
