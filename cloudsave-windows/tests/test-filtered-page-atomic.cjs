const assert=require('node:assert/strict'),{FilteredLibraryPages}=require('../filtered-library-pages');
(async()=>{
 for(const failedPage of [1,2]){
  const pager=new FilteredLibraryPages(),reads=[];let fail=true;
  const read=async page=>{reads.push(page);return {items:[{id:page+'a'},{id:page+'b'},{id:page+'a'}],limit:2,hasNext:page<3};};
  const match=item=>{if(fail&&item.id===failedPage+'b'){fail=false;throw Error('malformed metadata');}return true;};
  await assert.rejects(pager.get('retry',2,read,match),/malformed metadata/);
  const state=pager.scopes.get('retry');assert.equal(state.next,failedPage);assert.equal(state.nativeItemCount,(failedPage-1)*3);assert.equal(state.rows.length,(failedPage-1)*2);assert.equal(state.signatures.size,failedPage-1);
  const result=await pager.get('retry',2,read,match);assert.deepEqual(result.items.map(x=>x.id),['2a','2b']);assert.equal(result.nativeItemCount,9);assert.equal(result.matchedCached,6);assert.deepEqual(reads,failedPage===1?[1,1,2,3]:[1,2,2,3]);
  assert.deepEqual((await pager.get('retry',1,read,match)).items.map(x=>x.id),['1a','1b']);
 }
 const pager=new FilteredLibraryPages();let stopped=false;
 const read=async()=>({items:[{id:'a'},{id:'b'}],limit:2,hasNext:false});
 await assert.rejects(pager.get('stop',1,read,()=>{stopped=true;return true;},()=>stopped),/已停止/);
 assert.equal(pager.scopes.get('stop').rows.length,0);stopped=false;
 assert.equal((await pager.get('stop',1,read,()=>true,()=>stopped)).items.length,2);
 console.log('PASS atomic filtered page retry, prior checkpoints, duplicate rows, counters and cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
