const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{PosterCache}=require('../poster-cache');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloudsave-poster-stream-'));try{
 for(const declared of [null,'1']){
  let pulls=0,cancels=0,calls=0;
  const cache=new PosterCache({root,fetcher:async()=>{calls++;return new Response(new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(1024*1024));},cancel(){cancels++;}},{highWaterMark:0}),{headers:{'content-type':'image/png',...(declared?{'content-length':declared}:{})}});}});
  await assert.rejects(cache.load('https://images.invalid/oversize-'+declared),/封面大小无效/);
  assert.equal(calls,2);assert.equal(pulls,12,'Each attempt stops on sixth MiB without draining remainder');assert.equal(cancels,2);assert.equal(cache.running,0);assert.equal(cache.pending.size,0);assert.equal(fs.readdirSync(root).length,0,'Oversized covers never cached');
 }
 let calls=0;const good=new PosterCache({root,fetcher:async()=>{calls++;return new Response(new Uint8Array(5*1024*1024),{headers:{'content-type':'image/png'}});}});
 const url='https://images.invalid/exact-limit';const result=await good.load(url);assert.equal(Buffer.from(result.split(',')[1],'base64').length,5*1024*1024);assert.equal(await good.load(url),result);assert.equal(calls,1);
 for(const scenario of ['http','type','declared']){
  let canceled=0,read=0;const cache=new PosterCache({root,fetcher:async()=>({ok:scenario!=='http',status:503,headers:new Headers({'content-type':scenario==='type'?'text/html':'image/png','content-length':scenario==='declared'?'5242881':'1'}),body:{async cancel(){canceled++;throw Error('cleanup failed');}},async arrayBuffer(){read++;throw Error('must not drain');}})});
  await assert.rejects(cache.load('https://images.invalid/'+scenario),scenario==='http'?/HTTP 503/:/格式或大小/);assert.equal(canceled,2);assert.equal(read,0);assert.equal(cache.running,0);
 }
 for(const empty of [true,false]){
  let canceled=0,released=0;
  const cache=new PosterCache({root,fetcher:async()=>({ok:true,headers:new Headers({'content-type':'image/png'}),body:{getReader:()=>({async read(){if(empty)return {done:true};throw Error('stream disconnected');},async cancel(){canceled++;throw Error('cancel failed');},releaseLock(){released++;}})}})});
  await assert.rejects(cache.load('https://images.invalid/broken-'+empty),empty?/大小无效/:/stream disconnected/);assert.equal(canceled,2);assert.equal(released,2);
  cache.fetcher=async()=>new Response(Uint8Array.from([1,2,3]),{headers:{'content-type':'image/png'}});assert.match(await cache.load('https://images.invalid/recovered-'+empty),/^data:image/);assert.equal(cache.running,0);
 }
 console.log('PASS bounded streaming covers, missing/false size, exact limit, disk reuse, invalid response disposal, read failure cleanup and queue recovery');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
