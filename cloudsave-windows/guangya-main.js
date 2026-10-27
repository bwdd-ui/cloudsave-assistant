module.exports=function setupGuangya(d){
 const {app,BrowserWindow,ipcMain,session,readConfig,writeConfig,encrypt,decrypt,parse,log,stopped}=d;
 const windowSize=d.windowSize||((width,height)=>({width,height}));
 let window=null;const part=session.fromPartition('persist:cloudsave-guangya');
 const token=()=>{const value=readConfig().guangya?.token;if(!value)throw Error('请先打开光鸭登录窗口完成登录');return decrypt(value);};
 part.webRequest.onBeforeSendHeaders({urls:['https://api.guangyapan.com/*','https://account.guangyapan.com/*']},(details,callback)=>{
  const raw=Object.entries(details.requestHeaders).find(([k])=>k.toLowerCase()==='authorization')?.[1],value=String(raw||'').match(/^Bearer\s+(.+)$/i)?.[1];
  if(value){try{const c=readConfig();if(!c.guangya?.token||decrypt(c.guangya.token)!==value){c.guangya={...c.guangya,token:encrypt(value),savedAt:Date.now()};writeConfig(c);}}catch{log('光鸭登录会话保存失败，请重新登录','warning');}}
  callback({requestHeaders:details.requestHeaders});
 });
 async function request(url,body,access){const response=await fetch(url,{method:body===null?'GET':'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json',Referer:'https://www.guangyapan.com/'},...(body===null?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});if(response.status===401||response.status===403)throw Error('光鸭登录失效，请重新打开光鸭登录');if(!response.ok)throw Error('光鸭接口访问失败（HTTP '+response.status+'）');const text=await response.text();try{return parse(text);}catch{throw Error('光鸭接口返回格式异常');}}
 const provider=new (require('./guangya-provider').GuangyaProvider)({request}),service=new (require('./guangya-offline').GuangyaOffline)({readConfig,writeConfig:async c=>{writeConfig(c);await d.flush();},token,provider,stopped,log});
 ipcMain.handle('guangya-state',()=>service.state());
 ipcMain.handle('guangya-login',async()=>{if(window&&!window.isDestroyed()){window.show();window.focus();return {opened:true};}window=new BrowserWindow({...windowSize(1100,820),title:'光鸭云盘登录与文件夹',webPreferences:{partition:'persist:cloudsave-guangya',contextIsolation:true,nodeIntegration:false,sandbox:true}});window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.on('closed',()=>window=null);await window.loadURL('https://www.guangyapan.com/#/home');return {opened:true};});
 ipcMain.handle('guangya-folders',(_e,parent)=>provider.folders(parent,token()));
 ipcMain.handle('guangya-folder',(_e,folder)=>service.setFolder(folder));
 ipcMain.handle('guangya-submit',(_e,url,title)=>service.submit(url,title));
 ipcMain.handle('guangya-resolve',(_e,id,action)=>service.resolve(id,action));
 ipcMain.handle('guangya-logout',async()=>{if(service.running)throw Error('请等待光鸭当前提交结束');window?.close();const c=readConfig();delete c.guangya;shareProvider.clear();writeConfig(c);await d.flush();await part.clearStorageData();return service.state();});
 const shareProvider=new (require('./guangya-share-provider').GuangyaShareProvider)(provider,()=>readConfig().offlineEpisodeSize||{});
 const backend={cookie:()=>{try{return readConfig().guangya?.token?token():'';}catch{return '';}},account:t=>provider.account(t),validateFolder:async(t,f,u)=>{if(!f||!Object.hasOwn(f,'id'))throw Error('请为光鸭重新选择保存文件夹');const folder=await provider.validate(f,t,u);return {...folder,cid:folder.id};},provider:shareProvider,parseShare:require('./guangya-share-provider').parse,currentUid:async()=>String((await provider.account(token())).uid)};
 return {backend,get running(){return service.running;},close(){window?.close();}};
};
