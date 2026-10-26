const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const pkg=require('../package.json');
const listed=pkg.build.files.filter(name=>!name.includes('*'));
const set=new Set(listed);
for(const name of listed)assert(fs.existsSync(path.join(root,name)),`${name} 在 build.files 里但不存在于仓库`);
const localRequires=(file)=>[...fs.readFileSync(path.join(root,file),'utf8').matchAll(/require\((['"])\.\/([^'"/]+)\1\)/g)]
  .map(match=>/\./.test(match[2])?match[2]:`${match[2]}.js`);
const seen=new Set(),queue=['main.js'];
while(queue.length){
  const file=queue.shift();
  if(seen.has(file))continue;
  seen.add(file);
  assert(set.has(file),`${file} 由 main.js 的依赖链引入，却没有写进 build.files，打包后会缺失`);
  if(!file.endsWith('.js')||!fs.existsSync(path.join(root,file)))continue;
  for(const target of localRequires(file)){
    assert(fs.existsSync(path.join(root,target)),`${file} 依赖 ${target}，但文件不存在`);
    queue.push(target);
  }
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const match of html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)){
  const file=match[1].replace(/^\.\//,'');
  assert(fs.existsSync(path.join(root,file)),`index.html 加载 ${file}，但文件不存在`);
  assert(set.has(file),`index.html 加载 ${file}，却没有写进 build.files`);
}
assert(set.has('ipc-guard.js')&&set.has('quit-wait.js'),'新增的安全模块必须随包发布');
assert(seen.has('ipc-guard.js')&&seen.has('quit-wait.js'));
console.log(`PASS the ${seen.size} modules reachable from main.js and the ${[...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].length} scripts of index.html are all present and listed in build.files`);
