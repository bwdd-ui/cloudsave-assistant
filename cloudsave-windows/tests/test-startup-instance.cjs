const assert=require('node:assert/strict');const {acquireInstance}=require('../startup-instance');
let notices=0, data;const dialog={showErrorBox:(title,message)=>{notices++;assert(title.includes('已经在运行'));assert(message.includes('1.2.12'));assert(message.includes('退出程序'));assert(message.includes('未启动'));}};
assert.equal(acquireInstance({isPackaged:true,requestSingleInstanceLock:v=>{data=v;return false;}},dialog,'1.2.12'),false);assert.equal(notices,1);assert.deepEqual(data,{version:'1.2.12'});
assert.equal(acquireInstance({isPackaged:true,requestSingleInstanceLock:()=>true},dialog,'1.2.12'),true);assert.equal(notices,1);
assert.equal(acquireInstance({isPackaged:false,requestSingleInstanceLock:()=>false},dialog,'1.2.12'),false);assert.equal(notices,1);
assert.equal(acquireInstance({},dialog,'1.2.12'),true);
const fs=require('fs'),source=fs.readFileSync('main.js','utf8');assert(source.indexOf('acquireInstance(app')>source.indexOf('createPortableStorage(app'));assert(source.indexOf('acquireInstance(app')<source.indexOf("new (require('./buffered-json')"));assert(source.includes('if (!ownsApplicationLock) app.exit(0)'));console.log('Instance rejection and initialization ordering passed');

const vm=require('vm');let exited=false,storeLoaded=false;const stop=Error('exit');
assert.throws(()=>vm.runInNewContext(source.slice(0,source.indexOf('const jsonStore')+150),{require:name=>{if(name==='electron')return {app:{isPackaged:false,requestSingleInstanceLock:()=>false,exit:()=>{exited=true;throw stop;}},dialog};if(name==='./startup-instance')return {acquireInstance};if(name==='./package.json')return {version:'1.2.12'};if(name==='./buffered-json')storeLoaded=true;return require(name);},process:{env:{}}}),error=>error===stop);assert(exited);assert.equal(storeLoaded,false);console.log('Rejected process exits before worker/store creation');
