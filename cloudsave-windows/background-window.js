const path=require('path');
function installBackgroundWindow({app,win,Tray,Menu,nativeImage,read,write,isQuitting}){
 let tray,quitting=false;const show=()=>{if(win.isDestroyed())return;if(win.isMinimized())win.restore();win.show();win.focus();};
 try{tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'tray-icon.png')));tray.setToolTip('云存助手 · 后台监控');tray.setContextMenu(Menu.buildFromTemplate([{label:'显示主窗口',click:show},{type:'separator'},{label:'退出程序',click:()=>app.quit()}]));tray.on('click',show);tray.on('double-click',show);}catch(error){console.error('托盘初始化失败，保留普通最小化：',error.message);}
 // Normal minimize keeps the taskbar entry. Only a user close hides to the tray.
 app.on('before-quit',()=>{quitting=true;});
 win.on('close',event=>{if((isQuitting?isQuitting():quitting)||!tray||read().closeToTray===false)return;event.preventDefault();win.hide();});
 app.on('will-quit',()=>tray?.destroy());
 return {show,settings(value){if(value&&typeof value.closeToTray==='boolean')write({...read(),closeToTray:value.closeToTray});return {closeToTray:read().closeToTray!==false,minimizeToTray:false,trayAvailable:Boolean(tray)};}};
}
module.exports={installBackgroundWindow};
