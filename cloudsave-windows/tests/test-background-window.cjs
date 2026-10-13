const assert=require('assert/strict'),{EventEmitter}=require('events'),{installBackgroundWindow}=require('../background-window');
function fixture(options={}){let config={minimizeToTray:true,unrelated:'keep'},hidden=0,shown=0,quit=0,tray;
 const app=new EventEmitter();app.quit=()=>{quit++;app.emit('before-quit');};
 const win=new EventEmitter();Object.assign(win,{isDestroyed:()=>false,isMinimized:()=>true,restore:()=>{},show:()=>shown++,focus:()=>{},hide:()=>hidden++});
 class Tray extends EventEmitter{constructor(){super();if(options.noTray)throw Error('unavailable');tray=this;}setToolTip(){}setContextMenu(m){this.menu=m;}destroy(){this.dead=true;}}
 const controller=installBackgroundWindow({app,win,Tray,Menu:{buildFromTemplate:x=>x},nativeImage:{createFromPath:x=>x},read:()=>config,write:x=>config=x,...(options.isQuitting?{isQuitting:options.isQuitting}:{})});
 return {app,win,controller,get tray(){return tray;},get hidden(){return hidden;},get shown(){return shown;},get config(){return config;},get quit(){return quit;},close(){let prevented=false;win.emit('close',{preventDefault(){prevented=true;}});return prevented;}};
}
const f=fixture();f.win.emit('minimize');assert.equal(f.hidden,0);assert.equal(f.close(),true);assert.equal(f.hidden,1);f.tray.emit('click');assert.equal(f.shown,1);
assert.equal(f.controller.settings().closeToTray,true);assert.equal(f.controller.settings().minimizeToTray,false);f.controller.settings({closeToTray:false});assert.equal(f.config.unrelated,'keep');assert.equal(f.close(),false);f.controller.settings({closeToTray:true});f.tray.menu.at(-1).click();assert.equal(f.quit,1);assert.equal(f.close(),false);f.app.emit('will-quit');assert(f.tray.dead);
let flushComplete=false;const guarded=fixture({isQuitting:()=>flushComplete});guarded.app.quit();assert(guarded.close(),'window remains recoverable before flush completes or when flush fails');flushComplete=true;assert.equal(guarded.close(),false);
const old=fixture();old.controller.settings({minimizeToTray:true});old.win.emit('minimize');assert.equal(old.hidden,0,'legacy minimize setting cannot hide the window');
const originalError=console.error;console.error=()=>{};const missing=fixture({noTray:true});console.error=originalError;assert.equal(missing.close(),false,'never hide without a usable tray');assert.equal(missing.controller.settings().trayAvailable,false);
console.log('PASS normal minimize, default close-to-tray, restore, persistence, explicit quit, flush guard and unavailable-tray fallback');
