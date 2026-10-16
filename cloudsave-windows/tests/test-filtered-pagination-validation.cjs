const assert=require('node:assert/strict'),{FilteredLibraryPages}=require('../filtered-library-pages');
(async()=>{
 const pager=new FilteredLibraryPages();let reads=0;
 for(const page of [0,-1,1.5,Infinity,NaN,'invalid',Number.MAX_SAFE_INTEGER+1])await assert.rejects(pager.get('bad-page',page,async()=>{reads++;},()=>true),/页码/);
 assert.equal(reads,0);assert.equal(pager.scopes.size,0,'Invalid navigation cannot allocate a cache or start reads');
 for(const invalid of [Infinity,-Infinity,NaN,-1,2.5,'invalid',Number.MAX_SAFE_INTEGER+1]){
  const cache=new FilteredLibraryPages();let broken=true,calls=[];
  const read=async page=>{calls.push(page);return {limit:page===2&&broken?invalid:2,items:[{id:page+'a'},{id:page+'b'}],hasNext:page<2};};
  await assert.rejects(cache.get('retry',1,read,()=>true),/每页数量异常/);const state=cache.scopes.get('retry');assert.equal(state.next,2);assert.equal(state.rows.length,2);assert.equal(state.nativeItemCount,2);
  broken=false;assert.deepEqual((await cache.get('retry','2',read,()=>true)).items.map(x=>x.id),['2a','2b']);assert.deepEqual(calls,[1,2,2]);assert.equal(state.nativeItemCount,4);
 }
 for(const limit of [undefined,null,'',0,'2']){const result=await new FilteredLibraryPages().get('fallback',1,async()=>({limit,items:[{id:'a'},{id:'b'}],hasNext:false}),()=>true);assert.equal(result.limit,2);assert.equal(result.items.length,2);}
 console.log('PASS invalid page/size rejected before cache mutation, prior pages retained, same-page retry, numeric strings and missing-size fallback preserved');
})().catch(error=>{console.error(error);process.exitCode=1;});
