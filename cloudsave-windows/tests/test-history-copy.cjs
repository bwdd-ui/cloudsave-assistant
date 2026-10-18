const assert=require('node:assert/strict');
const {rowsToTsv}=require('../history-copy');
const rows=[
 {time:'2026-10-17 12:00',source:'auto',website:'qmp4',status:'uncertain',title:'=1+1',folderName:'目标\n目录',url:'magnet:?xt=urn:btih:abc',message:'需要\r\n确认'},
 {time:'2026-10-16',source:'manual',status:'success',title:'第二部',folderName:'电影',url:'magnet:second',message:'已提交'},
 {_cloudOnly:true,source:'cloud',cloudState:'downloading',title:'网盘任务',url:'magnet:remote'}
];
const tsv=rowsToTsv(rows),lines=tsv.split('\n');
assert.equal(lines.length,4);
assert.equal(lines[0],'时间\t来源\t状态\t资源标题\t保存目录\t磁力链接\t反馈');
assert.match(lines[1],/自动监控七味\t提交待确认\t'=1\+1\t目标 目录\tmagnet:\?xt=urn:btih:abc\t需要 确认/);
assert.match(lines[2],/手动提交\t已确认保存到目录\t第二部/);
assert.match(lines[3],/115云下载\t正在下载\t网盘任务/);
assert.throws(()=>rowsToTsv(null));
console.log('PASS filtered history clipboard table keeps source/status labels, sanitizes TSV cells, protects spreadsheet formulas, and includes remote-only rows with explicit origin');
