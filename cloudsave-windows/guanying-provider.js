const {bounded,loadPage}=require('./site-reader');
const ORIGIN = 'https://www.xn--wcv59z.com';
const GENRES = ['剧情','科幻','动作','喜剧','爱情','冒险','儿童','歌舞','音乐','奇幻','动画','恐怖','惊悚','丧尸','战争','传记','纪录','犯罪','悬疑','西部','灾难','古装','武侠','家庭','短片','校园','文艺','运动','青春','同性','励志','人性','美食','女性','治愈','历史','真人秀','脱口秀'];
const ANIME_GENRES = ['剧情','萌系','科幻','日常','战斗','战争','热血','机战','游戏','搞笑','恋爱','后宫','百合','基腐','冒险','儿童','歌舞','音乐','奇幻','恐怖','惊悚','犯罪','悬疑','西部','灾难','古装','武侠','泡面','校园','运动','青春','美食','治愈','致郁','励志','历史','纪录','异世界'];
const REGIONS = ['海外','欧美','亚洲','美国','日本','韩国','英国','法国','德国','印度','泰国','瑞典','巴西','大陆','香港','台湾','加拿大','俄罗斯','意大利','西班牙','澳大利亚'];
const LANGUAGES = ['英语','法语','国语','粤语','日语','韩语','泰语','德语','俄语','闽南语','丹麦语','波兰语','瑞典语','印地语','挪威语','意大利语','西班牙语','无对白'];
const QUALITY = ['720P','1080P','4K','8K','3D','BD','HDR','DV','原盘'];
function catalogPath(category = 'mv', page = 1, filters = {}) {
  if (!['mv','tv','ac','hot'].includes(category)) throw new Error('观影分类无效');
  page = Number(page); if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new Error('页码无效');
  if (category === 'hot') {
    const kind = ['mv','tv','ac'].includes(filters.hotCategory) ? filters.hotCategory : 'mv';
    const order = ['day','week','month','numbers'].includes(filters.hotOrder) ? filters.hotOrder : 'day';
    return `/hits/${kind}/${order}`;
  }
  const args = {};
  for (const key of ['genre','genres','year','region','lang','quality','status','sort','res','rrange','srange','imdb']) if (filters[key]) args[key] = Array.isArray(filters[key]) ? filters[key].join('_') : String(filters[key]);
  if (Number(filters.withinDays) > 0 && filters.dateMode !== 'range') { args.trange = String(Math.floor(Number(filters.withinDays))); args.timetype = 'uptime'; }
  if(String(args.genre || '').includes('_'))args.genres='1';
  if (page > 1) args.page = String(page);
  const query = new URLSearchParams(args).toString();
  return `/${category}${query ? '?' + query : ''}`;
}
function idFromPath(raw) {
  const url = new URL(raw, ORIGIN), match = url.pathname.match(/^\/(mv|tv|ac)\/([a-z0-9]+)$/i);
  if (url.origin !== ORIGIN || !match) throw new Error('观影影片地址无效');
  return `gy:${match[1]}:${match[2]}`;
}
function pathFromId(id) {
  const match = String(id).match(/^gy:(mv|tv|ac):([a-z0-9]+)$/i);
  if (!match) throw new Error('观影影片编号无效');
  return `/${match[1]}/${match[2]}`;
}
// Executed in the site's isolated browser document. Read rendered DOM only.
function extractDom(kind) {
  const text = node => (node?.textContent || '').trim();
  const body = text(document.body), main = document.querySelector('main');
  if (/登录后访问受限内容/.test(body) || location.pathname === '/user/login') return { error: '请先在设置中登录观影，然后重新加载', loginRequired: true };
  if (/浏览器安全验证|正在准备验证/.test(body)) return { error: '观影需要浏览器验证，请打开观影登录窗口完成验证', loginRequired: true,verificationRequired:true };
  if (!main) return { ready: false };
  if (kind === 'cloud') {
    const clouds=Array.from(main.querySelectorAll('table')).filter(table=>table.querySelector('caption')).flatMap(table=>Array.from(table.querySelectorAll('tbody tr')).flatMap(tr=>{
      const cells=Array.from(tr.querySelectorAll('td')),a=cells[0]?.querySelector('a[href^="http"]');if(!a)return [];
      const name=text(a);return [{url:a.href,title:name,type:text(table.querySelector('caption')),code:text(cells[1]),date:text(cells[3]),quality:(name.match(/4K|2160[Pp]|1080[Pp]|720[Pp]|HDR|杜比视界/g)||[]).join(' '),size:name.match(/[\d.]+\s*[GM]B/i)?.[0]||''}];
    }));
    const cloudTab=Array.from(main.querySelectorAll('#url .all-tabs li')).find(x=>/网盘资源/.test(text(x)));
    const knownEmpty=Boolean(main.querySelector('.main-ui-meta')) && (!cloudTab || /[（(]\s*0\s*[)）]/.test(text(cloudTab)) || (!/\d/.test(text(cloudTab)) && !main.querySelector('#url .inload')));
    return {ready:clouds.length>0 || knownEmpty || /暂无网盘|没有网盘|没有资源/.test(text(main)),clouds};
  }
  const href = node => node?.getAttribute('href') || '';
  const number = value => Number(String(value).replace(/[^0-9.]/g, '')) || 0;
  if (kind === 'catalog') {
    const items = Array.from(main.querySelectorAll('.li-bottom h3 a')).map(a => {
      const li = a.closest('li'), meta = text(li?.querySelector('.tag')).split('/').map(x=>x.trim());
      const image = li?.querySelector('img');
      const iconCount = name => { const use = li?.querySelector(`use[href="#icon-${name}"]`); return number(text(use?.closest('span')?.querySelector('i'))); };
      const scoreUse = li?.querySelector('use[href="#icon-douban"]');
      return { path: href(a), title: text(a), poster: image?.getAttribute('data-src') || image?.src || '', year: meta[0] || '', country: meta[1] || '', genre: meta.slice(2).join(', '), score: text(scoreUse?.parentElement?.nextElementSibling), magnetCount: iconCount('magnet'), cloudCount: iconCount('cloud') };
    }).filter(item=>/^\/(mv|tv|ac)\/[a-z0-9]+$/i.test(item.path));
    const pager = Array.from(document.querySelectorAll('a[href]')).filter(a=>/\bpage=\d+/.test(href(a)));
    const next = pager.find(a=>text(a)==='下一页');
    const choices = Array.from(main.querySelectorAll('dl')).map(dl=>({label:text(dl.querySelector('dt')).replace(/[:：]/g,'').trim(),values:Array.from(dl.querySelectorAll('dd a')).map(text).filter(x=>x&&!['全部','多选','排除','>>'].includes(x))}));
    return { ready: !main.querySelector('.content-list .inload') && !/载入中|加载中/.test(text(main)) && (items.length > 0 || Boolean(main.querySelector('.content-list')) || Boolean(main.querySelector('dl')) || /没有找到|暂无结果|暂无资源|没有搜索|未找到/.test(text(main))), items, hasNext: Boolean(next), nextPath: href(next), pages: Math.max(1,...pager.map(a=>Number(href(a).match(/\bpage=(\d+)/)?.[1]) || 1)), choices };
  }
  if (kind === 'torrent') {
    const magnet = main.querySelector('a[href^="magnet:"]');
    const files = Array.from(main.querySelectorAll('li')).filter(x=>!x.querySelector('li')).map(text).filter(value=>/\([\d.,]+\s*[KMGT]i?B\)\s*$/i.test(value));
    return { ready: Boolean(magnet) || /文件列表|资源下载/.test(text(main)), zlink: href(magnet), zfiles: files.map(name=>({name})), media: text(main).includes('媒体信息') ? text(main).split('文件列表')[0] : '', filename: files.find(name=>/\.(mkv|mp4|avi|ts|m2ts|mov)\s*\(/i.test(name) && !/更多无水印|我的电影网站/.test(name))?.replace(/\s*\([\d.,]+\s*[KMGT]i?B\)\s*$/i,'') || '' };
  }
  const meta = main.querySelector('.main-ui-meta');
  if (!meta) return { ready: false };
  const field = label => { const span = Array.from(meta.querySelectorAll('div>span')).find(x=>text(x).replace(/[:：]/g,'')===label); return span ? text(span.parentElement).replace(new RegExp('^'+label+'[:：]\\s*'),'') : ''; };
  const title = text(meta.querySelector('h1>div')) || text(meta.querySelector('h1')).replace(/\s*\(\d{4}\)\s*$/,'');
  const year = text(meta.querySelector('.year')).replace(/[()]/g,'');
  const seeds = Array.from(main.querySelectorAll('#down tbody tr')).flatMap(tr=>{
    const cells = Array.from(tr.querySelectorAll('td')), a = cells[0]?.querySelector('a[href^="magnet:"]');
    if (!a) return [];
    return [{ zname: text(a), zlink: href(a), zsize: text(cells[2]), ezt: cells[4]?.getAttribute('title') || text(cells[4]), originalDate: text(cells[4]), detailPath: href(cells[0]?.querySelector('a[href^="/bt/"]')) }];
  });
  const clouds = Array.from(main.querySelectorAll('a[href]')).filter(a=>/^https?:\/\/(?:[^/]*\.)?(?:115\.com|123pan\.com|123865\.com|pan\.quark\.cn|pan\.baidu\.com|aliyundrive\.com|alipan\.com|drive\.uc\.cn)\//i.test(a.href)).map(a=>({url:a.href,title:text(a)||title}));
  const cloudLabel=Array.from(main.querySelectorAll('#url .all-tabs li')).find(x=>/网盘资源/.test(text(x)));
  return { ready: Boolean(meta) && (Boolean(main.querySelector('#down table')) || /磁力资源\s*\(0\)/.test(text(main))), title, niandai: year, episodes: text(meta.querySelector('.otherbox')).match(/共\s*(\d+)\s*集/)?.[1] || '', ejs: text(meta.querySelector('.otherbox')), class: field('类型'), production_area: field('地区'), language: field('语言'), release: field('上映') || field('首播'), long_time: field('片长'), alias: field('又名'), director: field('导演'), writer: field('编剧'), performer: field('主演'), abstract: text(main.querySelector('.summary')), epic: main.querySelector('.main-meta img')?.src || '', all_seeds: seeds, clouds, wp_num:Number(text(cloudLabel).match(/\d+/)?.[0]||0), seed_updated_text: text(meta.querySelector('.otherbox em')), url: location.href, doub_score: text(main.querySelector('.ratings-section .freshness')), IMDB_number:main.querySelector('a[href*="imdb.com/title/"]')?.href || '' };
}
function publishDay(value, now = new Date()) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const old=String(value).match(/(\d+|[一二三四五六七八九十])\s*(年|个月|月|周)前/);
  if(old){const number=Number(old[1]) || ({一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10}[old[1]]);const date=new Date(now);if(old[2]==='年')date.setFullYear(date.getFullYear()-number);else if(old[2]==='周')date.setDate(date.getDate()-number*7);else date.setMonth(date.getMonth()-number);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  const date = new Date(now), match = String(value).match(/(\d+)\s*天前/);
  const days = match ? Number(match[1]) : /昨天/.test(value) ? 1 : /今天|分钟前|小时前|刚刚/.test(value) ? 0 : null;
  if (days === null) return '';
  date.setDate(date.getDate()-days);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
class GuanyingProvider {
  constructor({ BrowserWindow, restoreSession, prepareSession, captureSession, log, getInterval=()=>3000, diskCache=null, cacheContext=()=>'', verificationGraceMs=8000 }) { this.prepareSession=prepareSession;this.captureSession=captureSession;this.verificationGraceMs=verificationGraceMs;this.verificationError=null;this.verificationUrl='';this.diskCache=diskCache;this.cacheContext=cacheContext;this.BrowserWindow=BrowserWindow; this.restoreSession=restoreSession; this.log=log; this.queue=Promise.resolve(); this.cache=new Map(); this.window=null; this.nextRequest=0; this.getInterval=getInterval;this.pending=[];this.busy=false; }
  read(path, kind, fresh=false, options={}) {
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || !/^\/(?:mv|tv|ac|hits|bt|search)(?:\/|$)/.test(url.pathname)) throw new Error('观影请求地址无效');
    const key=kind+url.href+'|'+this.cacheContext(), cached=this.cache.get(key);
    const disk=!fresh&&this.diskCache?.get(key,kind==='catalog'?180000:900000);if(disk)return Promise.resolve(disk);
    if (!fresh && cached && cached.expires>Date.now()) return Promise.resolve(cached.value);
    const task = this.enqueue(async()=>{
      const shared=!fresh&&this.diskCache?.get(key,kind==='catalog'?180000:900000);if(shared)return shared;
      if(this.verificationError)throw this.verificationError;
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,this.nextRequest-Date.now())));
      if(this.verificationError)throw this.verificationError;
      await this.restoreSession();
      if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed?.()) { this.window=new this.BrowserWindow({show:false,width:1100,height:850,webPreferences:{partition:'persist:cloudsave-guanying',contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));this.window.webContents.on('will-navigate',(event,target)=>{try{if(new URL(target).origin!==ORIGIN)event.preventDefault();}catch(_){event.preventDefault();}}); }
      const win=this.window;
      const timeout = setTimeout(()=>{if(!win.isDestroyed()&&!win.webContents.isDestroyed?.())win.webContents.stop();},30000);
      const until=Date.now()+30000;
      try {
        await loadPage(win,url.href,'观影');
        if(await this.prepareSession?.(win))await loadPage(win,url.href,'观影恢复会话');
        let cloudClicked=false,magnetClicked=false,verificationStarted=0;
        while(Date.now()<until){
          if(win.isDestroyed())throw new Error('观影读取窗口已关闭');
          if(kind==='detail'&&!magnetClicked){magnetClicked=await win.webContents.executeJavaScript(`(()=>{const tab=Array.from(document.querySelectorAll('#url .all-tabs li')).find(x=>x.textContent.includes('磁力资源'));if(!tab)return false;tab.click();return true;})()`);}
          if(kind==='cloud'&&!cloudClicked){cloudClicked=await win.webContents.executeJavaScript(`(()=>{const tab=Array.from(document.querySelectorAll('#url .all-tabs li')).find(x=>x.textContent.includes('网盘资源'));if(!tab)return false;tab.click();return true;})()`);}
          const value=await bounded(()=>win.webContents.executeJavaScript(`(${extractDom.toString()})(${JSON.stringify(kind)})`),10000,'观影页面解析',{signal:options.signal});
          if(value.error){
            if(value.verificationRequired){
              verificationStarted ||= Date.now();
              if(Date.now()-verificationStarted<this.verificationGraceMs){await new Promise(resolve=>setTimeout(resolve,250));continue;}
              this.verificationUrl=url.href;this.verificationError=Object.assign(new Error(value.error),{loginRequired:true,verificationRequired:true});throw this.verificationError;
            }
            throw Object.assign(new Error(value.error),{loginRequired:value.loginRequired});
          }
          if(value.ready){this.diskCache?.set(key,value);this.cache.set(key,{value,expires:Date.now()+(kind==='catalog'?60000:300000)});while(this.cache.size>300)this.cache.delete(this.cache.keys().next().value);return value;}
          await new Promise(resolve=>setTimeout(resolve,250));
        }
        throw new Error('观影页面读取超时，网站布局可能变更，请查看原网页');
      } finally {await this.captureSession?.(win).catch(()=>{});clearTimeout(timeout);this.nextRequest=Date.now()+Math.max(1000,Math.min(60000,Number(this.getInterval())||3000));}
    },options.priority ?? 10);
    return task.catch(error=>{
      if(/Object has been destroyed|Render frame was disposed/i.test(error.message || '')){
        if(!this.closed && !options.recreated){const previous=this.window;this.window=null;if(previous&&!previous.isDestroyed())previous.destroy();return this.read(path,kind,fresh,{...options,recreated:true});}
        throw new Error(this.closed?'观影读取已停止':'观影读取窗口异常关闭，已重试；请重新加载或打开观影登录窗口');
      }
      throw error;
    });
  }
  enqueue(run,priority){if(this.closed)return Promise.reject(new Error('观影读取已停止'));return new Promise((resolve,reject)=>{this.pending.push({run,priority,resolve,reject});this.drain();});}
  async drain(){if(this.busy)return;this.busy=true;try{while(this.pending.length){this.pending.sort((a,b)=>b.priority-a.priority);const task=this.pending.shift();try{task.resolve(await task.run());}catch(error){task.reject(error);}}}finally{this.busy=false;}}
  async catalog(category,page,filters,options={}) { const path=filters?.search ? '/search?'+new URLSearchParams({q:String(filters.search).trim(),type:'',mode:'1',...(page>1?{page:String(page)}:{})}) : catalogPath(category,page,filters);const value=await this.read(path,'catalog',false,options);return {...value,page,items:value.items.map(item=>({...item,id:idFromPath(item.path),webUrl:ORIGIN+item.path,website:'guanying'}))}; }
  async detail(id,options={}) { const path=pathFromId(id), value=await this.read(path,'detail',Boolean(options.fresh),options);return {...value,id,doub_id:id,website:'guanying',detail_url:ORIGIN+path,all_seeds:value.all_seeds.map(seed=>({...seed,id:'gy:'+seed.detailPath.split('/').pop(),ezt:publishDay(seed.ezt),zqxd:/2160|4K/i.test(seed.zname)?'4K':/1080/i.test(seed.zname)?'1080P':'',website:'guanying'})),movies_online_seed:{观影:value.clouds.map(row=>({...row,link:row.url,seed_name:row.title}))}}; }
  async clouds(id,options={}){const value=await this.read(pathFromId(id),'cloud',Boolean(options.fresh),options);return value.clouds.map(row=>({...row,date:publishDay(row.date)}));}
  async torrent(seed,options={}) { if(!/^\/bt\/[a-z0-9]+$/i.test(seed.detailPath||''))throw new Error('观影种子详情地址缺失');return this.read(seed.detailPath,'torrent',false,options); }
  verificationCompleted(){this.verificationError=null;this.verificationUrl='';this.invalidate();}
  invalidate() { this.cache.clear();this.diskCache?.clear(); }
  close() { this.closed=true;for(const task of this.pending.splice(0))task.reject(new Error('观影读取已停止'));if(this.window&&!this.window.isDestroyed())this.window.destroy();this.window=null; }
}
module.exports={ORIGIN,GENRES,ANIME_GENRES,REGIONS,LANGUAGES,QUALITY,catalogPath,idFromPath,pathFromId,extractDom,publishDay,GuanyingProvider};
