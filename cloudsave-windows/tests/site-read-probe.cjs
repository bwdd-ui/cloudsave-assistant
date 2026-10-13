// Public site diagnostics only. Never import main.js or access personal Data.
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path');
app.setPath('userData','C:/Temp/cloudsave-sites-'+process.pid);
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{const rows=[];const limit=(p)=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('probe timeout')),16000))]);
try{for(const site of ['btbtla','qmp4']){const C=site==='btbtla'?require('../btbtla-provider').BtbtlaProvider:require('../qmp4-provider').Qmp4Provider,p=new C({BrowserWindow,getInterval:()=>1000});try{const r=await limit(p.catalog('mv',1,{}));rows.push({site,items:r.items.length});}catch(e){rows.push({site,error:e.message});}p.close();}
const w=new BrowserWindow({show:false,webPreferences:{partition:'probe-guanying',backgroundThrottling:false}});require('../remote-page').configureRemotePageSession(w.webContents.session,{host:'www.xn--wcv59z.com',preferNative:true});w.webContents.on('did-fail-load',(_e,code,description,url,isMain)=>{if(isMain)rows.push({site:'guanying',code,description,url});});try{await limit(w.loadURL('https://www.xn--wcv59z.com/user/login'));rows.push({site:'guanying',loaded:true,url:w.webContents.getURL()});}catch(e){rows.push({site:'guanying',error:e.message});}w.destroy();
}finally{fs.writeFileSync('C:/Temp/cloudsave-sites-probe.json',JSON.stringify(rows,null,2));app.exit();}});
