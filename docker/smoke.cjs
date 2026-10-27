const {app, BrowserWindow, session} = require('electron');
const fs = require('fs');
const assert = require('assert');
const result = '/config/docker-smoke.json';
app.whenReady().then(async () => {
  // Block default browser network requests. No real cloud accounts are configured.
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
  fs.writeFileSync('/output/docker-export-test.txt', 'export-directory-writable');
  const dom = await win.webContents.executeJavaScript(`({text:document.body.innerText, api:typeof window.cloudsave, ui:typeof window.cloudsaveUI})`);
  assert(dom.text.includes('不太灵'), 'Main resource navigation must render');
  assert.equal(dom.api, 'object', 'Preload bridge must load');
  assert.equal(dom.ui, 'object', 'Lazy cover runtime must load');
  let mobileLayout;
  if (process.env.CLOUDSAVE_MOBILE_LAYOUT === '1') {
    mobileLayout = await win.webContents.executeJavaScript(`(()=>{const grid=document.querySelector('.cloud-poster-grid'),nav=document.getElementById('showCloudHome');return {viewport:innerWidth,body:getComputedStyle(document.body).flexDirection,navTop:Math.round(nav.getBoundingClientRect().top),navHeight:Math.round(nav.getBoundingClientRect().height),toggle:getComputedStyle(document.querySelector('.sidebar-head')).display,poster:getComputedStyle(grid).gridTemplateColumns};})()`);
    assert(mobileLayout.viewport <= 560, `Phone profile must render a narrow viewport, got ${mobileLayout.viewport}`);
    assert.equal(mobileLayout.body, 'column', `Phone profile must stack vertically, got flex-direction ${mobileLayout.body}`);
    assert(mobileLayout.navTop < 200 && mobileLayout.navHeight >= 44, `Top navigation must stay reachable and touch sized, top=${mobileLayout.navTop} height=${mobileLayout.navHeight}`);
    assert.equal(mobileLayout.toggle, 'none', 'The sidebar collapse button must disappear in the top bar');
    assert(/repeat\(2/.test(mobileLayout.poster), `Posters must fall back to two columns, got ${mobileLayout.poster}`);
  }
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
  fs.writeFileSync(result, JSON.stringify({ok:true, arch:process.arch, data:app.getPath('userData'), secondRun, uid:process.getuid(), loaded:true, windowSize:win.getSize(), mobileLayout:mobileLayout || null}));
}).catch(error => {
  fs.writeFileSync(result, JSON.stringify({ok:false,error:error.stack}));
  console.error(error);
});
