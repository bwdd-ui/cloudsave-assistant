const {spawnSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');process.chdir(root);
// A test whose dependency cannot be resolved is reported as skipped; a hardcoded list would let a new
// test file sit here forever without ever being executed.
const canResolve=(spec,from)=>{try{require.resolve(spec.startsWith('.')?path.resolve(from,spec):spec,{paths:[root,from]});return true}catch{return false}};
const tests=fs.readdirSync('tests').filter(name=>/^test-.+\.cjs$/.test(name)).sort();
let failed=0,passed=0;const skipped=[];
for(const test of tests){console.log('\n--- '+test+' ---');const r=spawnSync(process.execPath,[path.join('tests',test)],{encoding:'utf8',timeout:120000});if(r.stdout)process.stdout.write(r.stdout);const missing=r.status!==0&&r.status!==null?((r.stderr||'').match(/Error: Cannot find module '([^']+)'/)||[])[1]:undefined;
  if(missing&&!canResolve(missing,'tests')){skipped.push([test,missing]);console.log('SKIP '+test+': '+missing+' 不可用');continue}
  if(r.stderr)process.stderr.write(r.stderr);
  if(r.error||r.status!==0){failed++;console.error(r.error||'exit '+r.status);continue}passed++;}
console.log('\n'+passed+'/'+(tests.length-skipped.length)+' test files passed'+(skipped.length?', '+skipped.length+' skipped ('+skipped.map(([,d])=>d).join(', ')+')':', none skipped'));
process.exitCode=failed?1:0;
