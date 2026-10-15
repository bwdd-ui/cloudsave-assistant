const assert=require('node:assert/strict'),{bounded}=require('../site-reader');
(async()=>{
 let timeouts=0;await assert.rejects(bounded(()=>new Promise(()=>{}),5,'synthetic read',{onTimeout:()=>{timeouts++;throw Error('disposed web contents');}}),error=>error.message.includes('超时')&&error.cause?.message==='disposed web contents');assert.equal(timeouts,1);
 const controller=new AbortController(),reason=Error('synthetic canceled');let aborts=0;const reading=bounded(()=>new Promise(()=>{}),1000,'read',{signal:controller.signal,onAbort:()=>{aborts++;throw Error('cleanup failure');}});const canceled=assert.rejects(reading,error=>error===reason);await Promise.resolve();assert.doesNotThrow(()=>controller.abort(reason));await canceled;await new Promise(r=>setImmediate(r));assert.equal(aborts,1);
 let cleanup=0;assert.equal(await bounded(()=>42,1000,'read',{onTimeout:()=>cleanup++,onAbort:()=>cleanup++}),42);assert.equal(cleanup,0);
 await assert.rejects(bounded(()=>{throw Error('original read failure');},1000,'read',{onTimeout:()=>cleanup++}),/original read failure/);assert.equal(cleanup,0);
 console.log('PASS throwing timeout cleanup still rejects with timeout/cause; throwing abort cleanup preserves original reason without uncaught errors; success and read failures unchanged');
})().catch(error=>{console.error(error);process.exitCode=1;});
