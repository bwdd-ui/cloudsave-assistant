const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{readSnapshot,writeSnapshot,EMPTY}=require('../snapshot-store');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloudsave-snapshot-')),file=path.join(root,'guanying-export.json'),dir=path.join(root,'blocked');
try{
 const problems=[];const warn=message=>problems.push(message);
 assert.deepEqual(readSnapshot(fs,file,warn),EMPTY,'a missing snapshot reads as the empty snapshot');
 assert.equal(problems.length,0,'a missing snapshot is the normal first run, not a warning');
 writeSnapshot(fs,file,{signature:'s1',rows:[{url:'magnet:?xt=urn:btih:'+'a'.repeat(40)}],complete:true});
 assert.deepEqual(readSnapshot(fs,file,warn),{signature:'s1',rows:[{url:'magnet:?xt=urn:btih:'+'a'.repeat(40)}],complete:true});
 assert(!fs.existsSync(file+'.tmp'),'the temp file is renamed away, never left beside the snapshot');
 fs.writeFileSync(file,'{"signature":"s2","rows":[{"url"');
 assert.deepEqual(readSnapshot(fs,file,warn),EMPTY,'a torn snapshot degrades to empty instead of throwing');
 assert.equal(problems.length,1);assert.match(problems[0],/无法解析/);
 writeSnapshot(fs,file,{signature:'s3',rows:[],complete:false});
 assert.deepEqual(readSnapshot(fs,file),{signature:'s3',rows:[],complete:false},'the next monitor run replaces the damaged snapshot');
 fs.mkdirSync(dir);
 const blocked=[];assert.deepEqual(readSnapshot(fs,dir,m=>blocked.push(m)),EMPTY,'an unreadable snapshot also degrades to empty');
 assert.equal(blocked.length,1);assert.match(blocked[0],/快照读取失败/);
 const main=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
 for(const name of ['GUANYING_EXPORT_FILE','BTBTLA_EXPORT_FILE','QMP4_EXPORT_FILE','JYING_EXPORT_FILE']){
   assert(!new RegExp('JSON\\.parse\\(fs\\.readFileSync\\('+name).test(main),name+' must read through snapshot-store');
   assert(!new RegExp('fs\\.writeFileSync\\('+name+',JSON\\.stringify').test(main),name+' must write through snapshot-store');}
 console.log('PASS snapshot store returns empty for missing/torn/unreadable files, warns only for the damaged cases, writes atomically and all four monitors route through it');
}finally{fs.rmSync(root,{recursive:true,force:true});}
