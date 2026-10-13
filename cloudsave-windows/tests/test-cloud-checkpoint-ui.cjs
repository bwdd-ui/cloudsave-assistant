const {app,BrowserWindow}=require('electron'),path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs');
app.setPath('userData','C:/Temp/checkpoint-ui-'+process.pid);
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'cloud-sync-ui-mock.cjs'),contextIsolation:true,offscreen:true}});try{
 await w.loadFile(path.join(__dirname,'../index.html'));
 await w.webContents.executeJavaScript(`cloudSyncState={uid:'u',enabled:true,checkpoint:1,syncedAt:Date.now(),cachedCount:3501,pageReads:1,fetchedCount:100,statusChecked:20,added:1,changed:20};renderCloudSyncStatus();`);
 let text=await w.webContents.executeJavaScript("document.getElementById('cloudDownloadSyncStatus').textContent");
 assert(text.includes('从上次成功同步继续'));assert(text.includes('累计缓存3501条'));assert(text.includes('本次列表读取1页/100条'));assert(text.includes('旧任务核对20条'));assert(!text.includes('第 1/100'));
 await w.webContents.executeJavaScript("cloudSyncState.running=true;cloudSyncState.progress={phase:'checking',statusChecked:3,statusTotal:20};renderCloudSyncStatus()");
 text=await w.webContents.executeJavaScript("document.getElementById('cloudDownloadSyncStatus').textContent");assert(text.includes('核对旧任务：3/20条'));assert(await w.webContents.executeJavaScript("document.getElementById('cloudSyncNow').disabled"));
 fs.writeFileSync('C:/Temp/windows-checkpoint-ui.txt','PASS cumulative counts, actual page reads, saved checkpoint, bounded state progress and duplicate sync prevention');app.exit(0);
}catch(error){fs.writeFileSync('C:/Temp/windows-checkpoint-ui.txt',error.stack);app.exit(1);}});
