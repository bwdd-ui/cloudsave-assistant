const API='https://api.guangyapan.com',ACCOUNT='https://account.guangyapan.com';
function identifier(value,root=false){if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('光鸭文件夹ID精度异常');const id=String(value??'');if(root&&id==='')return '';if(!/^[1-9]\d*$/.test(id))throw Error('光鸭文件夹ID无效');return id;}
function linkKey(value){const url=String(value||'').trim();if(/^magnet:\?/i.test(url)){const hash=new URL(url).searchParams.get('xt')?.match(/^urn:btih:([a-z0-9]{32}|[a-f0-9]{40})$/i)?.[1];if(!hash)throw Error('磁力链接格式无效');return 'magnet:'+hash.toLowerCase();}if(/^ed2k:\/\/\|file\|[^|]+\|\d+\|[a-f0-9]{32}\|/i.test(url))return 'ed2k:'+url.split('|')[4].toLowerCase();throw Error('目前光鸭离线支持磁力及ed2k链接');}
function torrentFiles(info){if(!Array.isArray(info?.subfiles)||!info.subfiles.length)throw Error('光鸭磁力文件清单缺失');const files=[],seen=new Set();let nodes=0;const visit=(rows,depth)=>{if(depth>20)throw Error('光鸭磁力目录层级过深');for(const f of rows){if(++nodes>100000)throw Error('光鸭磁力文件过多');if(f.isDir){if(!Array.isArray(f.subfiles))throw Error('光鸭磁力目录清单不完整');visit(f.subfiles,depth+1);}else{if(!Number.isInteger(f.fileIndex)||f.fileIndex<0||seen.has(f.fileIndex))throw Error('光鸭磁力文件索引异常');seen.add(f.fileIndex);files.push({n:f.fileName||f.name||f.path||'',s:f.fileSize??f.size,index:f.fileIndex});}}};visit(info.subfiles,0);if(!files.length||info.subfilesNum!=null&&Number(info.subfilesNum)!==files.length)throw Error('光鸭磁力文件清单数量不完整');return files;}
class GuangyaProvider{
 constructor({request}){this.request=request;}
 async account(token){const data=await this.request(ACCOUNT+'/v1/user/me',null,token);if(!data?.sub)throw Error('光鸭登录失效，请打开光鸭登录');return {uid:String(data.sub),name:String(data.name||data.nickname||'光鸭用户')};}
 async api(path,body,token){const result=await this.request(API+path,body,token);if(!(result?.code===0||result?.code===undefined&&result?.msg==='success'))throw Error('光鸭请求失败（'+String(result?.code??'未知')+'）：'+String(result?.msg||'接口未确认成功'));return result.data;}
 async folders(parentId,token){parentId=identifier(parentId,true);const folders=[],seen=new Set();let total=null;
  for(let page=0;page<10000;page++){const data=await this.api('/userres/v1/file/get_file_list',{parentId,page,pageSize:100,orderBy:0,sortType:0},token);if(!Array.isArray(data?.list))throw Error('光鸭目录列表格式异常');
   if(Number.isInteger(data.total)&&data.total>=0){if(total!==null&&data.total!==total)throw Error('目录内容发生变化，请重新读取');total=data.total;}
   for(const row of data.list){const id=identifier(row.fileId);if(seen.has(id))throw Error('光鸭目录重复分页');seen.add(id);if(Number(row.resType)===2)folders.push({id,name:String(row.fileName||id),parentId});}
   if(data.list.length<100||total!==null&&seen.size>=total)return folders;
  }throw Error('光鸭目录分页过多');
 }
 async validate(folder,token,uid){if(!folder||folder.uid&&folder.uid!==uid)throw Error('请为当前光鸭账号重新选择保存文件夹');const id=identifier(folder.id,true);if(id==='')return {id:'',name:'根目录',parentId:'',uid};const rows=await this.folders(folder.parentId,token),row=rows.find(x=>x.id===id);if(!row)throw Error('光鸭保存文件夹不存在或已移动，请重新选择');return {...row,uid};}
 async resolve(url,token){linkKey(url);const data=await this.api('/cloudcollection/v1/resolve_res',{url},token);if(!data||typeof data!=='object')throw Error('光鸭无法解析该资源');return data;}
 async create(url,folder,title,resolved,token){const parentId=identifier(folder.id,true),body={url:String(resolved.url||url),parentId,newName:String(title||resolved.btResInfo?.fileName||'offline_download').slice(0,250)};
  if(resolved.btResInfo?.subfiles?.length)body.fileIndexes=torrentFiles(resolved.btResInfo).map(x=>x.index);
  let result;try{result=await this.request(API+'/cloudcollection/v1/create_task',body,token);}catch{throw Object.assign(Error('光鸭提交结果未确认，请核对云盘任务后再决定是否重试'),{uncertain:true});}
  if(!(result?.code===0||result?.code===undefined&&result?.msg==='success')&&typeof result?.code!=='number')throw Object.assign(Error('光鸭响应缺少明确结果，请核对云盘任务'),{uncertain:true});
  if(result.code!==undefined&&result.code!==0)throw Error('光鸭离线未接受（'+result.code+'）：'+String(result.msg||'提交失败'));
  if(!result.data?.taskId)throw Object.assign(Error('光鸭没有返回任务ID，请先核对云盘任务'),{uncertain:true});return {taskId:String(result.data.taskId),folder};
 }
}
module.exports={GuangyaProvider,identifier,linkKey,torrentFiles};
