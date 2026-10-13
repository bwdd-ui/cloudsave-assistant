'use strict';
const crypto=require('crypto');
const HOST='https://yun.123pan.com';
function crc32(text){let crc=0xffffffff;for(const b of Buffer.from(text)){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function signedUrl(path,params={}){
 const url=new URL(path,HOST);for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
 const now=new Date(),stamp=Math.floor(now.getTime()/1000),digits=new Date(now.getTime()+8*3600000).toISOString().replace(/\D/g,'').slice(0,12),table='adefghlmyijnopkqrstubcvwsz';
 const timeSign=crc32([...digits].map(d=>table[Number(d)]).join('')),nonce=crypto.randomInt(10000000);
 url.searchParams.set(String(timeSign),`${stamp}-${nonce}-${crc32([stamp,nonce,path,'web','3',timeSign].join('|'))}`);return url.href;
}
function parseShare(value,password=''){
 const match=String(value).match(/https?:\/\/[^\s<>"，]+/);if(!match)throw new Error('请输入123云盘分享链接');
 const url=new URL(match[0]),host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.port||!(/^(?:www\.|yun\.)?123(?:pan\.(?:com|cn)|865\.com|684\.com|912\.com|952\.com)$/.test(host)||/^\d+\.(?:mshare|share)\.123pan\.cn$/.test(host)))throw new Error('只支持123云盘的HTTPS分享链接');
 const key=url.pathname.match(/^\/(?:s|ps|123pan)\/([a-zA-Z0-9_-]+)(?:\.html)?\/?$/)?.[1];if(!key)throw new Error('分享链接格式不正确');
 return {shareKey:key,url:url.href,password:String(password||url.searchParams.get('pwd')||String(value).match(/(?:提取码|访问码)\s*[:：]?\s*([a-zA-Z0-9]+)/)?.[1]||'').trim()};
}
class Pan123Provider{
 constructor({auth,fetch,rate=3000,lane}){this.auth=auth;this.fetch=fetch;this.rate=rate;this.lane=lane||{last:0,tail:Promise.resolve()};}
 snapshot(){const value={...this.auth()};return new Pan123Provider({auth:()=>value,fetch:this.fetch,rate:this.rate,lane:this.lane});}
 request(...args){const promise=this.lane.tail.then(()=>this.perform(...args));this.lane.tail=promise.catch(()=>{});return promise;}
 async perform(path,params={},body,signal){
  signal?.throwIfAborted();const delay=Math.max(0,this.lane.last+this.rate-Date.now());
  if(delay)await require('timers/promises').setTimeout(delay,undefined,{signal});signal?.throwIfAborted();this.lane.last=Date.now();
  const auth=this.auth();if(!auth?.token)throw new Error('请先打开123云盘登录');
  const response=await this.fetch(signedUrl(path,body?{}:params),{method:body?'POST':'GET',headers:{'Content-Type':'application/json;charset=UTF-8',platform:'web','app-version':'3',Authorization:'Bearer '+auth.token,LoginUuid:auth.loginUuid||'',Referer:HOST+'/'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error('123云盘请求失败（HTTP '+response.status+'）');let data;try{data=await response.json();}catch{throw new Error('123云盘返回非JSON，请打开登录窗口检查验证状态');}
  if(Number(data.code)!==0)throw new Error('123云盘：'+String(data.message||data.msg||'接口异常').slice(0,180));return data.data;
 }
 async account(signal){const d=await this.request('/b/api/user/info',{},null,signal);const uid=String(d?.UID||d?.Uid||'');if(!/^\d+$/.test(uid))throw new Error('123云盘登录状态无法确认，请重新登录');return {uid,name:d.Nickname||'123云盘账号'};}
 async list(parent=0,share,signal){
  const all=[],seen=new Set();let next=0;for(let page=1;page<=10000;page++){
   const d=await this.request(share?'/b/api/share/get':'/b/api/file/list/new',{driveId:0,limit:100,next,orderBy:'file_name',orderDirection:'asc',parentFileId:parent,ParentFileId:parent,Page:page,event:'homeListFile',operateType:share&&String(parent)!=='0'?4:1,trashed:false,...(share?{shareKey:share.shareKey,SharePwd:share.password}:{})},null,signal);
   if(!Array.isArray(d?.InfoList))throw new Error('123云盘文件列表结构异常，未继续转存');
   let fresh=0;for(const row of d.InfoList){if(!row.FileId||![0,1].includes(Number(row.Type))||typeof row.FileName!=='string')throw new Error('123云盘文件信息不完整');if(!seen.has(String(row.FileId))){seen.add(String(row.FileId));all.push(row);fresh++;}}
   // The share endpoint uses IsFirst=false for MORE pages (not for the last page).
   if(!d.InfoList.length||String(d.Next)==='-1'||('IsFirst' in d&&d.IsFirst!==false))return all;
   next=d.Next??0;
   if(!fresh)throw new Error('123云盘分页重复，已停止以免漏扫');
  }throw new Error('123云盘分页超过安全上限');
 }
 async mkdir(name,parent,signal){
  await this.request('/b/api/file/upload_request',{}, {driveId:0,etag:'',fileName:name,parentFileId:parent,size:0,type:1,duplicate:1,NotReuse:true,event:'newCreateFolder',operateType:1},signal);
  const row=(await this.list(parent,null,signal)).find(x=>Number(x.Type)===1&&x.FileName===name);if(!row)throw new Error('文件夹创建尚未确认，下次检查重新读取');return String(row.FileId);
 }
 save(file,parent,share,signal){return this.request('/b/api/restful/goapi/v1/file/copy/save',{}, {fileList:[{fileID:file.FileId,size:file.Size,etag:file.Etag,type:0,parentFileID:parent,fileName:file.FileName,driveID:0}],shareKey:share.shareKey,sharePwd:share.password,currentLevel:0,superAdmin:null},signal);}
}
module.exports={Pan123Provider,parseShare,signedUrl,crc32};
