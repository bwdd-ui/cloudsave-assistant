const {app,BrowserWindow}=require('electron'),path=require('path'),fs=require('fs'),assert=require('assert/strict');
app.setPath('userData','C:/Temp/monitor-labels-parallel-'+process.pid);
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{preload:path.join(__dirname,'library-share-ui-mock.cjs'),contextIsolation:true}}),run=s=>w.webContents.executeJavaScript(s),pause=()=>new Promise(r=>setTimeout(r,150));try{
 await w.loadFile(path.join(__dirname,'../index.html'));await pause();
 for(const [name,nav,page] of [['不太灵','showMonitorFilter','filterPage'],['观影','showGuanyingMonitor','guanyingMonitorPage'],['BT影视','showBtbtlaMonitor','btbtlaMonitorPage'],['聚影','showJyingMonitor','jyingMonitorPage'],['七味','showQmp4Monitor','qmp4MonitorPage']]){
  await run(`document.getElementById('${nav}').click()`);await pause();
  assert.equal(await run("document.getElementById('share115Heading').textContent"),'自动监控'+name+'网盘链接');
  assert(await run(`document.querySelector('#${page} .monitor-unified').textContent.includes('自动监控${name}磁力链接')`));
 }
 await run("window.cloudsave.testShareState({tasks:[{id:'a',name:'任务A',site:'qmp4',destination:'115',folder:{cid:'1',name:'目录'},running:true},{id:'b',name:'任务B',site:'qmp4',destination:'115',folder:{cid:'2',name:'目录'},running:true}],running:true,runningIds:['a','b'],records:[],logs:[]})");
 assert.equal(await run("document.querySelectorAll('#share115Tasks [data-stop]').length"),2);
 assert.equal(await run("(document.getElementById('share115Tasks').textContent.match(/扫描中/g)||[]).length"),2);
 fs.writeFileSync('C:/Temp/monitor-labels-parallel-ui-result.txt','PASS five sites distinguish magnet and cloud-link headings; both concurrent task cards show scanning and individual stop controls');app.exit(0);
 }catch(e){fs.writeFileSync('C:/Temp/monitor-labels-parallel-ui-result.txt',e.stack);app.exit(1);}});
