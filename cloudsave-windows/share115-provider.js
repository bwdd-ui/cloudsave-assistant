const HOSTS=new Set(['115.com','www.115.com','115cdn.com','www.115cdn.com','anxia.com','www.anxia.com','share.115.com']);
function parseShare(value,code=''){
 let u;try{u=new URL(String(value).trim());}catch{return null;}
 if(!['https:','http:'].includes(u.protocol)||!HOSTS.has(u.hostname)||u.username||u.password||u.port)return null;
 const match=u.pathname.match(u.hostname==='share.115.com'?/^\/(?:s\/)?([a-z0-9]{5,64})\/?$/i:/^\/s\/([a-z0-9]{5,64})\/?$/i);if(!match)return null;
 const raw=String(code||u.searchParams.get('password')||u.searchParams.get('receive_code')||u.hash.match(/^#([a-z0-9]{4})$/i)?.[1]||'').trim();
 const pin=raw.match(/(?:提取码|访问码|密码)\s*[:：]?\s*([a-z0-9]{4})/i)?.[1]||raw;
 if(!/^[a-z0-9]{0,32}$/i.test(pin))throw Error('115分享提取码格式异常');
 return {shareCode:match[1],receiveCode:pin,url:'https://115.com/s/'+match[1]};
}
function itemId(row){const value=row.fid&&String(row.fid)!=='0'?row.fid:row.file_id||row.cid||'';if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('115分享文件ID精度异常');const id=String(value);if(!/^[1-9]\d*$/.test(id))throw Error('115分享文件ID异常');return id;}
class Share115Provider{
 constructor({request,check,wait=ms=>new Promise(r=>setTimeout(r,ms))}){Object.assign(this,{request,check,wait});}
 async list(share,cookie,active,cid='0'){const rows=[],seen=new Set();let total=null;
  for(let offset=0,page=0;page<10000;page++){
   active();if(page){await this.wait(1000);active();}
   const query=new URLSearchParams({share_code:share.shareCode,receive_code:share.receiveCode,cid:String(cid),limit:'100',offset:String(offset)});
   const result=await this.request('https://webapi.115.com/share/snap?'+query,{},cookie);active();this.check(result);
   const data=result.data,list=data?.list,count=Number(data?.count);
   if(!Array.isArray(list)||!Number.isSafeInteger(count)||count<0)throw Error('115分享分页格式异常，未执行转存');
   if(total!==null&&count!==total)throw Error('115分享内容在扫描期间变化，稍后重试');total=count;
   for(const row of list){const id=itemId(row);if(seen.has(id))throw Error('115分享重复分页，未执行转存');seen.add(id);rows.push({...row,id});}
   offset+=list.length;if(offset===total)return rows;
   if(offset>total||!list.length)throw Error('115分享分页不完整，未执行转存');
  }throw Error('115分享分页数量异常，未执行转存');
 }
 async inspect(share,rows,cookie,active){let bytes=0,nodes=0,sizeKnown=true;const seen=new Set(),files=[];const visit=async(items,depth)=>{if(depth>20)throw Error('分享目录层级过深，无法确认文件信息');for(const row of items){active();if(++nodes>100000)throw Error('分享文件过多，无法确认文件信息');const folder=String(row.fid||'0')==='0'&&!row.file_id;if(folder){if(seen.has(row.id))throw Error('分享目录重复，无法确认文件信息');seen.add(row.id);await this.wait(1000);await visit(await this.list(share,cookie,active,row.id),depth+1);}else{files.push(row);const value=Number(row.s??row.file_size??row.size);if(!Number.isFinite(value)||value<0)sizeKnown=false;else bytes+=value;}}};await visit(rows,0);return {bytes,sizeKnown,files};}
 async size(share,rows,cookie,active){const result=await this.inspect(share,rows,cookie,active);if(!result.sizeKnown)throw Error('分享文件大小缺失，未通过大小筛选');return result.bytes;}
 async receive(share,ids,cid,cookie,{files,active=()=>{}}={}){
  if(!/^\d+$/.test(String(cid))||!ids.length||ids.some(id=>! /^[1-9]\d*$/.test(id)))throw Error('115转存目录或文件ID无效');
  active();
  const body=new URLSearchParams({share_code:share.shareCode,receive_code:share.receiveCode,file_id:ids.join(','),cid:String(cid)});
  let result;try{result=await this.request('https://webapi.115.com/share/receive',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:'https://115.com/'},body},cookie);}catch(error){throw Object.assign(Error('转存结果未确认，请核对115目标文件夹，避免重复转存：'+error.message),{uncertain:true});}
  if(!result||!['boolean'].includes(typeof result.state)&&typeof result.success!=='boolean')throw Object.assign(Error('115转存响应缺少明确结果，请核对目标文件夹后再处理'),{uncertain:true});
  if(result.state===false||result.success===false)throw Error(String(result.error||result.error_msg||result.msg||result.message||'115未接受转存请求'));
  this.check(result);
  if(files){
   try{const verification=await require('./share115-verify').verifySavedShare({request:this.request,check:this.check,source:this.list.bind(this),wait:this.wait,share,rows:files,cid,cookie,active});return {...result,verification};}
   catch(error){throw Object.assign(Error('115接口已接受，但目标目录保存未核验通过：'+error.message+'；请核对后处理，未自动重复转存'),{uncertain:true,serverResult:Object.fromEntries(['state','success','code','errno'].filter(key=>['boolean','number','string'].includes(typeof result[key])).map(key=>[key,result[key]]))});}
  }
  return result;
 }
}
module.exports={Share115Provider,parseShare,itemId};
