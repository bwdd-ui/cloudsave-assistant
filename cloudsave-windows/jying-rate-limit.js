function limited(response,json){return response.status===429||json?.code==='rate_limited'||/高频访问|冷静期|请求过于频繁|频率限制/.test(String(json?.message||''));}
function until(response,json,now,strikes=0){
 const deadline=value=>{const delay=typeof value==='number'||typeof value==='string'&&value.trim()!==''?Number(value):NaN;if(!Number.isFinite(delay)||delay<=0)return 0;const end=now+Math.ceil(delay)*1000;return Number.isFinite(end)&&end<=8640000000000000?end:0;};
 const header=response.headers?.get?.('retry-after'),headerDeadline=deadline(header);if(headerDeadline)return headerDeadline;
 const time=typeof header==='string'?Date.parse(header):NaN;if(time>now)return time;
 const jsonDeadline=deadline(json?.retry_after||json?.retryAfter);if(jsonDeadline)return jsonDeadline;
 return now+Math.min(3600000,900000*2**Math.min(strikes,2));
}
function error(state){return Object.assign(Error('聚影访问进入冷静期，已暂停请求至 '+new Date(state.until).toLocaleString('zh-CN')+'；届时监控自动重试并继续断点'),{rateLimited:true,retryAt:state.until,retryAfter:Math.max(1,Math.ceil((state.until-Date.now())/1000))});}
module.exports={limited,until,error};
