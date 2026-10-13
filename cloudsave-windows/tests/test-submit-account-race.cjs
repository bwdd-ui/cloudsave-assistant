const assert = require('node:assert/strict'), { CloudSubmitSync } = require('../cloud-submit-sync');
(async () => {
  let uid = 'old', timers = [], reject, calls = 0;
  const sync = new CloudSubmitSync({ account: () => uid, now: () => 100000,
    setTimer: fn => { const item = { fn }; timers.push(item); return item; }, clearTimer: item => timers = timers.filter(t => t !== item),
    sync: () => { calls++; return calls === 1 ? new Promise((_, fail) => reject = fail) : Promise.resolve({ tasks: { next: {} } }); }
  });
  sync.trigger(uid, 'previous'); const first = timers.shift().fn(); await Promise.resolve();
  uid = 'new'; sync.trigger(uid, 'next'); reject(Error('old account failed'));
  await first;
  assert.equal(sync.retries, 0); assert(sync.expected.has('next')); assert.equal(timers.length, 1);
  await timers.shift().fn(); assert.equal(calls, 2); assert.equal(sync.expected.size, 0);
  // A close during an in-flight request must never re-arm the scheduler.
  sync.sync = () => new Promise((_, fail) => reject = fail);
  sync.trigger(uid, 'next'); const running = timers.shift().fn(); await Promise.resolve(); sync.close();
  reject(Error('closed request')); await running; assert.equal(timers.length, 0);
  sync.trigger(uid, 'after-close'); assert.equal(timers.length, 0);
  console.log('PASS account switch during failed increment retains new-account submissions; close blocks late rearming');
})().catch(error => { console.error(error); process.exitCode = 1; });
