'use strict';
const {bounded}=require('./site-reader');
class GuanyingSession{
 constructor({partition,origin,read,save,encrypt,decrypt,log=()=>{}}){Object.assign(this,{partition,origin,read,save,encrypt,decrypt,log});this.restoring=null;this.attached=false;this.timer=null;this.closed=false;}
 allowed(cookie){const host=new URL(this.origin).hostname;return [host,host.replace(/^www\./,'')].includes(String(cookie.domain||'').replace(/^\./,''));}
 async liveCookies(){const domain=new URL(this.origin).hostname.replace(/^www\./,'');return (await this.partition.cookies.get({domain})).filter(cookie=>this.allowed(cookie));}
 restore(){if(this.restoring)return this.restoring;this.restoring=this.performRestore().catch(e=>{this.restoring=null;throw e;});return this.restoring;}
 async performRestore(){const stored=this.read()||{},p=this.partition;
  const ua=stored.userAgent||p.getUserAgent?.()?.replace(/\s(?:Electron|cloudsave-windows|CloudSave)\/\S+/gi,'');if(ua)p.setUserAgent?.(ua);
  let current=await this.liveCookies();
  if(stored.cookies){
   let failed=false;
   try{const backup=JSON.parse(this.decrypt(stored.cookies));if(!Array.isArray(backup))throw Error('会话备份格式无效');
    for(const cookie of backup){try{
     if(!cookie||typeof cookie!=='object'||Array.isArray(cookie)||typeof cookie.name!=='string'||typeof cookie.value!=='string'){failed=true;continue;}
     if(!this.allowed(cookie)||cookie.expirationDate&&cookie.expirationDate<Date.now()/1000)continue;
     // Chromium may contain a renewed session newer than our backup.
     if(current.some(c=>c.name===cookie.name&&(c.path||'/')===(cookie.path||'/')&&String(c.domain).replace(/^\./,'')===String(cookie.domain).replace(/^\./,'')&&(!c.expirationDate||c.expirationDate>Date.now()/1000)))continue;
     const {name,value,path,secure,httpOnly,expirationDate,sameSite}=cookie;
     await p.cookies.set({url:this.origin,name,value,path:path||'/',secure,httpOnly,...(!cookie.hostOnly&&cookie.domain?{domain:cookie.domain}:{}),...(expirationDate?{expirationDate}:{}),...(sameSite?{sameSite}:{})});
    }catch(_){failed=true;}}
   }catch(_){failed=true;}
   if(failed){try{this.log('观影会话部分备份恢复失败，已继续恢复有效记录并保留当前浏览器会话','warning');}catch(_){}}
  }
  if(!this.attached){this.attached=true;p.cookies.on?.('changed',(_event,cookie)=>{if(!this.allowed(cookie)||this.closed)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.capture().catch(()=>{}),400);this.timer.unref?.();});}
 }
 capture(win){const next=(this.pending||Promise.resolve()).catch(()=>{}).then(()=>this.performCapture(win));this.pending=next;return next;}
 async performCapture(win){if(this.closed)return;const old=this.read()||{},cookies=await this.liveCookies();let storage=old.storage||'';
  if(win&&!win.isDestroyed()){try{if(new URL(win.webContents.getURL()).origin===this.origin){const value=await bounded(()=>win.webContents.executeJavaScript(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])))`),8000,'保存观影网站状态');if(value.length<1024*1024)storage=this.encrypt(value);}}catch{}}
  const changed=this.decrypt(old.cookies||'')!==JSON.stringify(cookies)||(storage&&this.decrypt(storage)!==this.decrypt(old.storage||''));
  // The login window may close while cookies/storage are being read. Its
  // destruction must not discard the live cookie jar or fail exit-time saving.
  let windowAgent;
  try{if(win&&!win.isDestroyed())windowAgent=win.webContents.getUserAgent?.();}catch{}
  const userAgent=windowAgent||this.partition.getUserAgent?.()||old.userAgent;
  if(changed||old.userAgent!==userAgent)this.save({...old,cookies:this.encrypt(JSON.stringify(cookies)),storage,userAgent,savedAt:changed?new Date().toISOString():old.savedAt||new Date().toISOString()});
  await this.partition.cookies.flushStore?.();await this.partition.flushStorageData?.();
 }
 async prepare(win){const stored=this.read()||{};if(stored.userAgent)win.webContents.setUserAgent?.(stored.userAgent);
  if(!stored.storage)return false;let values;try{values=JSON.parse(this.decrypt(stored.storage));}catch{return false;}if(!values||typeof values!=='object'||Array.isArray(values))return false;
  // Only fill absent storage keys; never overwrite newer site values, including logged-out values.
  return bounded(()=>win.webContents.executeJavaScript(`(()=>{if(location.origin!==${JSON.stringify(this.origin)})return false;const values=${JSON.stringify(values)};let changed=false;for(const [k,v] of Object.entries(values))if(typeof v==='string'&&localStorage.getItem(k)===null){localStorage.setItem(k,v);changed=true;}return changed;})()`),8000,'恢复观影网站状态');
 }
 async close(){clearTimeout(this.timer);await this.capture();this.closed=true;}
}
module.exports={GuanyingSession};
