const assert=require('assert/strict'),{JyingProvider}=require('../jying-provider');
(async()=>{
 let now=Date.UTC(2026,9,12,3),calls=0,stored={},limited=true;
 const d={clock:()=>now,wait:async ms=>{now+=ms;},readCooldown:()=>stored,writeCooldown:s=>stored={...s},getInterval:()=>1000,fetcher:async()=>{calls++;return {ok:!limited,status:limited?429:200,headers:{get:k=>k==='retry-after'&&limited?'120':null},json:async()=>limited?{code:'rate_limited',message:'检测到异常高频访问，已进入临时冷静期'}:{results:[]}};}};
 let p=new JyingProvider(d);await assert.rejects(()=>p.request('/api/app/categories/'),e=>e.rateLimited&&e.retryAt===now+120000);assert.equal(calls,1);const until=stored.until;
 await Promise.all(Array.from({length:5},()=>p.request('/api/app/categories/').catch(e=>assert(e.rateLimited))));assert.equal(calls,1);
 p=new JyingProvider(d);await assert.rejects(()=>p.request('/api/app/categories/'),e=>e.rateLimited);assert.equal(calls,1);
 now=until;limited=false;await p.request('/api/app/categories/');await p.request('/api/app/categories/');assert.equal(calls,3);assert(now>=until+5000);
 let resolve,requests=0;const cached=new Map();const q=new JyingProvider({clock:()=>now,wait:async()=>{},diskCache:{get:k=>cached.get(k),set:(k,v)=>cached.set(k,v)},fetcher:()=>{requests++;return new Promise(r=>resolve=r);}});
 const a=q.read('/api/app/movie/1/resources/'),b=q.read('/api/app/movie/1/resources/');await new Promise(r=>setImmediate(r));assert.equal(requests,1);resolve({ok:true,status:200,headers:{get:()=>null},json:async()=>({resources:[]})});await Promise.all([a,b]);assert.equal(requests,1);
 console.log('PASS server Retry-After honored, all queued/shared/restarted requests blocked during cooldown, automatic retry after deadline, minimum pacing and concurrent identical read coalescing');
})().catch(e=>{console.error(e);process.exitCode=1;});
