const assert=require('node:assert/strict'),{CatalogCache}=require('../catalog-cache');
let clock=10000,writes=0,saved;const make=read=>new CatalogCache({read:()=>read,write:value=>{writes++;saved=JSON.parse(JSON.stringify(value));},limit:2,now:()=>clock});
const seed=make(null),key=name=>seed.key(name),valid={time:9000,value:{items:['retained']}};
for(const root of [null,[],42,'invalid']){const cache=make(root);assert.equal(cache.get('old',5000),undefined);cache.set('new',1);assert.equal(cache.get('new',5000),1);}
const cache=make({[key('valid')]:valid,[key('null')]:null,[key('badtime')]:{time:'9000',value:1},[key('future')]:{time:11000,value:2},[key('missing')]:{time:9000},[key('negative')]:{time:-1,value:1},junk:{time:9000,value:1}});
assert.deepEqual(cache.get('valid',5000),valid.value);assert.equal(Object.keys(cache.rows).length,1);assert.equal(cache.get('future',5000),undefined);cache.set('new',2);cache.set('newest',3);assert.equal(Object.keys(saved).length,2);assert.equal(cache.get('valid',5000),undefined,'Oldest valid row is evicted normally');assert.equal(cache.get('new',5000),2);
clock=9000;assert.equal(cache.get('new',5000),undefined,'Clock rollback never treats future row as fresh');clock=15000;assert.equal(cache.get('new',5000),undefined,'TTL boundary expires');
clock=20000;const loaded=make({[key('one')]:{time:1,value:1},[key('two')]:{time:2,value:2},[key('three')]:{time:3,value:3}});assert.equal(Object.keys(loaded.rows).length,2);assert.equal(loaded.get('one',30000),undefined);assert.equal(loaded.get('three',30000),3);loaded.clear();assert.equal(Object.keys(saved).length,0);assert(writes>0);
console.log('PASS malformed cache roots/rows skipped, valid rows retained, future timestamps and rollback expire, startup/set capacity bounded, clear persists');
