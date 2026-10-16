const assert=require('node:assert/strict'),{parseInWindow}=require('../site-reader');
(async()=>{for(const phase of ['parse','initialize','inspect']){
 const failure=Error('original '+phase+' failure');let destroyCalls=0,checks=0,created=0;
 const broken={isDestroyed(){checks++;if(phase==='inspect'&&checks>1)throw Error('cleanup inspection failed');return false;},loadURL:async()=>{throw failure;},webContents:{executeJavaScript:async()=>{throw failure;}},destroy(){destroyCalls++;throw Error('cleanup destruction failed');}};
 const owner={window:phase==='initialize'?null:broken,BrowserWindow:class{constructor(){created++;return broken;}}};
 await assert.rejects(parseInWindow(owner,'','catalog','https://synthetic.invalid',()=>{}),error=>error===failure);assert.equal(owner.window,null,'Failed reader always detached');assert.equal(destroyCalls,phase==='inspect'?0:1);
 owner.BrowserWindow=class{constructor(options){created++;assert(options.webPreferences.sandbox);assert(!options.webPreferences.nodeIntegration);return {isDestroyed:()=>false,loadURL:async()=>{},webContents:{executeJavaScript:async()=>({items:[{id:'recovered'}]})}};}};
 assert.equal((await parseInWindow(owner,'','catalog','https://synthetic.invalid',()=>{})).items[0].id,'recovered');assert(owner.window);assert.equal(created,phase==='initialize'?2:1);
 }
 console.log('PASS parser original errors survive destroy/inspection cleanup failures, detached readers recreate with sandbox intact');
})().catch(error=>{console.error(error);process.exitCode=1;});
