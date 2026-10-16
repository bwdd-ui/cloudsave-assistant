const assert=require('node:assert/strict'),{CloudSyncSchedule}=require('../cloud-sync-schedule');
(async()=>{const max=2147483647;let clock=100000,calls=0,enabled=true,deadline=clock+max*2+5000;const timers=[];
 const scheduler=new CloudSyncSchedule({now:()=>clock,state:()=>({enabled,uid:'synthetic',nextSyncAt:deadline}),sync:async()=>{calls++;enabled=false;},setTimer:(fn,delay)=>{assert(Number.isFinite(delay)&&delay>=1000&&delay<=max);const timer={fn,delay,unref(){}};timers.push(timer);return timer;},clearTimer:t=>t.cleared=true});
 scheduler.arm();assert.equal(timers.at(-1).delay,max);clock+=max;await timers.at(-1).fn();assert.equal(calls,0);assert.equal(timers.at(-1).delay,max);clock+=max;await timers.at(-1).fn();assert.equal(calls,0);assert.equal(timers.at(-1).delay,5000);clock+=5000;await timers.at(-1).fn();assert.equal(calls,1);assert.equal(scheduler.timer,null);
 enabled=true;for(const value of [Infinity,-Infinity,NaN,'invalid']){deadline=value;scheduler.arm();assert.equal(timers.at(-1).delay,1000,'Invalid deadlines cannot overflow the timer');scheduler.close();}
 deadline=clock+max+1;scheduler.arm();const obsolete=timers.at(-1);scheduler.close();const count=timers.length;await obsolete.fn();assert.equal(timers.length,count);assert.equal(calls,1,'Closed distant timers cannot rearm or sync');
 deadline=clock-60000;scheduler.arm();assert.equal(timers.at(-1).delay,1000);scheduler.close();
 console.log('PASS bounded sync timer delays, distant deadline rechecks without early sync, invalid deadlines, overdue and canceled timers');
})().catch(error=>{console.error(error);process.exitCode=1;});
