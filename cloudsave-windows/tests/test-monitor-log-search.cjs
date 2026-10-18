const assert=require('node:assert/strict');
const {filterLogs}=require('../monitor-log-search');
const logs=[
 {website:'qmp4',source:'qmp4_monitor',level:'error',time:'2026-10-18T05:00:00Z',message:'分享目标读取失败',details:'第 2 页请求超时'},
 {website:'share115',source:'share115_monitor',level:'warn',message:'等待站点验证',details:{taskId:'task-7'}},
 {source:'guanying_monitor',level:'info',message:'扫描完成',details:'新增 0 条'},
 {source:'cloudsave_monitor',level:'error',message:'目标文件夹无效'}
];
assert.equal(filterLogs(logs).length,4);
assert.equal(filterLogs(logs,{query:' 读取失败 '}).length,1,'Keyword finds an error message');
assert.equal(filterLogs(logs,{query:'TASK-7'}).length,1,'Keyword searches object details case-insensitively');
assert.equal(filterLogs(logs,{query:'第 2 页'}).length,1,'Keyword searches detail text');
assert.equal(filterLogs(logs,{website:'qmp4',level:'error'}).length,1,'Website and severity combine');
assert.equal(filterLogs(logs,{website:'share115',level:'warn'}).length,1);
assert.equal(filterLogs(logs,{website:'guanying'}).length,1,'Legacy source infers its website');
assert.equal(filterLogs(logs,{level:'debug'}).length,0);
assert.equal(filterLogs(logs,{query:'not-found'}).length,0);
assert.deepEqual(filterLogs(null),[]);assert.equal(logs.length,4,'Filtering never mutates the input');
console.log('PASS local log keyword, website and level filters, nested details, legacy source, empty results and immutability');
