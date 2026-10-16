const fs=require('fs'),path=require('path'),crypto=require('crypto');
const POSTER_MAX_BYTES=5*1024*1024;
async function discardBody(response){try{await response.body?.cancel();}catch(_){/* Keep the original response error. */}}
async function posterBytes(response){
 const reader=response.body?.getReader?.();
 if(!reader){const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length||bytes.length>POSTER_MAX_BYTES)throw Error('封面大小无效');return bytes;}
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>POSTER_MAX_BYTES)throw Error('封面大小无效');chunks.push(Buffer.from(value));}
  if(!size)throw Error('封面大小无效');return Buffer.concat(chunks,size);
 }catch(error){try{await reader.cancel();}catch(_){}throw error;}
 finally{reader.releaseLock();}
}
class PosterCache{
 constructor({root,fetcher=fetch,limit=4,ttl=30*86400000,now=Date.now}){Object.assign(this,{root,fetcher,ttl,now});this.limit=Math.max(1,Math.min(32,Math.floor(Number(limit)||4)));this.running=0;this.waiting=[];this.pending=new Map();this.failures=new Map();}
 acquire(){if(this.running<this.limit){this.running++;return Promise.resolve();}return new Promise(resolve=>this.waiting.push(resolve));}
 release(){const next=this.waiting.shift();if(next)next();else this.running--;}
 async load(url,site='butailing',origin='https://www.0bt0.com'){
  const bases={btbtla:'https://www.btbtla.com',jying:'https://jying.top',qmp4:'https://www.qmp4.com',guanying:'https://www.xn--wcv59z.com',butailing:origin};const base=bases[site] || origin,target=new URL(url,base);if(!['https:','http:'].includes(target.protocol)||target.username||target.password)throw Error('封面地址无效');const key=crypto.createHash('sha256').update(target.href).digest('hex'),file=path.join(this.root,key+'.json');try{const stat=fs.statSync(file);if(Date.now()-stat.mtimeMs<this.ttl){const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.url===target.href&&typeof saved.data==='string'&&saved.data.length<=7100000&&/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+={0,2}$/i.test(saved.data))return saved.data;}}catch(_){}if(this.pending.has(key))return this.pending.get(key);const failureKey=key+':'+base,failure=this.failures.get(failureKey);if(failure&&this.now()<failure.retryAt)throw failure.error;
  const task=(async()=>{await this.acquire();try{let last;for(const ref of [null,base+'/']){try{const r=await this.fetcher(target.href,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Mozilla/5.0',...(ref?{Referer:ref}:{})}});if(!r.ok){await discardBody(r);throw Error('封面HTTP '+r.status);}const type=(r.headers.get('content-type') || '').split(';')[0];if(!type.startsWith('image/')||Number(r.headers.get('content-length'))>POSTER_MAX_BYTES){await discardBody(r);throw Error('封面格式或大小无效');}const bytes=await posterBytes(r);const data='data:'+type+';base64,'+bytes.toString('base64');try{fs.mkdirSync(this.root,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({url:target.href,data}));fs.renameSync(tmp,file);}catch(_){/* A cache disk error must not hide an already downloaded cover. */}return data;}catch(e){last=e;}}throw last;}finally{this.release();}})();this.pending.set(key,task);try{const data=await task;this.failures.delete(failureKey);return data;}catch(error){const attempts=(failure?.attempts||0)+1;this.failures.delete(failureKey);this.failures.set(failureKey,{error,attempts,retryAt:this.now()+Math.min(300000,30000*2**Math.min(attempts-1,4))});if(this.failures.size>200)this.failures.delete(this.failures.keys().next().value);throw error;}finally{this.pending.delete(key);}
 }
}
module.exports={PosterCache};
