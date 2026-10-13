const fs=require('fs'),vm=require('vm'),assert=require('assert');const src=fs.readFileSync('main.js','utf8');const helpers=src.slice(src.indexOf('function defaultSaveFolder()'),src.indexOf('function updateSubmissionPlacement'));
const ctx={Date,Math,URLSearchParams,Number,String,Array,Object,magnetKey:url=>url.toLowerCase()};vm.createContext(ctx);vm.runInContext(helpers,ctx);
assert.equal(ctx.offlineHash('magnet:?xt=urn:btih:'+'A'.repeat(32)),'0'.repeat(40));
assert.equal(ctx.matchingOfflineTask({tasks:[{info_hash:'b'.repeat(40),url:'magnet:?xt=urn:btih:'+'a'.repeat(40),file_id:'999'}]},'magnet:?xt=urn:btih:'+'a'.repeat(40)),null);
const identity=src.slice(src.indexOf('function offlineFileIdentity('),src.indexOf('async function reconcileOfflinePlacement('));vm.runInContext(identity,ctx);assert.equal(ctx.offlineFileIdentity({cid:'888',pid:'42'}).id,'888');assert.equal(ctx.offlineFileIdentity({fid:'777',cid:'42'}).parent,'42');assert.equal(ctx.offlineFileIdentity({cid:'888'}),null);
console.log('Base32磁力、错误任务哈希拒绝、目录与文件字段区分验证通过');
