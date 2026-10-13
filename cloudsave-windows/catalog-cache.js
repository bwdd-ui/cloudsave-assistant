const crypto=require('crypto');
class CatalogCache {
  constructor({read,write,limit=1500}) {Object.assign(this,{write,limit});this.rows=read() || {};}
  key(value){return crypto.createHash('sha256').update(value).digest('hex');}
  get(key,ttl){const row=this.rows[this.key(key)];return row&&Date.now()-row.time<ttl?row.value:undefined;}
  set(key,value){this.rows[this.key(key)]={time:Date.now(),value};const keys=Object.keys(this.rows);if(keys.length>this.limit)for(const key of keys.sort((a,b)=>this.rows[a].time-this.rows[b].time).slice(0,keys.length-this.limit))delete this.rows[key];this.write(this.rows);}
  clear(){this.rows={};this.write(this.rows);}
}
module.exports={CatalogCache};
