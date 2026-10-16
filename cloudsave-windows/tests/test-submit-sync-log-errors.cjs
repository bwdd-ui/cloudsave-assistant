const assert=require('node:assert/strict'),{CloudSubmitSync}=require('../cloud-submit-sync');
(async()=>{let clock=100000,calls=0,logs=0,broken=false;const timers=[];
 const manager=new CloudSubmitSync({account:()=> 'synthetic',now:()=>clock,log(){logs++;throw Error('synthetic log disk failure');},sync:async()=>{calls++;if(broken)throw Error('synthetic network failure');return {tasks:{submitted:{}}};},setTimer:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimer:timer=>{const i=timers.indexOf(timer);if(i>=0)timers.splice(i,1);}});
 const fire=async()=>{const timer=timers.shift();assert(timer);clock+=timer.ms;await timer.fn();};
 manager.trigger('synthetic','submitted');await fire();assert.equal(calls,1,'Log write failure must not block incremental sync');assert.equal(manager.done,manager.revision);assert.equal(manager.expected.size,0);assert.equal(timers.length,0,'Successful sync needs no retry');
 broken=true;manager.trigger('synthetic','submitted');for(let i=0;i<3;i++){if(i)assert(timers[0].ms>=15000);await fire();}assert.equal(calls,4,'Real sync errors still retry twice');assert.equal(timers.length,0,'Log failures cannot create an infinite retry loop');assert.equal(manager.retries,3);assert.equal(manager.done,manager.revision);assert.equal(manager.expected.size,0);assert.equal(logs,7);
 broken=false;manager.trigger('synthetic','submitted');await fire();assert.equal(calls,5);assert.equal(manager.retries,0);manager.close();manager.trigger('synthetic','submitted');assert.equal(timers.length,0);
 console.log('PASS log errors cannot block incremental sync, successful completion, bounded error retries, later recovery and shutdown');
})().catch(error=>{console.error(error);process.exitCode=1;});
