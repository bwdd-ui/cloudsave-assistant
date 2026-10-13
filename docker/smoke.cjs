const {app, BrowserWindow, session} = require('electron');
const fs = require('fs');
const assert = require('assert');
const result = '/config/docker-smoke.json';
app.whenReady().then(async () => {
  // Smoke tests never contact resource websites or real cloud accounts.
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (_details, done) => done({cancel:true}));
  const deadline = Date.now() + 45000;
  let win;
  while (Date.now() < deadline) {
    win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
    if (win && !win.webContents.isLoading()) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(win, 'Application window must load');
  assert.equal(app.getPath('userData'), '/config/Data');
  const dom = await win.webContents.executeJavaScript(`({text:document.body.innerText, api:typeof window.cloudsave})`);
  assert(dom.text.includes('不太灵'), 'Main resource navigation must render');
  assert.equal(dom.api, 'object', 'Preload bridge must load');
  await win.webContents.executeJavaScript(`window.cloudsave.backgroundSettings({closeToTray:false})`);
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert(fs.existsSync('/config/Data/config.json'), 'Persistent config must exist');
  const persisted = session.fromPartition('persist:cloudsave-docker-smoke');
  const previous = await persisted.cookies.get({url:'https://smoke.invalid/'});
  const secondRun = previous.some(cookie => cookie.name === 'container-test' && cookie.value === 'persistent');
  await persisted.cookies.set({url:'https://smoke.invalid/', name:'container-test', value:'persistent', expirationDate:Math.floor(Date.now()/1000)+86400});
  await persisted.cookies.flushStore();
  const image = await win.webContents.capturePage();
  fs.writeFileSync('/config/docker-smoke.png', image.toPNG());
  fs.writeFileSync(result, JSON.stringify({ok:true, arch:process.arch, data:app.getPath('userData'), secondRun, uid:process.getuid(), loaded:true}));
}).catch(error => {
  fs.writeFileSync(result, JSON.stringify({ok:false,error:error.stack}));
  console.error(error);
});
