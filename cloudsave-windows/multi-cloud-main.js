const {NAMES,MultiCloudProvider,parse}=require('./multi-cloud-provider');
const ROOTS={pan123:'0',quark:'0',tianyi:'-11',xunlei:'',baidu:'/'};
const LOGIN={quark:'https://pan.quark.cn/',tianyi:'https://cloud.189.cn/web/',xunlei:'https://pan.xunlei.com/',baidu:'https://pan.baidu.com/disk/main'};
module.exports=function(d){
 const backends={},providers={},windows={};
 for(const cloud of ['quark','tianyi','xunlei','baidu']){
  const part=d.session.fromPartition('persist:cloudsave-'+cloud),auth=()=>d.readConfig().multiCloudAuth?.[cloud]||{};
  const headers=()=>{const value=auth();return value.headers?JSON.parse(d.decrypt(value.headers)||'{}'):{};};
  if(cloud==='xunlei')part.webRequest.onBeforeSendHeaders({urls:['https://api-pan.xunlei.com/*']},(details,callback)=>{
   const collected=Object.fromEntries(Object.entries(details.requestHeaders).filter(([k])=>['authorization','x-captcha-token','x-client-id','x-device-id'].includes(k.toLowerCase())));
   if(Object.keys(collected).some(k=>k.toLowerCase()==='authorization')){const c=d.readConfig();c.multiCloudAuth||={};const before=auth();c.multiCloudAuth[cloud]={...before,headers:d.encrypt(JSON.stringify(collected)),savedAt:before.savedAt||Date.now()};d.writeConfig(c);}callback({requestHeaders:details.requestHeaders});
  });
  async function fetch(url,body){const options={method:body===undefined?'GET':'POST',credentials:'include',headers:{...headers(),Accept:'application/json',...(body===undefined?{}:{'Content-Type':body instanceof URLSearchParams?'application/x-www-form-urlencoded':'application/json'})},...(body===undefined?{}:{body:body instanceof URLSearchParams?body.toString():JSON.stringify(body)}),signal:AbortSignal.timeout(30000)};const r=await part.fetch(url,options);if(!r.ok)throw Error(NAMES[cloud]+'请求失败（HTTP '+r.status+'），请打开官方登录窗口检查');return r;}
  const p=providers[cloud]=new MultiCloudProvider(cloud,{request:async(url,body)=>(await fetch(url,body)).json(),html:async url=>(await fetch(url)).text(),token:()=>Object.entries(headers()).find(([k])=>k.toLowerCase()==='authorization')?.[1]||''});
  backends[cloud]={cookie:()=>String(auth().savedAt||''),account:()=>p.account(),validateFolder:(...args)=>p.validateFolder(...args),currentUid:async()=>String((await p.account()).uid),parseShare:(v,c)=>parse(cloud,v,c),provider:p};
 }
 d.ipcMain.handle('cloud-capabilities',()=>Object.entries(NAMES).map(([id,name])=>({id,name,share:true,magnet:id==='xunlei',root:ROOTS[id]})));
 d.ipcMain.handle('cloud-login',async(_e,cloud)=>{
  if(cloud==='pan123')throw Error('请使用已有123云盘登录按钮');if(!providers[cloud])throw Error('网盘无效');
  const old=windows[cloud];if(old&&!old.isDestroyed()){old.show();old.focus();return {opened:true};}
  const win=windows[cloud]=new d.BrowserWindow({width:1100,height:820,title:NAMES[cloud]+'官方登录',webPreferences:{partition:'persist:cloudsave-'+cloud,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(({url})=>{try{if(new URL(url).protocol==='https:')win.loadURL(url).catch(()=>{});}catch{}return {action:'deny'};});
  win.on('closed',()=>{windows[cloud]=null;const c=d.readConfig();c.multiCloudAuth||={};c.multiCloudAuth[cloud]={...c.multiCloudAuth[cloud],savedAt:Date.now()};d.writeConfig(c);});await win.loadURL(LOGIN[cloud]);return {opened:true};
 });
 d.ipcMain.handle('cloud-folders',async(_e,cloud,parent)=>{if(cloud==='pan123')return d.pan123().backend.folders(parent??ROOTS[cloud]);const p=providers[cloud];if(!p)throw Error('网盘无效');const a=await p.account();const root=ROOTS[cloud],at=String(parent??root);return {uid:a.uid,root,items:(await p.folders(at)).map(f=>({...f,cloud,uid:a.uid}))};});
 return {backend:cloud=>cloud==='pan123'?d.pan123()?.backend:backends[cloud],close(){for(const w of Object.values(windows))if(w&&!w.isDestroyed())w.close();}};
};
