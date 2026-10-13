'use strict';
const {parseShare}=require('./pan123-provider');const {randomUUID}=require('crypto');
const fingerprint=f=>[String(f.FileId),f.FileName,String(f.Size),String(f.Etag||''),String(f.UpdateAt||'')].join('|');
const sameFile=(a,b)=>Number(a.Type)===0&&a.FileName===b.FileName&&String(a.Size)===String(b.Size)&&Boolean(a.Etag)&&String(a.Etag)===String(b.Etag);
class Pan123Monitor{
 constructor({read,write,provider,notify=()=>{},log=()=>{}}){this.read=read;this.write=write;this.provider=provider;this.notify=notify;this.log=log;this.running=null;this.controller=null;this.timer=null;this.closed=false;this.activeId='';}
 data(){if(this.cache)return this.cache;const d=this.read();if(!d)return this.cache={version:1,tasks:[]};if(d.version!==1||!Array.isArray(d.tasks))throw new Error('123监控缓存格式异常，未覆盖原数据');return this.cache=d;}
 state(){return {tasks:this.data().tasks.map(({saved,pending,...task})=>({...task,savedCount:Object.keys(saved||{}).length,pendingCount:Object.keys(pending||{}).length})),running:!!this.running,activeId:this.activeId};}
 persist(data){this.write(data);this.notify(this.state());}
 save(value){
  if(this.running&&value.id===this.activeId)throw new Error('请先停止此任务后再修改');const links=String(value.url).match(/https?:\/\//g)||[];if(links.length!==1)throw new Error('每个任务只能配置一个分享链接，请分别新增任务并选择对应文件夹');const share=parseShare(value.url,value.password),interval=Number(value.intervalMinutes),target=String(value.targetId??'');
  if(!Number.isInteger(interval)||interval<1||interval>10080)throw new Error('检查间隔请输入1–10080的整数分钟');if(!/^\d+$/.test(target))throw new Error('请选择123云盘目标文件夹');
  const data=this.data(),previous=value.id?data.tasks.find(t=>t.id===value.id):null;
  if(value.id&&!previous)throw new Error('任务不存在');
  const changed=previous&&(previous.shareKey!==share.shareKey||previous.targetId!==target);
  const task={...(changed?{}:previous),id:previous?.id||randomUUID(),...share,name:String(value.name||share.shareKey).slice(0,100),targetId:target,targetName:String(value.targetName||'根目录'),enabled:Boolean(value.enabled),intervalMinutes:interval,lastMessage:changed?'分享或目标已变更，将重新全量核对':previous?.lastMessage||'等待首次全量扫描',nextCheckAt:Date.now(),saved:changed?{}:previous?.saved||{},pending:changed?{}:previous?.pending||{}};
  if(previous)data.tasks[data.tasks.indexOf(previous)]=task;else data.tasks.push(task);this.persist(data);return this.state();
 }
 remove(id){if(this.activeId===id)throw new Error('请先停止该任务');const data=this.data();data.tasks=data.tasks.filter(t=>t.id!==id);this.persist(data);return this.state();}

 start(){if(this.timer||this.closed)return;this.timer=setInterval(()=>this.tick(),15000);this.timer.unref?.();}
 tick(){if(this.running||this.closed)return;const due=this.data().tasks.find(t=>t.enabled&&(!t.nextCheckAt||t.nextCheckAt<=Date.now()));if(due)this.run(due.id).catch(()=>{});}
 stop(){this.controller?.abort(new Error('已停止123云盘扫描'));return this.state();}
 close(){this.closed=true;clearInterval(this.timer);this.stop();return this.running;}
 run(id){
  if(this.closed)return Promise.reject(new Error('程序正在退出'));if(this.running)return Promise.reject(new Error('已有123云盘任务正在扫描'));
  this.controller=new AbortController();this.activeId=id;this.running=this.execute(id,this.controller.signal).finally(()=>{this.running=null;this.controller=null;this.activeId='';this.notify(this.state());});this.notify(this.state());return this.running;
 }
 async execute(id,signal){
  const data=this.data(),task=data.tasks.find(t=>t.id===id);if(!task)throw new Error('任务不存在');let savedNow=0,skipped=0,waiting=0;
  try{
   const provider=this.provider.snapshot?.()||this.provider;
   const account=await provider.account(signal);if(task.accountUid&&task.accountUid!==account.uid)throw new Error('此任务绑定的123云盘账号与当前登录不同，请切回原账号或新建任务');task.accountUid=account.uid;
   task.lastMessage='正在递归扫描分享文件列表…';this.persist(data);
   // Scan the complete share before any transfer. A failed/partial listing is never a new baseline.
   const queue=[{source:'0',path:[]}],visited=new Set(),files=[],folders=[];
   while(queue.length){signal.throwIfAborted();const dir=queue.shift();if(visited.has(dir.source))throw new Error('分享目录出现重复引用，已停止');visited.add(dir.source);
    const rows=await provider.list(dir.source,task,signal);for(const row of rows){if(Number(row.Type)===1){const child={source:String(row.FileId),path:[...dir.path,row.FileName]};folders.push(child);queue.push(child);}else {if(!row.Etag)throw new Error('分享文件缺少内容校验值，未继续转存：'+row.FileName);files.push({file:row,path:dir.path});}}
    task.lastMessage=`扫描中：${files.length} 个文件，${folders.length} 个文件夹`;this.notify(this.state());
   }
   task.scannedCount=files.length;task.folderCount=folders.length;
   const directoryCache=new Map(),destinationByPath=new Map([['[]',task.targetId]]);
   const children=async pid=>{if(!directoryCache.has(pid))directoryCache.set(pid,await provider.list(pid,null,signal));return directoryCache.get(pid);};
   await children(task.targetId); // Validate destination even for an empty share.
   const ensure=async parts=>{let pid=task.targetId;for(let i=0;i<parts.length;i++){const key=JSON.stringify(parts.slice(0,i+1));if(destinationByPath.has(key)){pid=destinationByPath.get(key);continue;}const existing=(await children(pid)).filter(f=>Number(f.Type)===1&&f.FileName===parts[i]);if(existing.length>1)throw new Error('目标存在同名文件夹，请整理后重试：'+parts[i]);let next=existing[0]?.FileId;if(!next){next=await provider.mkdir(parts[i],pid,signal);directoryCache.delete(pid);}pid=String(next);destinationByPath.set(key,pid);}return pid;};
   for(const dir of folders){signal.throwIfAborted();await ensure(dir.path);}
   for(const {file,path} of files){signal.throwIfAborted();const key=JSON.stringify([path,fingerprint(file)]);if(task.saved[key]){skipped++;continue;}
    const pid=await ensure(path);let rows=await children(pid);const matching=rows.find(f=>sameFile(f,file));
    if(matching){task.saved[key]={at:Date.now(),destinationId:String(matching.FileId)};delete task.pending[key];skipped++;this.persist(data);continue;}
    // Persist intent before the mutation; reconcile uncertain responses instead of blindly resubmitting.
    if(task.pending[key]&&Date.now()-task.pending[key].at<30*60000){waiting++;continue;}
    task.pending[key]={at:Date.now(),name:file.FileName,parentId:pid};this.persist(data);
    try{await provider.save(file,pid,task,signal);}catch(error){if(!signal.aborted&&!/超时|timeout|aborted|fetch failed|网络|HTTP 5/i.test(error.message)){delete task.pending[key];this.persist(data);}throw error;}
    directoryCache.delete(pid);rows=await children(pid);const confirmed=rows.find(f=>sameFile(f,file));
    if(confirmed){task.saved[key]={at:Date.now(),destinationId:String(confirmed.FileId)};delete task.pending[key];savedNow++;}else waiting++;
    task.lastMessage=`转存中：已确认 ${savedNow}，已存在 ${skipped}，待确认 ${waiting} / ${files.length}`;this.persist(data);
   }
   task.initialComplete=waiting===0;task.lastRun=Date.now();task.lastMessage=`扫描完成：${files.length} 个文件，本次转存 ${savedNow}，跳过 ${skipped}，待确认 ${waiting}`;
   this.log(task.name+'：'+task.lastMessage,'info');
  }catch(error){task.lastRun=Date.now();task.lastMessage=signal.aborted?'已停止扫描，已确认记录和待确认转存保留':String(error.message);this.log(task.name+'：'+task.lastMessage,'warning');throw error;}
  finally{task.nextCheckAt=Date.now()+task.intervalMinutes*60000;this.persist(data);}
 }
 retryPending(id){if(this.running)throw new Error('请先停止扫描');const data=this.data(),task=data.tasks.find(t=>t.id===id);if(!task)throw new Error('任务不存在');task.pending={};this.persist(data);return this.state();}
}
module.exports={Pan123Monitor,fingerprint,sameFile};
