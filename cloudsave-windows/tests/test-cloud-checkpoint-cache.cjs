const assert=require('node:assert/strict');
const {CloudDownloadCache}=require('../cloud-download-cache');
const hash=n=>n.toString(16).padStart(40,'0'),url=n=>'magnet:?xt=urn:btih:'+hash(n);
(async()=>{
 let now=Date.parse('2026-10-09T10:00:00Z'),disk,uid='u',pages=[],queries=[];
 const oldTime=now-4*3600000,previous={version:1,accounts:{u:{incremental:true,lookbackHours:24,syncedAt:now-3600000,pendingCursor:0,tasks:{},currentKeys:[]}}};
 for(let n=1;n<=3500;n++){const key=url(n);previous.accounts.u.tasks[key]={url:key,infoHash:hash(n),state:n<=25?'downloading':'completed',status:n<=25?1:2,createdAt:oldTime,title:'cached '+n,checkedAt:oldTime};previous.accounts.u.currentKeys.push(key);}
 disk=structuredClone(previous);
 const make=()=>new CloudDownloadCache({read:()=>structuredClone(disk),write:async value=>disk=structuredClone(value),account:()=>uid,key:x=>x,now:()=>now,wait:async()=>{},lookbackHours:()=>24,interval:()=>3600000,log(){},page:async n=>{pages.push(n);assert.equal(n,1,'must not request old pages');return {page_count:100,tasks:[{info_hash:hash(3501),status:1,add_time:Math.floor((now-60000)/1000),name:'new'},{info_hash:hash(3500),status:2,add_time:Math.floor(oldTime/1000)}]};},task:async value=>{queries.push(value.infoHash);return {info_hash:value.infoHash,status:2};}});
 let c=make();await c.sync(true);let result=disk.accounts.u;
 assert.deepEqual(pages,[1]);assert.equal(queries.length,20);assert.equal(result.count,3501);assert.equal(result.added,1);assert.equal(result.pageReads,1);assert.equal(result.fetchedCount,2);assert.equal(result.statusChecked,20);assert.equal(result.tasks[url(1)].state,'completed');assert.equal(result.tasks[url(25)].state,'downloading');assert.equal(result.tasks[url(1)].title,'cached 1');assert.equal(result.rangeStart,previous.accounts.u.syncedAt-300000);
 // Restart restores the disk checkpoint and does not scan the 100 historical pages.
 now+=3600000;pages=[];queries=[];c=make();await c.sync();assert.equal(pages.length,1);assert.equal(queries.length,5);assert.equal(disk.accounts.u.count,3501);assert.equal(disk.accounts.u.added,0);assert.equal(disk.accounts.u.counts.downloading,1);
 const requests=pages.length;await c.sync();assert.equal(pages.length,requests,'interval uses persisted checkpoint');
 // Missing/sparse single-task results never overwrite a known result or cause list fallback.
 now+=3600000;c=make();c.task=async()=>({info_hash:hash(3501)});await c.sync(true);assert.equal(disk.accounts.u.tasks[url(3501)].state,'downloading');assert.equal(disk.accounts.u.statusErrors,0,'listed tasks need no extra query');
 disk.accounts.u.tasks[url(24)].state='failed';disk.accounts.u.tasks[url(24)].status=-1;
 now+=3600000;c=make();c.task=async()=>{throw Error('endpoint unavailable')};pages=[];await c.sync(true);assert.equal(disk.accounts.u.tasks[url(24)].state,'failed');assert.equal(disk.accounts.u.statusErrors,1);assert.deepEqual(pages,[1]);
 // Durable-write failure does not advance the in-memory checkpoint.
 c=make();const before=JSON.stringify(c.data);c.write=async()=>{throw Error('disk full')};await assert.rejects(c.sync(true),/disk full/);assert.equal(JSON.stringify(c.data),before);
 // A malformed list fails atomically, without retrying the remaining full history.
 c=make();c.page=async()=>({page_count:100,tasks:[{info_hash:hash(4000),status:1}]});const saved=JSON.stringify(disk);await assert.rejects(c.sync(true),/时间缺失/);assert.equal(JSON.stringify(disk),saved);
 console.log('PASS 3500 cached tasks: checkpoint reads one of 100 pages, bounded old status polling, cumulative counts, restart persistence, interval reuse, single-task failure retained, atomic disk/list failure');
})().catch(error=>{console.error(error);process.exitCode=1});

