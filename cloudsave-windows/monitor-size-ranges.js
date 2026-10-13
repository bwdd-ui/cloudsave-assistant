function bound(value){if(value===''||value==null)return 0;const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error('资源大小请输入非负数字，留空表示不限');return n;}
function normalizeSizeRanges(filters={}){
 const legacy={minSizeGB:filters.minSizeGB??0,maxSizeGB:filters.maxSizeGB??0},result={};
 for(const [mode,label] of [['movie','电影'],['tv','电视剧']]){
  const input=filters.sizeRanges?.[mode]||legacy;
  const minSizeGB=bound(input.minSizeGB),maxSizeGB=bound(input.maxSizeGB);
  if(maxSizeGB&&minSizeGB>maxSizeGB)throw Error(label+'大小范围无效：最大值不能小于最小值');
  result[mode]={minSizeGB,maxSizeGB};
 }
 return result;
}
function sizeFilters(filters,mode){const sizeRanges=normalizeSizeRanges(filters);return {...filters,sizeRanges,...sizeRanges[mode==='tv'?'tv':'movie']};}
function saveModes(value){const modes=Array.isArray(value)?[...new Set(value.filter(x=>['movie','tv'].includes(x)))]:['movie','tv'];if(!modes.length)throw Error('请至少选择电影或电视剧');return modes;}
function modeAllowed(filters,mode){return saveModes(filters.saveModes).includes(mode);}
function episodeMinimumAllowed(seed,coverage,min,sizeInGb){if(!(Number(min)>0))return true;const files=seed.raw?._episodeFiles||seed.episodeFiles;
 if(files?.hasFileList){if(files.unresolved?.length||files.missingKeys?.length||!files.keys?.length)return false;if(!files.keys.every(key=>Number(files.sizes?.[key])>min))return false;if(files.files?.some(file=>!(Number(file.sizeGB)>min)))return false;return true;}
 if(coverage.opaque||coverage.keys.length!==1)return false;return sizeInGb(seed.size)>min;
}
module.exports={normalizeSizeRanges,sizeFilters,saveModes,modeAllowed,episodeMinimumAllowed};
