const crypto=require('crypto');
class CatalogCache {
 constructor({read,write,limit=1500,now=Date.now}){
  Object.assign(this,{write,now});const count=Number(limit);this.limit=Number.isFinite(count)?Math.max(1,Math.floor(count)):1500;
  this.rows=Object.create(null);const saved=read(),time=this.now();
  if(saved&&typeof saved==='object'&&!Array.isArray(saved))for(const [key,row]of Object.entries(saved)){
   if(/^[a-f0-9]{64}$/.test(key)&&row&&typeof row==='object'&&!Array.isArray(row)&&Number.isFinite(row.time)&&row.time>=0&&row.time<=time&&Object.hasOwn(row,'value'))this.rows[key]=row;
  }
  this.trim();
 }
 key(value){return crypto.createHash('sha256').update(value).digest('hex');}
 trim(){const keys=Object.keys(this.rows);if(keys.length>this.limit)for(const key of keys.sort((a,b)=>this.rows[a].time-this.rows[b].time).slice(0,keys.length-this.limit))delete this.rows[key];}
 get(key,ttl){const row=this.rows[this.key(key)],age=row?this.now()-row.time:-1;return row&&age>=0&&age<ttl?row.value:undefined;}
 set(key,value){this.rows[this.key(key)]={time:this.now(),value};this.trim();this.write(this.rows);}
 clear(){this.rows=Object.create(null);this.write(this.rows);}
}
module.exports={CatalogCache};
