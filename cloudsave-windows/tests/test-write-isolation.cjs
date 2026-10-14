const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BufferedJson}=require('../buffered-json');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloudsave-partial-write-')),store=new BufferedJson(60000);
 try{
  const blocked=path.join(root,'blocked');fs.writeFileSync(blocked,'not a directory');
  const exportFile=path.join(blocked,'export.xlsx'),config=path.join(root,'config.json');
  store.set(exportFile,{__xlsxExport:true,rows:[]});store.set(config,{saved:1});
  await assert.rejects(store.flush());
  assert.equal(JSON.parse(fs.readFileSync(config)).saved,1,'An export failure must not prevent settings from saving');
  assert(!store.dirty(config));assert(store.dirty(exportFile));assert.equal(store.pending.size,1);
  fs.unlinkSync(blocked);fs.mkdirSync(blocked);await store.flush();assert.equal(fs.readFileSync(exportFile).subarray(0,2).toString(),'PK');
  const badExportRoot=path.join(root,'bad-export');fs.writeFileSync(badExportRoot,'blocked');
  const badExport=path.join(badExportRoot,'report.xlsx');
  await assert.rejects(store.xlsx(badExport,[]));assert(!store.dirty(badExport),'Failed exports should not retry silently');
  await store.xlsx(path.join(root,'retry-elsewhere.xlsx'),[]);assert.equal(fs.readFileSync(path.join(root,'retry-elsewhere.xlsx')).subarray(0,2).toString(),'PK');
  const archiveRoot=path.join(root,'resource-archive');fs.writeFileSync(archiveRoot,'blocked archive');
  const archive=path.join(archiveRoot,'entry.json'),database=path.join(root,'offline-resources.json');
  fs.writeFileSync(database,JSON.stringify({version:'old',resources:{entry:{status:'success'}}}));
  store.set(database,{version:'new',resources:{},archivedResourceIndex:{entry:{status:'success'}}});
  store.set(archive,{identity:'entry',resource:{status:'success'}});store.set(config,{saved:2});
  await assert.rejects(store.flush());
  assert.equal(JSON.parse(fs.readFileSync(database)).version,'old','Never persist an index ahead of a failed archive file');
  assert.equal(JSON.parse(fs.readFileSync(config)).saved,2);assert(!store.dirty(config));assert(store.dirty(database));assert(store.dirty(archive));
  fs.unlinkSync(archiveRoot);fs.mkdirSync(archiveRoot);await store.flush();
  assert.equal(JSON.parse(fs.readFileSync(database)).version,'new');assert.equal(JSON.parse(fs.readFileSync(archive)).identity,'entry');
  const nullable=path.join(root,'nullable.json');store.set(nullable,{old:true});store.send();store.set(nullable,null);
  assert.equal(store.peek(nullable),null,'Pending null must override an older in-flight value');await store.flush();assert.equal(JSON.parse(fs.readFileSync(nullable)),null);
  await store.close();console.log('PASS export failures isolate settings writes, archive-index dependency preserved, failed targets retry, pending null wins');
 }finally{if(!store.closed){if(store.timer)clearTimeout(store.timer);store.closed=true;await store.worker?.terminate();}fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
