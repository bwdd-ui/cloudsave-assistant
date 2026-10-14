function bounded(task,ms,label,{signal,onTimeout}={}){
 if(signal?.aborted)return Promise.reject(signal.reason || Error('读取已取消'));
 let timer,abort;const guard=new Promise((_,reject)=>{
  timer=setTimeout(()=>{onTimeout?.();reject(Error(label+'超时，请重新加载或检查网站连接'));},ms);
  if(signal){abort=()=>reject(signal.reason || Error('读取已取消'));signal.addEventListener('abort',abort,{once:true});}
 });return Promise.race([Promise.resolve().then(()=>{if(signal?.aborted)throw signal.reason || Error('读取已取消');return task();}),guard]).finally(()=>{clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);});
}
class ReadQueue{
 constructor(){this.pending=[];this.busy=false;this.closed=false;}
 enqueue(run,priority=10,signal){if(this.closed)return Promise.reject(Error('读取已停止'));let job;return bounded(()=>new Promise((resolve,reject)=>{if(this.closed){reject(Error('读取已停止'));return;}job={run,priority,resolve,reject,signal};this.pending.push(job);this.drain();}),90000,'等待网站读取',{signal,onTimeout:()=>{if(job)this.pending=this.pending.filter(x=>x!==job);}});}
 async drain(){if(this.busy)return;this.busy=true;try{while(this.pending.length){this.pending.sort((a,b)=>b.priority-a.priority);const job=this.pending.shift();if(job.signal?.aborted){job.reject(job.signal.reason || Error('读取已取消'));continue;}try{job.resolve(await job.run());}catch(e){job.reject(e);}}}finally{this.busy=false;}}
 close(){this.closed=true;for(const job of this.pending.splice(0))job.reject(Error('读取已停止'));}
}
async function parseInWindow(owner,html,kind,url,extract){
 try{if(!owner.window||owner.window.isDestroyed()){owner.window=new owner.BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});await bounded(()=>owner.window.loadURL('about:blank'),10000,'初始化页面解析');}
  return await bounded(()=>owner.window.webContents.executeJavaScript('('+extract.toString()+')('+JSON.stringify(html)+','+JSON.stringify(kind)+','+JSON.stringify(url)+')'),10000,'解析网站页面');
 }catch(e){const old=owner.window;owner.window=null;if(old&&!old.isDestroyed())old.destroy();throw e;}
}
async function loadPage(win,url,label){
 for(let attempt=0;attempt<2;attempt++){try{return await bounded(()=>win.loadURL(url),30000,label+'网页加载',{onTimeout:()=>{if(!win.isDestroyed())win.webContents.stop();}});}catch(e){if(attempt===0&&/ERR_FAILED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|ERR_NETWORK_CHANGED/.test(e.message)){await new Promise(r=>setTimeout(r,500));continue;}throw e;}}
}
module.exports={bounded,ReadQueue,parseInWindow,loadPage};
