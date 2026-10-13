// Submission events bypass the periodic interval, but share the cache's single flight.
class CloudSubmitSync {
 constructor({account,sync,active=()=>null,stopped=()=>false,log=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,delay=3000}){Object.assign(this,{account,sync,active,stopped,log,now,setTimer,clearTimer,delay});this.revision=0;this.done=0;this.uid='';this.running=null;this.timer=null;this.lastAttempt=0;this.retries=0;this.expected=new Set();}
 trigger(uid,key){uid=String(uid||'');if(!uid||this.stopped()||String(this.account())!==uid)return;if(this.uid!==uid)this.expected.clear();this.uid=uid;if(key)this.expected.add(key);this.revision++;this.retries=0;this.arm();}
 arm(retryDelay=0){if(this.timer!==null||this.running||this.stopped()||this.done===this.revision)return;const wait=Math.max(this.delay,retryDelay,5000-(this.now()-this.lastAttempt));this.timer=this.setTimer(()=>{this.timer=null;this.run();},wait);this.timer?.unref?.();}
 run(){if(this.running||this.stopped())return this.running;
  const uid=this.uid;
  this.running=Promise.resolve().then(async()=>{
   const active=this.active();if(active)try{await active;}catch(_){}
   if(this.stopped()||String(this.account())!==uid||this.uid!==uid){if(this.uid===uid)this.done=this.revision;return;}
   const revision=this.revision,expected=[...this.expected];this.lastAttempt=this.now();
   this.log('磁力提交成功，自动增量同步115云下载');
   const result=await this.sync();
   if(!result)throw Error('增量缓存未更新');
   let missing=false;for(const key of expected){if(result.tasks?.[key])this.expected.delete(key);else missing=true;}
   if(missing)throw Error('115列表暂未显示已提交任务，稍后重试');
   this.done=revision;this.retries=0;
  }).catch(error=>{this.log('提交后增量同步暂未完成，保留缓存：'+error.message);this.retries++;if(this.retries>2){this.done=this.revision;this.expected.clear();}}).finally(()=>{this.running=null;this.arm(this.retries?15000:0);});
  return this.running;
 }
 close(){if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;}
}
module.exports={CloudSubmitSync};
