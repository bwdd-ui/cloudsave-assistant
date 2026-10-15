const assert=require('node:assert/strict');const {verifySavedShare}=require('../share115-verify');
let reads=0,names=0;const count=12000,expected=Array.from({length:count},(_,i)=>({fid:String(i+1),n:'Video '+i+'.mkv',s:1024+i,sha1:'A'}));
const target=expected.map((row,i)=>({fid:String(i+count+1),get n(){names++;return row.n;},s:row.s,sha1:row.sha1})).reverse();
const run=(rows,data,active=()=>{})=>verifySavedShare({rows,cid:'42',cookie:'synthetic',share:{},source:async()=>{throw Error('No source reads needed');},wait:async()=>{},active,check:r=>assert.equal(r.state,true),request:async url=>{reads++;const offset=Number(new URL(url).searchParams.get('offset'));return {state:true,path:[{cid:'42'}],count:data.length,data:data.slice(offset,offset+1000)};}});
(async()=>{
 const result=await run(expected,target);assert.equal(result.checked,count);assert.equal(reads,12);assert(names<count*4,'Linear comparison work for reversed listings');
 const row={fid:'1',n:'same.mkv',s:100};
 // Exact checksums must win before using a checksum-less target file.
 await run([{...row,sha1:'A'},{...row,sha1:'B'}],[{...row,fid:'3'},{...row,fid:'2',sha1:'A'}]);
 await run([row,{...row,sha1:'A'}],[{...row,fid:'2',sha1:'B'},{...row,fid:'3',sha1:'A'}]);
 await assert.rejects(run([row,row],[{...row,fid:'2'}]),/未找到匹配/);
 await assert.rejects(run([{...row,sha1:'A'}],[{...row,fid:'2',sha1:'B'}]),/未找到匹配/);
 await assert.rejects(run([row],[{...row,fid:'2',s:99}]),/未找到匹配/);
 await run([row],[{...row,fid:'2',sha1:'A'}]);
 await assert.rejects(run(expected,target,()=>{throw Error('stopped');}),/stopped/);
 console.log('PASS 12000 reversed files verified with 12 reads and '+names+' target-name accesses; duplicate consumption, checksum preference, mismatch and cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
