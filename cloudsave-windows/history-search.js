(function(root){
 const normalize=value=>typeof value==='string'||typeof value==='number'?String(value).normalize('NFKC').toLocaleLowerCase('zh-CN'):'';
 function tokens(query){return [...new Set(normalize(query).trim().split(/\s+/u).filter(Boolean))];}
 function matches(item,terms){if(!terms.length)return true;const record=item.exportRecord||{},media=record.media||{},text=[item.title,item.movieTitle,item.url,item.folderName,item.message,record.title,record.movieTitle,record.name,media.filename].map(normalize).join('\n');return terms.every(term=>text.includes(term));}
 function uniqueLinks(rows){const links=new Set();for(const row of rows){const url=typeof row.url==='string'?row.url.trim():'';if(/^(?:magnet:\?|ed2k:\/\/|https?:\/\/)/i.test(url)&&!/[\r\n]/.test(url))links.add(url);}return [...links];}
 const api={tokens,matches,uniqueLinks};if(typeof module==='object'&&module.exports)module.exports=api;else root.cloudsaveHistorySearch=api;
})(typeof globalThis==='object'?globalThis:this);
