const assert=require('assert/strict'),{CloudSubmitSync}=require('../cloud-submit-sync');
(async()=>{
 let uid='123',clock=100000,timers=[],calls=0,stopped=false,resolveSync,active=null;
 const make=(sync=async()=>{calls++;return {tasks:{a:{},b:{},c:{}}}})=>new CloudSubmitSync({account:()=>uid,sync,active:()=>active,stopped:()=>stopped,now:()=>clock,setTimer:(fn,ms)=>{const token={fn,ms};timers.push(token);return token;},clearTimer:t=>timers=timers.filter(x=>x!==t),log(){}});
 let s=make();s.trigger(uid,'a');s.trigger(uid,'b');assert.equal(timers.length,1);assert.equal(timers[0].ms,3000);let t=timers.shift();await t.fn();await s.running;assert.equal(calls,1);assert.equal(timers.length,0);
 // A submission during an active refresh needs a follow-up increment, not just the existing snapshot.
 s=make(()=>new Promise(r=>resolveSync=r));s.trigger(uid,'a');t=timers.shift();t.fn();await Promise.resolve();s.trigger(uid,'c');resolveSync({tasks:{a:{}}});await s.running;assert.equal(timers.length,1);assert(timers[0].ms>=5000);s.close();assert.equal(timers.length,0);
 // Wait for a full or periodic cache refresh to finish, then run a fresh increment.
 let releaseActive;active=new Promise(r=>releaseActive=r);s=make();s.trigger(uid,'a');t=timers.shift();t.fn();await Promise.resolve();assert.equal(calls,1);releaseActive();await s.running;assert.equal(calls,2);active=null;
 // Delayed task visibility retries twice, with no full-scan mode or rapid request loop.
 let attempts=0;s=make(async()=>{attempts++;return {tasks:attempts===3?{a:{}}:{}}});s.trigger(uid,'a');for(let n=0;n<3;n++){t=timers.shift();assert(t);if(n)assert(t.ms>=15000);clock+=t.ms;t.fn();await s.running;}assert.equal(attempts,3);assert.equal(timers.length,0);
 s=make();s.trigger(uid,'a');uid='456';t=timers.shift();t.fn();await s.running;assert.equal(calls,2);assert.equal(timers.length,0);
 s.trigger('123','a');assert.equal(timers.length,0);s.trigger(uid,'b');assert.equal(timers.length,1);stopped=true;s.close();assert.equal(timers.length,0);s.trigger(uid,'c');assert.equal(timers.length,0);
 console.log('PASS successful-submit batching, follow-up for mid-scan submissions, wait for existing full refresh, delayed visibility bounded retries, account/shutdown isolation and forced incremental callback');
})().catch(e=>{console.error(e);process.exitCode=1});
