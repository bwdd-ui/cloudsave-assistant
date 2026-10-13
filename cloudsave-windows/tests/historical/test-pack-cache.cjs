const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const prefix=fs.readFileSync('C:/Temp/test-cloudsave-resource-database.cjs','utf8').split('const magnet =')[0];
const ctx=vm.createContext({require,console,Buffer,process,URL,URLSearchParams});vm.runInContext(prefix+';globalThis.harness=harness;',ctx);const harness=ctx.harness;
const magnet=n=>'magnet:?xt=urn:btih:'+n.toString(16).padStart(40,'0');
const seed=(n,size,title)=>({id:n,zname:title,zlink:magnet(n),zsize:size,ezt:'2026-10-05'});
(async()=>{
 const h=harness();h.run("bindMonitorAccount('123')");
 for(const [title,keys] of [['征途[第19-20集]',['S1E19','S1E20']],['Drama.S02E03-S02E05',['S2E3','S2E4','S2E5']],['第19、21集',['S1E19','S1E21']]]){h.ctx.title=title;assert.deepEqual(Array.from(h.run('episodeCoverage(title).keys')),keys);}
 assert.equal(h.run("episodeCoverage('S01E19-S02E20')"),null);
 h.ctx.raw={title:'征途',all_seeds:[seed(1,'9.25GB','征途[第19-20集]'),seed(2,'4.48GB','征途[第19-20集]'),seed(3,'9.29GB','征途[第17-18集]')]};
 let rows=h.run("selectMonitorCandidates('tv',{id:'10',title:'征途'},raw,monitorConfig().filters).candidates");assert.equal(rows.length,2);assert(!rows.some(r=>r.url===magnet(2)));
 h.ctx.saved=rows.find(r=>r.url===magnet(1));h.run("recordSubmitHistory(saved.url,'pending','accepted','88',{...saved,uid:'123',source:'auto'})");
 h.run('resourceDatabaseCache=undefined');rows=h.run("selectMonitorCandidates('tv',{id:'10',title:'征途'},raw,monitorConfig().filters).candidates");assert.equal(rows.length,1);assert.equal(rows[0].url,magnet(3));
 h.ctx.raw={all_seeds:[seed(4,'10GB','征途[第19-20集]')]};rows=h.run("selectMonitorCandidates('tv',{id:'10'},raw,monitorConfig().filters).candidates");assert.equal(rows.length,1);assert.equal(rows[0].episodeSizeGB,5);
 h.ctx.raw={all_seeds:[seed(5,'4GB','征途[第20-21集]')]};rows=h.run("selectMonitorCandidates('tv',{id:'10'},raw,monitorConfig().filters).candidates");assert.equal(rows.length,1);assert.equal(rows[0].coverageReason,'补齐 1 集');
 const m=harness();m.run("bindMonitorAccount('123')");m.ctx.url=magnet(100);m.ctx.info={title:'Film',release:'2025-09-01',class:'剧情',country:'中国大陆'};m.ctx.rawSeed=seed(100,'3GB','Film.2160p');
 m.run("recordSubmitHistory(url,'pending','accepted','88',{uid:'123',source:'manual',movieId:'9',title:'Film',size:'3GB',raw:rawSeed,movieInfo:info})");
 let calls=0;m.ctx.fetchMovieDetail=async()=>{throw Error('film must come from local metadata')};m.ctx.apiRequest=async()=>{calls++;return {success:true,code:200,data:{zlink:magnet(100),mediaInfo:{filename:'Film.mkv',duration:'2 h',resolution:'3840 x 2160',frameRate:'24 fps',video:'HEVC',audio:'AAC'},zfiles:['Film.mkv']}}};
 let result=await m.run("hydrateHistoryResource('123',magnetKey(url))");assert(!result.missing);assert.equal(result.row.releaseDate,'2025-09-01');assert.equal(calls,1);
 m.run('resourceDatabaseCache=undefined');result=await m.run("hydrateHistoryResource('123',magnetKey(url))");assert(!result.missing);assert.equal(calls,1,'successful metadata reused after reload');
 m.run("recordSubmitHistory(url,'duplicate','曾经添加过','88',{uid:'123',title:'Film'})");assert.equal(m.run("resourceDatabase().resources['123|'+magnetKey(url)].exportRecord.media.duration"),'2 h','duplicate cannot erase full cached media');
 const record=m.run("resourceDatabase().resources['123|'+magnetKey(url)]");assert(record.seedInfo&&record.movieInfo&&record.torrentInfo.zfiles);
 m.run("resourceDatabase().history[0].message='保存到目录（CID 88） UID 123'");const publicRows=await m.handlers['submit-history']({});assert(!/CID|UID/.test(publicRows[0].message));assert.equal(publicRows[0].exportRecord.media.duration,'2 h');
 assert(!fs.readFileSync('E:/Deliverables/cloudsave-auto-save-1.20.11-final-20260921/cloudsave-windows/renderer.js','utf8').includes('submission-recheck'));
 console.log('PASS pack range recognition, largest range, durable coverage, larger upgrade, missing-episode overlap, local film/seed info, one media fetch, restart reuse, duplicate preserves cache, full torrent files retained, public IDs removed');
})().catch(e=>{console.error(e);process.exit(1)});

