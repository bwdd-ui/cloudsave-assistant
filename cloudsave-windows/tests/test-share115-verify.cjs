const assert=require('node:assert/strict'),{Share115Provider}=require('../share115-provider'),{Share115Monitor}=require('../share115-monitor');
const share={shareCode:'abcde',receiveCode:'abcd',url:'https://115.com/s/abcde'},folder={id:'10',fid:'0',cid:'10',n:'Show'},video={id:'11',fid:'11',n:'episode.mkv',s:'1073741824',sha1:'A'.repeat(40)};
const check=r=>{if(r.state!==true)throw Error('API failed');};
function fixture(mode='ok'){
 let posts=0,rootReads=0;
 const provider=new Share115Provider({check,wait:async()=>{},request:async(url,options)=>{
  if(options.method==='POST'){posts++;return {state:true};}
  const u=new URL(url),cid=u.searchParams.get('cid');
  if(u.pathname==='/share/snap')return {state:true,data:{count:1,list:cid==='0'?[folder]:[video]}};
  assert.equal(u.pathname,'/files');if(cid==='42')rootReads++;
  let rows=cid==='42'?[{cid:'100',fid:'0',n:'Show'}]:[{...video,fid:'111',sha1:(mode==='hash'?'B':'A').repeat(40)}];
  if(mode==='missing'||mode==='delayed'&&rootReads===1)rows=[];
  if(mode==='empty-folder'&&cid==='100')rows=[];
  return {state:true,path:[{cid:mode==='wrong-parent'?'0':cid}],count:rows.length,data:rows};
 }});
 return {provider,get posts(){return posts;},get rootReads(){return rootReads;}};
}
(async()=>{
 for(const mode of ['ok','delayed']){const f=fixture(mode);const receipt=await f.provider.receive(share,['10'],'42','cookie',{files:[folder]});assert(receipt.verification.verified);assert.equal(f.posts,1);assert.equal(receipt.verification.checked,2);}
 for(const mode of ['missing','hash','empty-folder','wrong-parent']){const f=fixture(mode);await assert.rejects(f.provider.receive(share,['10'],'42','cookie',{files:[folder]}),e=>e.uncertain&&e.serverResult.state===true);assert.equal(f.posts,1,'Never repeat POST on ambiguous verification');}
 const f=fixture();await assert.rejects(f.provider.receive(share,['10'],'42','cookie',{files:[folder],active:()=>{throw Error('stopped');}}),e=>e.uncertain);assert.equal(f.posts,1);
 for(const mode of ['ok','empty-folder']){
  const f=fixture(mode);let saved;
  const d={read:()=>saved,write:async v=>{saved=JSON.parse(JSON.stringify(v));},cookie:()=> 'synthetic',account:async()=>({uid:'u'}),validateFolder:async(_c,f)=>f,stopped:()=>false,wait:async()=>{},log(){},provider:f.provider,adapter:async()=>({filters:{},categories:['mv'],catalog:async()=>({items:[{id:'film',title:'Film'}],hasNext:false}),detail:async()=>({clouds:[{url:share.url,code:'abcd',title:'Share'}]})})};
  const m=new Share115Monitor(d);m.data.tasks=[{id:'task',name:'Task',site:'qmp4',uid:'u',folder:{cid:'42',name:'Target'},intervalMinutes:15}];await m.run('task');
  const tx=m.state().records[0];assert.equal(tx.status,mode==='ok'?'accepted':'uncertain');assert.equal(tx.verified===true,mode==='ok');assert.equal(Object.keys(m.data.savedLinks).length,mode==='ok'?1:0);assert.equal(f.posts,1);m.close();
 }
 console.log('PASS actual share provider and monitor: recursive destination verification, shell-only folders, checksum mismatch, wrong parent, delayed visibility, cancellation, no repeated receive');
})().catch(error=>{console.error(error);process.exitCode=1;});
