const {app,BrowserWindow}=require('electron');
const {EventEmitter}=require('events');const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {installBackgroundWindow}=require('../background-window');
app.setPath('userData',path.join(app.getPath('temp'),'close-tray-integration-'+process.pid));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{let config={minimizeToTray:true},exiting=false;const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false,nodeIntegration:false}});
 class Tray extends EventEmitter{setToolTip(){}setContextMenu(){}destroy(){}}
 try{installBackgroundWindow({app,win,Tray,Menu:{buildFromTemplate:x=>x},nativeImage:{createFromPath:x=>x},read:()=>config,write:x=>config=x,isQuitting:()=>exiting});await win.loadURL('about:blank');await win.webContents.executeJavaScript('window.pulse=0;setInterval(()=>pulse++,40)');win.close();assert.equal(win.isDestroyed(),false);await new Promise(r=>setTimeout(r,200));assert((await win.webContents.executeJavaScript('pulse'))>=2,'hidden WebContents continue running');exiting=true;const closed=new Promise(resolve=>win.once('closed',resolve));win.close();await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('exit did not close the window')),3000))]);assert(win.isDestroyed());fs.writeFileSync(path.join(app.getPath('temp'),'close-tray-integration.json'),JSON.stringify({pass:true,checks:['native close preserves BrowserWindow','hidden page timers continue','explicit quit destroys window']},null,2));app.exit(0);}catch(error){fs.writeFileSync(path.join(app.getPath('temp'),'close-tray-integration.json'),JSON.stringify({pass:false,error:error.stack},null,2));app.exit(1);}
});
