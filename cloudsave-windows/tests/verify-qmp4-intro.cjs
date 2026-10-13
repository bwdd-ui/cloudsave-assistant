const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {extractHtml,Qmp4Provider}=require('../qmp4-provider');
app.setPath('userData',path.join(app.getPath('temp'),'qmp4-intro-'+process.pid));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true}});
 const results=[];
 try{
  await win.loadURL('about:blank');
  const parse=html=>win.webContents.executeJavaScript('('+extractHtml.toString()+')('+JSON.stringify(html)+',"detail","https://www.qmp4.com/mv/517661.html")');
  let data=await parse('<h1>合成剧集<span class="year">2026</span></h1><div class="movie-introduce"><p class="zkjj_a">短简介<span class="zk_jj">[展开全部]</span></p><p class="sqjj_a" style="display:none">第一段<br>完整第二段<span class="sq_jj">[收起部分]</span></p></div>');
  assert.equal(data.abstract,'第一段\n完整第二段');assert.equal(data.title,'合成剧集');assert.equal(data.niandai,'2026');results.push('full synopsis preferred; no duplicate or control text; line breaks preserved');
  assert.equal((await parse('<div class="movie-introduce"><p class="zkjj_a">折叠简介<span class="zk_jj">[展开全部]</span></p></div>')).abstract,'折叠简介');
  assert.equal((await parse('<div class="movie-introduce"></div><div class="intro">旧版简介</div>')).abstract,'旧版简介');
  assert.equal((await parse('<h1>无简介</h1>')).abstract,'');results.push('collapsed-only, empty primary and legacy layout, absent synopsis handled');
  let requested=0;const keys=[];
  const provider=new Qmp4Provider({diskCache:{get:k=>{keys.push(k);return k==='qmp4:detail:/mv/517661.html'?{abstract:''}:null;},set:()=>{}},fetchHtml:async()=>{requested++;return '';},parseHtml:async()=>({abstract:'新简介'})});
  assert.equal((await provider.detail('qm5:tv:517661')).abstract,'新简介');assert.equal(requested,1);assert.equal(keys[0],'qmp4:detail:v2:/mv/517661.html');provider.close();results.push('old cached empty synopsis bypassed without clearing user data');
  const live=process.env.QMP4_INTRO_LIVE_HTML;
  if(live){data=await parse(fs.readFileSync(live,'utf8'));assert.equal(data.title,'伊甸园之东');assert(data.abstract.length>30);assert(!/展开全部|收起部分/.test(data.abstract));assert.equal(data.abstract.indexOf('讲述'),data.abstract.lastIndexOf('讲述'));results.push('reported official page parses nonempty synopsis once');}
  fs.writeFileSync(path.join(app.getPath('temp'),'qmp4-intro-result.json'),JSON.stringify({pass:true,checks:results},null,2));app.exit(0);
 }catch(error){fs.writeFileSync(path.join(app.getPath('temp'),'qmp4-intro-result.json'),JSON.stringify({pass:false,error:error.stack},null,2));app.exit(1);}
});
