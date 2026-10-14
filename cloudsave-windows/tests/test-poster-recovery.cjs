const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {PosterCache}=require('../poster-cache');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloudsave-cover-recovery-'));
 try{
  const url='https://images.invalid/cover.png',file=path.join(root,crypto.createHash('sha256').update(url).digest('hex')+'.json');let requests=0;
  const fetcher=async()=>{requests++;return {ok:true,headers:new Headers({'content-type':'image/png'}),arrayBuffer:async()=>Uint8Array.from([137,80,78,71]).buffer};};
  const cache=new PosterCache({root,fetcher});
  // Valid JSON without cover data previously returned undefined for 30 days.
  for(const saved of [{url},{url,data:'not-image'},{url:'https://other.invalid/',data:'data:image/png;base64,iVBORw=='}]){
   fs.writeFileSync(file,JSON.stringify(saved));const previous=requests;
   assert.match(await cache.load(url),/^data:image\/png;base64,/);assert.equal(requests,previous+1);
  }
  const previous=requests;await cache.load(url);assert.equal(requests,previous,'Repaired cover must reuse disk cache');
  // A read-only/unusable cache path is not a reason to discard good network data.
  const blocked=path.join(root,'blocked');fs.writeFileSync(blocked,'not a directory');
  const noDisk=new PosterCache({root:blocked,fetcher});const before=requests;
  assert.match(await noDisk.load(url),/^data:image\/png;base64,/);assert.equal(requests,before+1);
  // Reserve the slot for a queued reader until its microtask resumes. A new
  // reader in the same turn cannot steal it and exceed the concurrency limit.
  const gate=new PosterCache({root,limit:1,fetcher});await gate.acquire();let queued=false,newcomer=false;
  const second=gate.acquire().then(()=>queued=true);gate.release();
  const third=gate.acquire().then(()=>newcomer=true);await second;
  assert(queued);assert(!newcomer);assert.equal(gate.running,1);gate.release();await third;gate.release();assert.equal(gate.running,0);
  console.log('PASS damaged cover cache repaired, valid cache reused, disk error preserves cover, FIFO concurrency handover');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
