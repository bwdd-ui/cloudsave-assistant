// Browsing snapshots never replace the monitor's fresh provider queries.
class BrowseCache {
 constructor({cache,notify=()=>{},log=()=>{},delay=5000,now=Date.now}){Object.assign(this,{cache,notify,log,delay,now});this.pending=new Map();this.timers=new Set();this.closed=false;}
 key(site,args){return 'browse:v1:'+site+':'+JSON.stringify(args);}
 async get(site,args,load){const key=this.key(site,args),saved=this.cache.get(key,7*86400000);if(saved){if(this.now()-saved.time>180000)this.refresh(key,site,load,true);return {...saved.value,browseCache:{time:saved.time,updating:this.pending.has(key)}};}return this.refresh(key,site,load,false);}
 refresh(key,site,load,deferred){if(this.pending.has(key))return this.pending.get(key);const task=(async()=>{if(deferred)await new Promise(resolve=>{const t=setTimeout(()=>{this.timers.delete(t);resolve();},this.delay);this.timers.add(t);});if(this.closed)return;const value=await load();if(this.closed)return value;this.cache.set(key,{time:this.now(),value});this.notify({site,key});return value;})().catch(error=>{if(deferred){if(!this.closed)this.log(site,error);return;}throw error;}).finally(()=>this.pending.delete(key));this.pending.set(key,task);return task;}
 close(){this.closed=true;/* timers finish without fetching; no rejected detached promises */}
}
module.exports={BrowseCache};
