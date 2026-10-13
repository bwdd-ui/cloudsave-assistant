const crypto=require('crypto');
const refreshBudget=new WeakMap();
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function scope(value){const out={...value};for(const k of ['scanOnly','autoSubmit','compareSize','maxItems','sort'])delete out[k];return hash(out);}
function prepare(snapshot,key,signature){
 snapshot.archives||={};
 if(snapshot.scope&&snapshot.scope!==key||!snapshot.scope&&snapshot.archives[key]){
  const {archives,...old}=snapshot;snapshot.archives[snapshot.scope||snapshot.signature||'legacy']=old;
  const next=snapshot.archives[key]||{rows:[],complete:false};delete snapshot.archives[key];
  for(const k of Object.keys(snapshot))if(k!=='archives')delete snapshot[k];Object.assign(snapshot,next);
 }
 refreshBudget.set(snapshot,50);snapshot.scope=key;snapshot.signature=signature;snapshot.rows||=[];snapshot.catalogSeen||={};
 // Existing captures recorded a whole title at a time; adopt them without deleting 80k-row baselines.
 if(snapshot.complete&&!snapshot.lastCompleteAt&&Date.parse(snapshot.startedAt))snapshot.lastCompleteAt=snapshot.startedAt;
 for(const row of snapshot.rows)if(row.movieId&&!snapshot.catalogSeen[row.movieId])snapshot.catalogSeen[row.movieId]={checkedAt:Date.parse(snapshot.startedAt||snapshot.lastCompleteAt)||Date.now(),legacy:true};
 return snapshot;
}
function stamp(movie){
 const values={};for(const key of ['seedUpdatedAt','seed_updated_at','resource_updated_at','updated_at','updatedAt','updateTime','date','magnetCount','cloudCount','resourceCount'])if(movie[key]!==undefined&&movie[key]!==null&&movie[key]!=='')values[key]=movie[key];
 // Counts alone cannot prove that links have not changed.
 return {key:Object.keys(values).length?hash(values):'',reliable:Object.keys(values).some(k=>/updated|Updated|updateTime|date/.test(k))};
}
function skip(snapshot,movie,now=Date.now()){
 const old=snapshot.catalogSeen[movie.id];if(!old)return false;const current=stamp(movie);
 if(current.reliable&&old.stamp===current.key)return true;
 // Sources without catalogue update timestamps are rechecked after 30 minutes, rather than every cycle.
 if(!current.reliable){if(now-old.checkedAt<30*60000)return true;const remaining=refreshBudget.get(snapshot)??50;if(remaining<=0)return true;refreshBudget.set(snapshot,remaining-1);}
 return false;
}
function mark(snapshot,movie,now=Date.now()){snapshot.catalogSeen[movie.id]={checkedAt:now,stamp:stamp(movie).key};}
function complete(snapshot,startedAt){snapshot.complete=true;snapshot.lastCompleteAt=startedAt||new Date().toISOString();}
function reset(snapshot,signature){const {archives={},...old}=snapshot;if(old.rows?.length)archives[old.scope||old.signature||'legacy']=old;return {signature,rows:[],complete:false,startedAt:new Date().toISOString(),archives};}
module.exports={scope,prepare,skip,mark,complete,reset};
