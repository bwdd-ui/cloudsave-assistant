function normalize(value={}){const number=x=>x==null||x===''?0:Number(x);const minGB=number(value.minGB??1),maxGB=number(value.maxGB);if(!Number.isFinite(minGB)||!Number.isFinite(maxGB)||minGB<0||maxGB<0||maxGB&&minGB>=maxGB)throw Error('单集范围无效：最大值须大于最小值，留空表示不限');return {enabled:Boolean(value.enabled),minGB,maxGB};}
function check(policy,{files,coverage,sizeGB}){policy=normalize(policy);if(!policy.enabled||!policy.minGB&&!policy.maxGB)return;let sizes;
 if(files?.hasFileList){if(!files.keys?.length||files.unresolved?.length||files.missingKeys?.length)throw Error('无法确认完整逐集文件大小，未提交115；请补齐文件清单');sizes=files.files?.length?files.files.map(x=>Number(x.sizeGB)):files.keys.map(key=>Number(files.sizes?.[key]));}
 else if(coverage&&!coverage.opaque&&coverage.keys.length===1)sizes=[Number(sizeGB)];
 else throw Error('合集缺少完整文件清单，未提交115；不会按平均大小放行');
 if(sizes.some(x=>!Number.isFinite(x)||x<=0))throw Error('单集大小未确认，未提交115');
 if(sizes.some(x=>policy.minGB&&x<=policy.minGB||policy.maxGB&&x>policy.maxGB))throw Error('单集大小不符合范围（须大于'+policy.minGB+'GB'+(policy.maxGB?'，且不超过'+policy.maxGB+'GB':'')+'），整条资源未提交115');
}
module.exports={normalize,check};
