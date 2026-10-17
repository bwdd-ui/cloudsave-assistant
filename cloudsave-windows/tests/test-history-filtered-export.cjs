const assert=require('node:assert/strict'),{filterRows}=require('../history-export');
const rows=[{uid:'a',key:'1',title:'match'},{uid:'b',key:'2',title:'ignore'},{uid:'a',key:'3',title:'match too'}],key=row=>`${row.uid}|${row.key}`;
assert.deepEqual(filterRows(rows,['a|3','a|1','a|3'],key).map(row=>row.title),['match','match too']);
assert.deepEqual(filterRows(rows,[],key),[]);
for(const args of [[rows,null,key],[rows,Array(50001).fill('a|1'),key],[rows,['x'.repeat(4097)],key],[rows,['a|1'],null]])assert.throws(()=>filterRows(...args));
assert.deepEqual(rows.map(row=>row.key),['1','2','3']);
console.log('PASS filtered history export selects only allowlisted local records, deduplicates request keys, handles empty selection, bounds IPC input, and preserves history rows');
