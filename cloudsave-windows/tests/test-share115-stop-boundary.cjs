const assert=require('node:assert/strict');const {Share115Provider}=require('../share115-provider');
const share={shareCode:'abcde',receiveCode:'abcd'},check=r=>assert(r.state),rows=[{fid:'1',n:'one.mkv',s:100}];
(async()=>{
 let stopped=false,requests=0,waits=0;const active=()=>{if(stopped)throw Error('stopped');};
 const provider=new Share115Provider({check,wait:async()=>{waits++;stopped=true;},request:async()=>{requests++;return {state:true,data:{count:2,list:rows}};}});
 await assert.rejects(provider.list(share,'synthetic',active),/stopped/);assert.equal(waits,1);assert.equal(requests,1,'No second page after stopping during throttle');
 let posts=0;const receiving=new Share115Provider({check,wait:async()=>{},request:async()=>{posts++;return {state:true};}});
 await assert.rejects(receiving.receive(share,['1'],'42','synthetic',{files:rows,active}),e=>e.message==='stopped'&&!e.uncertain);assert.equal(posts,0,'Stop before POST is certain and has no remote side effects');
 // The default callback preserves explicitly authorized direct/manual receives.
 const accepted=await receiving.receive(share,['1'],'42','synthetic');assert.equal(accepted.state,true);assert.equal(posts,1);
 // Cancelling after a POST starts must remain uncertain and never repeat that POST.
 stopped=false;receiving.request=async()=>{posts++;stopped=true;return {state:true};};
 await assert.rejects(receiving.receive(share,['1'],'42','synthetic',{files:rows,active}),e=>e.uncertain&&e.serverResult.state===true);assert.equal(posts,2);
 console.log('PASS stop during page wait sends no further GET; pre-submit stop sends zero POST; post-submit cancellation remains uncertain without retry');
})().catch(error=>{console.error(error);process.exitCode=1;});
