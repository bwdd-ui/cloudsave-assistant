const assert=require('node:assert/strict'),{Qmp4Provider}=require('../qmp4-provider');
(async()=>{
 let entered,signal,parsed=0,written=0;const ready=new Promise(resolve=>entered=resolve),control=new AbortController();
 const provider=new Qmp4Provider({fetchHtml:(_url,options={})=>{signal=options.signal;entered();return new Promise((_,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));},parseHtml:async()=>{parsed++;return {};},diskCache:{get:()=>null,set:()=>written++}});
 const job=provider.read('/mv/3.html','detail',true,{signal:control.signal});await ready;
 control.abort(Error('native scan stopped'));await assert.rejects(job,/native scan stopped/);provider.close();
 assert.equal(signal,control.signal,'Cancellation must reach the injected browser-session transport');assert(signal.aborted);assert.equal(parsed,0);assert.equal(written,0);
 const fs=require('fs'),vm=require('vm'),path=require('path'),prefix=fs.readFileSync(path.join(__dirname,'test-gy-v2-policy.cjs'),'utf8').split('const {GuanyingProvider')[0],ctx=vm.createContext({require,console,Buffer,process,URL,URLSearchParams,__dirname});vm.runInContext(prefix+'\nglobalThis.getHarness=harness;',ctx);const h=ctx.getHarness();h.ctx.AbortSignal=AbortSignal;
 h.run(`session.fromPartition=()=>({getUserAgent:()=> 'Synthetic UA',setUserAgent:()=>{},fetch:async(url,options)=>{globalThis.nativeSignal=options.signal;return {ok:true,url,text:async()=> 'synthetic'};}});`);
 const caller=new AbortController();h.ctx.callerSignal=caller.signal;
 await h.run("getQmp4Provider().fetchHtml('https://www.qmp4.com/mv/3.html',{signal:callerSignal})");assert(!h.ctx.nativeSignal.aborted);
 caller.abort(Error('caller stopped'));assert(h.ctx.nativeSignal.aborted);assert.equal(h.ctx.nativeSignal.reason,caller.signal.reason);
 console.log('PASS cancellation reaches Qmp4 injected and actual browser-session transports, no parsing/cache after stop');
})().catch(error=>{console.error(error);process.exitCode=1;});
