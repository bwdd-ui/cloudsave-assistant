const assert=require('assert/strict'),{normalizeSizeRanges,sizeFilters}=require('../monitor-size-ranges'),{normalizeOptions,legacyFilters}=require('../guanying-monitor');
const f={sizeRanges:{movie:{minSizeGB:2,maxSizeGB:15},tv:{minSizeGB:20,maxSizeGB:200}}};
assert.equal(sizeFilters(f,'movie').minSizeGB,2);assert.equal(sizeFilters(f,'tv').minSizeGB,20);assert.equal(sizeFilters(sizeFilters(f,'tv'),'movie').maxSizeGB,15);
assert.deepEqual(normalizeSizeRanges({minSizeGB:3,maxSizeGB:40}),{movie:{minSizeGB:3,maxSizeGB:40},tv:{minSizeGB:3,maxSizeGB:40}});
assert.equal(normalizeSizeRanges({sizeRanges:{movie:{minSizeGB:'',maxSizeGB:''},tv:{minSizeGB:'0.5',maxSizeGB:'2.5'}}}).tv.minSizeGB,0.5);
for(const value of [-1,'bad',Infinity,NaN])assert.throws(()=>normalizeSizeRanges({sizeRanges:{movie:{minSizeGB:value}}}));
assert.throws(()=>normalizeSizeRanges({sizeRanges:{movie:{minSizeGB:20,maxSizeGB:10}}}),/电影/);assert.throws(()=>normalizeSizeRanges({sizeRanges:{tv:{minSizeGB:20,maxSizeGB:10}}}),/电视剧/);
const options=normalizeOptions(f);assert.deepEqual(legacyFilters(options).sizeRanges,f.sizeRanges);
// Exercise the actual candidate selector, including filtering before choosing the largest version.
const fs=require('fs'),vm=require('vm'),path=require('path');
const prefix=fs.readFileSync(path.join(__dirname,'test-gy-v2-policy.cjs'),'utf8').split('const {GuanyingProvider')[0];const ctx=vm.createContext({require,__dirname,console,Buffer,process,URL,URLSearchParams});vm.runInContext(prefix+';globalThis.harness=harness;',ctx);const h=ctx.harness();h.ctx.filters={genres:[],countries:[],years:[],qualities:[],tags:[],scoreRange:'',compareSize:true,...f};h.ctx.seeds=[{id:1,zname:'Movie 1080P',zsize:'10GB',zlink:'magnet:?xt=urn:btih:'+'1'.repeat(40)},{id:2,zname:'Movie 4K',zsize:'30GB',zlink:'magnet:?xt=urn:btih:'+'2'.repeat(40)}];
let rows=h.run("selectMonitorCandidates('movie',{id:'movie-1'}, {all_seeds:seeds}, filters).candidates");assert.equal(rows.length,1);assert.equal(rows[0].size,'10GB');
h.ctx.seeds=[{id:3,zname:'Show S01E01',zsize:'10GB',zlink:'magnet:?xt=urn:btih:'+'3'.repeat(40)},{id:4,zname:'Show S01E01',zsize:'30GB',zlink:'magnet:?xt=urn:btih:'+'4'.repeat(40)}];rows=h.run("selectMonitorCandidates('tv',{id:'show-1'}, {all_seeds:seeds}, filters).candidates");assert.equal(rows.length,1);assert.equal(rows[0].size,'30GB');
console.log('PASS separate movie/TV ranges, legacy migration, decimals/unlimited/invalid bounds, shared monitor serialization and actual movie/episode candidate size selection');
