function syncPreferences(value={}) {
  const minutes=Number(value.intervalMinutes ?? 60);
  if(!Number.isInteger(minutes)||minutes<1||minutes>10080)throw Error('同步间隔请输入 1–10080 的整数分钟');
  return {enabled:value.enabled!==false,intervalMinutes:minutes};
}
class CloudSyncSchedule {
  constructor({state,sync,stopped=()=>false,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){Object.assign(this,{state,sync,stopped,now,setTimer,clearTimer});}
  arm(){this.close();if(this.stopped())return;const state=this.state();if(!state.enabled||!state.uid)return;
    const delay=Math.max(1000,(state.nextSyncAt||this.now())-this.now());
    this.timer=this.setTimer(()=>{this.timer=null;if(this.stopped())return;Promise.resolve().then(()=>this.sync()).finally(()=>this.arm()).catch(()=>{});},delay);
    this.timer?.unref?.();
  }
  close(){if(this.timer!=null)this.clearTimer(this.timer);this.timer=null;}
}
module.exports={syncPreferences,CloudSyncSchedule};
