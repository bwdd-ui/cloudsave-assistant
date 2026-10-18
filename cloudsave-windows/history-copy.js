(function(root){
 const sourceLabels={cloud:'115云下载',auto5:'自动监控七味',auto4:'自动监控聚影',auto3:'自动监控BT影视',auto2:'自动监控观影',auto:'自动监控不太灵磁力链接',manual:'手动提交',batch:'批量离线',legacy:'历史记录'};
 const statusLabels={success:'已确认保存到目录',pending:'已加入离线任务，等待完成',duplicate:'已提交自动跳过',uncertain:'提交待确认',placement_failed:'保存目录异常',legacy_accepted:'历史已接受',unverified:'下载完成，位置未核实',failed:'失败'};
 function cleanCell(value){
  let text=String(value??'').replace(/[\r\n\t]+/g,' ').trim();
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text))text="'"+text;
  return text;
 }
 function sourceLabel(item){
  if(item.source==='auto'&&(item.website==='qmp4'||String(item.movieId||'').startsWith('qm5:')))return sourceLabels.auto5;
  if(item.source==='auto'&&(item.website==='jying'||String(item.movieId||'').startsWith('jy4:')))return sourceLabels.auto4;
  if(item.source==='auto'&&(item.website==='btbtla'||String(item.movieId||'').startsWith('bt3:')))return sourceLabels.auto3;
  if(item.source==='auto'&&(item.website==='guanying'||String(item.movieId||'').startsWith('gy:')))return sourceLabels.auto2;
  return sourceLabels[item.source]||sourceLabels.legacy;
 }
 function rowsToTsv(rows){
  if(!Array.isArray(rows))throw new Error('Invalid history copy request');
  const heading=['时间','来源','状态','资源标题','保存目录','磁力链接','反馈'];
  const body=rows.map(item=>{
   const cloudStatus=item._cloudOnly?({completed:'已完成',downloading:'正在下载',failed:'下载失败'}[item.cloudState]||'状态未知'):'';
   return [item.time,sourceLabel(item),cloudStatus||statusLabels[item.status]||item.status,item.title,item.folderName,item.url,item.message].map(cleanCell).join('\t');
  });
  return [heading.join('\t'),...body].join('\n');
 }
 const api={rowsToTsv};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.cloudsaveHistoryCopy=api;
})(typeof globalThis==='object'?globalThis:this);
