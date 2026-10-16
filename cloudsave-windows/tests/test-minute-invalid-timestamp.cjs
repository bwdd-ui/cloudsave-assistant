const assert=require('node:assert/strict'),{minuteMatch,updateValue}=require('../monitor-time');
const filters={dateMode:'minutes',withinMinutes:60};
for(const [invalid,normalized] of [['2026-02-30T12:00:00+08:00','2026-03-02T12:10:00+08:00'],['2025-02-29T12:00:00+08:00','2025-03-01T12:10:00+08:00'],['2026-04-31T12:00:00+08:00','2026-05-01T12:10:00+08:00'],['2026/2/30 12:00:00+08:00','2026-03-02T12:10:00+08:00']]){
 assert(!minuteMatch(invalid,filters,Date.parse(normalized)),invalid+' must not normalize into recent window');
 const valid=normalized;assert.equal(updateValue({date:'2026/3/2',raw:{eztime:invalid,updated_at:valid}}),valid,'Invalid precise metadata must not hide valid fallback');
}
assert(minuteMatch('2024-02-29T12:00:00+08:00',filters,Date.parse('2024-02-29T12:30:00+08:00')));
assert(minuteMatch('2026-10-16T04:00:00Z',filters,Date.parse('2026-10-16T12:30:00+08:00')));
assert(minuteMatch('2026/10/16',{dateMode:'minutes',withinMinutes:5},Date.parse('2026-10-16T12:30:00+08:00')));
assert(minuteMatch('3分钟前',{dateMode:'minutes',withinMinutes:5},Date.parse('2026-10-16T12:30:00+08:00')));
console.log('PASS impossible timestamp calendar dates rejected, valid metadata fallback, leap dates, timezone, date-only and relative windows preserved');
