const assert=require('node:assert/strict'),{CloudDownloadCache}=require('../cloud-download-cache');
(async()=>{let now=Date.parse('2026-10-16T04:00:00Z');const interval=3600000;
 for(const stamp of [now+86400000,Infinity,NaN,'invalid',-1]){
  let reads=0;const old={url:'magnet:old',state:'completed',createdAt:now-86400000};const cache=new CloudDownloadCache({read:()=>({version:1,accounts:{u:{syncedAt:stamp,currentKeys:['magnet:old'],tasks:{'magnet:old':old}}}}),write:async()=>{},account:()=> 'u',key:x=>x,now:()=>now,interval:()=>interval,lookbackHours:()=>24,log(){},page:async()=>{reads++;return {page_count:1,tasks:[{url:'magnet:new',status:1,add_time:Math.floor((now-60000)/1000)}]};}});
  cache.attempts.set('u',now+86400000);assert.equal(cache.nextSyncAt('u'),now);await cache.sync();assert.equal(reads,1,'Future or invalid clocks cannot indefinitely suppress automatic sync');assert.equal(cache.state('u','magnet:old'),'completed');assert.equal(cache.state('u','magnet:new'),'downloading');assert.equal(cache.data.accounts.u.count,2);assert.equal(cache.nextSyncAt('u'),now+interval);await cache.sync();assert.equal(reads,1,'Successful recovery restores normal throttling');
 }
 const cache=new CloudDownloadCache({read:()=>({accounts:{u:{syncedAt:now-600000,currentKeys:[],tasks:{}}}}),write(){},account:()=> 'u',key:x=>x,now:()=>now,interval:()=>interval,log(){},page:async()=>{throw Error('recent cache must not read');}});
 assert.equal(cache.nextSyncAt('u'),now+3000000);await cache.sync();cache.attempts.set('u',now-300000);assert.equal(cache.nextSyncAt('u'),now+3300000);assert.equal(cache.nextSyncAt('other'),now,'Account checkpoints remain isolated');
 // The production progress/scheduler path must use the same validated checkpoint.
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../main.js'),'utf8');assert(source.includes('nextSyncAt:prefs.enabled?cloudDownloadCache.nextSyncAt(uid,prefs.intervalMinutes*60000):0'));
 console.log('PASS future/invalid checkpoints recover incremental sync, retain history, restore intervals and share validated deadlines with production scheduler');
})().catch(error=>{console.error(error);process.exitCode=1;});
