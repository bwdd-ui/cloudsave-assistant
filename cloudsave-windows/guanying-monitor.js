const crypto=require('crypto');
const {catalogPath}=require('./guanying-provider');
const scanHistory=require('./magnet-scan-history');

function normalizeOptions(value={},categories=['mv','tv','ac']){
  const native={};
  for(const key of ['genre','genres','year','region','lang','quality','status','rrange','srange','imdb','res','tag'])native[key]=(Array.isArray(value[key])?value[key].map(String).filter(Boolean).join('_'):String(value[key] || '')).slice(0,500);
  return {...native,sizeRanges:require('./monitor-size-ranges').normalizeSizeRanges(value),sort:['','uptime','date','score','number'].includes(value.sort)?value.sort:'uptime',categories:[...new Set((Array.isArray(value.categories)?value.categories:categories).filter(x=>categories.includes(x)))],scanOnly:Boolean(value.scanOnly),autoSubmit:!value.scanOnly&&value.autoSubmit!==false,compareSize:value.compareSize!==false,onlyCloud:Boolean(value.onlyCloud),minSizeGB:Math.max(0,Number(value.minSizeGB)||0),maxSizeGB:Math.max(0,Number(value.maxSizeGB)||0),dateMode:['range','minutes'].includes(value.dateMode)?value.dateMode:'recent',withinMinutes:value.dateMode==='minutes'?require('./monitor-time').minutes(value.withinMinutes):Number(value.withinMinutes)||60,withinDays:Math.max(0,Math.floor(Number(value.withinDays)||0)),startDate:String(value.startDate || ''),endDate:String(value.endDate || ''),maxItems:Math.max(1,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(value.maxItems)||30)))};
}
function legacyFilters(options){return {genres:options.genre?options.genre.split('_'):[],countries:[],years:options.year&&options.year.split('_').every(x=>/^\d{4}$/.test(x))?options.year.split('_'):[],qualities:options.quality?[options.quality]:[],tags:[],sort:'更新时间',scoreRange:options.rrange.replace('_','-'),onlyImdb:Boolean(options.imdb),onlyCloud:options.onlyCloud,compareSize:options.compareSize,sizeRanges:options.sizeRanges,minSizeGB:options.minSizeGB,maxSizeGB:options.maxSizeGB,dateMode:options.dateMode,withinDays:options.withinDays,withinMinutes:options.withinMinutes,startDate:options.startDate,endDate:options.endDate,maxItems:options.maxItems,scanOnly:options.scanOnly};}
class GuanyingMonitor{
  constructor(deps){this.d=deps;this.website=deps.website || 'guanying';this.label=deps.label || '观影';this.running=false;this.timer=null;this.stopRequested=false;this.snapshotCache=null;this.nextCheckAt=0;this.rateRetryTimer=null;}
  state(){const saved=this.d.readConfig().guanyingMonitor || {};return {...saved,coverageReview:(this.d.readConfig().monitorCoverageReview || []).filter(row=>String(row.movieId).startsWith(this.d.namespace || 'gy:')&&(!row.uid || row.uid===this.d.uid())),enabled:Boolean(saved.enabled),intervalMinutes:Math.max(5,Math.min(1440,Number(saved.intervalMinutes)||15)),options:normalizeOptions(saved.options,this.d.categories),running:this.running,stopping:Boolean(this.running&&this.stopRequested),nextCheckAt:this.nextCheckAt?new Date(this.nextCheckAt).toISOString():'',lastMessage:saved.lastMessage || this.label+'监控未开启'};}
  save(patch){const config=this.d.readConfig();config.guanyingMonitor={...(config.guanyingMonitor || {}),...patch};delete config.guanyingMonitor.running;delete config.guanyingMonitor.coverageReview;delete config.guanyingMonitor.nextCheckAt;this.d.writeConfig(config);return this.state();}
  signature(){return crypto.createHash('sha256').update(JSON.stringify([this.state().options,this.state().options.scanOnly?'local':this.d.uid(),this.state().options.scanOnly?'local-history':this.d.sessionStamp()])).digest('hex');}
  checkpoint(value){const config=this.d.readConfig();if(value)config.guanyingScan=value;else delete config.guanyingScan;this.d.writeConfig(config);}
  snapshot(){return this.snapshotCache ||= this.d.readSnapshot();}
  persistSnapshot(){this.d.writeSnapshot(this.snapshot());}
  publish(message){this.save({lastMessage:message});this.d.publish(this.state());}
  schedule(){clearTimeout(this.rateRetryTimer);this.rateRetryTimer=null;clearInterval(this.timer);this.timer=null;this.nextCheckAt=0;const state=this.state();if(state.enabled){const interval=state.intervalMinutes*60000;this.nextCheckAt=Date.now()+interval;this.timer=setInterval(()=>{if(this.rateRetryTimer&&Date.parse(this.state().nextRetryAt)>Date.now())return;this.nextCheckAt=Date.now()+interval;this.run(false);},interval);}}
  update(value){const previous=this.state(),before=this.signature(),next=this.save({enabled:Boolean(value.enabled),intervalMinutes:Math.max(5,Math.min(1440,Number(value.intervalMinutes)||15)),options:normalizeOptions(value.options,this.d.categories)});if(this.signature()!==before)this.save({blockedSignature:'',nextRetryAt:''});if(previous.enabled!==next.enabled || previous.intervalMinutes!==next.intervalMinutes || !this.timer)this.schedule();return this.state();}
  stop(){this.stopRequested=true;this.abortController?.abort(Object.assign(new Error(this.label+'扫描已停止，进度已保留'),{cancelled:true,monitorCancelled:true}));if(this.running)this.publish('正在停止筛选，正在取消当前扫描请求…');return this.state();}
  close(){this.stopRequested=true;this.abortController?.abort(Object.assign(Error(this.label+'扫描已停止'),{cancelled:true}));clearTimeout(this.rateRetryTimer);this.rateRetryTimer=null;clearInterval(this.timer);this.timer=null;}
  async run(manual=false){
    if(!this.state().options.scanOnly&&this.d.magnetEnabled?.()===false)return {...this.state(),lastMessage:'115自动磁力离线总开关已关闭'};
    if(this.running)return this.state();let state=this.state();const initialSignature=this.signature();
    if(!manual&&(!state.enabled||state.blockedSignature===initialSignature||Date.parse(state.nextRetryAt)>Date.now()))return state;
    this.running=true;this.stopRequested=false;this.abortController=new AbortController();const startedEnabled=state.enabled;let saved=0,scanned=0,duplicates=0;
    let cookie,signature,cp;
    const assertActive=()=>{if(this.stopRequested||this.d.shuttingDown()||(!this.state().options.scanOnly&&cookie!==this.d.cookie())||signature!==this.signature()||(startedEnabled&&!this.state().enabled))throw Object.assign(new Error(this.label+'扫描已停止，进度已保留'),{cancelled:true,monitorCancelled:true});};
    assertActive.signal=this.abortController.signal;
    try{
      cookie=this.d.cookie();if(!cookie && this.state().options.autoSubmit)throw new Error('请先登录115');
      const account=this.state().options.autoSubmit?await this.d.account(cookie):{uid:this.state().options.scanOnly?'':this.d.uid()};if(account.uid)this.d.bindAccount(account.uid);signature=this.signature();
      if(this.state().options.autoSubmit)await this.d.syncDownloads?.();assertActive();
      if(this.state().options.autoSubmit)await this.d.validateFolder(cookie,this.d.folder(),account.uid);assertActive();
      state=this.state();const options=state.options,filters=this.d.filters?await this.d.filters(options):legacyFilters(options),categories=options.categories;
      if(!categories.length)throw new Error('请选择监控分类');
      cp=this.d.readConfig().guanyingScan;
      if(!cp||cp.signature!==signature||manual&&state.blockedSignature)cp={signature,categoryIndex:0,page:1,offset:0,scanned:0,startedAt:new Date().toISOString()};
      this.save({blockedSignature:'',nextRetryAt:''});this.checkpoint(cp);
      if(options.scanOnly){scanHistory.prepare(this.snapshot(),scanHistory.scope(options),signature);this.d.log('在本地历史基础上增量扫描：'+this.snapshot().rows.length+'条磁力；相同资源跳过详情，变更资源更新缓存');}
      else if(this.snapshot().signature!==signature)this.snapshotCache=scanHistory.reset(this.snapshot(),signature);
      this.snapshot().complete=false;this.persistSnapshot();
      scanned=cp.scanned || 0;
      const visited=new Set();
      if(options.autoSubmit)await this.d.scanFallbacks?.(filters,assertActive,async candidates=>{
        for(const candidate of candidates){assertActive();if(saved>=options.maxItems)return true;if(this.d.seen().has(candidate.key)){duplicates++;continue;}const folder=this.d.folder();const message=await this.d.submit(cookie,candidate.url,folder.cid,folder.name,{...candidate,website:this.website,source:'auto',assertActive});this.d.remember(candidate);if(/曾经添加过|自动跳过/.test(message))duplicates++;else saved++;this.d.log(`下一档资源提交：${candidate.title}`,'info',message);}
        return saved>=options.maxItems;
      },categories);
      if(saved>=options.maxItems)return this.finish(`本次下一档资源已成功提交 ${saved} 条，达到数量限制`,saved,scanned,duplicates,false);
      for(;cp.categoryIndex<categories.length;cp.categoryIndex++){
        const category=categories[cp.categoryIndex],mode=this.d.mode?this.d.mode(category):category==='mv'?'movie':'tv';
        for(;;){
          assertActive();const native=this.d.nativeOptions?this.d.nativeOptions(options):{...options,res:options.onlyCloud?'网盘':options.res || '磁力'};
          this.d.log(`按${this.label}筛选扫描${{mv:'电影',tv:'剧集',ac:'动漫',doc:'纪录片',variety:'综艺',bundle:'合集',other:'其他'}[category]}：第 ${cp.page} 页`,'info',(this.d.catalogPath || catalogPath)(category,cp.page,native));
          const list=await this.d.provider().catalog(category,cp.page,native,{priority:0,signal:this.abortController.signal});assertActive();
          if(options.year && options.year.split('_').every(x=>/^\d{4}$/.test(x))&&list.items.some(x=>x.year&&!options.year.split('_').includes(x.year)))throw Object.assign(new Error(`${this.label}网站未按年份 ${options.year} 返回资源，暂停此筛选，不退回全库`),{filterRejected:true});
          const listKey=category+':'+list.items.map(x=>x.id).join(',');
          if(visited.has(listKey))throw new Error(this.label+'分页重复返回同一批影片，已停止并保留断点');visited.add(listKey);
          for(;cp.offset<list.items.length;cp.offset++){
            assertActive();const movie=list.items[cp.offset];
            if(options.scanOnly&&scanHistory.skip(this.snapshot(),movie)){this.d.log('历史磁力已采集，跳过未变化资源：'+movie.title);scanned++;cp.scanned=scanned;this.checkpoint({...cp,offset:cp.offset+1});continue;}
            this.publish(`正在扫描：${movie.title}；已检查 ${scanned} 部，已成功提交 ${saved} 条`);
            this.d.log(`扫描${{mv:'电影',tv:'剧集',ac:'动漫',doc:'纪录片',variety:'综艺',bundle:'合集',other:'其他'}[category]}：${movie.title} (${movie.year || '年份未知'})`);
            const detail=await this.d.provider().detail(movie.id,{priority:0,signal:this.abortController.signal});assertActive();
            if(mode==='tv'&&!options.scanOnly)await this.d.inspectFiles(movie,detail,filters,assertActive);
            this.d.capture(movie,detail,filters,this.snapshot(),mode);if(options.scanOnly)scanHistory.mark(this.snapshot(),movie);this.persistSnapshot();
            const candidates=options.scanOnly?[]:this.d.select(mode,movie,detail,filters).candidates;
            for(const candidate of options.autoSubmit?candidates:[]){
              assertActive();if(saved>=options.maxItems){this.checkpoint(cp);return this.finish(`本次已成功提交 ${saved} 条，达到数量限制；下次从当前影片继续`,saved,scanned,duplicates,false);}
              if(this.d.seen().has(candidate.key)){duplicates++;continue;}
              const folder=this.d.folder();
              const message=await this.d.submit(cookie,candidate.url,folder.cid,folder.name,{...candidate,website:this.website,source:'auto',assertActive});assertActive();
              this.d.remember(candidate);
              if(/曾经添加过|自动跳过/.test(message))duplicates++;else saved++;
              this.d.log(`115提交反馈：${candidate.title}`,'info',message);
            }
            scanned++;cp.scanned=scanned;
            // Persist the next offset only after all candidates in this title are handled.
            this.checkpoint({...cp,offset:cp.offset+1});
          }
          cp.offset=0;
          if(!list.hasNext||!list.items.length)break;
          cp.page++;this.checkpoint(cp);
        }
        cp.page=1;cp.offset=0;this.checkpoint({...cp,categoryIndex:cp.categoryIndex+1});
      }
      this.checkpoint(null);if(options.scanOnly)scanHistory.complete(this.snapshot(),cp.startedAt);else this.snapshot().complete=true;this.persistSnapshot();
      return this.finish(!options.autoSubmit?`仅扫描模式：已检查 ${scanned} 部，缓存 ${this.snapshot().rows.length} 条磁力；自动提交已关闭，可导出扫描结果`:`${this.label}筛选检查完成：${scanned} 部，成功提交 ${saved} 条，重复跳过 ${duplicates} 条`,saved,scanned,duplicates,true);
    }catch(error){
      const nextRetryAt=error.rateLimited?new Date(error.retryAt).toISOString():error.cancelled||error.filterRejected||error.loginRequired?'':new Date(Date.now()+Math.max(5,this.state().intervalMinutes)*60000).toISOString();
      const message=error.message+(error.filterRejected||error.loginRequired?'；已暂停自动请求，处理后点击立即检查':'');
      this.save({lastMessage:message,lastRun:new Date().toISOString(),nextRetryAt,blockedSignature:error.filterRejected||error.loginRequired?this.signature():''});if(error.rateLimited&&this.state().enabled){clearTimeout(this.rateRetryTimer);this.nextCheckAt=error.retryAt+1000;this.rateRetryTimer=setTimeout(()=>{this.rateRetryTimer=null;this.run(false);},Math.max(1000,this.nextCheckAt-Date.now()));this.rateRetryTimer.unref?.();}this.d.log(message,error.cancelled?'info':'error');
      return {...this.state(),error:!error.cancelled};
    }finally{this.running=false;this.abortController=null;this.d.publish(this.state());}
  }
  finish(message,saved,scanned,duplicates,complete){this.publish(message);this.save({lastRun:new Date().toISOString(),nextRetryAt:''});this.d.log(message,'success');return {...this.state(),saved,scanned,duplicates,complete};}
}
module.exports={GuanyingMonitor,normalizeOptions,legacyFilters};
