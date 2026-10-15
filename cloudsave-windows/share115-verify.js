// Read-only verification. Never repeat the receive POST to resolve ambiguity.
const name=row=>String(row.n??row.file_name??row.name??'');
const file=row=>Boolean(row.fid&&String(row.fid)!=='0'||row.file_id);
const id=row=>String(file(row)?row.fid||row.file_id:row.cid||'');
const size=row=>Number(row.s??row.file_size??row.size);
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
   active();if(depth>20)throw Error('目录核验层级过深');const actual=await target(folder),used=new Set();
   for(const row of expected){
    if(++checked>100000)throw Error('目录核验文件过多');
    if(!name(row))throw Error('源文件名称缺失，无法核验');
    const found=actual.find((candidate,index)=>{
     if(used.has(index)||name(candidate)!==name(row)||file(candidate)!==file(row))return false;
     if(!file(row))return true;
     return Number.isFinite(size(row))&&size(row)>=0&&size(candidate)===size(row)&&(!hash(row)||!hash(candidate)||hash(row)===hash(candidate));
    });
    if(!found)throw Error('目标目录未找到匹配项目：'+name(row));used.add(actual.indexOf(found));
    if(!file(row))await compare(await sourceRows(id(row)),id(found),depth+1);
   }
  }
  try{await compare(rows,String(cid));return {verified:true,checked,requests:totalRequests};}
  catch(error){last=error;active();if(attempt===0)await wait(2000);}
 }
 throw last;
}
module.exports={verifySavedShare};
