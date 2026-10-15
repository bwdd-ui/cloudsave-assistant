const assert=require('node:assert/strict'),{sizeGB,decide}=require('../share115-filters');
for(const value of [Infinity,-Infinity,NaN,-2,0,'-2 GB','-.5 GiB','2..5 GB','1e3 GB','9'.repeat(400)+' TB','unknown'])assert.equal(sizeGB(value),0,'Reject malformed size '+value);
for(const [value,expected]of [[2,2],['2 GB',2],['.5 GiB',0.5],['大小：1,024 MiB',1],['1 TB',1024],['1024 KB',1/1024],['1073741824 Bytes',1]])assert.equal(sizeGB(value),expected,String(value));
for(const value of [Infinity,-Infinity,NaN,0,-2,'2'])assert(!decide({minSizeGB:1},{},value).allowed,'Unknown/non-finite size cannot pass minimum-only filter');
assert(decide({minSizeGB:1,maxSizeGB:3},{},1).allowed);assert(decide({minSizeGB:1,maxSizeGB:3},{},3).allowed);assert(!decide({minSizeGB:1,maxSizeGB:3},{},0.99).allowed);assert(!decide({minSizeGB:1,maxSizeGB:3},{},3.01).allowed);assert(decide({},{},Infinity).allowed,'Disabled size filter retains behavior');
console.log('PASS finite positive size parsing, malformed/negative/exponent/overflow rejection, unit conversions and inclusive bounds; minimum-only Infinity bypass blocked');
