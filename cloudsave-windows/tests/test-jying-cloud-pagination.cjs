const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const src=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const start=src.indexOf("ipcMain.handle('site-detail-resources'");
const end=src.indexOf("ipcMain.handle('site-resolve-resource'",start);
let handler;const calls=[];
const context={ipcMain:{handle:(k,f)=>{if(k==='site-detail-resources')handler=f;}},detailSiteProvider:()=>({resourcePage:async(id,page)=>{calls.push(page);return page===1?{rows:[{resource_type:'MagnetLink',zname:'磁力'}],hasMore:true}:{rows:[{resource_type:'quark',zname:'网盘',zlink:'https://pan.quark.cn/s/test'}],hasMore:false};}}),normalizeCloudDetail:()=>({}),normalizeMovie:()=>({})};
vm.createContext(context);vm.runInContext(src.slice(start,end),context);
(async()=>{const result=await handler(null,'jying','jy4:mv:1','cloud',1,false);assert.deepEqual(calls,[1,2]);assert.equal(result.rows.length,1);assert.equal(result.page,2);assert.equal(result.rows[0].url,'https://pan.quark.cn/s/test');assert.equal(result.hasMore,false);console.log('PASS actual Jying cloud handler skips magnet-only page, returns cloud links and real last-page cursor');})().catch(e=>{console.error(e);process.exitCode=1;});
