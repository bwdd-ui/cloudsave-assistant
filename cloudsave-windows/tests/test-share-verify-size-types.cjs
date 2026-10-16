const assert=require('node:assert/strict'),{verifySavedShare}=require('../share115-verify'),{Share115Provider}=require('../share115-provider');
const row=s=>({fid:'1',n:'episode.mkv',s}),check=r=>assert.equal(r.state,true);
async function verify(sourceSize,targetSize){return verifySavedShare({request:async(_url,options)=>{assert.notEqual(options.method,'POST');return {state:true,path:[{cid:'42'}],count:1,data:[{...row(targetSize),fid:'2'}]};},check,source:async()=>[],wait:async()=>{},share:{},rows:[row(sourceSize)],cid:'42',cookie:'',active(){}});}
(async()=>{for(const [invalid,coerced]of [['',0],[' \t',0],[true,1],[false,0],[[],0],[0.5,0.5],[Number.MAX_SAFE_INTEGER+1,Number.MAX_SAFE_INTEGER+1],[Infinity,Infinity]]){
 await assert.rejects(verify(invalid,coerced),/未找到匹配/);await assert.rejects(verify(coerced,invalid),/未找到匹配/);}
 for(const size of [0,'0',1024,' 1024 ',Number.MAX_SAFE_INTEGER])assert((await verify(size,Number(size))).verified);
 let posts=0;const provider=new Share115Provider({check,wait:async()=>{},request:async(_url,options)=>{if(options.method==='POST'){posts++;return {state:true};}return {state:true,path:[{cid:'42'}],count:1,data:[{...row(0),fid:'2'}]};}});
 await assert.rejects(provider.receive({shareCode:'abcde',receiveCode:''},['1'],'42','',{files:[row('')]}),error=>error.uncertain&&error.serverResult.state===true);assert.equal(posts,1,'Ambiguous size must not repeat receive POST');
 console.log('PASS invalid source/target sizes cannot verify as zero or one, safe integer/zero preserved, ambiguous receipt remains uncertain with one POST');
})().catch(error=>{console.error(error);process.exitCode=1;});
