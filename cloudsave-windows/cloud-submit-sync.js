// Submission events bypass the periodic interval, but share the cache's single flight.
class CloudSubmitSync {
 constructor({account,sync,active=()=>null,stopped=()=>false,log=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,delay=3000}){Object.assign(this,{account,sync,active,stopped,log,now,setTimer,clearTimer,delay});this.revision=0;this.done=0;this.uid='';this.generation=0;this.closed=false;this.running=null;this.timer=null;this.lastAttempt=0;this.retries=0;this.expected=new Set();}
 report(message){try{this.log(message);}catch(_){/* Logging must not interrupt post-submit synchronization or retries. */}}
 trigger(uid,key){uid=String(uid||'');if(!uid||this.closed||this.stopped()||String(this.account())!==uid)return;if(this.uid!==uid){this.expected.clear();this.generation++;}this.uid=uid;if(key)this.expected.add(key);this.revision++;this.retries=0;this.arm();}
 arm(retryDelay=0){if(this.timer!==null||this.running||this.closed||this.stopped()||this.done===this.revision)return;const wait=Math.max(this.delay,retryDelay,5000-(this.now()-this.lastAttempt));this.timer=this.setTimer(()=>{this.timer=null;return this.run();},wait);this.timer?.unref?.();}
 run(){if(this.running||this.closed||this.stopped())return this.running;
  const uid=this.uid,generation=this.generation;let revision=this.revision;
  const current=()=>!this.closed&&!this.stopped()&&generation===this.generation&&String(this.account())===uid;
  this.running=Promise.resolve().then(async()=>{
   const active=this.active();if(active)try{await active;}catch(_){}
   if(!current()){if(generation===this.generation)this.done=this.revision;return;}
   revision=this.revision;const expected=[...this.expected];this.lastAttempt=this.now();
   this.report('磁力提交成功，自动增量同步115云下载');
   const result=await this.sync();
   if(!current()){if(generation===this.generation)this.done=this.revision;return;}
   if(!result)throw Error('增量缓存未更新');
   let missing=false;for(const key of expected){if(result.tasks?.[key])this.expected.delete(key);else missing=true;}
   if(missing)throw Error('115列表暂未显示已提交任务，稍后重试');
   this.done=revision;this.retries=0;
  }).catch(error=>{if(!current()){if(generation===this.generation)this.done=this.revision;return;}this.report('提交后增量同步暂未完成，保留缓存：'+error.message);if(revision!==this.revision)return;this.retries++;if(this.retries>2){this.done=revision;this.expected.clear();}}).finally(()=>{this.running=null;this.arm(this.retries?15000:0);});
  return this.running;
 }
 close(){this.closed=true;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;}
}
module.exports={CloudSubmitSync};
