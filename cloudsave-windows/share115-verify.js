// Read-only verification. Never repeat the receive POST to resolve ambiguity.
const name=row=>String(row.n??row.file_name??row.name??'');
const file=row=>Boolean(row.fid&&String(row.fid)!=='0'||row.file_id);
const id=row=>String(file(row)?row.fid||row.file_id:row.cid||'');
const size=row=>Number(row.s??row.file_size??row.size);
// Bucket by identity, then prefer matching checksums over checksum-less fallbacks.
// Each candidate is consumed once; reversed large listings stay linear in size.
function targetIndex(rows){
 const buckets=new Map();
 for(const row of rows){
  const isFile=file(row),bytes=size(row);if(isFile&&(!Number.isFinite(bytes)||bytes<0))continue;
  const key=JSON.stringify([isFile,name(row),isFile?bytes:null]);
  let bucket=buckets.get(key);if(!bucket)buckets.set(key,bucket={all:[],hashes:new Map()});
  const entry={row,used:false},checksum=isFile?hash(row):'';
  bucket.all.push(entry);if(!bucket.hashes.has(checksum))bucket.hashes.set(checksum,[]);bucket.hashes.get(checksum).push(entry);
 }
 const take=queue=>{while(queue?.length){const entry=queue.pop();if(!entry.used){entry.used=true;return entry.row;}}};
 return row=>{
  const isFile=file(row),bytes=size(row);if(isFile&&(!Number.isFinite(bytes)||bytes<0))return;
  const bucket=buckets.get(JSON.stringify([isFile,name(row),isFile?bytes:null]));if(!bucket)return;
  const checksum=isFile?hash(row):'';
  return checksum ? take(bucket.hashes.get(checksum))||take(bucket.hashes.get('')) : take(bucket.all);
 };
}
const hash=row=>String(row.sha1||row.sha||'').toUpperCase();
async function verifySavedShare({request,check,source,wait,share,rows,cid,cookie,active}){
 const sourceCache=new Map();let totalRequests=0;
 const tick=async()=>{active();if(++totalRequests>100)throw Error('目录核验达到读取上限，请核对目标目录');await wait(1000);active();};
 const sourceRows=async folder=>{if(!sourceCache.has(folder)){await tick();sourceCache.set(folder,await source(share,cookie,active,folder));}return sourceCache.get(folder);};
 async function targetRows(folder){
  let offset=0,total=null;const rows=[],seen=new Set();
  while(true){
   await tick();const params=new URLSearchParams({aid:'1',cid:folder,offset:String(offset),limit:'1000',show_dir:'1'});
   const response=await request('https://webapi.115.com/files?'+params,{},cookie);active();check(response);
   const body=response.data,path=response.path||body?.path,last=Array.isArray(path)?path.at(-1):null;
   const actual=String(last?.cid??last?.file_id??response.cid??body?.cid??'');
   if(actual!==String(folder))throw Error('115未确认核验目录，不能认定已保存');
   const list=Array.isArray(body)?body:body?.list,count=Number(response.count??body?.count);
   if(!Array.isArray(list)||!Number.isSafeInteger(count)||count<0||total!==null&&count!==total)throw Error('目标目录分页不完整或内容变化，未确认保存');
   total=count;
   for(const row of list){const key=(file(row)?'f:':'d:')+id(row);if(!/^[fd]:[1-9]\d*$/.test(key)||seen.has(key))throw Error('目标目录分页重复或ID无效');seen.add(key);rows.push(row);}
   offset+=list.length;if(offset===total)return rows;if(offset>total||!list.length)throw Error('目标目录分页未完整返回');
  }
 }
 let last;
 for(let attempt=0;attempt<2;attempt++){
  const targets=new Map();let checked=0;
  const target=async folder=>{if(!targets.has(folder))targets.set(folder,await targetRows(folder));return targets.get(folder);};
  async function compare(expected,folder,depth=0){
   active();if(depth>20)throw Error('目录核验层级过深');const find=targetIndex(await target(folder));
   // Reserve checksum matches before sources without checksums consume arbitrary files.
   const known=[],other=[];for(const row of expected)(file(row)&&hash(row)?known:other).push(row);
   for(const row of known.concat(other)){
    if(++checked>100000)throw Error('目录核验文件过多');
    if(!name(row))throw Error('源文件名称缺失，无法核验');
    const found=find(row);
    if(!found)throw Error('目标目录未找到匹配项目：'+name(row));
    if(!file(row))await compare(await sourceRows(id(row)),id(found),depth+1);
   }
  }
  try{await compare(rows,String(cid));return {verified:true,checked,requests:totalRequests};}
  catch(error){last=error;active();if(attempt===0)await wait(2000);}
 }
 throw last;
}
module.exports={verifySavedShare};
