const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('main.js','utf8');const block=src.slice(src.indexOf('const SITE_MIRRORS'),src.indexOf('function loadCookie()'));
let config={},calls=[],events=[],clock=100000;
class TestDate extends Date{static now(){return clock}}
const ctx={Date:TestDate,URL,Number,String,Boolean,Array,Map,Promise,JSON,SITE:'https://www.0bt0.com',AbortSignal,setTimeout:(fn,ms)=>{clock+=ms;queueMicrotask(fn)},readConfig:()=>config,writeConfig:x=>config=x,loadSiteSession:()=>({token:'',host:'',cookie:''}),session:{fromPartition:()=>({cookies:{get:async()=>[]}})},mainWindow:null,appendMonitorLog:(...a)=>events.push(a),fetch:async url=>{calls.push(url);return {ok:true,status:200,headers:{get:()=>''},text:async()=>JSON.stringify({success:true,code:200,data:{}})}}};
vm.createContext(ctx);vm.runInContext(block,ctx);
(async()=>{
await Promise.all([ctx.cachedResourceRequest('/prod/api/list?a=1',{}),ctx.cachedResourceRequest('/prod/api/list?a=1',{})]);assert.equal(calls.length,1);
await ctx.cachedResourceRequest('/prod/api/list?a=1',{});assert.equal(calls.length,1);
const start=clock;await ctx.cachedResourceRequest('/prod/api/list?a=2',{});assert(clock-start>=1000);
calls=[];ctx.fetch=async url=>{calls.push(url);if(new URL(url).hostname==='www.0bt0.com')throw Object.assign(new Error('fetch failed'),{cause:{code:'ENOTFOUND'}});return {ok:true,status:200,headers:{get:()=>''},text:async()=>JSON.stringify({success:true,code:200})}};
await ctx.requestWithMirrors('/prod/api/x',{});assert.equal(config.mirrors.current,'https://www.1bt0.com');assert.equal(calls.length,3);
assert(events.some(e=>String(e).includes('ENOTFOUND')));
config={mirrors:{current:'https://www.0bt0.com',autoSwitch:false}};calls=[];await assert.rejects(ctx.requestWithMirrors('/prod/api/x',{}));assert(calls.every(url=>new URL(url).hostname==='www.0bt0.com'));
config={};calls=[];ctx.fetch=async url=>{calls.push(url);return {ok:false,status:429,headers:{get:()=> '1'}}};await assert.rejects(ctx.requestWithMirrors('/prod/api/x',{}),e=>e.rateLimited);assert.equal(calls.length,2);assert(calls.every(url=>new URL(url).hostname==='www.0bt0.com'));
calls=[];ctx.fetch=async url=>{calls.push(url);return {ok:false,status:401,headers:{get:()=>''}}};await assert.rejects(ctx.requestWithMirrors('/prod/api/x',{}),e=>e.noMirrorRetry);assert.equal(calls.length,1);
assert.throws(()=>ctx.setMirror('https://example.com'));
console.log('镜像故障切换、手动模式、请求合并缓存、限速、429退避不换域、登录错误与域名校验通过');
})().catch(e=>{console.error(e);process.exit(1)});
