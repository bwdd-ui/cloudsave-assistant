const assert=require('node:assert/strict'),{Share115Provider}=require('../share115-provider'),{verifySavedShare}=require('../share115-verify');
const share={shareCode:'abcde',receiveCode:''},check=r=>assert.equal(r.state,true);
(async()=>{for(const count of [null,'',' \t',false,true,[],{},Infinity,0.5,-1,Number.MAX_SAFE_INTEGER+1]){
 let reads=0;const source=new Share115Provider({check,wait:async()=>{},request:async()=>{reads++;return {state:true,data:{count,list:[]}};}});await assert.rejects(source.list(share,'',()=>{}),/分页格式异常/);assert.equal(reads,1);
 await assert.rejects(verifySavedShare({request:async()=>({state:true,path:[{cid:'42'}],data:{count,list:[]}}),check,source:async()=>[],wait:async()=>{},share,rows:[],cid:'42',cookie:'',active(){}}),/分页不完整/);
 }
 for(const count of [0,'0',' 0 ']){const p=new Share115Provider({check,wait:async()=>{},request:async()=>({state:true,data:{count,list:[]}})});assert.deepEqual(await p.list(share,'',()=>{}),[]);assert((await verifySavedShare({request:async()=>({state:true,path:[{cid:'42'}],data:{count,list:[]}}),check,source:async()=>[],wait:async()=>{},share,rows:[],cid:'42',cookie:'',active(){}})).verified);}
 let posts=0;const provider=new Share115Provider({check,wait:async()=>{},request:async(url,options)=>{if(options.method==='POST'){posts++;return {state:true};}if(new URL(url).pathname==='/share/snap')return {state:true,data:{count:null,list:[]}};return {state:true,path:[{cid:'42'}],count:1,data:[{fid:'0',cid:'100',n:'folder'}]};}});
 await assert.rejects(provider.receive(share,['10'],'42','',{files:[{fid:'0',cid:'10',id:'10',n:'folder'}]}),error=>error.uncertain&&/分页格式异常/.test(error.message));assert.equal(posts,1,'Malformed source pagination never repeats receive POST');
 console.log('PASS malformed source/target counts rejected, real empty folders retained, recursive verification remains uncertain and submits once');
})().catch(error=>{console.error(error);process.exitCode=1;});
