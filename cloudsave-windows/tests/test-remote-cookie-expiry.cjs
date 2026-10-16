const assert=require('node:assert/strict'),{saveResponseCookies}=require('../remote-page');
(async()=>{const saved=[],partition={cookies:{set:async v=>saved.push(v),remove:async()=>{throw Error('Root URL removal cannot preserve cookie identity');}}},url=new URL('https://site.invalid/user/logout');
 for(const cookie of ['ticket=; Path=/user; Max-Age=0; Secure; HttpOnly','ticket=; Max-Age=-1','ticket=; Path=/user; Expires=Thu, 01 Jan 1970 00:00:00 GMT','ticket=; Path=/; Max-Age=0'])await saveResponseCookies(partition,new Response('',{headers:{'set-cookie':cookie}}),url);
 assert.equal(saved.length,4);assert.deepEqual(saved.map(v=>v.path),['/user','/user','/user','/']);assert(saved.every(v=>Number.isFinite(v.expirationDate)&&v.expirationDate<=Date.now()/1000));assert(saved[0].secure&&saved[0].httpOnly);assert(saved.every(v=>v.name==='ticket'&&v.url===url.origin));
 await saveResponseCookies(partition,new Response('',{headers:{'set-cookie':'ticket=new; Path=relative; Max-Age=3600; SameSite=Lax'}}),url);assert.equal(saved.at(-1).path,'/user');assert.equal(saved.at(-1).value,'new');assert.equal(saved.at(-1).sameSite,'lax');assert(saved.at(-1).expirationDate>Date.now()/1000);
 await saveResponseCookies(partition,new Response('',{headers:{'set-cookie':'ticket=bad; Domain=other.invalid; Max-Age=0'}}),url);assert.equal(saved.length,5,'Foreign cookie domains remain rejected');
 console.log('PASS expired cookies retain exact path and flags; default/invalid paths, renewal and foreign-domain isolation preserved');
})().catch(error=>{console.error(error);process.exitCode=1;});
