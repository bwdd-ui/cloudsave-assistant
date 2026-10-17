(function(root){
 const normalize=value=>typeof value==='string'||typeof value==='number'?String(value).normalize('NFKC').toLocaleLowerCase('zh-CN'):'';
 function tokens(query){return [...new Set(normalize(query).trim().split(/\s+/u).filter(Boolean))];}
 function matches(item,terms){if(!terms.length)return true;const record=item.exportRecord||{},media=record.media||{},text=[item.title,item.movieTitle,item.url,item.folderName,item.message,record.title,record.movieTitle,record.name,media.filename].map(normalize).join('\n');return terms.every(term=>text.includes(term));}
 function dayStart(value){if(!value)return null;const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return NaN;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(year,month-1,day);return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?date.getTime():NaN;}
 function dayAfter(value){const date=new Date(dayStart(value));date.setDate(date.getDate()+1);return date.getTime();}
 function validDateRange(from,to){if(!from&&!to)return true;const start=dayStart(from),end=dayStart(to);return !Number.isNaN(start)&&!Number.isNaN(end)&&!(from&&to&&start>end);}
 function matchesDateRange(item,from,to){if(!from&&!to)return true;if(!validDateRange(from,to))return false;const time=Date.parse(item?.time||'');if(!Number.isFinite(time))return false;const start=from?dayStart(from):-Infinity,end=to?dayAfter(to):Infinity;return time>=start&&time<end;}
 function uniqueLinks(rows){const links=new Set();for(const row of rows){const url=typeof row.url==='string'?row.url.trim():'';if(/^(?:magnet:\?|ed2k:\/\/|https?:\/\/)/i.test(url)&&!/[\r\n]/.test(url))links.add(url);}return [...links];}
 const api={tokens,matches,dayStart,validDateRange,matchesDateRange,uniqueLinks};if(typeof module==='object'&&module.exports)module.exports=api;else root.cloudsaveHistorySearch=api;
})(typeof globalThis==='object'?globalThis:this);
