const assert=require('node:assert/strict'),{decide}=require('../share115-filters');
const base=Date.parse('2026-10-16T12:00:00+08:00'),original=Date.now;let reads=0;
try{Date.now=()=>base+reads++;
 for(const date of ['昨天','昨日','1天前','24小时前']){reads=0;assert(decide({withinDays:1},{date},0).allowed,date+' stays on the inclusive one-day boundary');assert.equal(reads,1,'One wall-clock snapshot per decision');}
 for(const date of ['今天','今日','刚刚','1小时前'])assert(decide({withinDays:1},{date},0).allowed);
 for(const date of ['前天','2天前','49小时前'])assert(!decide({withinDays:1},{date},0).allowed);
 const iso=time=>new Date(time).toISOString();assert(decide({withinDays:1},{date:iso(base-86400000)},0,base).allowed);assert(!decide({withinDays:1},{date:iso(base-86400001)},0,base).allowed);assert(decide({withinDays:1},{date:iso(base+86400000)},0,base).allowed);assert(!decide({withinDays:1},{date:iso(base+86400001)},0,base).allowed);
 assert(!decide({withinDays:1},{date:''},0,base).allowed);assert(decide({withinDays:0},{date:''},0,base).allowed);assert(!decide({withinDays:1,minSizeGB:2},{date:'今天'},1,base).allowed);
 console.log('PASS one clock snapshot stabilizes yesterday/one-day relative boundaries; absolute bounds, older/missing dates and size filters preserved');
}finally{Date.now=original;}
