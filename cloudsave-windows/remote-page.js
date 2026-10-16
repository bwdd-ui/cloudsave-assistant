const installed=new WeakSet();
function configureRemotePageSession(partition,{host='haisou.cc',nodeFetch=fetch,preferNative=false}={}){
 if(installed.has(partition))return;installed.add(partition);
 partition.protocol.handle('https',async request=>{
  const hostname=new URL(request.url).hostname;
  if(hostname!==host&&!hostname.endsWith('.'+host))return partition.fetch(request,{bypassCustomProtocolHandlers:true});
  if(preferNative){try{return await partition.fetch(request.clone(),{bypassCustomProtocolHandlers:true,signal:AbortSignal.timeout(12000)});}catch(error){
   if(/CERT|SSL|certificate/i.test(error.message) || !/ERR_FAILED|ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT|Failed to fetch|fetch failed|aborted|TimeoutError/i.test(error.message+' '+error.name))throw error;
  }}
  const headers=new Headers(request.headers);if(!headers.has('cookie')&&partition.cookies){const cookies=await partition.cookies.get({url:request.url});if(cookies.length)headers.set('cookie',cookies.map(x=>x.name+'='+x.value).join('; '));}for(const key of ['host','content-length','connection','accept-encoding'])headers.delete(key);
  const body=['GET','HEAD'].includes(request.method)?undefined:Buffer.from(await request.arrayBuffer());
  const response=await nodeFetch(request.url,{method:request.method,headers,...(body?{body}:{}),...(preferNative?{redirect:'manual'}:{}),signal:AbortSignal.timeout(preferNative?12000:25000)});
  await saveResponseCookies(partition,response,new URL(request.url));const outputHeaders=new Headers(response.headers);for(const key of ['content-encoding','content-length','transfer-encoding'])outputHeaders.delete(key);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:outputHeaders});
 });
}
async function saveResponseCookies(partition,response,url){
 if(!partition.cookies)return;
 for(const line of response.headers.getSetCookie?.() || []){try{const parts=line.split(';').map(x=>x.trim()),pair=parts.shift(),equal=pair.indexOf('=');if(equal<1)continue;const attributes=Object.fromEntries(parts.map(x=>{const index=x.indexOf('=');return index<0?[x.toLowerCase(),true]:[x.slice(0,index).toLowerCase(),x.slice(index+1)];})),domain=String(attributes.domain || url.hostname).replace(/^\./,'').toLowerCase();if(url.hostname!==domain&&!url.hostname.endsWith('.'+domain))continue;const expirationDate=attributes['max-age']!==undefined?Date.now()/1000+Number(attributes['max-age']):attributes.expires?Date.parse(attributes.expires)/1000:undefined;// Expire the exact cookie identity through set(), including its original path.
  await partition.cookies.set({url:url.origin,name:pair.slice(0,equal),value:pair.slice(equal+1),path:String(attributes.path||'').startsWith('/')?attributes.path:url.pathname.slice(0,url.pathname.lastIndexOf('/')) || '/',secure:Boolean(attributes.secure),httpOnly:Boolean(attributes.httponly),...(attributes.domain?{domain:attributes.domain}:{}),...(Number.isFinite(expirationDate)?{expirationDate}:{}),...(['lax','strict','none'].includes(String(attributes.samesite || '').toLowerCase())?{sameSite:attributes.samesite.toLowerCase()==='none'?'no_restriction':attributes.samesite.toLowerCase()}:{})});}catch(_){}
 }
}
module.exports={configureRemotePageSession,saveResponseCookies};
