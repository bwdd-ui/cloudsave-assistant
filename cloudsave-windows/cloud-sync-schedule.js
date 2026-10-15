function syncPreferences(value={}) {
  const minutes=Number(value.intervalMinutes ?? 60);
  if(!Number.isInteger(minutes)||minutes<1||minutes>10080)throw Error('同步间隔请输入 1–10080 的整数分钟');
  return {enabled:value.enabled!==false,intervalMinutes:minutes};
}
class CloudSyncSchedule {
  constructor({state,sync,stopped=()=>false,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){Object.assign(this,{state,sync,stopped,now,setTimer,clearTimer});this.generation=0;}
  arm(){this.close();if(this.stopped())return;const state=this.state();if(!state.enabled||!state.uid)return;
    const delay=Math.max(1000,(state.nextSyncAt||this.now())-this.now());
    const generation=this.generation;
    this.timer=this.setTimer(()=>{
      if(generation!==this.generation)return;
      this.timer=null;if(this.stopped())return;
      return Promise.resolve().then(()=>{if(generation===this.generation&&!this.stopped())return this.sync();}).finally(()=>{if(generation===this.generation)this.arm();}).catch(()=>{});
    },delay);
    this.timer?.unref?.();
  }
  close(){this.generation++;if(this.timer!=null)this.clearTimer(this.timer);this.timer=null;}
}
module.exports={syncPreferences,CloudSyncSchedule};
