const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const filename=path.resolve(__dirname,'../share115-monitor.js'),localRequire=require('node:module').createRequire(filename);let timer;
const context={require:localRequire,module:{exports:{}},setTimeout:(fn,delay)=>{timer={fn,delay,unref(){}};return timer;},clearTimeout:()=>{timer=null;}};
vm.runInNewContext(fs.readFileSync(filename,'utf8'),context);const {Share115Monitor}=context.module.exports;
(async()=>{
 const m=new Share115Monitor({read:()=>null,write:async()=>{},stopped:()=>false,log(){}}),ran=[];
 const cases=[['missing',undefined],['invalid','invalid'],['null',null],['negative',-1],['string','1'],['future',Date.now()+60000]];
 m.data.tasks=cases.map(([id,nextRun])=>({id,site:'qmp4',enabled:true,...(id==='missing'?{}:{nextRun})}));
 m.data.tasks.push({id:'disabled',site:'qmp4',enabled:false});m.scan=async id=>{ran.push(id);m.data.tasks.find(t=>t.id===id).nextRun=Date.now()+60000;};
 m.arm();assert.equal(timer.delay,1000,'Legacy task schedules a near wake-up');await timer.fn();
 assert.deepEqual(ran.sort(),['invalid','missing','negative','null','string']);assert(timer.delay>=59000&&timer.delay<=60000,'No one-second empty polling after recovery');
 m.data.tasks=[{id:'far',site:'qmp4',enabled:true,nextRun:Date.now()+40*86400000}];m.arm();assert.equal(timer.delay,2147483647,'Clamp far deadlines to safe Node timer range');const farTimer=timer;await timer.fn();assert.notEqual(timer,farTimer,'Early bounded wake schedules the remaining wait');assert.equal(timer.delay,2147483647);assert.equal(ran.length,5,'Far task is not run early');
 m.close();assert.equal(timer,null);console.log('PASS legacy/invalid deadlines run once, future and disabled tasks stay idle, no repeated empty polling, far-future timer bounded');
})().catch(error=>{console.error(error);process.exitCode=1;});
