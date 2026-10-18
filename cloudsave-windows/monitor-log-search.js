(function(root){
 function filterLogs(logs,filters={}){
  if(!Array.isArray(logs))return [];
  const website=String(filters.website||'all'),level=String(filters.level||'all').toLowerCase(),query=String(filters.query||'').trim().toLowerCase();
  return logs.filter(item=>{
   if(!item||typeof item!=='object')return false;
   const source=String(item.source||'cloudsave_monitor'),rowWebsite=String(item.website||(source==='guanying_monitor'?'guanying':'butailing'));
   if(website!=='all'&&rowWebsite!==website)return false;
   if(level!=='all'&&String(item.level||'info').toLowerCase()!==level)return false;
   if(!query)return true;
   let details=item.details;try{if(details&&typeof details==='object')details=JSON.stringify(details);}catch(_){details='';}
   return [item.time,rowWebsite,source,item.level||'info',item.message,details,item.taskId,item.taskTitle].filter(value=>value!==undefined&&value!==null).join(' ').toLowerCase().includes(query);
  });
 }
 const api={filterLogs};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.cloudsaveMonitorLogSearch=api;
})(typeof globalThis==='object'?globalThis:this);
