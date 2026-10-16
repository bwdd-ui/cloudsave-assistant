// Apply the predicate to the globally ordered catalogue before slicing UI pages.
class FilteredLibraryPages {
 constructor({now=Date.now,ttl=300000,limit=8}={}){Object.assign(this,{now,ttl,limit});this.scopes=new Map();}
 trim(keep){for(const [key,state] of this.scopes){if(this.scopes.size<=this.limit)break;if(key!==keep&&!state.running)this.scopes.delete(key);}}
 async get(key,page,read,match,stopped=()=>false){
  page=Number(page);if(!Number.isSafeInteger(page)||page<1)throw Error('资源页码请输入大于0的整数');
  let state=this.scopes.get(key);
  if(!state||(!state.running&&this.now()-state.time>this.ttl)){
   state={time:this.now(),rows:[],seen:new Set(),signatures:new Set(),next:1,limit:0,complete:false,nativeItemCount:0};
   this.scopes.delete(key);this.scopes.set(key,state);
   this.trim(key);
  }
  // Promote reused filters without removing any in-flight state.
  this.scopes.delete(key);this.scopes.set(key,state);
  const previous=state.running||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
   // One extra match determines whether a next display page actually exists.
   while(!state.complete&&(!state.limit||state.rows.length<page*state.limit+1)){
    if(stopped())throw Error('资源读取已停止');
    const batch=await read(state.next);if(stopped())throw Error('资源读取已停止');
    const sourceLimit=batch.limit==null||batch.limit===''?0:Number(batch.limit);
    if(!Number.isSafeInteger(sourceLimit)||sourceLimit<0)throw Error('网站返回的每页数量异常，请重新加载');
    const items=batch.items||[],signature=JSON.stringify(items.map(x=>x.id||x.title));
    if(items.length&&state.signatures.has(signature))throw Error('网站重复返回同一页，已停止补齐；请稍后刷新');
    // Stage a complete source page before advancing its checkpoint or cache.
    const limit=state.limit||Math.max(1,sourceLimit||items.length||25),rows=[],ids=new Set();
    for(const item of items){const id=String(item.id||JSON.stringify(item));if(match(item)&&!state.seen.has(id)&&!ids.has(id)){ids.add(id);rows.push(item);}}
    const complete=!items.length||(typeof batch.hasNext==='boolean'?!batch.hasNext:state.next*(sourceLimit||limit)>=Number(batch.total)),time=this.now();
    if(stopped())throw Error('资源读取已停止');
    if(items.length)state.signatures.add(signature);
    state.limit=limit;state.nativeItemCount+=items.length;
    for(const id of ids)state.seen.add(id);
    state.rows.push(...rows);state.complete=complete;
    state.next++;state.time=time;
   }
   const actual=state.complete?Math.min(page,Math.max(1,Math.ceil(state.rows.length/state.limit))):page;
   const start=(actual-1)*state.limit,end=actual*state.limit,hasNext=state.rows.length>end;
   return {page:actual,items:state.rows.slice(start,end),limit:state.limit,total:state.complete?state.rows.length:end+(hasNext?1:0),hasNext,totalKnown:state.complete,matchedCached:state.rows.length,nativeItemCount:state.nativeItemCount,nativeFiltered:true,filteredPagination:true};
  });
  state.running=work;
  try{return await work;}finally{if(state.running===work){state.running=null;this.trim([...this.scopes.keys()].at(-1));}}
 }
}
module.exports={FilteredLibraryPages};
