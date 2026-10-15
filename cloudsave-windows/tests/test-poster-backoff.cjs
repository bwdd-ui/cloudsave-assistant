const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{PosterCache}=require('../poster-cache');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloudsave-poster-backoff-'));try{
 let clock=1000000,calls=0,broken=true;const cache=new PosterCache({root,now:()=>clock,fetcher:async()=>{calls++;if(broken)throw Error('synthetic unavailable cover');return {ok:true,headers:new Headers({'content-type':'image/png'}),arrayBuffer:async()=>Uint8Array.from([137,80,78,71]).buffer};}}),url='https://images.invalid/bad.png';
 await Promise.all(Array.from({length:10},()=>assert.rejects(cache.load(url,'jying'))));assert.equal(calls,2,'One shared attempt with two referer strategies');
 for(let i=0;i<20;i++)await assert.rejects(cache.load(url,'jying'));assert.equal(calls,2,'Repaints during cooldown use failure snapshot');assert.equal(cache.running,0);assert.equal(cache.waiting.length,0);
 clock+=30000;await assert.rejects(cache.load(url,'jying'));assert.equal(calls,4);clock+=59999;await assert.rejects(cache.load(url,'jying'));assert.equal(calls,4);clock++;
 broken=false;assert.match(await cache.load(url,'jying'),/^data:image/);assert.equal(calls,5);assert.equal(cache.failures.size,0);await cache.load(url,'jying');assert.equal(calls,5,'Recovered disk cover remains cached');
 broken=true;const shared='https://images.invalid/context.png';await assert.rejects(cache.load(shared,'jying'));const before=calls;await assert.rejects(cache.load(shared,'btbtla'));assert.equal(calls,before+2,'A different referer context is not suppressed');
 for(let i=0;i<8;i++){clock+=300001;await assert.rejects(cache.load('https://images.invalid/repeated.png'));}assert.equal([...cache.failures.values()].at(-1).retryAt-clock,300000,'Backoff caps at five minutes');
 for(let i=0;i<205;i++)await assert.rejects(cache.load('https://images.invalid/'+i+'.png'));assert.equal(cache.failures.size,200,'Failure memory is bounded');assert.equal(cache.running,0);assert.equal(cache.pending.size,0);
 console.log('PASS poster failures deduplicate, skip repaint retries, back off, recover to disk cache, isolate referer contexts and cap failure memory');
 }finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
