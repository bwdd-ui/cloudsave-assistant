const assert=require('node:assert/strict'),{FilteredLibraryPages}=require('../filtered-library-pages');
(async()=>{
 const pager=new FilteredLibraryPages({limit:2}),release=[];let entered=0,ready;const started=new Promise(r=>ready=r);
 const work=Array.from({length:6},(_,i)=>pager.get('filter'+i,1,async()=>{entered++;if(entered===6)ready();await new Promise(r=>release[i]=r);return {items:[{id:String(i)}],limit:1,hasNext:false};},()=>true));
 await started;assert.equal(pager.scopes.size,6,'In-flight filters must not be evicted');
 for(let i=0;i<6;i++){release[i]();const result=await work[i];assert.equal(result.items[0].id,String(i));}
 assert.equal(pager.scopes.size,2,'Completed requests converge to configured scope limit');assert([...pager.scopes.values()].every(state=>!state.running));
 const outOfOrder=new FilteredLibraryPages({limit:2}),gates=[];let count=0,startAll;const allStarted=new Promise(r=>startAll=r);const concurrent=Array.from({length:3},(_,i)=>outOfOrder.get('k'+i,1,async()=>{if(++count===3)startAll();await new Promise(r=>gates[i]=r);return {items:[{id:String(i)}],limit:1,hasNext:false};},()=>true));await allStarted;gates[2]();await concurrent[2];gates[0]();await concurrent[0];assert(outOfOrder.scopes.has('k2'),'Late older response must not evict the latest filter');gates[1]();await concurrent[1];assert.equal(outOfOrder.scopes.size,2);
 const lru=new FilteredLibraryPages({limit:2}),counts={};const read=key=>async()=>{counts[key]=(counts[key]||0)+1;return {items:[{id:key}],limit:1,hasNext:false};};const get=key=>lru.get(key,1,read(key),()=>true);
 await get('a');await get('b');await get('a');await get('c');assert(lru.scopes.has('a'));assert(!lru.scopes.has('b'),'Recently reused filter survives before untouched filter');await get('a');assert.equal(counts.a,1);await get('b');assert.equal(counts.b,2);assert.equal(lru.scopes.size,2);
 await assert.rejects(lru.get('failed',1,async()=>{throw Error('synthetic failure');},()=>true),/synthetic/);assert.equal(lru.scopes.size,2);assert([...lru.scopes.values()].every(state=>!state.running));assert.equal((await get('failed')).items[0].id,'failed');
 console.log('PASS six concurrent filters finish intact then trim to two; recently reused results stay cached, failure cleanup and retry preserve bound');
})().catch(error=>{console.error(error);process.exitCode=1;});
