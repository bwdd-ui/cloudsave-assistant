// Account/cloud scoped history, shared by every resource website and destination folder.
function parts(key){const p=String(key||'').split('|');const cloud=['guangya','pan123','quark','tianyi','xunlei','baidu'].includes(p[0])?p.shift():'115';return p.length>=3?{cloud,uid:p[0],share:p[2],file:p[3]}:null;}
function identity(cloud,uid,share){return JSON.stringify([cloud||'115',String(uid),String(share)]);}
function migrate(data){
 data.savedLinks||={};data.globalItems||={};
 for(const [key,row] of Object.entries(data.shares||{})){const p=parts(key);if(p&&row.status==='accepted')data.savedLinks[identity(p.cloud,p.uid,p.share)]={...row,legacyKey:key};}
 for(const [key,row] of Object.entries(data.items||{})){const p=parts(key);if(!p?.file)continue;const global=identity(p.cloud,p.uid,p.share)+'|'+p.file,old=data.globalItems[global];if(!old||row.status==='accepted'||old.status!=='accepted'&&['intent','uncertain'].includes(row.status))data.globalItems[global]={...row};}
}
function key(task,share){return identity(task.destination,task.uid,share.shareCode);}
function pending(data,task,share){const prefix=key(task,share)+'|';return Object.entries(data.globalItems).some(([k,v])=>k.startsWith(prefix)&&['intent','uncertain'].includes(v.status));}
module.exports={parts,identity,migrate,key,pending};
