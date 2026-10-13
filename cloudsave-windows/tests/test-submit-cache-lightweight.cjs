const assert=require('assert/strict'),{CloudDownloadCache}=require('../cloud-download-cache');
(async()=>{let now=Date.now(),reads=0,queries=0;const hash='a'.repeat(40),old='magnet:?xt=urn:btih:'+hash,seed={accounts:{u:{incremental:true,lookbackHours:24,syncedAt:now-60000,tasks:{[old]:{url:old,infoHash:hash,state:'downloading',status:1,createdAt:now-86400000}},currentKeys:[old]}}};
 const c=new CloudDownloadCache({read:()=>seed,write(){},account:()=> 'u',lookbackHours:()=>24,interval:()=>3600000,enabled:()=>false,key:x=>x,now:()=>now,wait:async()=>{},log(){},task:async()=>{queries++;return {info_hash:hash,status:2}},page:async p=>{reads++;assert.equal(p,1);return {page_count:100,tasks:[{url:'new',status:1,add_time:(now-10000)/1000},{url:'boundary',status:2,add_time:(now-3*3600000)/1000}]};}});
 await c.sync(true,{checkOldTasks:false});assert.equal(reads,1);assert.equal(queries,0);assert(c.data.accounts.u.tasks.new);assert.equal(c.state('u',old),'downloading');
 now+=3600000;await c.sync(true,{checkOldTasks:false});assert.equal(reads,2);assert.equal(queries,1);assert.equal(c.state('u',old),'completed');
 console.log('PASS submission force bypasses periodic disable/interval, reads one new page, avoids repeated old polls and still refreshes old statuses when interval elapses');
})().catch(e=>{console.error(e);process.exitCode=1});
