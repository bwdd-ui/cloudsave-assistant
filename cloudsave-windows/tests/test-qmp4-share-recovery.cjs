const assert=require('node:assert/strict'),{cloudDriveType}=require('../cloud-drive-types'),{Share115Provider}=require('../share115-provider'),{Share115Monitor}=require('../share115-monitor'),history=require('../share-save-history');
(async()=>{
 for(const host of ['guangyapan.com','www.guangyapan.com','app.guangyapan.com'])assert.equal(cloudDriveType('https://'+host+'/s/test'),'光鸭云盘');
 assert.equal(cloudDriveType('https://guangyapan.com.evil.invalid/s/test'),'其他网盘');
 const provider=new Share115Provider({request:async()=>({state:false,success:true,error:'receive denied'}),check:()=>{}});
 await assert.rejects(provider.receive({shareCode:'abcde',receiveCode:''},['10'],'42',''),/receive denied/);
 const globalKey=history.identity('115','u','abcde'),key='u|42|abcde|10';
 let saved={version:1,tasks:[],items:{[key]:{status:'accepted'},'u|old|abcde|10':{status:'accepted'}},shares:{'u|42|abcde':{status:'accepted'},'u|old|abcde':{status:'accepted'}},transactions:{tx:{id:'tx',uid:'u',site:'qmp4',keys:[key],shareKey:'u|42|abcde',globalKey,status:'accepted',at:1,title:'synthetic',folderName:'test'}},shareFiles:{'u|42|abcde':[key]},savedLinks:{[globalKey]:{status:'accepted'}},scannedLinks:{old:{shareKey:'u|42|abcde'}}};
 const monitor=new Share115Monitor({read:()=>saved,write:async value=>{saved=JSON.parse(JSON.stringify(value));},currentUid:async()=> 'u'});
 await monitor.resolve('tx','retry');assert.equal(monitor.data.savedLinks[globalKey],undefined);assert.equal(monitor.data.shares['u|old|abcde'],undefined);assert.equal(monitor.data.globalItems[globalKey+'|10'].status,'failed');assert.equal(monitor.data.scannedLinks.old,undefined);monitor.close();
 const restored=new Share115Monitor({read:()=>saved,write:async()=>{}});assert.equal(restored.data.savedLinks[globalKey],undefined);assert.equal(restored.data.globalItems[globalKey+'|10'].status,'failed');restored.close();
 const fs=require('fs'),vm=require('vm'),path=require('path'),prefix=fs.readFileSync(path.join(__dirname,'test-gy-v2-policy.cjs'),'utf8').split('const {GuanyingProvider')[0],ctx=vm.createContext({require,console,Buffer,process,URL,URLSearchParams,__dirname});vm.runInContext(prefix+'\nglobalThis.getHarness=harness;',ctx);const h=ctx.getHarness();h.ctx.AbortSignal=AbortSignal;
 h.run(`session.fromPartition=()=>({getUserAgent:()=> 'Chrome Synthetic Electron/44.5.1',setUserAgent:value=>globalThis.sessionUA=value,fetch:async(url,options)=>{globalThis.nativeOptions=options;return {ok:true,url,text:async()=> 'synthetic html'};}});`);
 assert.equal(await h.run("getQmp4Provider().fetchHtml('https://www.qmp4.com/vs/-------------.html?wd=test')"),'synthetic html');assert(h.ctx.nativeOptions.bypassCustomProtocolHandlers);assert.equal(h.ctx.sessionUA,'Chrome Synthetic');
 console.log('PASS cloud classification, rejected conflicting receive flags, manual retry across migrated history and native seven-flavour verification session');
})().catch(error=>{console.error(error);process.exitCode=1;});
