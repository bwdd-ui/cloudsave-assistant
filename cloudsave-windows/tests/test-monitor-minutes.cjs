const assert=require('assert/strict'),time=require('../monitor-time'),{normalizeOptions,legacyFilters}=require('../guanying-monitor');
const now=Date.parse('2026-10-09T10:00:00+08:00'),f={dateMode:'minutes',withinMinutes:15};
assert(time.minuteMatch(now-14*60000,f,now));assert(time.minuteMatch(now-15*60000,f,now));assert(!time.minuteMatch(now-16*60000,f,now));assert(!time.minuteMatch(now+1,f,now));assert(time.minuteMatch('5分钟前',f,now));assert(!time.minuteMatch('1小时前',f,now));assert(!time.minuteMatch('2026-10-08',f,now));assert(time.minuteMatch('2026-10-09',f,now));
for(const v of [0,-1,1.1,'',NaN,Infinity,525601])assert.throws(()=>time.minutes(v));
const o=normalizeOptions({dateMode:'minutes',withinMinutes:7});assert.equal(o.withinMinutes,7);assert.equal(legacyFilters(o).dateMode,'minutes');assert.equal(legacyFilters(o).withinMinutes,7);assert.equal(time.updateValue({date:'2026-10-09',raw:{eztime:now/1000}}),now/1000);assert(time.scanLowerBound(f,now)<time.lowerBound(f,now));
console.log('PASS minute cutoff boundaries, future exclusion, relative minutes, date-only conservative precision, validation and shared monitor serialization');
