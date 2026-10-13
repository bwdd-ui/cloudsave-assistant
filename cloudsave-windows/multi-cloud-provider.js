const NAMES={pan123:'123云盘',quark:'夸克云盘',tianyi:'天翼云盘',xunlei:'迅雷云盘',baidu:'百度网盘'};
const ORIGINS={quark:'https://drive-pc.quark.cn',tianyi:'https://cloud.189.cn',xunlei:'https://api-pan.xunlei.com',baidu:'https://pan.baidu.com'};
function parse(cloud,value,code=''){
 if(cloud==='pan123'){try{const s=require('./pan123-provider').parseShare(value,code);return {...s,shareCode:s.shareKey,receiveCode:s.password};}catch{return null;}}
 if(cloud==='xunlei'&&/^magnet:\?/i.test(value)){const id=String(value).match(/btih:([a-z0-9]{32,40})/i)?.[1];return id?{shareCode:'magnet:'+id.toLowerCase(),url:value,magnet:true}:null;}
 let u;try{u=new URL(String(value).match(/https?:\/\/[^\s<>]+/)?.[0]||value);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
 const hosts={quark:['pan.quark.cn'],tianyi:['cloud.189.cn'],xunlei:['pan.xunlei.com'],baidu:['pan.baidu.com','yun.baidu.com']};
 if(!hosts[cloud]?.includes(u.hostname.toLowerCase()))return null;
 const id=cloud==='tianyi'?(u.searchParams.get('code')||u.pathname.match(/^\/t\/([a-z0-9]+)\/?$/i)?.[1]):u.pathname.match(/^\/s\/([a-z0-9_-]+)\/?$/i)?.[1];if(!id)return null;
 return {shareCode:cloud==='baidu'?id.replace(/^1/,''):id,url:u.href,receiveCode:String(code||u.searchParams.get('pwd')||u.searchParams.get('password')||u.searchParams.get('pass_code')||'').replace(/^(?:提取码|密码)\s*[:：]?\s*/,'').trim()};
}
function id(value){const s=String(value??'');if(!s||s==='undefined'||s==='null'||typeof value==='number'&&!Number.isSafeInteger(value))throw Error('网盘文件ID缺失或超出精度');return s;}
class MultiCloudProvider{
 constructor(cloud,d){this.cloud=cloud;this.d=d;this.name=NAMES[cloud];this.access=new Map();this.own=null;}
 async request(path,query={},body,write=false){
  const u=new URL(path,ORIGINS[this.cloud]);for(const [k,v] of Object.entries(query))u.searchParams.set(k,String(v));
  try{const r=await this.d.request(u.href,body);if(!r||typeof r!=='object')throw Error('网盘返回格式异常');
   const ok=this.cloud==='quark'?Number(r.code)===0&&(!r.status||r.status===200):this.cloud==='baidu'?Number(r.errno)===0:this.cloud==='tianyi'?Number(r.res_code)===0||Number(r.resCode)===0:!r.error&&!r.error_code;
   if(!ok)throw Error(this.name+'：'+String(r.message||r.msg||r.error_description||r.errorMsg||r.error||r.res_message||r.errno||'接口未确认成功'));
   return r;
  }catch(e){if(write)e.uncertain=true;throw e;}
 }
 async account(){let uid,name,r;
  if(this.cloud==='quark'){r=await this.d.request('https://pan.quark.cn/account/info?fr=pc&platform=pc');const a=r?.data;uid=a?.uid||a?.user_id;name=a?.nickname||a?.nick_name;}
  if(this.cloud==='tianyi'){r=await this.request('/api/open/user/getUserBriefInfo.action');uid=r.userId||r.userID||r.loginName;name=r.nickName||r.userName||r.loginName;}
  if(this.cloud==='baidu'){r=await this.request('/api/gettemplatevariable',{fields:JSON.stringify(['bdstoken','uk','username']),clienttype:0,app_id:250528});const a=r.result;uid=a?.uk;name=a?.username;if(!a?.bdstoken)throw Error('百度登录凭据缺失，请打开官方登录窗口');this.token=a.bdstoken;}
  if(this.cloud==='xunlei'){await this.request('/drive/v1/files',{limit:1,parent_id:''});const raw=this.d.token?.()||'';try{uid=JSON.parse(Buffer.from(raw.replace(/^Bearer\s+/i,'').split('.')[1],'base64url').toString()).sub;}catch{}name='迅雷账号';}
  if(!uid)throw Error('请先打开'+this.name+'登录窗口完成登录');this.own={uid:String(uid),name:String(name||this.name+'账号')};return this.own;
 }
 row(raw){
  if(this.cloud==='quark')return {id:id(raw.fid),name:raw.file_name,isDir:Boolean(raw.dir||raw.file_type===0),bytes:Number(raw.size),raw};
  if(this.cloud==='tianyi')return {id:id(raw.id||raw.fileId),name:raw.name||raw.fileName,isDir:Boolean(raw.isFolder),bytes:Number(raw.size??raw.fileSize),raw};
  if(this.cloud==='baidu')return {id:id(raw.fs_id),name:raw.server_filename,isDir:raw.isdir===1,bytes:Number(raw.size),raw};
  return {id:id(raw.id),name:raw.name,isDir:raw.kind==='drive#folder',bytes:Number(raw.size),raw};
 }
 async page(parent,page=1,share){
  let r,rows,total,next;
  if(this.cloud==='quark'){
   if(share&&!share.stoken){r=await this.request('/1/clouddrive/share/sharepage/token',{pr:'ucpro',fr:'pc'},{pwd_id:share.shareCode,passcode:share.receiveCode});if(!r.data?.stoken)throw Error('夸克未返回分享访问凭据');share.stoken=r.data.stoken;}
   r=await this.request(share?'/1/clouddrive/share/sharepage/detail':'/1/clouddrive/file/sort',{pr:'ucpro',fr:'pc',...(share?{pwd_id:share.shareCode,stoken:share.stoken}:{}),pdir_fid:parent,_page:page,_size:100,_sort:'file_type:asc,file_name:asc'});rows=r.data?.list;total=r.metadata?._total??r.data?.total;next=Number(total)>page*100;
  }else if(this.cloud==='tianyi'){
   if(share&&!share.shareId){r=await this.request('/api/open/share/getShareInfoByCode.action',{shareCode:share.shareCode});share.shareId=r.shareId;share.shareMode=r.shareMode;share.rootId=r.fileId||r.fileID;share.singleFile=r.isFolder===false&&r.fileId&&r.fileName?{id:r.fileId,name:r.fileName,size:r.fileSize,isFolder:false}:null;if(!share.shareId)throw Error('天翼分享ID缺失');if(r.needAccessCode&&!share.receiveCode)throw Error('天翼分享需要提取码');if(share.receiveCode)await this.request('/api/open/share/checkAccessCode.action',{shareCode:share.shareCode,accessCode:share.receiveCode});}
   if(share?.singleFile&&page===1)return {rows:[this.row(share.singleFile)],next:false};if(share?.rootId&&String(parent)==='-11')parent=share.rootId;
   r=await this.request(share?'/api/open/share/listShareDir.action':'/api/open/file/listFiles.action',{pageNum:page,pageSize:100,folderId:parent,fileId:parent,orderBy:'filename',descending:false,mediaType:0,...(share?{shareId:share.shareId,shareMode:share.shareMode,accessCode:share.receiveCode,isFolder:true}:{} )});const v=r.fileListAO||r;rows=[...(v.folderList||[]).map(x=>({...x,isFolder:true})),...(v.fileList||[])];if(!Array.isArray(v.fileList)&&!Array.isArray(v.folderList))throw Error('天翼文件列表格式异常');total=v.count??v.totalCount;next=Number(total)>page*100;
  }else if(this.cloud==='baidu'){
   if(share&&!share.uk)await this.baiduShare(share);
   r=await this.request(share?'/share/list':'/api/list',{page,num:100,order:'name',desc:0,web:1,clienttype:0,app_id:250528,...(share?{shareid:share.shareId,uk:share.uk,root:parent==='/'?1:0,dir:parent}: {dir:parent})});rows=r.list;next=r.has_more===1||Array.isArray(rows)&&rows.length===100;
  }else{
   if(share?.magnet)return {rows:[{id:'magnet',name:share.url,isDir:false,bytes:NaN,raw:{}}],next:false};
   r=await this.request(share?'/drive/v1/share':'/drive/v1/files',{limit:100,parent_id:parent,page_token:page===1?'':page,...(share?{share_id:share.shareCode,pass_code:share.receiveCode}:{} )});rows=r.files;if(share)share.passCodeToken=r.pass_code_token||share.passCodeToken;next=r.next_page_token||false;
  }
  if(!Array.isArray(rows))throw Error(this.name+'文件列表格式异常');return {rows:rows.map(x=>this.row(x)),next};
 }
 async list(share,_cookie,active,parent){return this.all(parent??(this.cloud==='baidu'?'/':this.cloud==='tianyi'?'-11':this.cloud==='xunlei'?'':'0'),share,active);}
 async all(parent,share,active=()=>{}){const rows=[],seen=new Set();let page=1;for(let step=0;step<10000;step++){active();const batch=await this.page(parent,page,share);for(const f of batch.rows){if(seen.has(f.id))throw Error(this.name+'文件分页重复');seen.add(f.id);rows.push(f);}if(!batch.next)return rows;if(!batch.rows.length)throw Error('分页未结束但文件列表为空');page=this.cloud==='xunlei'?batch.next:Number(page)+1;}throw Error('文件列表超过安全上限');}
 async folders(parent){const files=await this.all(parent,undefined);return files.filter(x=>x.isDir).map(x=>({id:this.cloud==='baidu'?x.raw.path:x.id,cid:this.cloud==='baidu'?x.raw.path:x.id,parentId:parent,name:x.name}));}
 async validateFolder(_cookie,folder,uid){if(!folder||folder.cloud!==this.cloud||folder.uid!==uid||!Object.hasOwn(folder,'cid'))throw Error('请重新选择'+this.name+'保存文件夹');const root={quark:'0',tianyi:'-11',xunlei:'',baidu:'/'}[this.cloud];if(folder.cid===root&&folder.explicitRoot)return folder;const rows=await this.folders(folder.parentId);if(!rows.some(x=>x.cid===folder.cid))throw Error('保存文件夹不存在或已删除');return folder;}
 async inspect(share,roots,cookie,active){const files=[],queue=roots.map(x=>({row:x,depth:0})),seen=new Set();let bytes=0,sizeKnown=true;while(queue.length){active();const {row,depth}=queue.shift();if(depth>20||files.length+queue.length>100000)throw Error('分享目录超过检查上限');if(seen.has(row.id))throw Error('分享目录重复');seen.add(row.id);if(!row.name)throw Error('分享文件名称缺失');if(row.isDir){const children=await this.list(share,cookie,active,this.cloud==='baidu'?row.raw.path:row.id);queue.push(...children.map(row=>({row,depth:depth+1})));}else{files.push({name:row.name,bytes:row.bytes});if(Number.isFinite(row.bytes)&&row.bytes>=0)bytes+=row.bytes;else sizeKnown=false;}}return {files,bytes,sizeKnown};}
 async size(share,roots,cookie,active){const r=await this.inspect(share,roots,cookie,active);if(!r.sizeKnown)throw Error('文件大小缺失');return r.bytes;}
 async receive(share,ids,cid){
  if(cid===undefined||cid===null)throw Error('必须明确选择保存文件夹');let r;
  if(this.cloud==='quark'){const files=await this.list(share,'',()=>{});const selected=ids.map(x=>{const f=files.find(f=>f.id===x);if(!f?.raw.share_fid_token)throw Error('夸克分享文件凭据缺失');return f;});r=await this.request('/1/clouddrive/share/sharepage/save',{pr:'ucpro',fr:'pc'},{fid_list:ids,fid_token_list:selected.map(x=>x.raw.share_fid_token),to_pdir_fid:cid,pwd_id:share.shareCode,stoken:share.stoken,pdir_fid:'0',scene:'link'},true);if(!r.data?.task_id)throw Object.assign(Error('夸克未返回保存任务凭据，请核对后处理'),{uncertain:true});return {taskId:String(r.data.task_id)};}
  if(this.cloud==='tianyi'){r=await this.request('/api/open/batch/createBatchTask.action',{},new URLSearchParams({type:'SHARE_SAVE',taskInfos:JSON.stringify(ids.map(fileId=>({fileId,shareId:share.shareId}))),targetFolderId:cid,shareId:String(share.shareId)}),true);const t=r.taskId||r.data?.taskId;if(!t)throw Object.assign(Error('天翼未返回保存任务凭据'),{uncertain:true});return {taskId:String(t)};}
  if(this.cloud==='baidu'){if(!this.token)await this.account();r=await this.request('/share/transfer',{shareid:share.shareId,from:share.uk,bdstoken:this.token,async:1,channel:'chunlei',web:1,app_id:250528,clienttype:0},new URLSearchParams({fsidlist:JSON.stringify(ids),path:cid,ondup:'newcopy',extra:JSON.stringify({sekey:share.randsk||''})}),true);if(!r.extra?.list?.length&&!r.taskid&&!r.request_id)throw Object.assign(Error('百度未返回保存凭据'),{uncertain:true});return {taskId:String(r.taskid||r.request_id||'accepted')};}
  if(share.magnet)r=await this.request('/drive/v1/files',{}, {kind:'drive#file',upload_type:'UPLOAD_TYPE_URL',url:{url:share.url},parent_id:cid},true);
  else r=await this.request('/drive/v1/share/restore',{}, {share_id:share.shareCode,pass_code_token:share.passCodeToken||'',file_ids:ids,parent_id:cid},true);
  const receipt=r.task?.id||r.task_id||r.file?.id||r.file_id;if(!receipt)throw Object.assign(Error('迅雷未返回保存凭据，请核对结果'),{uncertain:true});return {taskId:String(receipt)};
 }
 async baiduShare(share){if(share.receiveCode){const r=await this.request('/share/verify',{surl:share.shareCode},new URLSearchParams({pwd:share.receiveCode,vcode:'',vcode_str:''}));share.randsk=r.randsk;}
  const html=await this.d.html(share.url);const patterns=[/yunData\s*=\s*(\{[^;]+\});/,/yunData\.setData\((\{[\s\S]+?\})\);/];let data;for(const p of patterns){try{const match=html.match(p);if(match){data=JSON.parse(match[1]);break;}}catch{}}
  share.uk=data?.uk||data?.share_uk;share.shareId=data?.shareid||data?.share_id;if(!share.uk||!share.shareId)throw Error('百度分享页面未返回可读取的分享信息，请在官方窗口检查提取码或验证');
 }
}
module.exports={NAMES,ORIGINS,parse,MultiCloudProvider};
