const assert=require('node:assert/strict'),{BrowseCache}=require('../browse-cache');
(async()=>{for(const site of ['guanying','btbtla','jying','qmp4']){
 const rows=new Map(),cache={get:k=>rows.get(k),set:(k,v)=>rows.set(k,v)};let clock=1000000,loads=0,reloads=0,renders=0,token=0;const reader=new BrowseCache({cache,now:()=>clock,delay:1,notify:()=>{reloads++;void show();}});
 const load=async()=>({items:[{id:++loads}]});async function show(){const current=++token;const result=await reader.get(site,['mv',1,{}],load);if(current===token)renders++;return result;}
 await show();await Promise.resolve();assert.equal(loads,1);assert.equal(reloads,0,'Cold caller renders its own response without a forced re-read');assert.equal(renders,1);
 await show();assert.equal(reloads,0);assert.equal(loads,1);
 clock+=200000;const result=await show();assert.equal(result.items[0].id,1);const pending=reader.pending.get(reader.key(site,['mv',1,{}]));await pending;await Promise.resolve();assert.equal(loads,2);assert.equal(reloads,1,'One background completion refreshes the visible page');assert.equal((await show()).items[0].id,2);
 reader.close();}
 console.log('PASS four resource libraries avoid cold-load notification/re-read while stale background completion still refreshes once');
})().catch(error=>{console.error(error);process.exitCode=1;});
