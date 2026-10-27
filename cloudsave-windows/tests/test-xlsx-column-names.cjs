const assert=require('node:assert/strict'),zlib=require('node:zlib'),{columnName,buildTableXlsx}=require('../scan-export');
function entries(buffer){const files=new Map();let p=0;while(buffer.readUInt32LE(p)===0x04034b50){const length=buffer.readUInt32LE(p+18),nameLength=buffer.readUInt16LE(p+26),extra=buffer.readUInt16LE(p+28),start=p+30+nameLength+extra;files.set(buffer.subarray(p+30,p+30+nameLength).toString(),zlib.inflateRawSync(buffer.subarray(start,start+length)).toString());p=start+length;}return files;}
assert.equal(columnName(0),'A');assert.equal(columnName(25),'Z');assert.equal(columnName(26),'AA');assert.equal(columnName(27),'AB');assert.equal(columnName(51),'AZ');assert.equal(columnName(52),'BA');assert.equal(columnName(701),'ZZ');assert.equal(columnName(702),'AAA');
const wide=Array.from({length:30},(_,index)=>`第${index+1}列`);
const sheet=entries(buildTableXlsx(wide,[wide.map(()=>'值')],wide.map(()=>10),'宽表')).get('xl/worksheets/sheet1.xml');
assert(sheet.includes('ref="A1:AD2"'),'the dimension must name the real last column');
assert(sheet.includes('r="AA1"')&&sheet.includes('r="AD1"'),'headers past column Z keep valid references');
assert(sheet.includes('r="AA2"')&&sheet.includes('r="AD2"'));
assert.deepEqual([...new Set([...sheet.matchAll(/<c r="([A-Z]+)\d+"/g)].map(match=>match[1]))],wide.map((_,index)=>columnName(index)));
const twelve=entries(buildTableXlsx(['名称'],[['磁力链接']], [30],'窄表')).get('xl/worksheets/sheet1.xml');
assert(twelve.includes('ref="A1:A2"')&&twelve.includes('r="A1"'));
console.log('PASS XLSX column references stay valid beyond Z instead of running off into punctuation');
