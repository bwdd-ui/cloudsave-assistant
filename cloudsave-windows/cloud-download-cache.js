// Retain account-specific history; read new tasks after the last successful checkpoint.
class CloudDownloadCache {
  constructor({ read, write, account, page, task=null, key, log, stopped=()=>false, now=()=>Date.now(), interval=()=>3600000, lookbackHours=()=>0, enabled=()=>true, onProgress=()=>{}, wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)) }) {
    Object.assign(this,{read,write,account,page,task,key,log,stopped,now,wait,interval,lookbackHours,enabled,onProgress});
    this.data=read() || {version:1,accounts:{}}; this.data.accounts ||= {}; this.running=null;this.attempts=new Map();this.progress={running:false};
  }
  report(value){this.progress={...this.progress,...value};try{this.onProgress({...this.progress});}catch(_){}}
  state(uid,url) { return this.data.accounts[String(uid)]?.tasks?.[this.key(url)]?.state || 'unknown'; }
  snapshot(uid){const value=this.data.accounts[String(uid)];if(!value)return [];return (value.currentKeys || Object.keys(value.tasks || {})).flatMap(key=>value.tasks[key]?[{key,...value.tasks[key]}]:[]);}
  lastSyncAt(uid,now=this.now()) { return Math.max(0,...[this.data.accounts[String(uid)]?.syncedAt,this.attempts.get(String(uid))].map(value=>{const time=Number(value);return Number.isFinite(time)&&time>0&&time<=now?time:0;})); }
  nextSyncAt(uid,interval=this.interval(),now=this.now()) { const last=this.lastSyncAt(uid,now);return last?last+interval:now; }
  retryable(uid,url) { return ['downloading','failed'].includes(this.state(uid,url)); }
  sync(force=false,{full=false,checkOldTasks=true}={}) {
    if(this.running){if(full&&this.progress.mode!=='full')return Promise.reject(new Error('当前增量同步尚未完成，请完成后再点击全部同步'));return this.running;}
    this.running=this.refresh(force,full,checkOldTasks).catch(error=>{this.report({running:false,phase:'failed',error:error.message});throw error;}).finally(()=>{this.running=null;if(this.progress.phase==='reading')this.report({running:false,phase:'complete'});});return this.running;
  }
  async refresh(force,full=false,checkOldTasks=true) {
    const uid=String(this.account() || '');if(!uid){if(force)throw new Error('请先登录115账号');return;}if(this.stopped()||!force&&!this.enabled())return;
    const previous=this.data.accounts[uid] || {tasks:{}};
    const startedAt=this.now(),lastSyncAt=this.lastSyncAt(uid,startedAt);
    if(!force && lastSyncAt && (Array.isArray(previous.currentKeys)||this.attempts.has(uid)) && startedAt-lastSyncAt<this.interval())return;
    this.attempts.set(uid,startedAt);this.report({uid,running:true,phase:'reading',mode:full?'full':'incremental',page:0,pages:0,readCount:0,fetchedCount:0,statusChecked:0,error:''});
    const tasks={...previous.tasks};let pages=1,count=0,added=0,changed=0;const fingerprints=new Set(),observed=new Map();
    const hours=Number(this.lookbackHours())||0,incremental=hours>0&&!full;
    // A five-minute overlap catches page-boundary races. Enlarging the range explicitly re-reads that range.
    const checkpoint=incremental&&(previous.incremental||previous.fullSyncedAt)&&(previous.fullSyncedAt||Number(previous.lookbackHours)===hours)&&Number(previous.syncedAt)>0&&Number(previous.syncedAt)<=startedAt?Number(previous.syncedAt):0;
    const cutoff=incremental?(checkpoint&&previous.fullSyncedAt?checkpoint-300000:Math.max(startedAt-hours*3600000,checkpoint?checkpoint-300000:0)):0;
    let lastCreated=Infinity,reachedBoundary=false,pageReads=0,fetchedCount=0,statusChecked=0,statusErrors=0;
    for(let page=1;page<=pages;page++) {
      if(this.stopped()||String(this.account())!==uid)throw new Error('115账户已更换或软件正在退出，未更新云下载缓存');
      if(page>1)await this.wait(1000);
      const result=await this.page(page),data=result.data;
      pageReads++;
      const list=result.tasks || data?.tasks || data?.list || (Array.isArray(data)?data:null);
      if(!Array.isArray(list))throw new Error('115云下载任务列表格式异常');
      const pageCount=result.page_count??data?.page_count;
      if(full&&pageCount===undefined)throw new Error('115全部同步缺少分页总数，未覆盖原缓存');
      const total=Number(pageCount??1);
      if(!Number.isInteger(total)||total<1||total>10000)throw new Error('115云下载分页异常');
      pages=total;
      if(full&&page<pages&&!list.length)throw new Error('115全部同步提前返回空页，未覆盖原缓存');
      const fingerprint=JSON.stringify(list.map(t=>t.info_hash || t.hash || t.url || t.id || t.task_id));
      if(list.length&&fingerprints.has(fingerprint))throw new Error('115云下载重复返回同一页，保留原缓存');
      fingerprints.add(fingerprint);
      for(const task of list) {
        fetchedCount++;
        const createdAt=taskCreatedAt(task);
        if(incremental){if(!createdAt)throw new Error('115任务添加时间缺失，已停止增量同步并保留缓存');if(createdAt>lastCreated)throw new Error('115任务未按添加时间倒序返回，已停止增量同步，未退回全量');lastCreated=createdAt;if(createdAt<cutoff){reachedBoundary=true;continue;}}
        const hash=task.info_hash || task.hash || '',url=task.url || (hash?`magnet:?xt=urn:btih:${hash}`:'');
        const key=url?this.key(url):task.id || task.task_id?`task:${task.id || task.task_id}`:'';if(!key)continue;
        observed.set(key,taskValue(task,url,createdAt));
      }
      this.report({uid,running:true,phase:'reading',page,pages,readCount:observed.size,fetchedCount,pageReads,incremental,checkpoint,rangeStart:cutoff});
      if(incremental&&(reachedBoundary||!list.length))break;
    }
    // Older unfinished tasks can change without appearing in the new-task range.
    // Query only known hashes, rotate at most 20 per sync, and never fall back to list pagination.
    let pendingCursor=Number(previous.pendingCursor)||0;
    const previousStatusAt=Number(previous.oldStatusSyncedAt||previous.syncedAt||0);
    const checkStatuses=incremental&&this.task&&(checkOldTasks||startedAt-previousStatusAt>=this.interval());
    if(checkStatuses){
      const pending=Object.entries(previous.tasks||{}).filter(([key,value])=>!observed.has(key)&&['downloading','failed','unknown'].includes(value.state)&&/^[a-f0-9]{40}$/i.test(value.infoHash||String(value.url||'').match(/btih:([a-f0-9]{40})(?:&|$)/i)?.[1]||''));
      const start=pending.length?pendingCursor%pending.length:0,budget=Math.min(20,pending.length);
      for(let n=0;n<budget;n++){
        if(this.stopped()||String(this.account())!==uid)throw new Error('115账户已更换或软件正在退出，未更新云下载缓存');
        const [key,old]=pending[(start+n)%pending.length];
        this.report({uid,running:true,phase:'checking',statusChecked,statusTotal:budget});
        if(n)await this.wait(300);
        statusChecked++;
        try{
          const value=await this.task(old),hash=String(old.infoHash||old.url.match(/btih:([a-f0-9]{40})(?:&|$)/i)?.[1]||'').toLowerCase();
          if(value&&String(value.info_hash||value.hash||'').toLowerCase()===hash&&taskStatus(value).status!==null){
            // Single-task responses may omit list metadata; keep the cached title/date/size.
            const status=taskStatus(value);
            observed.set(key,{...old,...status,fileId:String(value.file_id||value.fid||value.data?.file_id||value.data?.fid||old.fileId||''),percent:value.percentDone??value.display_percent??old.percent});
          }else statusErrors++;
        }catch(_){statusErrors++;}
      }
      pendingCursor=pending.length?(start+budget)%pending.length:0;
    }
    if(this.stopped()||String(this.account())!==uid)throw new Error('115账户已更换，未更新云下载缓存');
    count=observed.size;
    for(const [key,value] of observed){const old=tasks[key];if(!old){added++;}else if(Object.keys(value).some(field=>field!=='checkedAt'&&old[field]!==value[field])){changed++;}tasks[key]={...value,checkedAt:this.now()};}
    // Disappearing/removed tasks are not failures. Retain the last observed result.
    const currentKeys=incremental||full?[...new Set([...Object.keys(previous.tasks||{}),...observed.keys()])]:[...observed.keys()];
    const counts={downloading:0,failed:0,completed:0,unknown:0};for(const key of currentKeys)if(tasks[key])counts[tasks[key].state]++;
    const value={tasks,currentKeys,counts,syncedAt:startedAt,oldStatusSyncedAt:full||checkStatuses?startedAt:previousStatusAt,fullSyncedAt:full?startedAt:previous.fullSyncedAt||0,fullReadCount:full?count:previous.fullReadCount||0,lastSyncMode:full?'full':'incremental',count:currentKeys.length,readCount:count,fetchedCount,pageReads,statusChecked,statusErrors,pendingCursor,added,changed,incremental,checkpoint,lookbackHours:hours,rangeStart:cutoff};
    const next={...this.data,accounts:{...this.data.accounts,[uid]:value}};
    await this.write(next);this.data=next;
    this.report({uid,running:false,phase:'complete',statusChecked,statusErrors,pageReads,fetchedCount,readCount:count});
    this.log(`115云下载${full?'全部同步并缓存':incremental?'增量缓存同步':'核查'}：列表读取 ${pageReads} 页/${fetchedCount} 条，旧任务状态核对 ${statusChecked} 条${statusErrors?'（'+statusErrors+'条未确认，保留旧状态）':''}；累计缓存 ${currentKeys.length} 条，新增 ${added} 条、变化 ${changed} 条；下次约 ${Math.round(this.interval()/60000)} 分钟后`);return value;
  }
}
function taskCreatedAt(task){const raw=task.add_time||task.create_time||task.time||0,stamp=Number(raw);if(stamp>1e12)return stamp;if(stamp>1e9)return stamp*1000;return typeof raw==='string'?Date.parse(raw)||0:0;}
function taskStatus(task){const raw=task.status,number=typeof raw==='number'||typeof raw==='string'&&raw.trim()!==''?Number(raw):NaN,status=Number.isSafeInteger(number)?number:NaN;return {state:status===2?'completed':status===-1?'failed':[0,1].includes(status)?'downloading':'unknown',status:Number.isFinite(status)?status:null};}
function taskValue(task,url,createdAt){return {...taskStatus(task),fileId:String(task.file_id||task.fid||task.data?.file_id||task.data?.fid||''),infoHash:String(task.info_hash||task.hash||url.match(/btih:([a-f0-9]{40})(?:&|$)/i)?.[1]||'').toLowerCase(),percent:task.percentDone??task.display_percent??null,url,title:String(task.name||task.file_name||task.title||'').slice(0,500),size:String(task.size||task.file_size||''),createdAt,folderName:String(task.savepath_name||task.path_name||'')};}
module.exports={CloudDownloadCache,taskCreatedAt};
