'use strict';
const {Pan123Provider}=require('./pan123-provider');const {Pan123Monitor}=require('./pan123-monitor');
module.exports=function setup({app,BrowserWindow,ipcMain,session,read,write,readConfig,writeConfig,encrypt,decrypt,notify,log}){
 let win=null,attached=false;const partition=()=>session.fromPartition('persist:cloudsave-123pan');
 const auth=()=>{const c=readConfig().pan123Session||{};return {token:decrypt(c.token)||'',loginUuid:decrypt(c.loginUuid)||''};};
 const provider=new Pan123Provider({auth,fetch:(...args)=>partition().fetch(...args)});
 const monitor=new Pan123Monitor({read,write,provider,notify:s=>notify('pan123-status',s),log:(m,l)=>log(m,l,'','123')});
 const persistAuth=(token,loginUuid)=>{if(!token)return;token=token.replace(/^Bearer\s+/i,'');const old=auth();if(old.token===token&&(!loginUuid||loginUuid===old.loginUuid))return;const c=readConfig();c.pan123Session={token:encrypt(token),loginUuid:encrypt(loginUuid||old.loginUuid),savedAt:Date.now()};writeConfig(c);};
 function attach(){if(attached)return;attached=true;partition().webRequest.onBeforeSendHeaders({urls:['https://*.123pan.com/*','https://*.123pan.cn/*']},(details,callback)=>{
  if(win&&!win.isDestroyed()&&details.webContentsId===win.webContents.id){const entries=Object.entries(details.requestHeaders),token=entries.find(([k])=>k.toLowerCase()==='authorization')?.[1],uuid=entries.find(([k])=>k.toLowerCase()==='loginuuid')?.[1];if(token&&/^Bearer\s+\S+/i.test(String(token)))persistAuth(String(token),String(uuid||''));}
  callback({requestHeaders:details.requestHeaders});
 });}
 async function capture(){if(!win||win.isDestroyed())return;const url=new URL(win.webContents.getURL());if(!['yun.123pan.com','www.123pan.com','yun.123pan.cn'].includes(url.hostname))return;
  const values=await win.webContents.executeJavaScript(`({token:localStorage.getItem('authorToken'),uuid:localStorage.getItem('LoginUuid')})`);
  const unwrap=value=>{if(!value)return '';try{return JSON.parse(value);}catch{return value;}};
  let uuid=unwrap(values.uuid);if(typeof uuid==='string'&&/^[a-f0-9]+$/i.test(uuid)&&uuid.length%32===0){try{const cipher=require('crypto').createDecipheriv('aes-128-cbc',Buffer.from('1234567890000000'),Buffer.from('1234567890000000'));uuid=Buffer.concat([cipher.update(Buffer.from(uuid,'hex')),cipher.final()]).toString();}catch{uuid='';}}
  const token=unwrap(values.token);if(typeof token==='string'&&token.length>20)persistAuth(token,String(uuid||''));
 }
 ipcMain.handle('pan123-login',async()=>{await app.whenReady();attach();if(win&&!win.isDestroyed()){win.show();win.focus();return {opened:true};}
  win=new BrowserWindow({width:1150,height:820,title:'123云盘登录',webPreferences:{partition:'persist:cloudsave-123pan',contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('did-finish-load',()=>capture().catch(()=>{}));
  win.on('close',event=>{if(win?._captured)return;event.preventDefault();const closing=win;capture().catch(()=>{}).finally(()=>{if(!closing.isDestroyed()){closing._captured=true;closing.close();}});});
  win.on('closed',()=>{win=null;notify('pan123-status',monitor.state());});
  await win.loadURL('https://yun.123pan.com/');return {opened:true};
 });
 ipcMain.handle('pan123-account',async()=>{await capture();return provider.account();});
 ipcMain.handle('pan123-state',()=>monitor.state());
 ipcMain.handle('pan123-folders',async(_e,parent)=>{if(!/^\d+$/.test(String(parent??0)))throw new Error('目录ID无效');return (await provider.list(String(parent??0))).filter(f=>Number(f.Type)===1).map(f=>({id:String(f.FileId),name:f.FileName}));});
 ipcMain.handle('pan123-save',(_e,value)=>monitor.save(value));ipcMain.handle('pan123-remove',(_e,id)=>monitor.remove(id));
 ipcMain.handle('pan123-run',(_e,id)=>monitor.run(id).then(()=>monitor.state()));ipcMain.handle('pan123-stop',()=>monitor.stop());
 const shareAdapter={
  list:async(s,_cookie,active,parent='0')=>(await provider.list(parent,{shareKey:s.shareCode,password:s.receiveCode},active.signal)).map(raw=>({id:String(raw.FileId),name:raw.FileName,isDir:Number(raw.Type)===1,bytes:Number(raw.Size),raw})),
  inspect:async(s,roots,cookie,active)=>{const queue=roots.map(row=>({row,depth:0})),seen=new Set(),files=[];let bytes=0,sizeKnown=true;while(queue.length){active();const {row,depth}=queue.shift();if(depth>20||seen.size>100000||seen.has(row.id))throw Error('123分享目录检查异常');seen.add(row.id);if(row.isDir)queue.push(...(await shareAdapter.list(s,cookie,active,row.id)).map(row=>({row,depth:depth+1})));else{files.push({name:row.name,bytes:row.bytes});if(Number.isFinite(row.bytes))bytes+=row.bytes;else sizeKnown=false;}}return {files,bytes,sizeKnown};},
  size:async(s,roots,cookie,active)=>{const r=await shareAdapter.inspect(s,roots,cookie,active);if(!r.sizeKnown)throw Error('123分享大小缺失');return r.bytes;},
  receive:async(s,ids,parent)=>{if(parent===undefined||parent===null)throw Error('请选择123保存文件夹');const rows=await shareAdapter.list(s,'',()=>{});const selected=ids.map(i=>{const r=rows.find(x=>x.id===i);if(!r)throw Error('123分享文件未找到');return r.raw;});try{const result=await provider.request('/b/api/restful/goapi/v1/file/copy/save',{}, {fileList:selected.map(f=>({fileID:f.FileId,size:f.Size,etag:f.Etag,type:Number(f.Type),parentFileID:parent,fileName:f.FileName,driveID:0})),shareKey:s.shareCode,sharePwd:s.receiveCode,currentLevel:0,superAdmin:null});if(result===undefined||result===null)throw Error('123未返回保存回执');return {taskId:String(result.taskId||result.TaskId||'accepted')};}catch(e){e.uncertain=true;throw e;}}
 };
 monitor.backend={cookie:()=>auth().token,account:()=>provider.account(),currentUid:async()=>String((await provider.account()).uid),parseShare:(v,c)=>require('./multi-cloud-provider').parse('pan123',v,c),provider:shareAdapter,
 folders:async(parent='0')=>{const account=await provider.account();return {uid:account.uid,root:'0',items:(await provider.list(parent)).filter(x=>Number(x.Type)===1).map(x=>({id:String(x.FileId),cid:String(x.FileId),parentId:parent,name:x.FileName,cloud:'pan123',uid:account.uid}))};},
 validateFolder:async(_cookie,f,u)=>{if(f?.cloud!=='pan123'||f.uid!==u||!Object.hasOwn(f,'cid'))throw Error('请重新选择123云盘文件夹');if(f.cid==='0'&&f.explicitRoot)return f;const rows=await provider.list(f.parentId);if(!rows.some(x=>String(x.FileId)===f.cid&&Number(x.Type)===1))throw Error('123保存文件夹不存在或已删除');return f;}};
 monitor.start();app.on('before-quit',()=>monitor.close());return monitor;
};
