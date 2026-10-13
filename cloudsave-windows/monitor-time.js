function minutes(value){const n=Number(value);if(!Number.isInteger(n)||n<1||n>525600)throw Error('最近分钟数请输入1–525600的整数');return n;}
function lowerBound(filters,now=Date.now()){
 if(filters.dateMode==='minutes')return now-minutes(filters.withinMinutes)*60000;
 if(filters.dateMode==='range')return filters.startDate?Date.parse(filters.startDate+'T00:00:00+08:00'):0;
 return Number(filters.withinDays)>0?now-Number(filters.withinDays)*86400000:0;
}
function scanLowerBound(filters,now=Date.now()){const bound=lowerBound(filters,now);return filters.dateMode==='minutes'?Math.floor((bound+8*3600000)/86400000)*86400000-8*3600000:bound;}
function precision(value,now){
 const n=Number(value);if(Number.isFinite(n)&&n>0)return {start:n<1e10?n*1000:n,end:n<1e10?n*1000:n};
 const text=String(value||'').trim(),relative=text.match(/^(\d+)\s*(分钟|小时)前$/);
 if(relative){const start=now-Number(relative[1])*(relative[2]==='分钟'?60000:3600000);return {start,end:start};}
 if(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(text)){const start=Date.parse(text.replaceAll('/','-')+'T00:00:00+08:00');return {start,end:start+86400000-1,coarse:true};}
 const start=Date.parse(text);return Number.isFinite(start)?{start,end:start}:null;
}
function minuteMatch(value,filters,now=Date.now()){const bound=lowerBound(filters,now),range=precision(value,now);return Boolean(range&&range.start<=now&&range.end>=bound);}
function updateValue(item){
 const raw=item?.raw||{};
 for(const v of [raw.eztime,raw.update_time,raw.updated_at,raw.publish_time,raw.created_at,raw.ezt,raw.originalDate,item?.date]){if(v&&precision(v,Date.now())&&!precision(v,Date.now()).coarse)return v;}
 return item?.date||raw.ezt||raw.originalDate||'';
}
module.exports={minutes,lowerBound,scanLowerBound,minuteMatch,updateValue};
