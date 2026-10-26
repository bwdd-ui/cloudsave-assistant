const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
const block=source.slice(source.indexOf('function readConfig()'),source.indexOf('const SITE_MIRRORS'));
const target=path.join(path.sep,'mock','Data','config.json');
function harness(files){
  const store=new Map(Object.entries(files)),calls=[];
  const context={jsonStore:null,CONFIG_FILE:()=>target,path:{dirname:name=>name.slice(0,name.lastIndexOf(path.sep))},
    fs:{readFileSync(name){calls.push(['read',name]);if(!store.has(name))throw Object.assign(new Error('missing'),{code:'ENOENT'});return store.get(name);},
      mkdirSync(name){calls.push(['mkdir',name]);},
      writeFileSync(name,data){calls.push(['write',name,data]);store.set(name,data);}},
    JSON,Object,Array,String,Number,Error,Boolean};
  vm.runInNewContext(`${block}\nthis.readConfig=readConfig;this.writeConfig=writeConfig;`,context);
  return {store,calls,readConfig:context.readConfig,writeConfig:context.writeConfig};
}
const valid=harness({[target]:JSON.stringify({folder:{cid:'7'}})});
assert.deepEqual(valid.readConfig(),{folder:{cid:'7'}});
assert.equal(JSON.stringify(harness({}).readConfig()),'{}','a first run has no config file yet');
const damaged=harness({[target]:'{"folder":'});
assert.throws(()=>damaged.readConfig(),/配置文件无法读取，已保留原文件/,'a damaged file must never look like an empty profile');
assert.equal(damaged.store.get(target),'{"folder":','the damaged bytes stay on disk for recovery');
assert.equal(damaged.calls.some(call=>call[0]==='write'),false,'reading alone must not replace the file');
const damagedAfterWrite=harness({[target]:'{"folder":'});
assert.throws(()=>damagedAfterWrite.readConfig(),/配置文件无法读取/);
damagedAfterWrite.store.set(target,JSON.stringify({folder:{cid:'1'}}));
assert.deepEqual(damagedAfterWrite.readConfig(),{folder:{cid:'1'}},'a repaired file is read again normally');
const written=harness({});
written.writeConfig({folder:{cid:'9'}});
assert.deepEqual(written.calls.map(call=>call[0]),['mkdir','write']);
assert.deepEqual(JSON.parse(written.store.get(target)),{folder:{cid:'9'}});
console.log('PASS a damaged config file raises with the original bytes preserved instead of being mistaken for an empty profile on every later write');
