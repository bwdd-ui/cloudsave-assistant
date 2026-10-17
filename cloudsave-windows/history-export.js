(function(root){
 function filterRows(rows,keys,keyForRow){
  if(!Array.isArray(rows)||!Array.isArray(keys)||keys.length>50000||keys.some(key=>typeof key!=='string'||key.length>4096)||typeof keyForRow!=='function')throw new Error('Invalid filtered history export request');
  const wanted=new Set(keys);
  return rows.filter(row=>wanted.has(keyForRow(row)));
 }
 const api={filterRows};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.cloudsaveHistoryExport=api;
})(typeof globalThis==='object'?globalThis:this);
